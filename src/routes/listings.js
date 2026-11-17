// src/routes/listings.js — tienda de Robin Dark.
// Sin categorías: la búsqueda es la forma de encontrar artículos.
// Precios solo en BTC: se reciben en BTC y se guardan en satoshis.
const express = require('express');
const db = require('../db');
const { formatBtc } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody, escapeLike } = require('../middleware/validate');
const { daysSince, badgeFor, rankInfo, effectiveVerified } = require('../reputation');

const router = express.Router();
const SATS_PER_BTC = 100_000_000;
// 21 millones de BTC es toda la oferta máxima de Bitcoin: ningún
// precio real puede ser mayor. Antes se aceptaba cualquier número
// y un valor enorme desbordaba el entero de la base de datos (500).
const MAX_PRICE_BTC = 21_000_000;
// Stock máximo por anuncio: 10.000 unidades es más que suficiente
// para un anuncio y evita cantidades absurdas.
const MAX_STOCK = 10000;

function parseStock(value) {
  // Cantidad al publicar (o al reponer). Si no viene, 1 unidad
  // (el comportamiento de antes). Tiene que ser un entero >= 1.
  if (value === undefined || value === null || value === '') return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_STOCK) return null;
  return n;
}

function toSats(priceBtc) {
  const btc = Number(priceBtc);
  if (!Number.isFinite(btc) || btc <= 0 || btc > MAX_PRICE_BTC) return null;
  const sats = Math.round(btc * SATS_PER_BTC);
  if (!Number.isSafeInteger(sats) || sats <= 0) return null;
  return sats;
}

function sellerBadge(row) {
  // La insignia del vendedor viaja con el anuncio: el cliente solo
  // la muestra. Se calcula aquí, en el servidor, con la misma
  // función que usa el perfil público (src/reputation.js).
  const closed = Number(row.seller_closed ?? 0);
  const cancelled = Number(row.seller_cancelled ?? 0);
  const days = daysSince(row.seller_created_at);
  const isAdmin = Boolean(process.env.ADMIN_ALIAS) && row.seller_alias === process.env.ADMIN_ALIAS;
  return badgeFor({ isAdmin, days, closed, cancelled });
}

function sellerRank(row) {
  // Rango con letras y verificación del vendedor, también calculados
  // en el servidor: el cliente solo los muestra.
  const info = rankInfo({ rank: row.seller_rank, alias: row.seller_alias });
  return {
    seller_rank: info.rank,
    seller_rank_letter: info.rank_letter,
    seller_rank_label: info.rank_label,
    seller_rank_badges: info.rank_badges,
    seller_verified: effectiveVerified({ verified: row.seller_verified, alias: row.seller_alias }),
  };
}

function present(row) {
  if (!row) return null;
  const stock = Number(row.stock ?? 1);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price_sats: Number(row.price_sats),
    price_btc: formatBtc(row.price_sats),
    price_display: `₿ ${formatBtc(row.price_sats)}`,
    stock,
    cantidad: stock,
    stock_label: stock === 1 ? '1 unidad' : `${stock} unidades`,
    status: row.status,
    seller_id: row.seller_id,
    seller_alias: row.seller_alias,
    seller_badge: sellerBadge(row),
    ...sellerRank(row),
    created_at: row.created_at,
  };
}

// Datos del vendedor para su insignia: fecha de registro, tratos
// cerrados (como vendedor y como comprador) y tratos cancelados.
// Son subconsultas sobre columnas propias, sin parámetros del
// usuario: funcionan igual en Postgres y en SQLite.
const SELLER_BADGE_COLS = `
  u.created_at AS seller_created_at,
  u.rank AS seller_rank,
  u.verified AS seller_verified,
  (SELECT COUNT(*) FROM orders o WHERE o.seller_id = l.seller_id AND o.status IN ('liberado', 'completado')) +
  (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = l.seller_id AND o.status IN ('liberado', 'completado')) AS seller_closed,
  (SELECT COUNT(*) FROM orders o WHERE (o.seller_id = l.seller_id OR o.buyer_id = l.seller_id) AND o.status = 'cancelado') AS seller_cancelled`;

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
        `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
         JOIN users u ON u.id = l.seller_id
         WHERE l.status = 'disponible' AND (l.title ${op} $1 ESCAPE '\\' OR l.description ${op} $1 ESCAPE '\\')
         ORDER BY l.created_at DESC LIMIT 100`,
        [like],
      );
      rows = r.rows;
    } else {
      const r = await db.query(
        `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
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

// GET /api/listings/all?status=todas|disponible|agotada&search=texto —
// TODAS las publicaciones de todos los usuarios (disponibles y
// agotadas), más recientes primero, con contadores en vivo. Es el
// apartado «Publicaciones»: la Tienda (GET /api/listings) sigue
// siendo solo lo disponible. Va ANTES de /:id para que Express no
// confunda «all» con un id. «Agotadas» incluye el estado antiguo
// «vendido», que también es un anuncio terminado. Nunca devuelve
// password_hash ni datos privados: solo los campos de present().
router.get('/all', async (req, res) => {
  try {
    const status = String(req.query.status || 'todas').trim().toLowerCase();
    if (!['todas', 'disponible', 'agotada', 'agotadas'].includes(status)) {
      return res.status(400).json({ error: 'El filtro tiene que ser Todas, Disponibles o Agotadas.' });
    }
    const search = String(req.query.search || '').trim().slice(0, 100);
    const counts = await db.get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'disponible' THEN 1 ELSE 0 END), 0) AS disponibles,
              COALESCE(SUM(CASE WHEN status IN ('agotado', 'vendido') THEN 1 ELSE 0 END), 0) AS agotadas,
              COUNT(DISTINCT seller_id) AS vendedores
       FROM listings`,
    );
    const conditions = [];
    const params = [];
    if (status === 'disponible') {
      conditions.push(`l.status = 'disponible'`);
    } else if (status === 'agotada' || status === 'agotadas') {
      conditions.push(`l.status IN ('agotado', 'vendido')`);
    }
    if (search) {
      const op = db.usePostgres ? 'ILIKE' : 'LIKE';
      const like = `%${escapeLike(search)}%`;
      params.push(like, like);
      const a = params.length - 1;
      const b = params.length;
      conditions.push(`(l.title ${op} $${a} ESCAPE '\\' OR l.description ${op} $${b} ESCAPE '\\')`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const r = await db.query(
      `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
       JOIN users u ON u.id = l.seller_id
       ${where} ORDER BY l.created_at DESC LIMIT 200`,
      params,
    );
    return res.json({
      listings: r.rows.map(present),
      counts: {
        total: Number(counts.total ?? 0),
        disponibles: Number(counts.disponibles ?? 0),
        agotadas: Number(counts.agotadas ?? 0),
        vendedores: Number(counts.vendedores ?? 0),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar las publicaciones.' });
  }
});

// GET /api/listings/:id
router.get('/:id', async (req, res) => {
  const id = requireIdParam(req, res);
  if (id === null) return;
  try {
    const row = await db.get(
      `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
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

// POST /api/listings { title, description, price_btc, stock }
// stock = cantidad de unidades de este artículo (por defecto 1).
// Un anuncio con stock 3 se puede vender 3 veces: cada venta
// descuenta 1 y el anuncio sigue en la tienda hasta agotarse.
router.post('/', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim().slice(0, 120);
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const priceSats = toSats(req.body.price_btc);
    const stock = parseStock(req.body.stock ?? req.body.cantidad);
    if (!title) return res.status(400).json({ error: 'El título es obligatorio.' });
    if (!priceSats) return res.status(400).json({ error: 'El precio debe ser un valor en BTC mayor que 0.' });
    if (stock === null) return res.status(400).json({ error: `La cantidad tiene que ser un número entero entre 1 y ${MAX_STOCK}.` });

    const created = await db.query(
      `INSERT INTO listings (seller_id, title, description, price_sats, stock)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, title, description, priceSats, stock],
    );
    const row = await db.get(
      `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
       JOIN users u ON u.id = l.seller_id WHERE l.id = $1`,
      [created.rows[0].id],
    );
    return res.status(201).json({ listing: present(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo publicar el anuncio.' });
  }
});

// POST /api/listings/:id/mark-out-of-stock — SOLO EL VENDEDOR.
// La única forma manual de que se acabe un artículo: el vendedor
// lo da por agotado. El anuncio deja de verse en la tienda y
// nadie nuevo puede contactar por él. El stock pasa a 0.
router.post('/:id/mark-out-of-stock', requireAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [id]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el vendedor de este anuncio puede darlo por agotado.' });
    }
    if (listing.status !== 'disponible') {
      return res.status(409).json({ error: 'Ese anuncio ya está agotado.' });
    }
    await db.query("UPDATE listings SET status = 'agotado', stock = 0 WHERE id = $1", [id]);
    const row = await db.get(
      `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
       JOIN users u ON u.id = l.seller_id WHERE l.id = $1`,
      [id],
    );
    return res.json({ listing: present(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo marcar el anuncio como agotado.' });
  }
});

// POST /api/listings/:id/restock { stock | cantidad } — SOLO EL VENDEDOR.
// Vuelve a poner en venta un anuncio agotado (o vendido, en filas
// viejas) con una cantidad nueva, o cambia la cantidad de uno
// disponible. El anuncio vuelve a 'disponible' con ese stock.
router.post('/:id/restock', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const stock = parseStock(req.body.stock ?? req.body.cantidad);
    if (stock === null) return res.status(400).json({ error: `La cantidad tiene que ser un número entero entre 1 y ${MAX_STOCK}.` });
    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [id]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo el vendedor de este anuncio puede reponer su stock.' });
    }
    await db.query("UPDATE listings SET stock = $1, status = 'disponible' WHERE id = $2", [stock, id]);
    const row = await db.get(
      `SELECT l.*, u.alias AS seller_alias, ${SELLER_BADGE_COLS} FROM listings l
       JOIN users u ON u.id = l.seller_id WHERE l.id = $1`,
      [id],
    );
    return res.json({ listing: present(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo reponer el stock.' });
  }
});

module.exports = router;
