const express          = require('express');
const router           = express.Router();
const pool             = require('../db');
const { generarFolio } = require('../utils/folio');

// GET /api/reportes
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
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

        const reportes = result.rows.map(venta => ({
            ...venta,
            folio: generarFolio(venta.id_venta),
        }));

        res.json(reportes);
    } catch (error) {
        console.error('❌ Error al obtener reportes:', error);
        res.status(500).json({ error: 'Error al obtener reportes.' });
    }
});

module.exports = router;