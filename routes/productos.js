const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// ⚠️  Rutas específicas ANTES de la genérica /:id

// GET /api/productos/ranking?sort=asc|desc
router.get('/ranking', async (req, res) => {
    const direccion = req.query.sort === 'asc' ? 'ASC' : 'DESC';
    try {
        const result = await pool.query(`
            SELECT
                p.nombre,
                c.nombre AS categoria_nombre,
                p.unidad_medida,
                SUM(dv.cantidad)                       AS cantidad_vendida,
                SUM(dv.cantidad * dv.precio_unitario)  AS total_ingresos
            FROM detalle_venta dv
            JOIN productos  p ON dv.id_producto = p.id_producto
            JOIN categorias c ON p.id_categoria = c.id_categoria
            GROUP BY p.id_producto, p.nombre, c.nombre, p.unidad_medida
            ORDER BY cantidad_vendida ${direccion}
            LIMIT 10
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error en ranking:', error);
        res.status(500).json({ error: 'Error al procesar ranking.' });
    }
});

// GET /api/productos/vendedor/:idVendedor
router.get('/vendedor/:idVendedor', async (req, res) => {
    const { idVendedor } = req.params;
    try {
        const result = await pool.query(`
            SELECT
                p.id_producto AS id, p.nombre, p.precio, p.descripcion,
                p.imagen_url, p.id_categoria, p.stock, p.unidad_medida,
                c.nombre AS categoria_nombre
            FROM productos p
            LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
            WHERE p.id_vendedor = $1
            ORDER BY p.id_producto DESC
        `, [idVendedor]);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error al obtener productos del vendedor:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/productos?categoria=...
router.get('/', async (req, res) => {
    const { categoria } = req.query;
    try {
        let query = `
            SELECT
                p.id_producto AS id, p.nombre, p.precio, p.descripcion,
                p.imagen_url, p.id_categoria, p.stock, p.unidad_medida,
                c.nombre AS categoria_nombre
            FROM productos p
            INNER JOIN categorias c ON p.id_categoria = c.id_categoria
            WHERE p.activo = true
        `;
        const params = [];
        if (categoria) {
            query += ' AND c.nombre ILIKE $1';
            params.push(categoria);
        }
        query += ' ORDER BY p.id_producto ASC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error al obtener productos:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/productos
router.post('/', async (req, res) => {
    const { nombre, precio, descripcion, imagen_url, id_categoria, id_vendedor, stock, unidad_medida } = req.body;
    try {
        const result = await pool.query(`
            INSERT INTO productos
                (nombre, precio, descripcion, imagen_url, id_categoria, id_vendedor, stock, unidad_medida, activo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
            RETURNING id_producto AS id
        `, [nombre, precio, descripcion, imagen_url, id_categoria, id_vendedor, stock || 0, unidad_medida || 'pz']);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('❌ Error al crear producto:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/productos/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, precio, descripcion, imagen_url, id_categoria, stock, unidad_medida } = req.body;
    try {
        await pool.query(`
            UPDATE productos
            SET nombre=$1, precio=$2, descripcion=$3, imagen_url=$4,
                id_categoria=$5, stock=$6, unidad_medida=$7
            WHERE id_producto = $8
        `, [nombre, precio, descripcion, imagen_url, id_categoria, stock || 0, unidad_medida || 'pz', id]);
        res.json({ message: 'Producto actualizado correctamente.' });
    } catch (error) {
        console.error('❌ Error al actualizar producto:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/productos/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM productos WHERE id_producto = $1', [id]);
        res.json({ message: 'Producto eliminado correctamente.' });
    } catch (error) {
        console.error('❌ Error al eliminar producto:', error);
        res.status(500).json({ error: 'Error al eliminar producto.' });
    }
});

module.exports = router;