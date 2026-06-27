// ============================================================
// EcoMercado — Rutas del Monitor de Actividad
// GET /api/monitor/actividad     → historial completo
// GET /api/monitor/resumen       → métricas globales
// GET /api/monitor/usuarios      → actividad por usuario
// GET /api/monitor/alertas       → errores y anomalías
// GET /api/monitor/ips           → IPs más activas
// DELETE /api/monitor/limpiar    → purgar registros antiguos
// ============================================================
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// ── GET /api/monitor/actividad ────────────────────────────────
// Historial paginado. Query params: limit, offset, estado, grupo, usuario_id
router.get('/actividad', async (req, res) => {
    const limit      = Math.min(parseInt(req.query.limit)  || 50, 200);
    const offset     = parseInt(req.query.offset) || 0;
    const { estado, grupo, usuario_id, ip } = req.query;

    const condiciones = [];
    const params      = [];

    if (estado)     { params.push(estado);     condiciones.push(`estado = $${params.length}`); }
    if (grupo)      { params.push(grupo);      condiciones.push(`endpoint_grupo = $${params.length}`); }
    if (usuario_id) { params.push(usuario_id); condiciones.push(`id_usuario = $${params.length}`); }
    if (ip)         { params.push(ip);         condiciones.push(`ip_origen = $${params.length}`); }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    params.push(limit, offset);

    try {
        const result = await pool.query(`
            SELECT
                id,
                id_usuario,
                COALESCE(nombre_usuario, 'Anónimo')  AS nombre_usuario,
                COALESCE(email_usuario,  '—')         AS email_usuario,
                COALESCE(rol_usuario,    '—')         AS rol_usuario,
                ip_origen,
                origen_cors,
                metodo,
                ruta,
                query_params,
                body_resumen,
                status_code,
                estado,
                duracion_ms,
                es_escritura,
                endpoint_grupo,
                fecha_hora
            FROM monitor_actividad
            ${where}
            ORDER BY fecha_hora DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `, params);

        // Total para paginación
        const totalRes = await pool.query(
            `SELECT COUNT(*) AS total FROM monitor_actividad ${where}`,
            params.slice(0, -2)
        );

        res.json({
            total:    parseInt(totalRes.rows[0].total),
            limit,
            offset,
            registros: result.rows,
        });
    } catch (error) {
        console.error('❌ Monitor/actividad:', error);
        res.status(500).json({ error: 'Error al obtener actividad.' });
    }
});

// ── GET /api/monitor/resumen ──────────────────────────────────
// Métricas globales: totales, tasa de error, endpoints más usados
router.get('/resumen', async (req, res) => {
    try {
        const [totales, porEstado, porGrupo, tiempoPromedio, ultimas24h] = await Promise.all([

            pool.query(`SELECT COUNT(*) AS total_solicitudes FROM monitor_actividad`),

            pool.query(`
                SELECT estado, COUNT(*) AS cantidad
                FROM monitor_actividad
                GROUP BY estado ORDER BY cantidad DESC
            `),

            pool.query(`
                SELECT endpoint_grupo, COUNT(*) AS cantidad,
                       ROUND(AVG(duracion_ms)) AS duracion_promedio_ms
                FROM monitor_actividad
                GROUP BY endpoint_grupo ORDER BY cantidad DESC
            `),

            pool.query(`
                SELECT ROUND(AVG(duracion_ms)) AS promedio_ms,
                       MAX(duracion_ms)         AS maximo_ms,
                       MIN(duracion_ms)         AS minimo_ms
                FROM monitor_actividad
            `),

            pool.query(`
                SELECT COUNT(*) AS solicitudes_24h
                FROM monitor_actividad
                WHERE fecha_hora >= NOW() - INTERVAL '24 hours'
            `),
        ]);

        res.json({
            total_solicitudes:  parseInt(totales.rows[0].total_solicitudes),
            solicitudes_24h:    parseInt(ultimas24h.rows[0].solicitudes_24h),
            por_estado:         porEstado.rows,
            por_endpoint:       porGrupo.rows,
            tiempos:            tiempoPromedio.rows[0],
        });
    } catch (error) {
        console.error('❌ Monitor/resumen:', error);
        res.status(500).json({ error: 'Error al obtener resumen.' });
    }
});

// ── GET /api/monitor/usuarios ─────────────────────────────────
// Actividad agrupada por usuario: cuánto operó, qué hizo, cuándo fue la última vez
router.get('/usuarios', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id_usuario,
                COALESCE(nombre_usuario, 'Anónimo') AS nombre,
                COALESCE(email_usuario,  '—')        AS email,
                COALESCE(rol_usuario,    '—')        AS rol,
                COUNT(*)                             AS total_solicitudes,
                SUM(CASE WHEN es_escritura THEN 1 ELSE 0 END) AS operaciones_escritura,
                SUM(CASE WHEN estado = 'ERROR' THEN 1 ELSE 0 END) AS errores,
                ROUND(AVG(duracion_ms))              AS duracion_promedio_ms,
                MAX(fecha_hora)                      AS ultima_actividad,
                MIN(fecha_hora)                      AS primera_actividad,
                COUNT(DISTINCT ip_origen)            AS ips_distintas,
                -- Endpoints que más usa
                MODE() WITHIN GROUP (ORDER BY endpoint_grupo) AS endpoint_favorito
            FROM monitor_actividad
            WHERE id_usuario IS NOT NULL
            GROUP BY id_usuario, nombre_usuario, email_usuario, rol_usuario
            ORDER BY ultima_actividad DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Monitor/usuarios:', error);
        res.status(500).json({ error: 'Error al obtener actividad por usuario.' });
    }
});

// ── GET /api/monitor/alertas ──────────────────────────────────
// Anomalías: errores recientes, IPs con muchos fallos, respuestas lentas
router.get('/alertas', async (req, res) => {
    try {
        const [erroresRecientes, ipsConFallos, respuestasLentas, loginsFallidos] = await Promise.all([

            // Últimos 20 errores
            pool.query(`
                SELECT id, nombre_usuario, email_usuario, ip_origen,
                       metodo, ruta, status_code, estado, duracion_ms, fecha_hora
                FROM monitor_actividad
                WHERE estado IN ('ERROR', 'ERROR_SERVIDOR', 'NO_AUTH')
                ORDER BY fecha_hora DESC
                LIMIT 20
            `),

            // IPs con más de 5 errores en las últimas 2 horas
            pool.query(`
                SELECT ip_origen,
                       COUNT(*) AS total_errores,
                       MAX(fecha_hora) AS ultimo_error
                FROM monitor_actividad
                WHERE estado IN ('ERROR', 'NO_AUTH')
                  AND fecha_hora >= NOW() - INTERVAL '2 hours'
                GROUP BY ip_origen
                HAVING COUNT(*) >= 5
                ORDER BY total_errores DESC
            `),

            // Respuestas que tardaron más de 3 segundos
            pool.query(`
                SELECT id, nombre_usuario, ip_origen, metodo, ruta,
                       duracion_ms, status_code, fecha_hora
                FROM monitor_actividad
                WHERE duracion_ms > 3000
                ORDER BY duracion_ms DESC
                LIMIT 10
            `),

            // Intentos de login fallidos en las últimas 24h
            pool.query(`
                SELECT ip_origen,
                       COUNT(*) AS intentos_fallidos,
                       MAX(fecha_hora) AS ultimo_intento
                FROM monitor_actividad
                WHERE endpoint_grupo = 'auth'
                  AND status_code = 401
                  AND fecha_hora >= NOW() - INTERVAL '24 hours'
                GROUP BY ip_origen
                ORDER BY intentos_fallidos DESC
                LIMIT 10
            `),
        ]);

        res.json({
            errores_recientes:   erroresRecientes.rows,
            ips_sospechosas:     ipsConFallos.rows,
            respuestas_lentas:   respuestasLentas.rows,
            logins_fallidos:     loginsFallidos.rows,
        });
    } catch (error) {
        console.error('❌ Monitor/alertas:', error);
        res.status(500).json({ error: 'Error al obtener alertas.' });
    }
});

// ── GET /api/monitor/ips ──────────────────────────────────────
// IPs más activas con su comportamiento
router.get('/ips', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                ip_origen,
                COUNT(*)                             AS total_solicitudes,
                COUNT(DISTINCT id_usuario)           AS usuarios_distintos,
                COUNT(DISTINCT endpoint_grupo)       AS endpoints_visitados,
                SUM(CASE WHEN estado = 'ERROR'   THEN 1 ELSE 0 END) AS errores,
                SUM(CASE WHEN estado = 'NO_AUTH' THEN 1 ELSE 0 END) AS no_autorizados,
                SUM(CASE WHEN es_escritura       THEN 1 ELSE 0 END) AS escrituras,
                MAX(fecha_hora)                      AS ultima_actividad,
                ROUND(AVG(duracion_ms))              AS duracion_promedio_ms
            FROM monitor_actividad
            GROUP BY ip_origen
            ORDER BY total_solicitudes DESC
            LIMIT 30
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Monitor/ips:', error);
        res.status(500).json({ error: 'Error al obtener actividad por IP.' });
    }
});

// ── DELETE /api/monitor/limpiar ───────────────────────────────
// Elimina registros con más de N días (por defecto 30)
router.delete('/limpiar', async (req, res) => {
    const dias = parseInt(req.query.dias) || 30;
    try {
        const result = await pool.query(`
            DELETE FROM monitor_actividad
            WHERE fecha_hora < NOW() - ($1 || ' days')::INTERVAL
        `, [dias]);
        console.log(`🧹 Monitor: ${result.rowCount} registros eliminados (>${dias} días)`);
        res.json({ eliminados: result.rowCount, dias_retencion: dias });
    } catch (error) {
        console.error('❌ Monitor/limpiar:', error);
        res.status(500).json({ error: 'Error al limpiar registros.' });
    }
});

module.exports = router;