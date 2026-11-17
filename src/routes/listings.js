// src/routes/listings.js — tienda de Robin Dark.
// Sin categorías: la búsqueda es la forma de encontrar artículos.
// Precios solo en BTC: se reciben en BTC y se guardan en satoshis.
const express = require('express');
const db = require('../db');
const { formatBtc } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody, escapeLike } = require('../middleware/validate');

const router = express.Router();
const SATS_PER_BTC = 100_000_000;
// 21 millones de BTC es toda la oferta máxima de Bitcoin: ningún
// precio real puede ser mayor. Antes se aceptaba cualquier número
// y un valor enorme desbordaba el entero de la base de datos (500).
const MAX_PRICE_BTC = 21_000_000;

function toSats(priceBtc) {
  const btc = Number(priceBtc);
  if (!Number.isFinite(btc) || btc <= 0 || btc > MAX_PRICE_BTC) return null;
  const sats = Math.round(btc * SATS_PER_BTC);
  if (!Number.isSafeInteger(sats) || sats <= 0) return null;
  return sats;
}

function present(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price_sats: Number(row.price_sats),
    price_btc: formatBtc(row.price_sats),
    price_display: `₿ ${formatBtc(row.price_sats)}`,
    status: row.status,
    seller_id: row.seller_id,
    seller_alias: row.seller_alias,
    created_at: row.created_at,
  };
}

// GET /api/listings?search=texto — solo anuncios disponibles, más recientes primero.
router.get('/', async (req, res) => {
  try {
    // Búsqueda limitada a 100 caracteres: sin límite, una búsqueda
    // gigante es una forma barata de cargar el servidor.
    const search = String(req.query.search || '').trim().slice(0, 100);
    let rows;
    if (search) {
      // Los comodines % y _ se escapan: buscar "%" ya no devuelve
      // toda la tienda. La consulta sigue siendo parametrizada
      // (nunca hubo inyección SQL aquí), con ESCAPE '\'.
      const like = `%${escapeLike(search)}%`;
      // Postgres: ILIKE (sin distinción de mayúsculas). SQLite: LIKE.
      const op = db.usePostgres ? 'ILIKE' : 'LIKE';
      const r = await db.query(
        `SELECT l.*, u.alias AS seller_alias FROM listings l
         JOIN users u ON u.id = l.seller_id
         WHERE l.status = 'disponible' AND (l.title ${op} $1 ESCAPE '\\' OR l.description ${op} $1 ESCAPE '\\')
         ORDER BY l.created_at DESC LIMIT 100`,
        [like],
      );
      rows = r.rows;
    } else {
      const r = await db.query(
        `SELECT l.*, u.alias AS seller_alias FROM listings l
         JOIN users u ON u.id = l.seller_id
         WHERE l.status = 'disponible' ORDER BY l.created_at DESC LIMIT 100`,
      );
      rows = r.rows;
    }
    return res.json({ listings: rows.map(present) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar la tienda.' });
  }
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const id = requireIdParam(req, res);
  if (id === null) return;
  try {
    const row = await db.get(
      `SELECT l.*, u.alias AS seller_alias FROM listings l
       JOIN users u ON u.id = l.seller_id WHERE l.id = $1`,
      [id],
    );
    if (!row) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    return res.json({ listing: present(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el anuncio.' });
  }
});

// POST /api/listings { title, description, price_btc }
router.post('/', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 120);
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const priceSats = toSats(req.body.price_btc);
    if (!title) return res.status(400).json({ error: 'El título es obligatorio.' });
    if (!priceSats) return res.status(400).json({ error: 'El precio debe ser un valor en BTC mayor que 0.' });

    const created = await db.query(
      `INSERT INTO listings (seller_id, title, description, price_sats)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, title, description, priceSats],
    );
    const row = await db.get(
      `SELECT l.*, u.alias AS seller_alias FROM listings l
       JOIN users u ON u.id = l.seller_id WHERE l.id = $1`,
      [created.rows[0].id],
    );
    return res.status(201).json({ listing: present(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo publicar el anuncio.' });
  }
});

module.exports = router;
