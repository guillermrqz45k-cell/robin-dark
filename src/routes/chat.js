// src/routes/chat.js — chat privado entre comprador y vendedor.
// Una conversación por anuncio + comprador + vendedor.
// Solo participan esas dos personas.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/chat — mis conversaciones.
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*, l.title AS listing_title,
              b.alias AS buyer_alias, s.alias AS seller_alias
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
router.post('/', requireAuth, async (req, res) => {
  try {
    const listingId = Number(req.body.listing_id);
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

// GET /api/chat/:id/messages
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const conv = await db.get('SELECT * FROM conversations WHERE id = $1', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada.' });
    if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Este chat no es tuyo.' });
    }
    const r = await db.query(
      `SELECT m.*, u.alias AS sender_alias FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
      [conv.id],
    );
    return res.json({ conversation: conv, messages: r.rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar los mensajes.' });
  }
});

// POST /api/chat/:id/messages { body }
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    const conv = await db.get('SELECT * FROM conversations WHERE id = $1', [req.params.id]);
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
