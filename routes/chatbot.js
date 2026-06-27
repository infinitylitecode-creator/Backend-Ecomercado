const express   = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache de productos: se refresca cada 5 minutos
let productosCache      = [];
let ultimaActualizacion = 0;

async function obtenerProductos() {
    const ahora = Date.now();
    if (ahora - ultimaActualizacion < 5 * 60 * 1000 && productosCache.length > 0)
        return productosCache;

    try {
        const result = await pool.query(`
            SELECT p.nombre, p.precio, p.stock, p.unidad_medida,
                   c.nombre AS categoria_nombre
            FROM productos p
            JOIN categorias c ON p.id_categoria = c.id_categoria
            WHERE p.activo = true
            ORDER BY c.nombre, p.nombre
        `);
        productosCache      = result.rows;
        ultimaActualizacion = ahora;
        console.log(`🛒 Catálogo cargado: ${productosCache.length} productos`);
    } catch (err) {
        console.warn('⚠️  No se pudo actualizar catálogo:', err.message);
    }
    return productosCache;
}

function buildSystemPrompt(productos) {
    const lista = productos.length > 0
        ? productos.map(p =>
            `- ${p.nombre} | $${parseFloat(p.precio).toFixed(2)} | Stock: ${p.stock} ${p.unidad_medida} | Categoría: ${p.categoria_nombre}`
          ).join('\n')
        : 'No hay productos disponibles en este momento.';

    return `Eres el asistente virtual de EcoMercado, un mercado de productos orgánicos de Oaxaca, México.

Tu personalidad:
- Amable, cercano y conocedor de productos orgánicos locales.
- Respondes siempre en español y de forma concisa (máximo 3 oraciones, salvo que pidan un listado).
- Si no sabes algo, lo dices honestamente.

Puedes ayudar con:
- Información sobre productos disponibles, precios y stock.
- Ayudar al cliente a elegir productos según sus necesidades.
- Métodos de pago: efectivo, tarjeta, OXXO, 7-Eleven, Farmacias del Ahorro.
- Explicar el proceso de compra en EcoMercado.

No debes:
- Procesar pagos ni modificar pedidos directamente.
- Inventar productos fuera del catálogo.
- Salirte del tema de EcoMercado.

Catálogo actual:
${lista}`;
}

// POST /api/chat
// Body: { messages: [{ role: 'user'|'assistant', content: string }] }
router.post('/', async (req, res) => {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0)
        return res.status(400).json({ error: '"messages" debe ser un array con al menos un elemento.' });

    if (messages[messages.length - 1].role !== 'user')
        return res.status(400).json({ error: 'El último mensaje debe ser del usuario.' });

    try {
        const productos    = await obtenerProductos();
        const systemPrompt = buildSystemPrompt(productos);

        const response = await anthropic.messages.create({
            model:      'claude-sonnet-4-6',
            max_tokens: 1024,
            system:     systemPrompt,
            messages,
        });

        const texto = response.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('');

        console.log(`💬 Chat | ${response.usage.input_tokens}in / ${response.usage.output_tokens}out tokens`);
        res.json({ reply: texto });

    } catch (error) {
        console.error('❌ Error en chatbot:', error.message);
        res.status(500).json({ error: 'El asistente no está disponible en este momento.' });
    }
});

// GET /api/chat/health
router.get('/health', async (req, res) => {
    const productos = await obtenerProductos();
    res.json({
        status:    'ok',
        productos: productos.length,
        modelo:    'claude-sonnet-4-6',
        apiKey:    process.env.ANTHROPIC_API_KEY ? 'cargada' : 'FALTA',
    });
});

module.exports = router;