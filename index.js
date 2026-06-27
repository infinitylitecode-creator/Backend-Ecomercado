// ============================================================
// EcoMercado — Servidor principal
// ============================================================
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const pool     = require('./db');
const { monitorMiddleware, inicializarTablaMonitor } = require('./middleware/monitor');

const app  = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Monitor de actividad (antes de las rutas) ─────────────────
// Intercepta TODAS las solicitudes y las registra en Neon
app.use(monitorMiddleware);

// ── Rutas ─────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/usuarios',  require('./routes/usuarios'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/ventas',    require('./routes/ventas'));
app.use('/api/reportes',  require('./routes/reportes'));
app.use('/api/chat',      require('./routes/chatbot'));
app.use('/api/monitor',   require('./routes/monitor'));   // ← routes, no middleware  

// ── Conexión a Neon + inicialización del monitor ─────────────
pool.query('SELECT 1')
    .then(async () => {
        console.log('✅ Conexión a Neon establecida.');
        await inicializarTablaMonitor();   // crea la tabla si no existe
    })
    .catch(err => {
        console.error('❌ No se pudo conectar a Neon:', err.message);
        process.exit(1);
    });

// ── Arranque ──────────────────────────────────────────────────
app.listen(port, () => {
    console.log('\n====================================================');
    console.log(`🚀 EcoMercado API:   http://localhost:${port}`);
    console.log('🌩️  Base de datos:   Neon PostgreSQL (cloud)');
    console.log(`🤖 Chatbot IA:       http://localhost:${port}/api/chat`);
    console.log(`📡 Monitor:          http://localhost:${port}/api/monitor/resumen`);
    console.log('====================================================\n');
});