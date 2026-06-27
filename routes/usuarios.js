const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /api/usuarios
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id_usuario, nombre, apellido, email, id_rol, activo
            FROM usuarios
            ORDER BY id_usuario ASC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Error al obtener usuarios:', error);
        res.status(500).json({ error: 'Error al obtener usuarios.' });
    }
});

// 🔥 NUEVO ENDPOINT: POST /api/usuarios/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña requeridos.' });
    }

    try {
        // Busca el usuario en Postgres (Neon) evaluando el correo y que esté activo
        const result = await pool.query(
            'SELECT id_usuario, nombre, email, id_rol, password_hash FROM usuarios WHERE LOWER(email) = LOWER($1) AND activo = true',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales incorrectas o usuario inactivo.' });
        }

        const usuario = result.rows[0];

        // Verificación de texto plano (puedes meter bcrypt aquí más adelante si lo usas)
        if (usuario.password_hash !== password) {
            return res.status(401).json({ error: 'Credenciales incorrectas.' });
        }

        // Retorna los datos exactos que tu Frontend de Angular espera almacenar en el localStorage
        res.json({
            id_usuario: usuario.id_usuario,
            nombre: usuario.nombre,
            email: usuario.email,
            id_rol: usuario.id_rol
        });

    } catch (error) {
        console.error('❌ Error en el proceso de Login:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// POST /api/usuarios/registrar
router.post('/registrar', async (req, res) => {
    const { nombre, email, password, id_rol } = req.body;
    if (!nombre || !email || !password || !id_rol)
        return res.status(400).json({ error: 'Todos los campos son requeridos.' });

    try {
        const check = await pool.query(
            'SELECT id_usuario FROM usuarios WHERE LOWER(email) = LOWER($1)', [email]
        );
        if (check.rows.length > 0)
            return res.status(400).json({ error: 'Este correo ya está registrado en EcoMercado.' });

        const result = await pool.query(`
            INSERT INTO usuarios (nombre, apellido, email, password_hash, id_rol, activo, created_at)
            VALUES ($1, '', $2, $3, $4, true, NOW())
            RETURNING id_usuario, nombre, email
        `, [nombre, email, password, id_rol]);

        console.log(`👤 Nuevo usuario: ${email} | ID: ${result.rows[0].id_usuario}`);
        res.status(201).json({ message: 'Usuario registrado con éxito.', user: result.rows[0] });
    } catch (error) {
        console.error('❌ Error en registro:', error);
        if (error.code === '23505')
            return res.status(400).json({ error: 'El correo ya existe.' });
        res.status(500).json({ error: 'No se pudo completar el registro.' });
    }
});

// PUT /api/usuarios/ascender/:id
router.put('/ascender/:id', async (req, res) => {
    const { id } = req.params;
    const { nuevoRolId } = req.body;
    if (!nuevoRolId)
        return res.status(400).json({ error: 'nuevoRolId es requerido.' });

    try {
        const result = await pool.query(`
            UPDATE usuarios SET id_rol = $1
            WHERE id_usuario = $2
            RETURNING id_usuario, nombre, email, id_rol
        `, [nuevoRolId, id]);

        if (result.rows.length === 0)
            return res.status(404).json({ error: 'Usuario no encontrado.' });

        res.json(result.rows[0]);
    } catch (error) {
        console.error('❌ Error al ascender usuario:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/usuarios/reset-password
router.put('/reset-password', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email y nueva contraseña son requeridos.' });

    try {
        let emailFinal = email.trim();
        if (!emailFinal.includes('@')) emailFinal += '@ecomercado.com';

        const resultado = await pool.query(
            'UPDATE usuarios SET password_hash = $1 WHERE email = $2 RETURNING id_usuario',
            [password, emailFinal]
        );

        if (resultado.rowCount > 0) {
            console.log(`🔐 Contraseña actualizada: ${emailFinal}`);
            res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
        } else {
            res.status(404).json({ error: 'El correo no está registrado en EcoMercado.' });
        }
    } catch (error) {
        console.error('❌ Error al resetear contraseña:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

module.exports = router;