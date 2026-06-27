// ============================================================
// EcoMercado — Reportes (híbrido Neon + MongoDB Atlas)
// Neon:    datos de ventas y usuarios
// MongoDB: folios, metadatos del documento, historial
// ============================================================
const express          = require('express');
const router           = express.Router();
const pool             = require('../db');
const { getReportesCol } = require('../mongo');
const { generarFolio } = require('../utils/folio');

// ── GET /api/reportes ─────────────────────────────────────────
// Fusiona ventas de Neon con folios/metadatos de MongoDB
router.get('/', async (req, res) => {
    try {
        // 1. Ventas desde Neon (PostgreSQL)
        const ventasSQL = await pool.query(`
            SELECT
                v.id_venta,
                COALESCE(u.nombre || ' ' || u.apellido, 'Consumidor Final') AS cliente,
                v.total,
                v.metodo_pago,
                v.fecha_venta
            FROM ventas v
            LEFT JOIN usuarios u ON v.id_cliente = u.id_usuario
            ORDER BY v.fecha_venta DESC
        `);

        // 2. Documentos desde MongoDB Atlas
        const col       = await getReportesCol();
        const docsMongo = await col.find({}).toArray();

        // 3. Fusionar: cada venta de Neon + su folio de MongoDB
        const reportes = ventasSQL.rows.map(venta => {
            const doc = docsMongo.find(d => d.id_venta_sql === venta.id_venta);
            return {
                ...venta,
                folio:        doc ? doc.folio        : generarFolio(venta.id_venta),
                documento:    doc ? doc.documento    : null,
                fecha_emision: doc ? doc.fecha_emision : null,
                en_mongo:     !!doc,   // útil para saber si ya fue procesado
            };
        });

        res.json(reportes);
    } catch (error) {
        console.error('❌ Error al fusionar reportes:', error);
        res.status(500).json({ error: 'Error al obtener reportes híbridos.' });
    }
});

// 🔥 NUEVO: POST /api/reportes/crear ───────────────────────────
// Permite insertar un reporte de prueba directo en MongoDB Atlas
router.post('/crear', async (req, res) => {
    try {
        const col = await getReportesCol();
        
        // Estructura adaptada al esquema de ReporteVenta que espera tu frontend
        const nuevoReporte = {
            id_venta_sql:  req.body.id_venta_sql || Math.floor(Math.random() * 1000),
            folio:         req.body.folio || "FOL-PRUEBA-" + Date.now().toString().slice(-4),
            resumen: {
                cliente:      req.body.cliente || "Cliente de Prueba Atlas",
                total_pago:   parseFloat(req.body.total_pago) || 150.00,
                metodo:       req.body.metodo || "Efectivo",
                items_count:  parseInt(req.body.items_count) || 2
            },
            documento: {
                nombre_archivo: req.body.nombre_archivo || "reporte_prueba.pdf",
                url_descarga:   req.body.url_descarga || "http://example.com/download"
            },
            fecha_emision: new Date().toISOString()
        };

        const result = await col.insertOne(nuevoReporte);
        console.log(`🍃 Reporte insertado directamente en Atlas con ID: ${result.insertedId}`);
        
        res.status(201).json({ 
            success: true, 
            message: '¡Reporte guardado con éxito en MongoDB Atlas!', 
            insertedId: result.insertedId 
        });
    } catch (error) {
        console.error('❌ Error al crear reporte directo:', error);
        res.status(500).json({ error: 'No se pudo guardar el reporte en MongoDB Atlas.' });
    }
});

// ── GET /api/reportes/:id_venta ───────────────────────────────
// Detalle completo de una venta: SQL + MongoDB
router.get('/:id_venta', async (req, res) => {
    const id_venta = parseInt(req.params.id_venta);
    try {
        const ventaSQL = await pool.query(`
            SELECT
                v.id_venta, v.total, v.metodo_pago, v.fecha_venta,
                COALESCE(u.nombre || ' ' || u.apellido, 'Consumidor Final') AS cliente,
                u.email
            FROM ventas v
            LEFT JOIN usuarios u ON v.id_cliente = u.id_usuario
            WHERE v.id_venta = $1
        `, [id_venta]);

        if (ventaSQL.rows.length === 0)
            return res.status(404).json({ error: 'Venta no encontrada.' });

        const productosSQL = await pool.query(`
            SELECT p.nombre, p.unidad_medida,
                   dv.cantidad, dv.precio_unitario,
                   (dv.cantidad * dv.precio_unitario) AS subtotal
            FROM detalle_venta dv
            JOIN productos p ON dv.id_producto = p.id_producto
            WHERE dv.id_venta = $1
        `, [id_venta]);

        const col = await getReportesCol();
        const doc = await col.findOne({ id_venta_sql: id_venta });

        res.json({
            ...ventaSQL.rows[0],
            productos:     productosSQL.rows,
            folio:         doc ? doc.folio      : generarFolio(id_venta),
            documento:     doc ? doc.documento  : null,
            en_mongo:      !!doc,
        });
    } catch (error) {
        console.error('❌ Error al obtener reporte:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── POST /api/reportes/generar/:id_venta ──────────────────────
// Genera y guarda el folio en MongoDB para una venta existente
router.post('/generar/:id_venta', async (req, res) => {
    const id_venta = parseInt(req.params.id_venta);
    try {
        const col = await getReportesCol();

        // Idempotencia: no duplicar
        const yaExiste = await col.findOne({ id_venta_sql: id_venta });
        if (yaExiste)
            return res.json({ message: 'Ya existe un reporte para esta venta.', folio: yaExiste.folio });

        // Datos de la venta desde Neon
        const ventaSQL = await pool.query(`
            SELECT v.id_venta, v.total, v.metodo_pago, v.fecha_venta,
                   COALESCE(u.nombre || ' ' || u.apellido, 'Consumidor Final') AS cliente
            FROM ventas v
            LEFT JOIN usuarios u ON v.id_cliente = u.id_usuario
            WHERE v.id_venta = $1
        `, [id_venta]);

        if (ventaSQL.rows.length === 0)
            return res.status(404).json({ error: 'Venta no encontrada en Neon.' });

        const venta = ventaSQL.rows[0];
        const folio = generarFolio(id_venta);

        // Guardar en MongoDB Atlas
        await col.insertOne({
            id_venta_sql:  id_venta,
            folio,
            documento: {
                formato:      'JSON',
                generado_at:  new Date(),
            },
            resumen: {
                cliente:      venta.cliente,
                total:        parseFloat(venta.total),
                metodo_pago:  venta.metodo_pago,
                fecha_compra: venta.fecha_venta,
            },
            fecha_emision: new Date(),
        });

        console.log(`📄 MongoDB ← Folio ${folio} | Venta #${id_venta}`);
        res.status(201).json({ success: true, folio, id_venta });

    } catch (error) {
        console.error('❌ Error al generar reporte:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── DELETE /api/reportes/mongo/:id_venta ──────────────────────
// Elimina el documento de MongoDB (no toca Neon)
router.delete('/mongo/:id_venta', async (req, res) => {
    const id_venta = parseInt(req.params.id_venta);
    try {
        const col    = await getReportesCol();
        const result = await col.deleteOne({ id_venta_sql: id_venta });
        if (result.deletedCount === 0)
            return res.status(404).json({ error: 'No hay reporte en MongoDB para esta venta.' });
        res.json({ success: true, message: `Reporte de venta #${id_venta} eliminado de MongoDB.` });
    } catch (error) {
        console.error('❌ Error al eliminar reporte de MongoDB:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;