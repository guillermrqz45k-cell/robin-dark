// src/routes/groups.js — grupos de Robin Dark.
//
// GET  /api/social/groups — lista pública con nº real de miembros.
// POST /api/social/groups { name, description? } — crear (con sesión).
// GET  /api/social/groups/:id — detalle con miembros.
// POST /api/social/groups/:id/join | /leave — unirse/salir (con sesión).
// DELETE /api/social/groups/:id — solo el creador.
// GET  /api/social/groups/:id/posts — muro del grupo (solo miembros).
// POST /api/social/groups/:id/posts { text, photo? } — publicar en
//   el muro (solo miembros). DELETE /:id/posts/:postId — el autor
//   o el creador del grupo.
//
// El número de miembros es real: cuenta las filas de
// group_members, no un número guardado. Empieza en 1 (el creador
// se une al crear el grupo) y sube cuando alguien se une.
const express = require('express');
const db = require('../db');
const photos = require('../photos');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody } = require('../middleware/validate');
const { authorCard, collectAvatarIds } = require('../present');
const { checkText } = require('../moderation');

const router = express.Router();
const MAX_NAME = 80;
const MAX_DESC = 500;
const MAX_GROUP_POST_TEXT = 2000;

const GROUP_SELECT = `
  SELECT g.*, u.alias AS creator_alias,
         u.verified AS creator_verified, u.avatar_photo_id AS creator_avatar_photo_id,
         u.rank AS creator_rank,
         (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
  FROM groups g JOIN users u ON u.id = g.creator_id`;

async function presentGroup(row, reqUser) {
  const photoUrls = await photos.urlsByIds([row.creator_avatar_photo_id]);
  let isMember = false;
  let isCreator = false;
  if (reqUser) {
    isCreator = reqUser.id === row.creator_id;
    if (!isCreator) {
      const m = await db.get('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [row.id, req.user.id]);
      isMember = Boolean(m);
    } else {
      isMember = true;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    created_at: row.created_at,
    creator: authorCard({
      id: row.creator_id,
      alias: row.creator_alias,
      verified: row.creator_verified,
      avatar_photo_id: row.creator_avatar_photo_id,
      rank: row.creator_rank,
    }, photoUrls),
    member_count: Number(row.member_count),
    is_member: isMember,
    is_creator: isCreator,
  };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `${GROUP_SELECT} ORDER BY member_count DESC, g.created_at DESC, g.id DESC LIMIT 100`,
    );
    const groups = [];
    for (const row of rows) groups.push(await presentGroup(row, req.user));
    return res.json({ groups });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar los grupos.' });
  }
});

router.post('/', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, MAX_NAME);
    if (name.length < 2) return res.status(400).json({ error: 'El grupo necesita un nombre (mínimo 2 caracteres).' });
    const description = String(req.body.description || '').trim().slice(0, MAX_DESC);
    const created = await db.query(
      'INSERT INTO groups (name, description, creator_id) VALUES ($1, $2, $3) RETURNING id',
      [name, description, req.user.id],
    );
    const groupId = created.rows[0].id;
    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [groupId, req.user.id],
    );
    const row = await db.get(`${GROUP_SELECT} WHERE g.id = $1`, [groupId]);
    const group = await presentGroup(row, req.user);
    return res.status(201).json({ group });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo crear el grupo.' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const row = await db.get(`${GROUP_SELECT} WHERE g.id = $1`, [id]);
    if (!row) return res.status(404).json({ error: 'Grupo no encontrado.' });
    const group = await presentGroup(row, req.user);
    const { rows: memberRows } = await db.query(
      `SELECT u.id, u.alias, u.verified, u.avatar_photo_id, u.rank
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1 ORDER BY gm.created_at ASC, gm.id ASC LIMIT 100`,
      [id],
    );
    const photoUrls = await photos.urlsByIds(collectAvatarIds(memberRows));
    group.members = memberRows.map((r) => authorCard(r, photoUrls));
    return res.json({ group });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el grupo.' });
  }
});

router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const group = await db.get('SELECT id FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado.' });
    await db.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, req.user.id],
    );
    const count = await db.get('SELECT COUNT(*) AS n FROM group_members WHERE group_id = $1', [id]);
    return res.json({ joined: true, member_count: Number(count.n) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No te pudiste unir al grupo.' });
  }
});

router.post('/:id/leave', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const group = await db.get('SELECT id FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado.' });
    await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [id, req.user.id]);
    const count = await db.get('SELECT COUNT(*) AS n FROM group_members WHERE group_id = $1', [id]);
    return res.json({ joined: false, member_count: Number(count.n) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No pudiste salir del grupo.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const group = await db.get('SELECT id, creator_id FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado.' });
    if (group.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el creador puede borrar el grupo.' });
    }
    await db.query('DELETE FROM groups WHERE id = $1', [id]);
    return res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo borrar el grupo.' });
  }
});

// ---------- Muro del grupo ----------

const GROUP_POST_SELECT = `
  SELECT gp.*, u.alias AS author_alias, u.verified AS author_verified,
         u.avatar_photo_id AS author_avatar_photo_id, u.rank AS author_rank
  FROM group_posts gp JOIN users u ON u.id = gp.author_id`;

async function isGroupMember(groupId, userId) {
  const m = await db.get('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return Boolean(m);
}

async function presentGroupPosts(rows) {
  const photoUrls = await photos.urlsByIds([
    ...collectAvatarIds(rows.map((r) => ({ avatar_photo_id: r.author_avatar_photo_id }))),
    ...rows.map((r) => r.photo_id).filter(Boolean),
  ]);
  return rows.map((r) => ({
    id: r.id,
    group_id: r.group_id,
    text: r.text,
    created_at: r.created_at,
    author: authorCard({
      id: r.author_id,
      alias: r.author_alias,
      verified: r.author_verified,
      avatar_photo_id: r.author_avatar_photo_id,
      rank: r.author_rank,
    }, photoUrls),
    photo_url: r.photo_id ? (photoUrls.get(Number(r.photo_id)) || null) : null,
  }));
}

// GET /api/social/groups/:id/posts — muro: solo lo ven los miembros.
router.get('/:id/posts', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const group = await db.get('SELECT id FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado.' });
    if (!(await isGroupMember(id, req.user.id))) {
      return res.status(403).json({ error: 'Solo los miembros del grupo pueden ver su muro.' });
    }
    const { rows } = await db.query(
      `${GROUP_POST_SELECT} WHERE gp.group_id = $1 AND gp.deleted = FALSE AND u.disabled = FALSE ORDER BY gp.created_at DESC, gp.id DESC LIMIT 50`,
      [id],
    );
    return res.json({ posts: await presentGroupPosts(rows) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el muro del grupo.' });
  }
});

// POST /api/social/groups/:id/posts — publicar en el muro (solo
// miembros). El texto pasa por la moderación automática: el spam
// y los insultos se rechazan (422). Se puede adjuntar una foto.
router.post('/:id/posts', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const group = await db.get('SELECT id FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado.' });
    if (!(await isGroupMember(id, req.user.id))) {
      return res.status(403).json({ error: 'Solo los miembros del grupo pueden publicar en su muro.' });
    }
    const text = String(req.body.text || '').trim().slice(0, MAX_GROUP_POST_TEXT);
    if (!text) return res.status(400).json({ error: 'La publicación no puede estar vacía.' });
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
      'INSERT INTO group_posts (group_id, author_id, text, photo_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, req.user.id, text, photoId],
    );
    const row = await db.get(`${GROUP_POST_SELECT} WHERE gp.id = $1`, [created.rows[0].id]);
    const [post] = await presentGroupPosts([row]);
    return res.status(201).json({ post });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo publicar en el grupo.' });
  }
});

// DELETE /api/social/groups/:id/posts/:postId — el autor o el
// creador del grupo (borrado suave).
router.delete('/:id/posts/:postId', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId) || postId <= 0) {
      return res.status(400).json({ error: 'Id de publicación no válido.' });
    }
    const group = await db.get('SELECT id, creator_id FROM groups WHERE id = $1', [id]);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado.' });
    const post = await db.get('SELECT id, author_id FROM group_posts WHERE id = $1 AND group_id = $2', [postId, id]);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    if (post.author_id !== req.user.id && group.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el autor o el creador del grupo puede borrarla.' });
    }
    await db.query('UPDATE group_posts SET deleted = $1 WHERE id = $2', [true, postId]);
    return res.json({ ok: true, deleted: postId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo borrar la publicación.' });
  }
});

module.exports = router;
