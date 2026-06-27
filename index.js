// ============================================================
// EcoMercado — Servidor principal
// PostgreSQL (Neon) + MongoDB Atlas + IA (Anthropic)
// ============================================================
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const pool       = require('./db');
const { conectarMongo } = require('./mongo');
const { monitorMiddleware, inicializarTablaMonitor } = require('./middleware/monitor');

const app  = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Monitor (intercepta todo antes de las rutas) ──────────────
app.use(monitorMiddleware);

// ── Rutas ─────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/usuarios',  require('./routes/usuarios'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/ventas',    require('./routes/ventas'));
app.use('/api/reportes',  require('./routes/reportes'));
app.use('/api/chat',      require('./routes/chatbot'));
app.use('/api/monitor',   require('./routes/monitor'));

// ── Inicio: Neon + MongoDB + tabla monitor ────────────────────
async function iniciar() {
    try {
        // Neon PostgreSQL
        await pool.query('SELECT 1');
        console.log('✅ Neon PostgreSQL conectado.');

        // MongoDB Atlas
        await conectarMongo();

        // Tabla de monitoreo
        await inicializarTablaMonitor();

    } catch (err) {
        console.error('❌ Error al iniciar conexiones:', err.message);
        process.exit(1);
    }
}

iniciar();

// ── Arranque ──────────────────────────────────────────────────
app.listen(port, () => {
    console.log('\n====================================================');
    console.log(`🚀 EcoMercado API:   http://localhost:${port}`);
    console.log('🌩️  Neon PostgreSQL: cloud');
    console.log('🍃 MongoDB Atlas:    cloud');
    console.log(`🤖 Chatbot IA:       http://localhost:${port}/api/chat`);
    console.log(`📡 Monitor:          http://localhost:${port}/api/monitor/resumen`);
    console.log('====================================================\n');
});