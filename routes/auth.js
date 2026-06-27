const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email y contraseña son requeridos.' });

    try {
        const result = await pool.query(`
            SELECT u.id_usuario, u.nombre, u.email, u.id_rol, r.nombre_rol
            FROM usuarios u
            INNER JOIN roles r ON u.id_rol = r.id_rol
            WHERE LOWER(u.email) = LOWER($1) AND u.password_hash = $2
            LIMIT 1
        `, [email, password]);

        if (result.rows.length === 0)
            return res.status(401).json({ error: 'Credenciales incorrectas.' });

        const usuario = result.rows[0];
        console.log(`✅ Login: ${usuario.email} | Rol: ${usuario.id_rol} (${usuario.nombre_rol})`);
        res.json(usuario);
    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;