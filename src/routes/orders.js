// src/routes/orders.js — pedidos, custodia (escrow) y Mi cuenta.
// Pagos solo en BTC. NO hay compra automática:
// - El chat es solo para contactar y negociar. Enviar un mensaje
//   nunca crea un pedido, nunca marca un anuncio como vendido.
// - Cuando el trato se cierra en el chat, SOLO EL VENDEDOR marca su
//   anuncio como vendido (POST /api/orders/mark-sold, con confirmación
//   explícita). Eso crea el pedido con el pago RETENIDO en custodia.
// - El dinero queda retenido (estado: retenido) hasta que EL COMPRADOR
//   confirma que recibió el producto (POST /api/orders/:id/confirm-receipt).
//   Solo entonces el pago se libera al vendedor (estado: liberado).
//   El vendedor NO puede liberar el pago él mismo.
const express = require('express');
const db = require('../db');
const { formatBtc } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Estados de custodia del pedido.
// retenido: pago en BTC en custodia, esperando confirmación del comprador.
// liberado: el comprador confirmó que recibió el producto; pago liberado.
// pagado_btc / completado: estados antiguos, se conservan por compatibilidad.
// cancelado: pedido cancelado.
function escrowLabel(status) {
  switch (status) {
    case 'retenido':
      return 'Pago retenido en custodia — esperando que el comprador confirme que recibió el producto';
    case 'liberado':
      return 'Pago liberado al vendedor — el comprador confirmó que recibió el producto';
    case 'pagado_btc':
      return 'Pago en BTC registrado';
    case 'completado':
      return 'Pedido completado';
    case 'cancelado':
      return 'Pedido cancelado';
    default:
      return status;
  }
}

function presentOrder(row) {
  return {
    id: row.id,
    listing_id: row.listing_id,
    listing_title: row.listing_title,
    buyer_id: row.buyer_id,
    buyer_alias: row.buyer_alias,
    seller_id: row.seller_id,
    seller_alias: row.seller_alias,
    price_sats: Number(row.price_sats),
    price_btc: formatBtc(row.price_sats),
    price_display: `₿ ${formatBtc(row.price_sats)}`,
    payment: 'BTC',
    status: row.status,
    escrow_status: row.status,
    escrow_label: escrowLabel(row.status),
    created_at: row.created_at,
  };
}

async function fetchOrder(id) {
  return db.get(
    `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
     FROM orders o JOIN listings l ON l.id = o.listing_id
     JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
     WHERE o.id = $1`,
    [id],
  );
}

// POST /api/orders/mark-sold { listing_id, buyer_id | buyer_alias, confirm: true }
// SOLO EL VENDEDOR, y solo después de cerrar el trato en el chat.
// Crea el pedido con el pago RETENIDO en custodia (estado: retenido)
// y marca el anuncio como vendido. Requiere confirmación explícita.
async function markSold(req, res) {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({ error: 'El vendedor debe confirmar explícitamente que el trato se cerró.' });
    }
    const listingId = Number(req.body.listing_id);
    if (!listingId) return res.status(400).json({ error: 'Falta el anuncio.' });

    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [listingId]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    // Solo el vendedor de este anuncio puede marcarlo como vendido.
    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el vendedor de este anuncio puede marcarlo como vendido.' });
    }
    if (listing.status !== 'disponible') return res.status(409).json({ error: 'Ese anuncio ya está vendido.' });

    // ¿Con qué comprador se cerró el trato? Por id o por alias.
    let buyer = null;
    if (req.body.buyer_id) {
      buyer = await db.get('SELECT * FROM users WHERE id = $1', [Number(req.body.buyer_id)]);
    } else if (req.body.buyer_alias) {
      buyer = await db.get('SELECT * FROM users WHERE alias = $1', [String(req.body.buyer_alias).trim()]);
    }
    if (!buyer) return res.status(400).json({ error: 'Indica el alias del comprador con el que cerraste el trato.' });
    if (buyer.id === req.user.id) return res.status(400).json({ error: 'No puedes venderte a ti mismo.' });

    // El trato debe haberse negociado en el chat de este anuncio.
    const conv = await db.get(
      'SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 AND seller_id = $3',
      [listing.id, buyer.id, listing.seller_id],
    );
    if (!conv) {
      return res.status(400).json({ error: 'Primero habla con ese comprador en el chat de este anuncio.' });
    }

    const existing = await db.get('SELECT * FROM orders WHERE listing_id = $1', [listing.id]);
    if (existing) return res.status(409).json({ error: 'Ese anuncio ya tiene un pedido.' });

    // Pedido en custodia: el pago queda RETENIDO hasta que el comprador
    // confirme que recibió el producto. No se libera aquí.
    const created = await db.query(
      `INSERT INTO orders (listing_id, buyer_id, seller_id, price_sats, status)
       VALUES ($1, $2, $3, $4, 'retenido') RETURNING id`,
      [listing.id, buyer.id, listing.seller_id, listing.price_sats],
    );
    await db.query('UPDATE listings SET status = $1 WHERE id = $2', ['vendido', listing.id]);
    await db.query(
      'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)',
      [conv.id, req.user.id, `Trato cerrado. Vendido por ₿ ${formatBtc(listing.price_sats)}. El pago queda retenido en custodia hasta que el comprador confirme que recibió el producto.`],
    );

    const row = await fetchOrder(created.rows[0].id);
    return res.status(201).json({ order: presentOrder(row), conversation_id: conv.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo marcar el anuncio como vendido.' });
  }
}

router.post('/mark-sold', requireAuth, markSold);
// La ruta antigua /api/orders ahora es la misma acción del vendedor:
// no hay compra por parte del comprador. Un comprador que la llame
// recibe 403 porque no es el vendedor del anuncio.
router.post('/', requireAuth, markSold);

// POST /api/orders/:id/confirm-receipt — SOLO EL COMPRADOR.
// Confirmación explícita de que recibió el producto. Libera el pago
// retenido al vendedor (retenido -> liberado). El vendedor NO puede
// liberar el pago él mismo.
router.post('/:id/confirm-receipt', requireAuth, async (req, res) => {
  try {
    const order = await fetchOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el comprador puede confirmar que recibió el producto y liberar el pago.' });
    }
    if (order.status !== 'retenido') {
      return res.status(409).json({ error: 'Este pago ya no está retenido en custodia.' });
    }
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['liberado', order.id]);
    const conv = await db.get(
      'SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 AND seller_id = $3',
      [order.listing_id, order.buyer_id, order.seller_id],
    );
    if (conv) {
      await db.query(
        'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)',
        [conv.id, req.user.id, `Confirmo que recibí el producto. Pago liberado al vendedor: ₿ ${formatBtc(order.price_sats)}.`],
      );
    }
    const updated = await fetchOrder(order.id);
    return res.json({ order: presentOrder(updated) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo confirmar la recepción.' });
  }
});

// GET /api/orders/account — Mi cuenta: mis anuncios, mis compras y mis ventas.
// Cada pedido trae su estado de custodia (escrow_status / escrow_label),
// visible tanto para el comprador como para el vendedor.
router.get('/account', requireAuth, async (req, res) => {
  try {
    const myListings = await db.query(
      `SELECT l.*, u.alias AS seller_alias FROM listings l
       JOIN users u ON u.id = l.seller_id WHERE l.seller_id = $1 ORDER BY l.created_at DESC`,
      [req.user.id],
    );
    const purchases = await db.query(
      `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
       FROM orders o JOIN listings l ON l.id = o.listing_id
       JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
       WHERE o.buyer_id = $1 ORDER BY o.created_at DESC`,
      [req.user.id],
    );
    const sales = await db.query(
      `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
       FROM orders o JOIN listings l ON l.id = o.listing_id
       JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
       WHERE o.seller_id = $1 ORDER BY o.created_at DESC`,
      [req.user.id],
    );
    return res.json({
      listings: myListings.rows.map((r) => ({
        id: r.id, title: r.title, description: r.description,
        price_sats: Number(r.price_sats), price_btc: formatBtc(r.price_sats),
        price_display: `₿ ${formatBtc(r.price_sats)}`, status: r.status, created_at: r.created_at,
      })),
      purchases: purchases.rows.map(presentOrder),
      sales: sales.rows.map(presentOrder),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar tu cuenta.' });
  }
});

module.exports = router;
