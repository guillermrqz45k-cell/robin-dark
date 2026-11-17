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
const { requireIdParam, requireObjectBody } = require('../middleware/validate');

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
// y DESCUENTA 1 unidad del stock.
//
// STOCK (no una sola venta por anuncio):
// - Un anuncio con stock 3 se vende 3 veces: cada mark-sold crea
//   un pedido y descuenta 1. El anuncio sigue 'disponible' mientras
//   stock > 0 y solo pasa a 'agotado' cuando stock llega a 0.
// - La única otra forma de que se acabe es que el vendedor lo dé
//   por agotado (POST /api/listings/:id/mark-out-of-stock).
// - 'vendido' es un estado antiguo: las filas viejas lo conservan,
//   pero el flujo nuevo ya no lo usa.
//
// Correcciones de seguridad (carreras / TOCTOU):
// - El descuento es ATÓMICO: UPDATE ... SET stock = stock - 1
//   WHERE status='disponible' AND stock > 0 RETURNING stock, y
//   solo se sigue si realmente cambió 1 fila. Dos ventas a la vez
//   de la última unidad: una gana (201) y la otra recibe 409, sin
//   crear un segundo pedido ni dejar el stock en negativo. El
//   índice único de un pedido por anuncio se eliminó (ver src/db.js):
//   ya no es la defensa, lo es este decremento atómico.
// - Antes bastaba con haber abierto el chat (clic en "Contactar"):
//   el trato se podía cerrar sin haber negociado nada. Ahora se
//   exige al menos UN mensaje en esa conversación.
async function markSold(req, res) {
  try {
    if (req.body.confirm !== true) {
      return res.status(400).json({ error: 'El vendedor debe confirmar explícitamente que el trato se cerró.' });
    }
    const listingId = Number(req.body.listing_id);
    if (!Number.isInteger(listingId) || listingId <= 0) return res.status(400).json({ error: 'Falta el anuncio.' });

    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [listingId]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    // Solo el vendedor de este anuncio puede marcarlo como vendido.
    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el vendedor de este anuncio puede marcarlo como vendido.' });
    }
    if (listing.status === 'agotado' || listing.status === 'vendido') {
      return res.status(409).json({ error: 'Ese artículo ya está agotado.' });
    }

    // ¿Con qué comprador se cerró el trato? Por id o por alias.
    let buyer = null;
    if (req.body.buyer_id) {
      buyer = await db.get('SELECT * FROM users WHERE id = $1', [Number(req.body.buyer_id)]);
    } else if (req.body.buyer_alias) {
      buyer = await db.get('SELECT * FROM users WHERE alias = $1', [String(req.body.buyer_alias).trim()]);
    }
    if (!buyer) return res.status(400).json({ error: 'Indica el alias del comprador con el que cerraste el trato.' });
    if (buyer.id === req.user.id) return res.status(400).json({ error: 'No puedes venderte a ti mismo.' });

    // El trato debe haberse negociado en el chat de este anuncio:
    // conversación existente Y al menos un mensaje en ella.
    const conv = await db.get(
      'SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 AND seller_id = $3',
      [listing.id, buyer.id, listing.seller_id],
    );
    if (!conv) {
      return res.status(400).json({ error: 'Primero habla con ese comprador en el chat de este anuncio.' });
    }
    const negotiated = await db.get(
      'SELECT id FROM messages WHERE conversation_id = $1 LIMIT 1',
      [conv.id],
    );
    if (!negotiated) {
      return res.status(400).json({ error: 'Primero negocia el trato en el chat: tiene que haber al menos un mensaje.' });
    }

    // Descuento de stock ATÓMICO: solo el intento que encuentra
    // stock > 0 descuenta 1 unidad. Si otro intento vendió la
    // última unidad antes (o el anuncio ya estaba agotado),
    // rowCount es 0 y se rechaza con 409, sin crear pedido.
    const claimed = await db.query(
      "UPDATE listings SET stock = stock - 1 WHERE id = $1 AND status = 'disponible' AND stock > 0 RETURNING stock",
      [listing.id],
    );
    if (!claimed.rowCount) {
      return res.status(409).json({ error: 'Ese artículo ya está agotado.' });
    }
    const remainingStock = Number(claimed.rows[0].stock);
    // Si era la última unidad, el anuncio se agota: deja de verse
    // en la tienda. Si quedan unidades, sigue disponible.
    if (remainingStock === 0) {
      await db.query("UPDATE listings SET status = 'agotado' WHERE id = $1", [listing.id]);
    }

    let created;
    try {
      created = await db.query(
        `INSERT INTO orders (listing_id, buyer_id, seller_id, price_sats, status)
         VALUES ($1, $2, $3, $4, 'retenido') RETURNING id`,
        [listing.id, buyer.id, listing.seller_id, listing.price_sats],
      );
    } catch (e) {
      // Si no se pudo crear el pedido, se devuelve la unidad al
      // stock para no perderla (el anuncio vuelve a disponible
      // si se había agotado por esta venta).
      await db.query(
        "UPDATE listings SET stock = stock + 1, status = 'disponible' WHERE id = $1",
        [listing.id],
      );
      throw e;
    }
    await db.query(
      'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)',
      [conv.id, req.user.id, remainingStock === 0
        ? `Trato cerrado. Vendido por ₿ ${formatBtc(listing.price_sats)}. Era la última unidad: el artículo se agotó. El pago queda retenido en custodia hasta que el comprador confirme que recibió el producto.`
        : `Trato cerrado. Vendido por ₿ ${formatBtc(listing.price_sats)}. Quedan ${remainingStock} ${remainingStock === 1 ? 'unidad' : 'unidades'} de este artículo. El pago queda retenido en custodia hasta que el comprador confirme que recibió el producto.`],
    );

    const row = await fetchOrder(created.rows[0].id);
    const updatedListing = await db.get('SELECT * FROM listings WHERE id = $1', [listing.id]);
    return res.status(201).json({
      order: presentOrder(row),
      conversation_id: conv.id,
      listing: updatedListing ? {
        id: updatedListing.id,
        stock: Number(updatedListing.stock ?? 0),
        cantidad: Number(updatedListing.stock ?? 0),
        status: updatedListing.status,
      } : null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo marcar el anuncio como vendido.' });
  }
}

router.post('/mark-sold', requireAuth, requireObjectBody, markSold);
// La ruta antigua /api/orders ahora es la misma acción del vendedor:
// no hay compra por parte del comprador. Un comprador que la llame
// recibe 403 porque no es el vendedor del anuncio.
router.post('/', requireAuth, requireObjectBody, markSold);

// POST /api/orders/:id/confirm-receipt — SOLO EL COMPRADOR.
// Confirmación explícita de que recibió el producto. Libera el pago
// retenido al vendedor (retenido -> liberado). El vendedor NO puede
// liberar el pago él mismo.
//
// Corrección de carrera: antes se leía el estado y luego se
// actualizaba, así que dos confirmaciones a la vez podían pasar
// el control. Ahora la liberación es ATÓMICA: UPDATE ... WHERE
// status='retenido' y solo sigue si realmente cambió 1 fila.
// La segunda confirmación recibe 409.
router.post('/:id/confirm-receipt', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const order = await fetchOrder(id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (order.buyer_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el comprador puede confirmar que recibió el producto y liberar el pago.' });
    }
    const released = await db.query(
      "UPDATE orders SET status = 'liberado' WHERE id = $1 AND status = 'retenido'",
      [id],
    );
    if (!released.rowCount) {
      return res.status(409).json({ error: 'Este pago ya no está retenido en custodia.' });
    }
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
    const updated = await fetchOrder(id);
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
        price_display: `₿ ${formatBtc(r.price_sats)}`,
        stock: Number(r.stock ?? 1), cantidad: Number(r.stock ?? 1),
        stock_label: Number(r.stock ?? 1) === 1 ? '1 unidad' : `${Number(r.stock ?? 1)} unidades`,
        status: r.status, created_at: r.created_at,
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
