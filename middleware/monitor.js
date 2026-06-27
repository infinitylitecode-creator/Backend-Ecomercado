// ============================================================
// EcoMercado — Monitor de Actividad (Middleware)
// ============================================================
const pool = require('../db');

// ── Inicializa la tabla si no existe ─────────────────────────
async function inicializarTablaMonitor() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS monitor_actividad (
                id              SERIAL PRIMARY KEY,
                id_usuario      INTEGER,
                nombre_usuario  VARCHAR(120),
                email_usuario   VARCHAR(200),
                rol_usuario     VARCHAR(60),
                ip_origen       VARCHAR(60),
                user_agent      TEXT,
                origen_cors     VARCHAR(200),
                metodo          VARCHAR(10),
                ruta            TEXT,
                query_params    TEXT,
                body_resumen    TEXT,
                status_code     INTEGER,
                estado          VARCHAR(20),
                duracion_ms     INTEGER,
                es_escritura    BOOLEAN,
                endpoint_grupo  VARCHAR(60),
                fecha_hora      TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_monitor_fecha   ON monitor_actividad (fecha_hora DESC);
            CREATE INDEX IF NOT EXISTS idx_monitor_usuario ON monitor_actividad (id_usuario);
            CREATE INDEX IF NOT EXISTS idx_monitor_ip      ON monitor_actividad (ip_origen);
            CREATE INDEX IF NOT EXISTS idx_monitor_estado  ON monitor_actividad (estado);
        `);

        console.log('📡 Monitor de actividad: tabla lista.');
    } catch (err) {
        console.warn('⚠️  Monitor: no se pudo crear la tabla:', err.message);
    }
}

// ── IP real (soporta proxies) ─────────────────────────────────
function extraerIP(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        'desconocida'
    );
}

// ── Grupo del endpoint ────────────────────────────────────────
function extraerGrupo(ruta) {
    const segmento = (ruta || '').split('/')[2] || '';
    const mapa = {
        auth:      'auth',
        usuarios:  'usuarios',
        productos: 'productos',
        ventas:    'ventas',
        reportes:  'reportes',
        chat:      'chatbot-ia',
        monitor:   'monitor',
    };
    return mapa[segmento] || segmento || 'raiz';
}

// ── Sanitiza body (nunca loguear passwords) ───────────────────
function sanitizarBody(body) {
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0)
        return null;

    const copia = { ...body };
    ['password', 'password_hash', 'token', 'secret', 'api_key'].forEach(k => {
        if (copia[k]) copia[k] = '***';
    });
    if (Array.isArray(copia.items))
        copia.items = `[${copia.items.length} producto(s)]`;
    if (Array.isArray(copia.messages)) {
        const ultimo = copia.messages[copia.messages.length - 1];
        copia.messages = `[${copia.messages.length} msg(s)] Último: "${String(ultimo?.content || '').substring(0, 60)}"`;
    }
    return JSON.stringify(copia).substring(0, 400);
}

// ── Middleware principal ──────────────────────────────────────
function monitorMiddleware(req, res, next) {
    const inicio = Date.now();

    res.on('finish', async () => {
        const duracion    = Date.now() - inicio;
        const statusCode  = res.statusCode;
        const esEscritura = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);

        let estado = 'OK';
        if (statusCode === 401 || statusCode === 403) estado = 'NO_AUTH';
        else if (statusCode >= 500)                   estado = 'ERROR_SERVIDOR';
        else if (statusCode >= 400)                   estado = 'ERROR';

        if (req.path === '/favicon.ico') return;

        const usuario = req.usuario || null;
        const ip      = extraerIP(req);

        try {
            await pool.query(`
                INSERT INTO monitor_actividad
                    (id_usuario, nombre_usuario, email_usuario, rol_usuario,
                     ip_origen, user_agent, origen_cors,
                     metodo, ruta, query_params, body_resumen,
                     status_code, estado, duracion_ms,
                     es_escritura, endpoint_grupo)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            `, [
                usuario?.id_usuario || null,
                usuario?.nombre     || null,
                usuario?.email      || null,
                usuario?.nombre_rol || null,
                ip,
                (req.headers['user-agent'] || '').substring(0, 300) || null,
                req.headers['origin'] || req.headers['referer'] || null,
                req.method,
                req.path,
                Object.keys(req.query).length ? JSON.stringify(req.query) : null,
                sanitizarBody(req.body),
                statusCode,
                estado,
                duracion,
                esEscritura,
                extraerGrupo(req.path),
            ]);
        } catch (err) {
            console.warn('⚠️  Monitor: error al registrar:', err.message);
        }
    });

    next();
}

module.exports = { monitorMiddleware, inicializarTablaMonitor };