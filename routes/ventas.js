const express      = require('express');
const router       = express.Router();
const pool         = require('../db');
const { generarFolio } = require('../utils/folio');

// POST /api/ventas
router.post('/', async (req, res) => {
    const { id_cliente, total, metodo_pago, items } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Pedido
        const pedidoRes = await client.query(`
            INSERT INTO pedidos (id_usuario, estado, total, fecha_pedido)
            VALUES ($1, 'completado', $2, NOW())
            RETURNING id_pedido
        `, [id_cliente || null, total]);

        // 2. Venta
        const ventaRes = await client.query(`
            INSERT INTO ventas (id_pedido, id_cliente, id_vendedor, total, metodo_pago, fecha_venta)
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id_venta, fecha_venta
        `, [pedidoRes.rows[0].id_pedido, id_cliente || null, 1, total, metodo_pago || 'efectivo']);

        const { id_venta, fecha_venta } = ventaRes.rows[0];

        // 3. Detalle de productos
        if (Array.isArray(items) && items.length > 0) {
            for (const item of items) {
                const productId = item.id ?? item.id_producto;
                const precio    = parseFloat(item.precio);
                const cantidad  = parseInt(item.quantity ?? item.cantidad ?? 1);

                if (!productId || isNaN(precio) || isNaN(cantidad)) continue;

                await client.query(`
                    INSERT INTO detalle_venta (id_venta, id_producto, cantidad, precio_unitario)
                    VALUES ($1, $2, $3, $4)
                `, [id_venta, productId, cantidad, precio]);
            }
            console.log(`📦 Detalle: ${items.length} productos → Venta #${id_venta}`);
        } else {
            console.warn(`⚠️  Venta #${id_venta} sin items — detalle_venta vacío.`);
        }

        await client.query('COMMIT');

        const folio = generarFolio(id_venta);
        console.log(`✅ Venta registrada | ID: ${id_venta} | Folio: ${folio}`);

        res.json({ success: true, id_venta, folio, fecha_venta });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en venta:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
});

module.exports = router;