// src/routes/chat.js — mensajes directos entre usuarios.
//
// Un hilo (dm_threads) por pareja de usuarios (a < b, único).
// Solo participan esas dos personas. Cada mensaje tiene read_at:
// cuando abres un hilo, los mensajes que te mandaron se marcan
// como leídos, y el globo de Mensajes cuenta los que quedan sin
// leer (unread_count por hilo, unread_total en la lista).
//
// GET  /api/chat — mis hilos con la otra persona, último mensaje
//   y no leídos. POST /api/chat { user_id | alias } — abrir (o
//   reutilizar) el hilo con alguien. GET /api/chat/:id/messages
//   — mensajes del hilo (marca como leídos los que me mandaron).
//   POST /api/chat/:id/messages { body } — enviar un mensaje.
//
// Los chats viejos por anuncio quedan en conversations/messages,
// intactos, sin usarse (Robin Dark ya no tiene tienda).
const express = require('express');
const db = require('../db');
const photos = require('../photos');
const { requireAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody } = require('../middleware/validate');
const { authorCard } = require('../present');
const { isAdminUser, effectiveVerified } = require('../reputation');

const router = express.Router();
const MAX_BODY = 2000;

// Fecha "ahora" en cada motor, para read_at.
const NOW_SQL = db.usePostgres ? 'NOW()' : "datetime('now')";

// Insignia del dueño y verificación de quien envía un mensaje:
// se calculan en el servidor y viajan con cada mensaje, para
// mostrar la insignia «Admin» y el ✓ Verificado junto al alias
// en el chat. No hay rangos con letras.
function presentMessage(row) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    sender_id: row.sender_id,
    sender_alias: row.sender_alias,
    sender_is_admin: isAdminUser({ alias: row.sender_alias, rank: row.sender_rank }),
    sender_verified: effectiveVerified({ verified: row.sender_verified, alias: row.sender_alias, rank: row.sender_rank }),
    body: row.body,
    created_at: row.created_at,
  };
}

async function otherUser(thread, myId) {
  const otherId = thread.user_a_id === myId ? thread.user_b_id : thread.user_a_id;
  const row = await db.get(
    'SELECT id, alias, rank, verified, avatar_photo_id FROM users WHERE id = $1',
    [otherId],
  );
  if (!row) return null;
  const urls = await photos.urlsByIds([row.avatar_photo_id]);
  return authorCard(row, urls);
}

// GET /api/chat — mis hilos. Cada uno trae a la otra persona, su
// último mensaje y cuántos mensajes suyos tengo sin leer, para el
// badge de Mensajes. unread_total es la suma para el globo.
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT t.*,
              (SELECT m.body FROM dm_messages m WHERE m.thread_id = t.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
              (SELECT m.sender_id FROM dm_messages m WHERE m.thread_id = t.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender_id,
              (SELECT m.created_at FROM dm_messages m WHERE m.thread_id = t.id
                ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*) FROM dm_messages m WHERE m.thread_id = t.id
                AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread_count
       FROM dm_threads t
       WHERE t.user_a_id = $1 OR t.user_b_id = $1
       ORDER BY last_at DESC NULLS LAST, t.created_at DESC, t.id DESC`,
      [req.user.id],
    );
    const threads = [];
    let unreadTotal = 0;
    for (const row of r.rows) {
      const other = await otherUser(row, req.user.id);
      if (!other) continue;
      const unread = Number(row.unread_count);
      unreadTotal += unread;
      threads.push({
        id: row.id,
        other_user: other,
        last_body: row.last_body || null,
        last_sender_id: row.last_sender_id ? Number(row.last_sender_id) : null,
        last_at: row.last_at || null,
        unread_count: unread,
        created_at: row.created_at,
      });
    }
    return res.json({ threads, unread_total: unreadTotal });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el chat.' });
  }
});

// POST /api/chat { user_id | alias } — abrir (o reutilizar) el
// hilo con alguien. No te puedes escribir a ti mismo.
router.post('/', requireAuth, requireObjectBody, async (req, res) => {
  try {
    let other = null;
    if (req.body.user_id !== undefined && req.body.user_id !== null && req.body.user_id !== '') {
      const n = Number(req.body.user_id);
      if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'Ese usuario no es válido.' });
      other = await db.get('SELECT id, alias FROM users WHERE id = $1', [n]);
    } else if (req.body.alias) {
      const alias = String(req.body.alias).trim();
      if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
      other = await db.get('SELECT id, alias FROM users WHERE alias = $1', [alias]);
    } else {
      return res.status(400).json({ error: 'Falta el usuario con el que quieres hablar.' });
    }
    if (!other) return res.status(404).json({ error: 'Ese usuario no existe.' });
    if (other.id === req.user.id) return res.status(400).json({ error: 'No te puedes escribir a ti mismo.' });
    const [a, b] = [req.user.id, other.id].sort((x, y) => x - y);
    let thread = await db.get('SELECT * FROM dm_threads WHERE user_a_id = $1 AND user_b_id = $2', [a, b]);
    if (!thread) {
      const created = await db.query(
        'INSERT INTO dm_threads (user_a_id, user_b_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
        [a, b],
      );
      thread = created.rows[0]
        || await db.get('SELECT * FROM dm_threads WHERE user_a_id = $1 AND user_b_id = $2', [a, b]);
    }
    const otherCard = await otherUser(thread, req.user.id);
    return res.status(201).json({ thread: { id: thread.id, other_user: otherCard, created_at: thread.created_at } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo abrir el chat.' });
  }
});

// GET /api/chat/:id/messages — mensajes del hilo + la otra
// persona. Al abrirlo, los mensajes que me mandaron se marcan
// como leídos (el badge baja).
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const thread = await db.get('SELECT * FROM dm_threads WHERE id = $1', [id]);
    if (!thread) return res.status(404).json({ error: 'Conversación no encontrada.' });
    if (thread.user_a_id !== req.user.id && thread.user_b_id !== req.user.id) {
      return res.status(403).json({ error: 'Este chat no es tuyo.' });
    }
    await db.query(
      `UPDATE dm_messages SET read_at = ${NOW_SQL}
       WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [thread.id, req.user.id],
    );
    const r = await db.query(
      `SELECT m.*, u.alias AS sender_alias, u.verified AS sender_verified, u.rank AS sender_rank
       FROM dm_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.thread_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
      [thread.id],
    );
    const other = await otherUser(thread, req.user.id);
    return res.json({
      thread: { id: thread.id, other_user: other, created_at: thread.created_at },
      messages: r.rows.map(presentMessage),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar los mensajes.' });
  }
});

// POST /api/chat/:id/messages { body } — enviar un mensaje.
router.post('/:id/messages', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const body = String(req.body.body || '').trim().slice(0, MAX_BODY);
    if (!body) return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
    const id = requireIdParam(req, res);
    if (id === null) return;
    const thread = await db.get('SELECT * FROM dm_threads WHERE id = $1', [id]);
    if (!thread) return res.status(404).json({ error: 'Conversación no encontrada.' });
    if (thread.user_a_id !== req.user.id && thread.user_b_id !== req.user.id) {
      return res.status(403).json({ error: 'Este chat no es tuyo.' });
    }
    const created = await db.query(
      `INSERT INTO dm_messages (thread_id, sender_id, body)
       VALUES ($1, $2, $3) RETURNING id, thread_id, sender_id, body, created_at`,
      [thread.id, req.user.id, body],
    );
    const sender = await db.get('SELECT alias, verified, rank FROM users WHERE id = $1', [req.user.id]);
    const row = {
      ...created.rows[0],
      sender_alias: sender ? sender.alias : req.user.alias,
      sender_verified: sender ? sender.verified : false,
      sender_rank: sender ? sender.rank : null,
    };
    return res.status(201).json({ message: presentMessage(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo enviar el mensaje.' });
  }
});

module.exports = router;
