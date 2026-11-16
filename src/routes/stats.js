// src/routes/stats.js — conteos públicos de Robin Dark.
//
// GET /api/stats devuelve solo números, ningún dato personal:
// cuántos usuarios se registraron, cuántos anuncios se publicaron,
// cuántos tratos se cerraron (pedidos liberados) y cuántos mensajes
// se enviaron. Así cualquiera puede ver cuántos registros hay,
// sin ver quiénes son.
const express = require('express');
const db = require('../db');

const router = express.Router();

async function count(table) {
  const row = await db.get(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row.n);
}

router.get('/', async (req, res, next) => {
  try {
    const [users, listings, orders, conversations, messages, dealsRow] = await Promise.all([
      count('users'),
      count('listings'),
      count('orders'),
      count('conversations'),
      count('messages'),
      db.get(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('liberado', 'completado')`),
    ]);
    res.json({
      users,
      listings,
      orders,
      conversations,
      messages,
      tratos_cerrados: Number(dealsRow.n),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
