// src/routes/stats.js — conteos públicos de Robin Dark.
//
// GET /api/stats devuelve solo números, ningún dato personal:
// cuántos usuarios se registraron, cuántas publicaciones,
// historias y reels hay, a cuánta gente se sigue, cuántos
// grupos existen y cuántos mensajes y comentarios se enviaron.
// Así cualquiera puede ver cuántos registros hay, sin ver
// quiénes son. (Robin Dark ya no tiene tienda: no hay conteos
// de anuncios, pedidos ni tratos.)
const express = require('express');
const db = require('../db');

const router = express.Router();

async function count(table, where = '', params = []) {
  const row = await db.get(`SELECT COUNT(*) AS n FROM ${table} ${where}`, params);
  return Number(row.n);
}

router.get('/', async (req, res, next) => {
  try {
    const [users, posts, stories, reels, follows, groups, messages, comments] = await Promise.all([
      count('users'),
      count('posts', 'WHERE deleted = $1', [false]),
      count('stories', "WHERE kind = $1 AND deleted = $2", ['story', false]),
      count('stories', "WHERE kind = $1 AND deleted = $2", ['reel', false]),
      count('follows'),
      count('groups'),
      count('dm_messages'),
      count('post_comments', 'WHERE deleted = $1', [false]),
    ]);
    res.json({
      users,
      posts,
      stories,
      reels,
      follows,
      groups,
      messages,
      comments,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
