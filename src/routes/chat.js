// src/routes/chat.js — chat privado entre comprador y vendedor.
// Una conversación por anuncio + comprador + vendedor.
// Solo participan esas dos personas.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody } = require('../middleware/validate');

const router = express.Router();

// GET /api/chat — mis conversaciones. Cada una trae su último
// mensaje (id y quién lo envió) para que el cliente pueda avisar
// con el badge de Mensajes cuando llega algo nuevo sin recargar.
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*, l.title AS listing_title,
              b.alias AS buyer_alias, s.alias AS seller_alias,
              (SELECT m.id FROM messages m WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_id,
              (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_sender_id
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       JOIN users b ON b.id = c.buyer_id
       JOIN users s ON s.id = c.seller_id
       WHERE c.buyer_id = $1 OR c.seller_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id],
    );
    return res.json({ conversations: r.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el chat.' });
  }
});

// POST /api/chat { listing_id } — abrir (o reutilizar) la conversación de un anuncio.
router.post('/', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const listingId = Number(req.body.listing_id);
    if (!Number.isInteger(listingId) || listingId <= 0) {
      // Se registra lo que llegó (solo el id, sin datos personales):
      // un id perdido en el cliente llega aquí como null y antes solo
      // se veía el error en la pantalla del usuario.
      console.error('[chat] POST /api/chat con listing_id no válido:', JSON.stringify(req.body));
      return res.status(400).json({ error: 'Anuncio no válido: no llegó el identificador del anuncio. Recarga la página e inténtalo de nuevo.' });
    }
    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [listingId]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    if (listing.seller_id === req.user.id) {
      return res.status(400).json({ error: 'Eres el vendedor de este anuncio.' });
    }
    const existing = await db.get(
      'SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 AND seller_id = $3',
      [listing.id, req.user.id, listing.seller_id],
    );
    if (existing) return res.json({ conversation: existing });
    // Un artículo agotado no admite tratos nuevos: la única forma
    // de que vuelva es que el vendedor reponga el stock.
    if (listing.status !== 'disponible') {
      return res.status(409).json({ error: 'Ese artículo está agotado.' });
    }
    const created = await db.query(
      `INSERT INTO conversations (listing_id, buyer_id, seller_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [listing.id, req.user.id, listing.seller_id],
    );
    return res.status(201).json({ conversation: created.rows[0] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo abrir el chat.' });
  }
});

// GET /api/chat/:id/messages — mensajes + estado del anuncio y de la
// custodia (escrow) de ese trato, para mostrarlos en el chat.
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const conv = await db.get('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
    if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Este chat no es tuyo.' });
    }
    const listing = await db.get('SELECT id, title, status, stock, price_sats FROM listings WHERE id = $1', [conv.listing_id]);
    // Pedido de ESTA conversación (este comprador y este vendedor),
    // no el último pedido del anuncio: un anuncio con stock puede
    // tener varios pedidos, uno por unidad vendida y por comprador.
    // Mostrar el pedido de otro comprador en este chat sería
    // confundir custodias y bloquear el botón de vender.
    const order = await db.get(
      'SELECT * FROM orders WHERE listing_id = $1 AND buyer_id = $2 AND seller_id = $3 ORDER BY created_at DESC LIMIT 1',
      [conv.listing_id, conv.buyer_id, conv.seller_id],
    );
    const r = await db.query(
      `SELECT m.*, u.alias AS sender_alias FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
      [conv.id],
    );
    return res.json({
      conversation: conv,
      listing: listing ? { id: listing.id, title: listing.title, status: listing.status, stock: Number(listing.stock ?? 1), cantidad: Number(listing.stock ?? 1), price_sats: Number(listing.price_sats) } : null,
      // Custodia: null si aún no hay pedido; si lo hay, su estado
      // (retenido / liberado) se muestra en el chat.
      order: order ? { id: order.id, status: order.status, buyer_id: order.buyer_id, seller_id: order.seller_id, price_sats: Number(order.price_sats) } : null,
      messages: r.rows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar los mensajes.' });
  }
});

// POST /api/chat/:id/messages { body }
// SOLO envía un mensaje. Nunca crea un pedido, nunca marca el anuncio
// como vendido y nunca muestra "compra exitosa": el chat es solo para
// contactar al vendedor y negociar el trato.
router.post('/:id/messages', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    const id = requireIdParam(req, res);
    if (id === null) return;
    const conv = await db.get('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
    if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Este chat no es tuyo.' });
    }
    const created = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, conversation_id, sender_id, body, created_at`,
      [conv.id, req.user.id, body],
    );
    return res.status(201).json({ message: { ...created.rows[0], sender_alias: req.user.alias } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
  }
});

module.exports = router;
