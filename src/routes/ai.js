// src/routes/ai.js — la IA propia de Robin Dark (por reglas).
//
// POST /api/ai/ask { question } -> { answer, topic }
//   La asistente responde con las reglas reales de la plataforma
//   (src/ai.js). No es un modelo externo: no hay llave ni costo.
//   Robin Dark ya no tiene tienda: la asistente no ayuda a
//   comprar/vender ni explica BTC o escrow.
// GET /api/ai/recommendations -> { recommendations: [...] }
//   Reels y publicaciones de la gente a la que sigues (con su
//   motivo); si no sigues a nadie, de autores cuyos posts te
//   gustaron. Sin actividad, la lista viene vacía.
//
// Ambas necesitan sesión: la asistente vive dentro de la app.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimit');
const { requireObjectBody } = require('../middleware/validate');
const ai = require('../ai');
const photos = require('../photos');
const { isAdminUser, effectiveVerified } = require('../reputation');

const router = express.Router();

router.post('/ask', requireAuth, aiLimiter, requireObjectBody, async (req, res) => {
  try {
    const question = String(req.body.question || '').trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: 'Escribe tu pregunta.' });
    const result = ai.answer(question);
    return res.json({ answer: result.answer, topic: result.topic });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'La asistente no pudo responder. Inténtalo de nuevo.' });
  }
});

router.get('/recommendations', requireAuth, async (req, res) => {
  try {
    const items = await ai.recommendations(req.user.id);
    const mediaIds = items.map((it) => it.photo_id || it.author_avatar_photo_id).filter(Boolean);
    const info = await photos.infoByIds(mediaIds);
    // Datos extra de cada recomendación (dueño, verificación,
    // medio) para que el cliente la muestre como una tarjeta
    // completa.
    const out = [];
    for (const it of items) {
      const author = await db.get('SELECT verified, rank FROM users WHERE id = $1', [it.author_id]);
      if (!author) continue;
      const base = {
        ...it,
        author_is_admin: isAdminUser({ alias: it.author_alias, rank: author.rank }),
        author_verified: effectiveVerified({ verified: author.verified, alias: it.author_alias, rank: author.rank }),
        author_avatar_url: it.author_avatar_photo_id ? (info.get(Number(it.author_avatar_photo_id))?.url || null) : null,
      };
      if (it.type === 'reel') {
        const media = it.photo_id ? info.get(Number(it.photo_id)) : null;
        out.push({
          ...base,
          media_url: media ? media.url : null,
          media_type: media ? (media.mime.startsWith('video/') ? 'video' : 'image') : null,
        });
      } else {
        out.push({
          ...base,
          photo_url: it.photo_id ? (info.get(Number(it.photo_id))?.url || null) : null,
        });
      }
    }
    return res.json({ recommendations: out });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las recomendaciones.' });
  }
});

module.exports = router;
