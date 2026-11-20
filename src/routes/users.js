// src/routes/users.js — perfil público y reputación de Robin Dark.
//
// GET /api/users/:alias/profile es PÚBLICO (sin token): cualquiera
// puede ver el perfil de alguien antes de seguirlo o escribirlo.
// Solo devuelve datos que ya son públicos o se derivan de ellos:
// nombre real (el que se muestra en el perfil), alias (@usuario),
// fecha de registro, bio, publicaciones, seguidores,
// tiempo medio de respuesta en mensajes y reputación. NUNCA
// devuelve password_hash, correo ni documento (el correo es
// privado; el nombre real y el documento de la solicitud de
// verificación solo los ve el dueño y el admin).
//
// GET  /api/users/me (con token): mis datos, incluido el correo.
// GET  /api/users?search= (con token): buscar miembros por alias.
// PATCH /api/users/me/profile (con token): bio, avatar y portada.
// GET  /api/users/:alias/posts — publicaciones del usuario.
// GET  /api/users/:alias/followers | /following | /friends — listas
//   públicas (amigos = seguimiento mutuo).
// POST /api/users/:alias/rate (con token): valoración con estrellas.
// POST /api/users/me/verification (con token): pedir verificación
//   con nombre real + foto del documento (la revisa el dueño).
//   Solo con 500 o más amigos o seguidores.
// GET  /api/users/me/verification (con token): estado de mi solicitud.
// GET  /api/users/me/verification-requests (solo el dueño): lista
//   de solicitudes pendientes, para aprobarlas desde su perfil.
// POST /api/users/me/verification-requests/:id/approve|reject
//   (solo el dueño): otorga o niega el verificado.
const express = require('express');
const db = require('../db');
const {
  daysSince, computeReputation, badgeFor, seniority, median, formatResponseTime,
  isAdminAlias, effectiveVerified,
} = require('../reputation');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody } = require('../middleware/validate');
const photos = require('../photos');
const { authorCard, collectAvatarIds } = require('../present');

const router = express.Router();
const ALIAS_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const MAX_BIO = 300;

function parseTs(v) {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v).replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

// Mediana del tiempo de respuesta: por cada conversación en la que
// participa el usuario, se recorren los mensajes en orden; cuando
// el usuario responde a un mensaje de la otra persona, se anota
// cuánto tardó. La mediana de esos tiempos es su tiempo de respuesta.
function responseTimeMinutes(rows, userId) {
  const diffs = [];
  let prev = null; // { conversation_id, sender_id, ts }
  for (const row of rows) {
    const ts = parseTs(row.created_at);
    if (ts === null) continue;
    if (prev && prev.conversation_id === row.conversation_id && prev.sender_id !== userId && row.sender_id === userId) {
      const diff = (ts - prev.ts) / 60000;
      if (diff >= 0) diffs.push(diff);
    }
    prev = { conversation_id: row.conversation_id, sender_id: row.sender_id, ts };
  }
  return median(diffs);
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

async function followCounts(userId) {
  const [followers, following] = await Promise.all([
    db.get('SELECT COUNT(*) AS n FROM follows WHERE followed_id = $1', [userId]),
    db.get('SELECT COUNT(*) AS n FROM follows WHERE follower_id = $1', [userId]),
  ]);
  return { followers_count: Number(followers.n), following_count: Number(following.n) };
}

async function ratingStats(userId) {
  const row = await db.get(
    'SELECT COUNT(*) AS n, COALESCE(AVG(stars), 0) AS avg FROM ratings WHERE rated_id = $1',
    [userId],
  );
  return {
    ratings_count: Number(row.n),
    avg_stars: Number(row.n) ? Math.round(Number(row.avg) * 10) / 10 : null,
  };
}

// GET /api/users/me — mis datos (con token), incluido el correo
// (que nunca sale en el perfil público).
//
// GET /api/users?search= — buscar miembros por alias (con token):
// lo usan el selector «Nuevo mensaje» y el buscador de arriba.
// Sin búsqueda, devuelve los miembros más recientes. Nunca
// devuelve password_hash ni correo. El que busca no sale en la
// lista (no tiene sentido escribirse a uno mismo).
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.search || req.query.q || '').trim().slice(0, 30);
    const limit = parseLimit(req, 20, 50);
    let rows;
    if (q) {
      rows = (await db.query(
        `SELECT id, alias, verified, avatar_photo_id FROM users
         WHERE id <> $1 AND LOWER(alias) LIKE LOWER($2) ORDER BY alias ASC LIMIT $3`,
        [req.user.id, `%${q}%`, limit],
      )).rows;
    } else {
      rows = (await db.query(
        `SELECT id, alias, verified, avatar_photo_id FROM users
         WHERE id <> $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [req.user.id, limit],
      )).rows;
    }
    const photoUrls = await photos.urlsByIds(collectAvatarIds(rows));
    return res.json({ users: rows.map((u) => authorCard(u, photoUrls)) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron buscar miembros.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, alias, real_name, email, email_verified, bio, avatar_photo_id, cover_photo_id, verified, created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });
    const photoUrls = await photos.urlsByIds([user.avatar_photo_id, user.cover_photo_id]);
    const counts = await followCounts(user.id);
    const ratings = await ratingStats(user.id);
    const pending = await db.get(
      "SELECT id, status, created_at FROM verification_requests WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC, id DESC LIMIT 1",
      [user.id],
    );
    return res.json({
      user: {
        id: user.id,
        alias: user.alias,
        real_name: user.real_name || '',
        email: user.email || null,
        email_verified: user.email_verified === true || user.email_verified === 1 || user.email_verified === '1',
        bio: user.bio || '',
        avatar_url: user.avatar_photo_id ? (photoUrls.get(Number(user.avatar_photo_id)) || null) : null,
        cover_url: user.cover_photo_id ? (photoUrls.get(Number(user.cover_photo_id)) || null) : null,
        is_admin: isAdminAlias(user.alias),
        verified: effectiveVerified({ verified: user.verified, alias: user.alias }),
        member_since: user.created_at,
        ...counts,
        ...ratings,
        verification_pending: Boolean(pending),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar tu cuenta.' });
  }
});

// PATCH /api/users/me/profile — bio, avatar y portada.
// { bio?, avatar?, cover? } — avatar/cover: { mime, data } para
// poner una foto nueva, null para quitarla, o no venir para
// dejarla como está. La foto vieja se borra al reemplazarla.
router.patch('/me/profile', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const user = await db.get('SELECT id, alias, avatar_photo_id, cover_photo_id FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });
    const updates = [];
    const params = [];
    const newPhotos = [];
    if (req.body.bio !== undefined) {
      const bio = String(req.body.bio || '').trim().slice(0, MAX_BIO);
      updates.push(`bio = $${params.length + 1}`);
      params.push(bio);
    }
    for (const field of ['avatar', 'cover']) {
      const value = req.body[field];
      if (value === undefined) continue;
      const col = field === 'avatar' ? 'avatar_photo_id' : 'cover_photo_id';
      const oldId = field === 'avatar' ? user.avatar_photo_id : user.cover_photo_id;
      if (value === null) {
        if (oldId) await photos.deletePhoto(Number(oldId));
        updates.push(`${col} = NULL`);
      } else {
        const decoded = photos.decodeUpload(value);
        if (decoded.error) return res.status(400).json({ error: decoded.error });
        const saved = await photos.savePhoto({ ownerId: user.id, kind: field, mime: decoded.mime, buffer: decoded.buffer });
        if (oldId) await photos.deletePhoto(Number(oldId));
        updates.push(`${col} = $${params.length + 1}`);
        params.push(saved.id);
        newPhotos.push({ field, mime: decoded.mime, buffer: decoded.buffer });
      }
    }
    if (updates.length) {
      params.push(user.id);
      await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    }
    const updated = await db.get(
      'SELECT id, alias, real_name, email, email_verified, bio, avatar_photo_id, cover_photo_id, verified, created_at FROM users WHERE id = $1',
      [user.id],
    );
    // Foto nueva de perfil o portada: también se publica sola en
    // el inicio y en el perfil, como en Facebook ("actualizó su
    // foto de perfil/portada"). Se guarda una copia para la
    // publicación para que la foto no se pierda de la publicación
    // cuando el perfil cambie otra vez.
    const publishedPosts = [];
    for (const np of newPhotos) {
      const postPhoto = await photos.savePhoto({ ownerId: user.id, kind: 'post', mime: np.mime, buffer: np.buffer });
      const text = np.field === 'avatar' ? 'actualizó su foto de perfil.' : 'actualizó su foto de portada.';
      const created = await db.query(
        `INSERT INTO posts (author_id, text, feeling, photo_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [user.id, text, '', postPhoto.id],
      );
      publishedPosts.push(created.rows[0].id);
    }
    const photoUrls = await photos.urlsByIds([updated.avatar_photo_id, updated.cover_photo_id]);
    return res.json({
      user: {
        id: updated.id,
        alias: updated.alias,
        real_name: updated.real_name || '',
        email: updated.email || null,
        email_verified: updated.email_verified === true || updated.email_verified === 1 || updated.email_verified === '1',
        bio: updated.bio || '',
        avatar_url: updated.avatar_photo_id ? (photoUrls.get(Number(updated.avatar_photo_id)) || null) : null,
        cover_url: updated.cover_photo_id ? (photoUrls.get(Number(updated.cover_photo_id)) || null) : null,
        is_admin: isAdminAlias(updated.alias),
        verified: effectiveVerified({ verified: updated.verified, alias: updated.alias }),
        member_since: updated.created_at,
      },
      published_posts: publishedPosts.length,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo actualizar tu perfil.' });
  }
});

// POST /api/users/me/verification — pedir verificación con nombre
// real + foto del documento. Una sola solicitud pendiente por
// usuario: si ya hay una, 409. El nombre real y el documento
// NUNCA salen en el perfil público: solo los ve el dueño.
//
// Para pedirla hay que tener 500 o más amigos o seguidores
// (seguidores o seguidos): si no se llega, 409 con los números
// que llevas. El dueño ya está verificado: no necesita pedirla.
router.post('/me/verification', requireAuth, requireObjectBody, async (req, res) => {
  try {
    if (isAdminAlias(req.user.alias)) {
      return res.status(409).json({ error: 'La cuenta del dueño ya está verificada.' });
    }
    const counts = await followCounts(req.user.id);
    if (counts.followers_count < 500 && counts.following_count < 500) {
      return res.status(409).json({
        error: `Para pedir la verificación necesitas al menos 500 amigos o seguidores. Llevas ${counts.followers_count} seguidores y ${counts.following_count} seguidos.`,
        followers_count: counts.followers_count,
        following_count: counts.following_count,
        required: 500,
      });
    }
    const realName = String(req.body.real_name || '').trim().slice(0, 100);
    if (realName.length < 2) return res.status(400).json({ error: 'Pon tu nombre real (mínimo 2 caracteres).' });
    if (req.body.document === undefined || req.body.document === null) {
      return res.status(400).json({ error: 'Falta la foto del documento.' });
    }
    const pending = await db.get(
      "SELECT id FROM verification_requests WHERE user_id = $1 AND status = 'pending'",
      [req.user.id],
    );
    if (pending) {
      return res.status(409).json({ error: 'Ya tienes una solicitud de verificación pendiente.' });
    }
    const decoded = photos.decodeUpload(req.body.document);
    if (decoded.error) return res.status(400).json({ error: decoded.error });
    const saved = await photos.savePhoto({ ownerId: req.user.id, kind: 'document', mime: decoded.mime, buffer: decoded.buffer });
    const created = await db.query(
      'INSERT INTO verification_requests (user_id, real_name, document_photo_id) VALUES ($1, $2, $3) RETURNING id, status, created_at',
      [req.user.id, realName, saved.id],
    );
    return res.status(201).json({
      request: {
        id: created.rows[0].id,
        status: created.rows[0].status,
        created_at: created.rows[0].created_at,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo enviar tu solicitud de verificación.' });
  }
});

// GET /api/users/me/verification — estado de mi solicitud (la
// última). Sin el documento en el cuerpo: el documento se ve
// (solo yo o el dueño) en /api/photos/:id con mi sesión.
router.get('/me/verification', requireAuth, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT id, real_name, document_photo_id, status, review_note, created_at, reviewed_at
       FROM verification_requests WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [req.user.id],
    );
    if (!row) return res.json({ request: null });
    return res.json({
      request: {
        id: row.id,
        real_name: row.real_name,
        document_url: row.document_photo_id ? `/api/photos/${row.document_photo_id}` : null,
        status: row.status,
        review_note: row.review_note || '',
        created_at: row.created_at,
        reviewed_at: row.reviewed_at,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar tu solicitud.' });
  }
});

// Solo el dueño (alias de ADMIN_ALIAS) puede ver y resolver las
// solicitudes de verificación: es su insignia y su decisión, y
// las revisa desde su propio perfil, en una lista pequeña solo
// para él. No hay panel de administrador.
function requireOwner(req, res, next) {
  if (!isAdminAlias(req.user.alias)) {
    return res.status(403).json({ error: 'Solo el dueño puede ver esto.' });
  }
  return next();
}

const NOW_SQL = db.usePostgres ? 'NOW()' : "datetime('now')";

// GET /api/users/me/verification-requests — solicitudes de
// verificación (solo el dueño): pendientes primero, con el alias,
// el nombre real y la foto del documento de cada solicitante.
router.get('/me/verification-requests', requireAuth, requireOwner, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const params = [];
    let where = '';
    if (['pending', 'approved', 'rejected'].includes(status)) {
      params.push(status);
      where = 'WHERE vr.status = $1';
    }
    const { rows } = await db.query(
      `SELECT vr.*, u.alias AS user_alias
       FROM verification_requests vr JOIN users u ON u.id = vr.user_id
       ${where}
       ORDER BY CASE WHEN vr.status = 'pending' THEN 0 ELSE 1 END, vr.created_at DESC, vr.id DESC
       LIMIT 200`,
      params,
    );
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user_alias: r.user_alias,
        real_name: r.real_name,
        document_photo_id: r.document_photo_id,
        document_url: r.document_photo_id ? `/api/photos/${r.document_photo_id}` : null,
        status: r.status,
        review_note: r.review_note || '',
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las solicitudes.' });
  }
});

// POST /api/users/me/verification-requests/:id/approve — el dueño
// otorga el verificado: el usuario queda verificado (✓ Verificado).
router.post('/me/verification-requests/:id/approve', requireAuth, requireOwner, requireObjectBody, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const request = await db.get('SELECT * FROM verification_requests WHERE id = $1', [id]);
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'Esa solicitud ya fue revisada (' + request.status + ').' });
    }
    await db.query(
      `UPDATE verification_requests SET status = 'approved', reviewed_at = ${NOW_SQL}, review_note = $1 WHERE id = $2`,
      [String(req.body.note || '').trim().slice(0, 300), id],
    );
    await db.query('UPDATE users SET verified = $1 WHERE id = $2', [true, request.user_id]);
    return res.json({ ok: true, request_id: id, status: 'approved' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo aprobar la solicitud.' });
  }
});

// POST /api/users/me/verification-requests/:id/reject — el dueño
// rechaza la solicitud (con nota opcional). El usuario puede
// volver a pedirla después.
router.post('/me/verification-requests/:id/reject', requireAuth, requireOwner, requireObjectBody, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const request = await db.get('SELECT * FROM verification_requests WHERE id = $1', [id]);
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'Esa solicitud ya fue revisada (' + request.status + ').' });
    }
    await db.query(
      `UPDATE verification_requests SET status = 'rejected', reviewed_at = ${NOW_SQL}, review_note = $1 WHERE id = $2`,
      [String(req.body.note || '').trim().slice(0, 300), id],
    );
    return res.json({ ok: true, request_id: id, status: 'rejected' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo rechazar la solicitud.' });
  }
});

router.get('/:alias/profile', optionalAuth, async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) {
      return res.status(400).json({ error: 'Alias no válido.' });
    }
    const user = await db.get('SELECT id, alias, real_name, bio, avatar_photo_id, cover_photo_id, verified, created_at FROM users WHERE alias = $1', [alias]);
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });

    // Señales sociales de la reputación: publicaciones visibles,
    // seguidores y contenidos quitados por moderación. (Robin Dark
    // ya no tiene tienda: no hay tratos cerrados ni cancelados.)
    const [postsCount, rejectedRow, messageRows] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM posts WHERE author_id = $1 AND deleted = FALSE', [user.id]),
      db.get("SELECT COUNT(*) AS n FROM moderation_flags WHERE user_id = $1 AND status = 'rejected'", [user.id]),
      db.query(
        `SELECT m.thread_id AS conversation_id, m.sender_id, m.created_at FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         WHERE t.user_a_id = $1 OR t.user_b_id = $1
         ORDER BY m.thread_id ASC, m.created_at ASC, m.id ASC`,
        [user.id],
      ),
    ]);

    const days = daysSince(user.created_at);
    const posts = Number(postsCount.n);
    const rejected = Number(rejectedRow.n);
    const responseMinutes = responseTimeMinutes(messageRows.rows, user.id);
    const isAdmin = isAdminAlias(user.alias);
    const photoUrls = await photos.urlsByIds([user.avatar_photo_id, user.cover_photo_id]);
    const counts = await followCounts(user.id);
    const ratings = await ratingStats(user.id);

    // Relación con quien mira (solo con sesión): si lo sigo, si me
    // sigue, si somos amigos (mutuo) y cuántos amigos tenemos en
    // común (a quién seguimos los dos).
    let viewer = { is_following: false, is_followed_by: false, is_friend: false, mutual_follows: 0 };
    if (req.user && req.user.id !== user.id) {
      const [f1, f2, mutual] = await Promise.all([
        db.get('SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2', [req.user.id, user.id]),
        db.get('SELECT id FROM follows WHERE follower_id = $1 AND followed_id = $2', [user.id, req.user.id]),
        db.get(
          `SELECT COUNT(*) AS n FROM follows f1 JOIN follows f2 ON f1.followed_id = f2.followed_id
           WHERE f1.follower_id = $1 AND f2.follower_id = $2`,
          [req.user.id, user.id],
        ),
      ]);
      const isFollowing = Boolean(f1);
      const isFollowedBy = Boolean(f2);
      viewer = {
        is_following: isFollowing,
        is_followed_by: isFollowedBy,
        is_friend: isFollowing && isFollowedBy,
        mutual_follows: Number(mutual.n),
      };
    }

    return res.json({
      alias: user.alias,
      // Nombre real: el que se muestra en el perfil. Las cuentas
      // sin nombre real (ninguna nueva lo es: es obligatorio al
      // registrarse) muestran su alias.
      real_name: user.real_name || user.alias,
      bio: user.bio || '',
      avatar_url: user.avatar_photo_id ? (photoUrls.get(Number(user.avatar_photo_id)) || null) : null,
      cover_url: user.cover_photo_id ? (photoUrls.get(Number(user.cover_photo_id)) || null) : null,
      member_since: user.created_at,
      member_days: days,
      is_admin: isAdmin,
      badge: badgeFor({ isAdmin, days, posts, rejected }),
      // Antigüedad del perfil: 'nuevo' (< 30 días), 'antiguo'
      // (>= 90 días, marco dorado) o null entre medias.
      seniority: seniority(days),
      verified: effectiveVerified({ verified: user.verified, alias: user.alias }),
      reputation: computeReputation({ days, posts, followers: counts.followers_count, rejected }),
      ...counts,
      ...ratings,
      posts_count: posts,
      removed_by_moderation: rejected,
      response_minutes: responseMinutes === null ? null : Math.round(responseMinutes * 10) / 10,
      response_time: formatResponseTime(responseMinutes),
      ...viewer,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el perfil.' });
  }
});

// GET /api/users/:alias/posts — publicaciones del usuario.
router.get('/:alias/posts', async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
    const user = await db.get('SELECT id FROM users WHERE alias = $1', [alias]);
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });
    const limit = parseLimit(req);
    const before = parseBefore(req);
    const params = [user.id];
    let sql = `SELECT p.*, u.alias AS author_alias,
                      u.verified AS author_verified, u.avatar_photo_id AS author_avatar_photo_id
               FROM posts p JOIN users u ON u.id = p.author_id
               WHERE p.author_id = $1 AND p.deleted = FALSE`;
    if (before !== null) { params.push(before); sql += ` AND p.id < $${params.length}`; }
    sql += ' ORDER BY p.created_at DESC, p.id DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const { rows } = await db.query(sql, params);
    const photoUrls = await photos.urlsByIds([
      ...collectAvatarIds(rows),
      ...rows.map((r) => r.photo_id).filter(Boolean),
    ]);
    return res.json({
      posts: rows.map((r) => ({
        id: r.id,
        text: r.text,
        created_at: r.created_at,
        author: authorCard({
          id: r.author_id,
          alias: r.author_alias,
          verified: r.author_verified,
          avatar_photo_id: r.author_avatar_photo_id,
        }, photoUrls),
        photo_url: r.photo_id ? (photoUrls.get(Number(r.photo_id)) || null) : null,
      })),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las publicaciones.' });
  }
});

// GET /api/users/:alias/followers | /following — listas públicas.
async function followList(req, res, direction) {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
    const user = await db.get('SELECT id FROM users WHERE alias = $1', [alias]);
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });
    const limit = parseLimit(req);
    const rows = direction === 'followers'
      ? (await db.query(
        `SELECT u.id, u.alias, u.verified, u.avatar_photo_id
         FROM follows f JOIN users u ON u.id = f.follower_id
         WHERE f.followed_id = $1 ORDER BY f.created_at DESC, f.id DESC LIMIT $2`,
        [user.id, limit],
      )).rows
      : (await db.query(
        `SELECT u.id, u.alias, u.verified, u.avatar_photo_id
         FROM follows f JOIN users u ON u.id = f.followed_id
         WHERE f.follower_id = $1 ORDER BY f.created_at DESC, f.id DESC LIMIT $2`,
        [user.id, limit],
      )).rows;
    const photoUrls = await photos.urlsByIds(collectAvatarIds(rows));
    const key = direction === 'followers' ? 'followers' : 'following';
    return res.json({ [key]: rows.map((r) => authorCard(r, photoUrls)) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar la lista.' });
  }
}

router.get('/:alias/followers', (req, res) => followList(req, res, 'followers'));
router.get('/:alias/following', (req, res) => followList(req, res, 'following'));

// GET /api/users/:alias/friends — amigos: los que se siguen
// mutuamente (yo lo sigo y él me sigue). Es la lista de «Amigos»
// del perfil y de la vista Amigos.
router.get('/:alias/friends', async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
    const user = await db.get('SELECT id FROM users WHERE alias = $1', [alias]);
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });
    const limit = parseLimit(req);
    const { rows } = await db.query(
      `SELECT u.id, u.alias, u.verified, u.avatar_photo_id
       FROM follows f1 JOIN follows f2 ON f1.followed_id = f2.follower_id AND f1.follower_id = f2.followed_id
       JOIN users u ON u.id = f1.followed_id
       WHERE f1.follower_id = $1 ORDER BY f1.created_at DESC, f1.id DESC LIMIT $2`,
      [user.id, limit],
    );
    const photoUrls = await photos.urlsByIds(collectAvatarIds(rows));
    return res.json({ friends: rows.map((r) => authorCard(r, photoUrls)) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar la lista de amigos.' });
  }
});

// POST /api/users/:alias/rate { stars } — valoración con estrellas
// (1-5). Una por usuario: si ya valoraste, se actualiza tu
// valoración. No te puedes valorar a ti mismo. La media sale en
// el perfil público; no toca la reputación calculada por tratos.
router.post('/:alias/rate', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) return res.status(400).json({ error: 'Alias no válido.' });
    const stars = Number(req.body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Las estrellas tienen que ser de 1 a 5.' });
    }
    const target = await db.get('SELECT id, alias FROM users WHERE alias = $1', [alias]);
    if (!target) return res.status(404).json({ error: 'Ese usuario no existe.' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'No te puedes valorar a ti mismo.' });
    await db.query(
      `INSERT INTO ratings (rater_id, rated_id, stars) VALUES ($1, $2, $3)
       ON CONFLICT (rater_id, rated_id) DO UPDATE SET stars = EXCLUDED.stars`,
      [req.user.id, target.id, stars],
    );
    const stats = await ratingStats(target.id);
    return res.json({ rated_alias: target.alias, stars, ...stats });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo guardar tu valoración.' });
  }
});

module.exports = router;
