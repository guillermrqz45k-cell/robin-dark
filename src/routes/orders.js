// src/routes/orders.js — compras y Mi cuenta.
// Pagos solo en BTC. Al comprar, el anuncio pasa a "vendido" y se
// abre el chat privado con el vendedor automáticamente.
const express = require('express');
const db = require('../db');
const { formatBtc } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

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
    created_at: row.created_at,
  };
}

// POST /api/orders { listing_id } — comprar con BTC.
router.post('/', requireAuth, async (req, res) => {
  try {
    const listingId = Number(req.body.listing_id);
    if (!listingId) return res.status(400).json({ error: 'Falta el anuncio.' });

    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [listingId]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    if (listing.status !== 'disponible') return res.status(409).json({ error: 'Ese artículo ya está vendido.' });
    if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'No puedes comprar tu propio anuncio.' });

    const created = await db.query(
      `INSERT INTO orders (listing_id, buyer_id, seller_id, price_sats, status)
       VALUES ($1, $2, $3, $4, 'pagado_btc') RETURNING id`,
      [listing.id, req.user.id, listing.seller_id, listing.price_sats],
    );
    await db.query('UPDATE listings SET status = $1 WHERE id = $2', ['vendido', listing.id]);

    // Abrir el chat privado comprador-vendedor y dejar el aviso de pago BTC.
    const conv = await db.query(
      `INSERT INTO conversations (listing_id, buyer_id, seller_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [listing.id, req.user.id, listing.seller_id],
    );
    const conversationId = conv.rows[0].id;
    await db.query(
      'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)',
      [conversationId, req.user.id, `Compra realizada. Pago solo en BTC: ₿ ${formatBtc(listing.price_sats)}.`],
    );

    const row = await db.get(
      `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
       FROM orders o JOIN listings l ON l.id = o.listing_id
       JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
       WHERE o.id = $1`,
      [created.rows[0].id],
    );
    return res.status(201).json({ order: presentOrder(row), conversation_id: conversationId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo completar la compra.' });
  }
});

// GET /api/orders/account — Mi cuenta: mis anuncios, mis compras y mis ventas.
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
