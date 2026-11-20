// src/routes/social.js — red social de Robin Dark.
//
// GET  /api/social/feed?tab=para_ti|siguiendo|tendencias&limit&before
// GET  /api/social/posts/:id
// POST /api/social/posts { text, feeling?, photo? }
// DELETE /api/social/posts/:id (solo el autor)
// POST /api/social/posts/:id/like { kind?: like|love|wow } | DELETE /api/social/posts/:id/like
// POST /api/social/posts/:id/share
// GET  /api/social/posts/:id/comments | POST /api/social/posts/:id/comments
// POST /api/social/stories { kind: story|reel, text?, style_key?, media? }
// GET  /api/social/stories (activas, agrupadas por autor)
// GET  /api/social/reels
// POST /api/social/stories/:id/like | DELETE /api/social/stories/:id/like
// DELETE /api/social/stories/:id (solo el autor)
// POST /api/social/follow/:alias | DELETE /api/social/follow/:alias
// GET  /api/social/trends (hashtags + personas sugeridas)
// GET  /api/social/explore
// GET  /api/social/notifications | POST /api/social/notifications/seen
//
// Las lecturas (feed, posts, historias, reels, tendencias) son
// públicas. Escribir (publicar, like, comentar, seguir) necesita
// sesión. Los posts, historias y comentarios pasan por la
// moderación automática (src/moderation.js): el spam evidente y
// los insultos se rechazan; lo sospechoso se publica y queda
// marcado para que el dueño lo revise.
//
// Historias y reels con foto o vídeo corto (media: { mime, data },
// JPG/PNG o MP4/WebM hasta 20 MB): el medio se guarda con el
// mismo almacenamiento que las fotos (src/photos.js) y se sirve
// en /api/photos/:id. Un reel sin medio no es un reel: los reels
// exigen foto o vídeo; las historias aceptan solo texto (con
// estilo) o texto + medio.
const express = require('express');
const db = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody } = require('../middleware/validate');
const photos = require('../photos');
const { checkText, flagForReview } = require('../moderation');
const { authorCard, collectAvatarIds } = require('../present');

const router = express.Router();
const ALIAS_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const MAX_POST_TEXT = 2000;
const MAX_COMMENT_TEXT = 500;
const MAX_STORY_TEXT = 500;
const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

// Fecha en 'YYYY-MM-DD HH:MM:SS': la entienden Postgres
// (timestamptz) y SQLite (texto) sin problemas de formato.
function sqlTs(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

function parseLimit(req, def = 20, max = 50) {
  const n = Number(req.query.limit);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

function parseBefore(req) {
  const n = Number(req.query.before);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function extractHashtags(text) {
  const tags = [];
  const re = /#([\p{L}\p{N}_]+)/gu;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const tag = m[1].toLowerCase();
    if (tag.length <= 50) tags.push(tag);
  }
  return tags;
}

// Presenta varios posts a la vez: resuelve autores, fotos,
// conteos de likes/comentarios y si el usuario actual ya dio
// Me gusta, todo en pocas consultas.
async function presentPosts(rows, reqUser) {
  const postIds = rows.map((r) => Number(r.id));
  const photoUrls = await photos.urlsByIds([
    ...collectAvatarIds(rows.map((r) => ({
      avatar_photo_id: r.author_avatar_photo_id,
    }))),
    ...rows.map((r) => r.photo_id).filter(Boolean),
  ]);
  const likeCounts = new Map();
  const commentCounts = new Map();
  const shareCounts = new Map();
  const reactionsByPost = new Map();
  if (postIds.length) {
    const inList = postIds.map((_, i) => `$${i + 1}`).join(', ');
    const likes = await db.query(
      `SELECT post_id, kind, COUNT(*) AS n FROM post_likes WHERE post_id IN (${inList}) GROUP BY post_id, kind`,
      postIds,
    );
    for (const r of likes.rows) {
      const pid = Number(r.post_id);
      likeCounts.set(pid, (likeCounts.get(pid) || 0) + Number(r.n));
      const cur = reactionsByPost.get(pid) || { like: 0, love: 0, wow: 0 };
      if (r.kind === 'like' || r.kind === 'love' || r.kind === 'wow') cur[r.kind] += Number(r.n);
      reactionsByPost.set(pid, cur);
    }
    const comments = await db.query(
      `SELECT post_id, COUNT(*) AS n FROM post_comments WHERE post_id IN (${inList}) AND deleted = FALSE GROUP BY post_id`,
      postIds,
    );
    for (const r of comments.rows) commentCounts.set(Number(r.post_id), Number(r.n));
    const shares = await db.query(
      `SELECT post_id, COUNT(*) AS n FROM post_shares WHERE post_id IN (${inList}) GROUP BY post_id`,
      postIds,
    );
    for (const r of shares.rows) shareCounts.set(Number(r.post_id), Number(r.n));
  }
  const likedIds = new Set();
  const myReactions = new Map();
  if (reqUser && postIds.length) {
    const inList = postIds.map((_, i) => `$${i + 2}`).join(', ');
    const liked = await db.query(
      `SELECT post_id, kind FROM post_likes WHERE user_id = $1 AND post_id IN (${inList})`,
      [reqUser.id, ...postIds],
    );
    for (const r of liked.rows) {
      likedIds.add(Number(r.post_id));
      myReactions.set(Number(r.post_id), r.kind || 'like');
    }
  }
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    feeling: r.feeling || '',
    created_at: r.created_at,
    author: authorCard({
      id: r.author_id,
      alias: r.author_alias,
      verified: r.author_verified,
      avatar_photo_id: r.author_avatar_photo_id,
    }, photoUrls),
    likes_count: likeCounts.get(Number(r.id)) || 0,
    comments_count: commentCounts.get(Number(r.id)) || 0,
    liked_by_me: likedIds.has(Number(r.id)),
    reactions: reactionsByPost.get(Number(r.id)) || { like: 0, love: 0, wow: 0 },
    my_reaction: myReactions.get(Number(r.id)) || null,
    shares: shareCounts.get(Number(r.id)) || 0,
    photo_url: r.photo_id ? (photoUrls.get(Number(r.photo_id)) || null) : null,
  }));
}

const POST_SELECT = `
  SELECT p.*, u.alias AS author_alias,
         u.verified AS author_verified, u.avatar_photo_id AS author_avatar_photo_id
  FROM posts p JOIN users u ON u.id = p.author_id`;

// GET /api/social/feed?tab=...
router.get('/feed', optionalAuth, async (req, res) => {
  try {
    const tab = String(req.query.tab || 'para_ti').toLowerCase();
    if (!['para_ti', 'siguiendo', 'tendencias'].includes(tab)) {
      return res.status(400).json({ error: 'La pestaña tiene que ser Para ti, Siguiendo o Tendencias.' });
    }
    const limit = parseLimit(req);
    const before = parseBefore(req);
    let rows;
    if (tab === 'siguiendo') {
      if (!req.user) return res.json({ posts: [] });
      const params = [req.user.id];
      let sql = `${POST_SELECT}
        WHERE p.deleted = FALSE AND p.author_id IN (SELECT followed_id FROM follows WHERE follower_id = $1)`;
      if (before !== null) { params.push(before); sql += ` AND p.id < $${params.length}`; }
      sql += ' ORDER BY p.created_at DESC, p.id DESC LIMIT $' + (params.length + 1);
      params.push(limit);
      rows = (await db.query(sql, params)).rows;
    } else if (tab === 'tendencias') {
      const weekAgo = sqlTs(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const params = [weekAgo];
      let sql = `${POST_SELECT}
        WHERE p.deleted = FALSE AND p.created_at > $1`;
      if (before !== null) { params.push(before); sql += ` AND p.id < $${params.length}`; }
      sql += ' ORDER BY (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) DESC, p.created_at DESC, p.id DESC LIMIT $' + (params.length + 1);
      params.push(limit);
      rows = (await db.query(sql, params)).rows;
    } else {
      const params = [];
      let sql = `${POST_SELECT} WHERE p.deleted = FALSE`;
      if (before !== null) { params.push(before); sql += ` AND p.id < $${params.length}`; }
      sql += ' ORDER BY p.created_at DESC, p.id DESC LIMIT $' + (params.length + 1);
      params.push(limit);
      rows = (await db.query(sql, params)).rows;
    }
    const posts = await presentPosts(rows, req.user);
    return res.json({ posts, tab });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el feed.' });
  }
});

// GET /api/social/posts/:id
router.get('/posts/:id', optionalAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const row = await db.get(`${POST_SELECT} WHERE p.id = $1 AND p.deleted = FALSE`, [id]);
    if (!row) return res.status(404).json({ error: 'Publicación no encontrada.' });
    const [post] = await presentPosts([row], req.user);
    return res.json({ post });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar la publicación.' });
  }
});

// POST /api/social/posts — publicar. El texto pasa por moderación:
// 'block' se rechaza con el motivo; 'flag' se publica y queda
// marcado para el dueño. Se puede adjuntar una foto.
router.post('/posts', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const text = String(req.body.text || '').trim().slice(0, MAX_POST_TEXT);
    if (!text) return res.status(400).json({ error: 'La publicación no puede estar vacía.' });
    const feeling = String(req.body.feeling || '').trim().slice(0, 60);
    let photoId = null;
    if (req.body.photo !== undefined && req.body.photo !== null) {
      const decoded = photos.decodeUpload(req.body.photo);
      if (decoded.error) return res.status(400).json({ error: decoded.error });
      const saved = await photos.savePhoto({ ownerId: req.user.id, kind: 'post', mime: decoded.mime, buffer: decoded.buffer });
      photoId = saved.id;
    }
    const check = checkText(text);
    if (check.decision === 'block') {
      if (photoId) await photos.deletePhoto(photoId);
      return res.status(422).json({ error: check.reason });
    }
    const created = await db.query(
      `INSERT INTO posts (author_id, text, feeling, photo_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, text, feeling, photoId],
    );
    const postId = created.rows[0].id;
    if (check.decision === 'flag') {
      await flagForReview({ targetType: 'post', targetId: postId, userId: req.user.id, reason: check.reason });
    }
    const row = await db.get(`${POST_SELECT} WHERE p.id = $1`, [postId]);
    const [post] = await presentPosts([row], req.user);
    return res.status(201).json({ post, moderated: check.decision === 'flag' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo publicar.' });
  }
});

// DELETE /api/social/posts/:id — solo el autor (borrado suave).
router.delete('/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const post = await db.get('SELECT id, author_id FROM posts WHERE id = $1', [id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    if (post.author_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el autor puede borrar su publicación.' });
    }
    await db.query('UPDATE posts SET deleted = $1 WHERE id = $2', [true, id]);
    return res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo borrar la publicación.' });
  }
});

// Reacciones de un post: conteo por tipo (like 👍, love ❤️, wow 😮).
async function reactionsOf(postId) {
  const reactions = { like: 0, love: 0, wow: 0 };
  const rows = (await db.query(
    'SELECT kind, COUNT(*) AS n FROM post_likes WHERE post_id = $1 GROUP BY kind',
    [postId],
  )).rows;
  for (const r of rows) {
    if (r.kind === 'like' || r.kind === 'love' || r.kind === 'wow') reactions[r.kind] += Number(r.n);
  }
  return { reactions, likes_count: reactions.like + reactions.love + reactions.wow };
}

// POST /api/social/posts/:id/like — reacción con tipo: like (👍),
// love (❤️) o wow (😮). La misma reacción dos veces la quita;
// otra distinta cambia el tipo. Sin tipo, es like.
router.post('/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const kind = String((req.body && req.body.kind) || 'like').toLowerCase();
    if (!['like', 'love', 'wow'].includes(kind)) {
      return res.status(400).json({ error: 'La reacción tiene que ser like, love o wow.' });
    }
    const post = await db.get('SELECT id FROM posts WHERE id = $1 AND deleted = FALSE', [id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    const mine = await db.get(
      'SELECT kind FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [id, req.user.id],
    );
    let liked;
    let myReaction;
    if (mine && mine.kind === kind) {
      await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
      liked = false;
      myReaction = null;
    } else if (mine) {
      await db.query('UPDATE post_likes SET kind = $1 WHERE post_id = $2 AND user_id = $3', [kind, id, req.user.id]);
      liked = true;
      myReaction = kind;
    } else {
      await db.query('INSERT INTO post_likes (post_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, req.user.id, kind]);
      liked = true;
      myReaction = kind;
    }
    const { reactions, likes_count } = await reactionsOf(id);
    return res.json({ liked, my_reaction: myReaction, reactions, likes_count });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo reaccionar.' });
  }
});

router.delete('/posts/:id/like', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    const { reactions, likes_count } = await reactionsOf(id);
    return res.json({ liked: false, my_reaction: null, reactions, likes_count });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo quitar Me gusta.' });
  }
});

// GET /api/social/posts/:id/reactions — quién reaccionó a la
// publicación y con qué (👍/❤️/😮). Público: cualquiera puede ver
// quién reaccionó, como en Facebook.
router.get('/posts/:id/reactions', optionalAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const post = await db.get('SELECT id FROM posts WHERE id = $1 AND deleted = FALSE', [id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    const { rows } = await db.query(
      `SELECT pl.kind, pl.created_at, u.id, u.alias, u.verified,
              u.avatar_photo_id
       FROM post_likes pl JOIN users u ON u.id = pl.user_id
       WHERE pl.post_id = $1 ORDER BY pl.created_at DESC, pl.id DESC`,
      [id],
    );
    const photoUrls = await photos.urlsByIds(collectAvatarIds(rows));
    return res.json({
      reactions: rows.map((r) => ({
        kind: r.kind,
        created_at: r.created_at,
        user: authorCard({ id: r.id, alias: r.alias, verified: r.verified, avatar_photo_id: r.avatar_photo_id }, photoUrls),
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo ver quién reaccionó.' });
  }
});

// POST /api/social/posts/:id/share — registra un Compartir del
// usuario y devuelve el contador nuevo del post. Cada Compartir
// cuenta (compartir dos veces son dos veces compartido).
router.post('/posts/:id/share', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const post = await db.get('SELECT id FROM posts WHERE id = $1 AND deleted = FALSE', [id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    await db.query('INSERT INTO post_shares (post_id, user_id) VALUES ($1, $2)', [id, req.user.id]);
    const count = await db.get('SELECT COUNT(*) AS n FROM post_shares WHERE post_id = $1', [id]);
    return res.json({ ok: true, shares: Number(count.n) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo compartir.' });
  }
});

// GET /api/social/posts/:id/comments
router.get('/posts/:id/comments', optionalAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const post = await db.get('SELECT id FROM posts WHERE id = $1 AND deleted = FALSE', [id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    const limit = parseLimit(req);
    const before = parseBefore(req);
    const params = [id];
    let sql = `SELECT c.*, u.alias AS author_alias,
                      u.verified AS author_verified, u.avatar_photo_id AS author_avatar_photo_id
               FROM post_comments c JOIN users u ON u.id = c.author_id
               WHERE c.post_id = $1 AND c.deleted = FALSE`;
    if (before !== null) { params.push(before); sql += ` AND c.id < $${params.length}`; }
    sql += ' ORDER BY c.created_at ASC, c.id ASC LIMIT $' + (params.length + 1);
    params.push(limit);
    const { rows } = await db.query(sql, params);
    const photoUrls = await photos.urlsByIds(collectAvatarIds(rows));
    return res.json({
      comments: rows.map((r) => ({
        id: r.id,
        text: r.text,
        created_at: r.created_at,
        author: authorCard({
          id: r.author_id,
          alias: r.author_alias,
          verified: r.author_verified,
          avatar_photo_id: r.author_avatar_photo_id,
        }, photoUrls),
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar los comentarios.' });
  }
});

// POST /api/social/posts/:id/comments — también pasa por moderación.
router.post('/posts/:id/comments', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const text = String(req.body.text || '').trim().slice(0, MAX_COMMENT_TEXT);
    if (!text) return res.status(400).json({ error: 'El comentario no puede estar vacío.' });
    const post = await db.get('SELECT id FROM posts WHERE id = $1 AND deleted = FALSE', [id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    const check = checkText(text);
    if (check.decision === 'block') {
      return res.status(422).json({ error: check.reason });
    }
    const created = await db.query(
      'INSERT INTO post_comments (post_id, author_id, text) VALUES ($1, $2, $3) RETURNING id',
      [id, req.user.id, text],
    );
    const commentId = created.rows[0].id;
    if (check.decision === 'flag') {
      await flagForReview({ targetType: 'comment', targetId: commentId, userId: req.user.id, reason: check.reason });
    }
    const row = await db.get(
      `SELECT c.*, u.alias AS author_alias,
              u.verified AS author_verified, u.avatar_photo_id AS author_avatar_photo_id
       FROM post_comments c JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
      [commentId],
    );
    const photoUrls = await photos.urlsByIds(collectAvatarIds([row]));
    return res.status(201).json({
      comment: {
        id: row.id,
        text: row.text,
        created_at: row.created_at,
        author: authorCard({
          id: row.author_id,
          alias: row.author_alias,
          verified: row.author_verified,
          avatar_photo_id: row.author_avatar_photo_id,
        }, photoUrls),
      },
      moderated: check.decision === 'flag',
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo comentar.' });
  }
});

const STORY_SELECT = `
  SELECT s.*, u.alias AS author_alias,
         u.verified AS author_verified, u.avatar_photo_id AS author_avatar_photo_id
  FROM stories s JOIN users u ON u.id = s.author_id`;

// POST /api/social/stories — historia (24 h) o reel (sin caducidad).
// Texto con estilo, foto o vídeo corto (media: { mime, data }).
// - Historia: basta con texto, con medio, o con ambos.
// - Reel: exige foto o vídeo (un reel sin medio no es un reel).
// El texto, si viene, pasa por moderación como en los posts.
// El medio se borra si el texto se bloquea.
router.post('/stories', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const kind = String(req.body.kind || 'story').toLowerCase();
    if (!['story', 'reel'].includes(kind)) {
      return res.status(400).json({ error: 'El tipo tiene que ser historia o reel.' });
    }
    const text = String(req.body.text || '').trim().slice(0, MAX_STORY_TEXT);
    const styleKey = String(req.body.style_key || '').trim().slice(0, 30);
    if (styleKey && !/^[a-z0-9_-]+$/.test(styleKey)) {
      return res.status(400).json({ error: 'El estilo no es válido.' });
    }
    let photoId = null;
    if (req.body.media !== undefined && req.body.media !== null) {
      const decoded = photos.decodeUpload(req.body.media, { allowVideo: true });
      if (decoded.error) return res.status(400).json({ error: decoded.error });
      const saved = await photos.savePhoto({ ownerId: req.user.id, kind: 'post', mime: decoded.mime, buffer: decoded.buffer });
      photoId = saved.id;
    }
    if (!text && !photoId) {
      return res.status(400).json({ error: 'La historia o el reel no puede estar vacío: pon texto, una foto o un vídeo.' });
    }
    if (kind === 'reel' && !photoId) {
      return res.status(400).json({ error: 'El reel necesita una foto o un vídeo corto.' });
    }
    const check = checkText(text);
    if (check.decision === 'block') {
      if (photoId) await photos.deletePhoto(photoId);
      return res.status(422).json({ error: check.reason });
    }
    const expiresAt = kind === 'story' ? Date.now() + STORY_TTL_MS : null;
    const created = await db.query(
      'INSERT INTO stories (author_id, kind, text, style_key, photo_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.user.id, kind, text, styleKey, photoId, expiresAt],
    );
    const storyId = created.rows[0].id;
    if (check.decision === 'flag') {
      await flagForReview({ targetType: 'story', targetId: storyId, userId: req.user.id, reason: check.reason });
    }
    const row = await db.get(`${STORY_SELECT} WHERE s.id = $1`, [storyId]);
    const [story] = await presentStories([row], req.user);
    return res.status(201).json({ story, moderated: check.decision === 'flag' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo subir.' });
  }
});

async function presentStories(rows, reqUser) {
  const storyIds = rows.map((r) => Number(r.id));
  const photoUrls = await photos.urlsByIds(collectAvatarIds(rows));
  const mediaInfo = await photos.infoByIds(rows.map((r) => r.photo_id).filter(Boolean));
  const likeCounts = new Map();
  if (storyIds.length) {
    const inList = storyIds.map((_, i) => `$${i + 1}`).join(', ');
    const likes = await db.query(
      `SELECT story_id, COUNT(*) AS n FROM story_likes WHERE story_id IN (${inList}) GROUP BY story_id`,
      storyIds,
    );
    for (const r of likes.rows) likeCounts.set(Number(r.story_id), Number(r.n));
  }
  const likedIds = new Set();
  if (reqUser && storyIds.length) {
    const inList = storyIds.map((_, i) => `$${i + 2}`).join(', ');
    const liked = await db.query(
      `SELECT story_id FROM story_likes WHERE user_id = $1 AND story_id IN (${inList})`,
      [reqUser.id, ...storyIds],
    );
    for (const r of liked.rows) likedIds.add(Number(r.story_id));
  }
  return rows.map((r) => {
    const media = r.photo_id ? mediaInfo.get(Number(r.photo_id)) : null;
    return {
      id: r.id,
      kind: r.kind,
      text: r.text,
      style_key: r.style_key,
      media_url: media ? media.url : null,
      media_type: media ? (media.mime.startsWith('video/') ? 'video' : 'image') : null,
      expires_at: r.expires_at ? Number(r.expires_at) : null,
      created_at: r.created_at,
      author: authorCard({
        id: r.author_id,
        alias: r.author_alias,
        verified: r.author_verified,
        avatar_photo_id: r.author_avatar_photo_id,
      }, photoUrls),
      likes_count: likeCounts.get(Number(r.id)) || 0,
      liked_by_me: likedIds.has(Number(r.id)),
    };
  });
}

// GET /api/social/stories — historias activas (no caducadas ni
// borradas), agrupadas por autor: primero las propias (si hay
// sesión) y luego por la historia más reciente.
router.get('/stories', optionalAuth, async (req, res) => {
  try {
    const now = Date.now();
    const { rows } = await db.query(
      `${STORY_SELECT}
       WHERE s.kind = 'story' AND s.deleted = FALSE AND (s.expires_at IS NULL OR s.expires_at > $1)
       ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
      [now],
    );
    const stories = await presentStories(rows, req.user);
    const groups = new Map();
    for (const s of stories) {
      if (!groups.has(s.author.id)) groups.set(s.author.id, { author: s.author, stories: [] });
      groups.get(s.author.id).stories.push(s);
    }
    const list = [...groups.values()];
    if (req.user) {
      list.sort((a, b) => (a.author.id === req.user.id ? -1 : 0) - (b.author.id === req.user.id ? -1 : 0));
    }
    return res.json({ groups: list });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las historias.' });
  }
});

// GET /api/social/reels — reels (sin caducidad), más recientes primero.
router.get('/reels', optionalAuth, async (req, res) => {
  try {
    const limit = parseLimit(req);
    const before = parseBefore(req);
    const params = [];
    let sql = `${STORY_SELECT} WHERE s.kind = 'reel' AND s.deleted = FALSE`;
    if (before !== null) { params.push(before); sql += ` AND s.id < $${params.length}`; }
    sql += ' ORDER BY s.created_at DESC, s.id DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const { rows } = await db.query(sql, params);
    const reels = await presentStories(rows, req.user);
    return res.json({ reels });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar los reels.' });
  }
});

router.post('/stories/:id/like', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const story = await db.get('SELECT id FROM stories WHERE id = $1 AND deleted = FALSE', [id]);
    if (!story) return res.status(404).json({ error: 'Historia o reel no encontrado.' });
    await db.query('INSERT INTO story_likes (story_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    const count = await db.get('SELECT COUNT(*) AS n FROM story_likes WHERE story_id = $1', [id]);
    return res.json({ liked: true, likes_count: Number(count.n) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo dar Me gusta.' });
  }
});

router.delete('/stories/:id/like', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    await db.query('DELETE FROM story_likes WHERE story_id = $1 AND user_id = $2', [id, req.user.id]);
    const count = await db.get('SELECT COUNT(*) AS n FROM story_likes WHERE story_id = $1', [id]);
    return res.json({ liked: false, likes_count: Number(count.n) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo quitar Me gusta.' });
  }
});

// DELETE /api/social/stories/:id — solo el autor. El medio (foto
// o vídeo) se borra también, para no dejar archivos huérfanos.
router.delete('/stories/:id', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const story = await db.get('SELECT id, author_id, photo_id FROM stories WHERE id = $1', [id]);
    if (!story) return res.status(404).json({ error: 'Historia o reel no encontrado.' });
    if (story.author_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el autor puede borrarlo.' });
    }
    await db.query('UPDATE stories SET deleted = $1 WHERE id = $2', [true, id]);
    if (story.photo_id) await photos.deletePhoto(Number(story.photo_id));
    return res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo borrar.' });
  }
});

// POST /api/social/follow/:alias — seguir (idempotente).
router.post('/follow/:alias', requireAuth, async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
    const target = await db.get('SELECT id, alias FROM users WHERE alias = $1', [alias]);
    if (!target) return res.status(404).json({ error: 'Ese usuario no existe.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'No te puedes seguir a ti mismo.' });
    await db.query(
      'INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, target.id],
    );
    return res.json({ following: true, followed_alias: target.alias });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo seguir.' });
  }
});

router.delete('/follow/:alias', requireAuth, async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
    const target = await db.get('SELECT id, alias FROM users WHERE alias = $1', [alias]);
    if (!target) return res.status(404).json({ error: 'Ese usuario no existe.' });
    await db.query('DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, target.id]);
    return res.json({ following: false, followed_alias: target.alias });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo dejar de seguir.' });
  }
});

// GET /api/social/trends — hashtags de los últimos 7 días y
// personas sugeridas (las que tienen más seguidores y aún no
// sigues). mutual_follows: cuánta gente siguen en común tú y
// esa persona (los seguimientos son unidireccionales, así que
// "amigos en común" se calcula por a quién sigue cada uno).
router.get('/trends', optionalAuth, async (req, res) => {
  try {
    const weekAgo = sqlTs(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { rows } = await db.query(
      'SELECT text FROM posts WHERE deleted = FALSE AND created_at > $1 ORDER BY created_at DESC LIMIT 500',
      [weekAgo],
    );
    const counts = new Map();
    for (const r of rows) {
      for (const tag of extractHashtags(r.text)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const hashtags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    let suggested = [];
    if (req.user) {
      const users = await db.query(
        `SELECT u.id, u.alias, u.verified, u.avatar_photo_id,
                (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS followers_count
         FROM users u
         WHERE u.id <> $1 AND u.id NOT IN (SELECT followed_id FROM follows WHERE follower_id = $1)
         ORDER BY followers_count DESC, u.created_at DESC LIMIT 10`,
        [req.user.id],
      );
      const photoUrls = await photos.urlsByIds(collectAvatarIds(users.rows));
      suggested = [];
      for (const u of users.rows) {
        const mutual = await db.get(
          `SELECT COUNT(*) AS n FROM follows f1 JOIN follows f2 ON f1.followed_id = f2.followed_id
           WHERE f1.follower_id = $1 AND f2.follower_id = $2`,
          [req.user.id, u.id],
        );
        suggested.push({
          ...authorCard(u, photoUrls),
          followers_count: Number(u.followers_count),
          mutual_follows: Number(mutual.n),
        });
      }
    } else {
      const users = await db.query(
        `SELECT u.id, u.alias, u.verified, u.avatar_photo_id,
                (SELECT COUNT(*) FROM follows f WHERE f.followed_id = u.id) AS followers_count
         FROM users u ORDER BY followers_count DESC, u.created_at DESC LIMIT 10`,
      );
      const photoUrls = await photos.urlsByIds(collectAvatarIds(users.rows));
      suggested = users.rows.map((u) => ({
        ...authorCard(u, photoUrls),
        followers_count: Number(u.followers_count),
        mutual_follows: 0,
      }));
    }
    return res.json({ hashtags, suggested_users: suggested });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las tendencias.' });
  }
});

// GET /api/social/explore — tendencias + sugeridos + posts recientes.
router.get('/explore', optionalAuth, async (req, res) => {
  try {
    const limit = parseLimit(req);
    const { rows } = await db.query(
      `${POST_SELECT} WHERE p.deleted = FALSE ORDER BY p.created_at DESC, p.id DESC LIMIT $1`,
      [limit],
    );
    const posts = await presentPosts(rows, req.user);
    // Reutiliza la lógica de tendencias llamando al mismo código
    // con una petición interna simulada: se replica la consulta
    // para no acoplar las rutas entre sí.
    const weekAgo = sqlTs(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await db.query(
      'SELECT text FROM posts WHERE deleted = FALSE AND created_at > $1 ORDER BY created_at DESC LIMIT 500',
      [weekAgo],
    );
    const counts = new Map();
    for (const r of recent.rows) {
      for (const tag of extractHashtags(r.text)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const hashtags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));
    return res.json({ posts, hashtags });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar Explorar.' });
  }
});

const REACTION_EMOJI = { like: '👍', love: '❤️', wow: '😮' };

// created_at llega como Date (Postgres) o como texto UTC sin zona
// (SQLite, datetime('now')): se convierte a ms desde epoch.
function parseTs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v).replace(' ', 'T');
  const t = Date.parse(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(t) ? 0 : t;
}

// GET /api/social/notifications — últimas 30 notificaciones,
// derivadas de la actividad real: reacciones y comentarios en mis
// posts y nuevos seguidores. unread: cuántas son posteriores a
// notif_seen_at (el instante hasta el que ya miré la campana).
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const me = await db.get('SELECT notif_seen_at FROM users WHERE id = $1', [req.user.id]);
    const seenAt = Number(me && me.notif_seen_at) || 0;
    const aliasRows = (await db.query('SELECT id, alias FROM users')).rows;
    const aliasById = new Map(aliasRows.map((u) => [Number(u.id), u.alias]));
    const myPosts = (await db.query(
      'SELECT id, text FROM posts WHERE author_id = $1 AND deleted = FALSE',
      [req.user.id],
    )).rows;
    const myPostIds = new Set(myPosts.map((p) => Number(p.id)));
    const textById = new Map(myPosts.map((p) => [Number(p.id), p.text]));
    const items = [];
    if (myPostIds.size) {
      const likes = (await db.query('SELECT id, post_id, user_id, kind, created_at FROM post_likes')).rows;
      for (const l of likes) {
        if (myPostIds.has(Number(l.post_id)) && Number(l.user_id) !== req.user.id) {
          const ts = parseTs(l.created_at);
          items.push({
            id: `like-${l.id}`,
            kind: 'like',
            actor_alias: aliasById.get(Number(l.user_id)) || 'usuario',
            actor_id: Number(l.user_id),
            text: `reaccionó con ${REACTION_EMOJI[l.kind] || '👍'} a tu publicación «${(textById.get(Number(l.post_id)) || '').slice(0, 60)}»`,
            created_at: l.created_at,
            unread: ts > seenAt,
            ts,
          });
        }
      }
      const comments = (await db.query(
        'SELECT id, post_id, author_id, text, created_at FROM post_comments WHERE deleted = FALSE',
      )).rows;
      for (const c of comments) {
        if (myPostIds.has(Number(c.post_id)) && Number(c.author_id) !== req.user.id) {
          const ts = parseTs(c.created_at);
          items.push({
            id: `comment-${c.id}`,
            kind: 'comment',
            actor_alias: aliasById.get(Number(c.author_id)) || 'usuario',
            actor_id: Number(c.author_id),
            text: `comentó tu publicación: «${String(c.text).slice(0, 80)}»`,
            created_at: c.created_at,
            unread: ts > seenAt,
            ts,
          });
        }
      }
    }
    const follows = (await db.query(
      'SELECT id, follower_id, created_at FROM follows WHERE followed_id = $1',
      [req.user.id],
    )).rows;
    for (const f of follows) {
      if (Number(f.follower_id) === req.user.id) continue;
      const ts = parseTs(f.created_at);
      items.push({
        id: `follow-${f.id}`,
        kind: 'follow',
        actor_alias: aliasById.get(Number(f.follower_id)) || 'usuario',
        actor_id: Number(f.follower_id),
        text: 'empezó a seguirte',
        created_at: f.created_at,
        unread: ts > seenAt,
        ts,
      });
    }
    items.sort((a, b) => b.ts - a.ts);
    const notifications = items.slice(0, 30).map(({ ts, ...rest }) => rest);
    return res.json({ notifications, unread: notifications.filter((n) => n.unread).length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las notificaciones.' });
  }
});

// POST /api/social/notifications/seen — marca la campana como
// vista (guarda el instante actual en users.notif_seen_at).
router.post('/notifications/seen', requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE users SET notif_seen_at = $1 WHERE id = $2', [Date.now(), req.user.id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo marcar como visto.' });
  }
});

module.exports = router;
