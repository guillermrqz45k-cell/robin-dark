// src/routes/admin.js — panel de administrador de Robin Dark.
//
// Solo el dueño del sitio entra aquí, con credenciales aparte de los
// usuarios anónimos: variables de entorno ADMIN_ALIAS y ADMIN_PASSWORD.
// NO hay contraseña por defecto en el código: si no están configuradas,
// el login de admin responde 503 y hay que ponerlas en Railway
// (Variables) o en el .env local. La contraseña nunca se guarda en la
// base de datos ni se devuelve en ninguna respuesta.
//
// POST /api/admin/login — entra como admin, devuelve JWT con role: 'admin'.
// GET  /api/admin/stats — conteos: usuarios, anuncios, pedidos, mensajes,
//        tratos cerrados, custodia retenida/liberada/cancelada (nº y sats).
// GET  /api/admin/users — todos los usuarios (alias y fecha; SIN contraseñas).
// GET  /api/admin/listings — todos los anuncios, con vendedor y precio en BTC.
// GET  /api/admin/orders — todos los pedidos, con comprador, vendedor y
//        estado de custodia.
// GET  /api/admin/escrows — los pedidos como custodias (retenido/liberado/
//        cancelado), con sus importes en satoshis.
// DELETE /api/admin/listings/:id — borra un anuncio (solo si no tiene
//        pedidos; si tiene, 409 para no romper el historial).
// POST /api/admin/escrows/:id/cancel — cancela una custodia RETENIDA:
//        el pedido pasa a 'cancelado' y el anuncio vuelve a 'disponible'.
//
// Todo requiere token de admin (requireAdmin): un usuario normal recibe 403.
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { formatBtc } = require('../db');
const { signToken } = require('../auth');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Comparación en tiempo constante: evita filtrar por timing si el
// alias o la contraseña son correctos o no.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminConfigured() {
  return Boolean(process.env.ADMIN_ALIAS && process.env.ADMIN_PASSWORD);
}

// POST /api/admin/login { alias, password }
router.post('/login', async (req, res) => {
  try {
    if (!adminConfigured()) {
      return res.status(503).json({
        error: 'El panel de administrador no está configurado. El dueño debe poner ADMIN_ALIAS y ADMIN_PASSWORD en las variables de entorno (en Railway, en Variables del servicio).',
      });
    }
    const alias = String(req.body.alias || '').trim();
    const password = String(req.body.password || '');
    if (!alias || !password) {
      return res.status(400).json({ error: 'Alias y contraseña de administrador son obligatorios.' });
    }
    if (!safeEqual(alias, process.env.ADMIN_ALIAS) || !safeEqual(password, process.env.ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Alias o contraseña de administrador incorrectos.' });
    }
    const token = signToken({ id: 0, alias: process.env.ADMIN_ALIAS }, { role: 'admin' });
    return res.json({ token, user: { id: 0, alias: process.env.ADMIN_ALIAS, role: 'admin' } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo entrar como administrador.' });
  }
});

async function count(table, where = '', params = []) {
  const row = await db.get(`SELECT COUNT(*) AS n FROM ${table} ${where}`, params);
  return Number(row.n);
}

async function sumSats(table, where = '', params = []) {
  const row = await db.get(`SELECT COALESCE(SUM(price_sats), 0) AS n FROM ${table} ${where}`, params);
  return Number(row.n);
}

function escrowLabel(status) {
  switch (status) {
    case 'retenido':
      return 'Pago retenido en custodia — esperando que el comprador confirme que recibió el producto';
    case 'liberado':
      return 'Pago liberado al vendedor — el comprador confirmó que recibió el producto';
    case 'pagado_btc':
      return 'Pago en BTC registrado';
    case 'completado':
      return 'Pedido completado';
    case 'cancelado':
      return 'Pedido cancelado — el anuncio volvió a estar disponible';
    default:
      return status;
  }
}

function presentOrder(row) {
  return {
    id: row.id,
    listing_id: row.listing_id,
    listing_title: row.listing_title,
    buyer_id: row.buyer_id,
    buyer_alias: row.buyer_alias,
    seller_id: row.seller_id,
    seller_alias: row.seller_alias,
    price_sats: Number(row.price_sats),
    price_btc: formatBtc(row.price_sats),
    price_display: `₿ ${formatBtc(row.price_sats)}`,
    payment: 'BTC',
    status: row.status,
    escrow_status: row.status,
    escrow_label: escrowLabel(row.status),
    created_at: row.created_at,
  };
}

// GET /api/admin/stats — conteos del panel.
router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    const [users, listings, orders, conversations, messages] = await Promise.all([
      count('users'),
      count('listings'),
      count('orders'),
      count('conversations'),
      count('messages'),
    ]);
    const [disponible, vendido] = await Promise.all([
      count('listings', "WHERE status = $1", ['disponible']),
      count('listings', "WHERE status = $1", ['vendido']),
    ]);
    const [retenido, liberado, cancelado] = await Promise.all([
      count('orders', "WHERE status = $1", ['retenido']),
      count('orders', "WHERE status IN ('liberado', 'completado')"),
      count('orders', "WHERE status = $1", ['cancelado']),
    ]);
    const retenidoSats = await sumSats('orders', "WHERE status = $1", ['retenido']);
    const liberadoSats = await sumSats('orders', "WHERE status IN ('liberado', 'completado')");
    res.json({
      users,
      listings,
      orders,
      conversations,
      messages,
      listings_disponible: disponible,
      listings_vendido: vendido,
      tratos_cerrados: liberado,
      escrows: {
        retenido,
        retenido_sats: retenidoSats,
        retenido_btc: formatBtc(retenidoSats),
        liberado,
        liberado_sats: liberadoSats,
        liberado_btc: formatBtc(liberadoSats),
        cancelado,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/users — todos los usuarios. NUNCA se devuelve
// password_hash: la consulta solo pide id, alias y fecha.
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.alias, u.created_at,
              (SELECT COUNT(*) FROM listings l WHERE l.seller_id = u.id) AS listings_count,
              (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id OR o.seller_id = u.id) AS orders_count
       FROM users u ORDER BY u.created_at DESC, u.id DESC`,
    );
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        alias: r.alias,
        created_at: r.created_at,
        listings_count: Number(r.listings_count),
        orders_count: Number(r.orders_count),
      })),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/listings — todos los anuncios, con vendedor y precio BTC.
router.get('/listings', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, u.alias AS seller_alias FROM listings l
       JOIN users u ON u.id = l.seller_id ORDER BY l.created_at DESC, l.id DESC`,
    );
    res.json({
      listings: rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        price_sats: Number(r.price_sats),
        price_btc: formatBtc(r.price_sats),
        price_display: `₿ ${formatBtc(r.price_sats)}`,
        status: r.status,
        seller_id: r.seller_id,
        seller_alias: r.seller_alias,
        created_at: r.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
});

const ORDERS_SQL = `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
  FROM orders o JOIN listings l ON l.id = o.listing_id
  JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id`;

// GET /api/admin/orders — todos los pedidos con su custodia.
router.get('/orders', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`${ORDERS_SQL} ORDER BY o.created_at DESC, o.id DESC`);
    res.json({ orders: rows.map(presentOrder) });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/escrows — los pedidos vistos como custodias.
// En Robin Dark la custodia ES el pedido: retenido = dinero en
// custodia, liberado = pagado al vendedor, cancelado = devuelto.
router.get('/escrows', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`${ORDERS_SQL} ORDER BY o.created_at DESC, o.id DESC`);
    res.json({ escrows: rows.map(presentOrder) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/admin/listings/:id — borra un anuncio.
// Si ya tiene pedidos, se rechaza (409) para no romper el historial
// de tratos. Antes se borran sus conversaciones y mensajes.
router.delete('/listings/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const listing = await db.get('SELECT * FROM listings WHERE id = $1', [id]);
    if (!listing) return res.status(404).json({ error: 'Anuncio no encontrado.' });
    const order = await db.get('SELECT id FROM orders WHERE listing_id = $1', [id]);
    if (order) {
      return res.status(409).json({ error: 'Ese anuncio ya tiene pedidos y no se puede borrar, para no romper el historial.' });
    }
    const convs = await db.query('SELECT id FROM conversations WHERE listing_id = $1', [id]);
    for (const c of convs.rows) {
      await db.query('DELETE FROM messages WHERE conversation_id = $1', [c.id]);
    }
    await db.query('DELETE FROM conversations WHERE listing_id = $1', [id]);
    await db.query('DELETE FROM listings WHERE id = $1', [id]);
    return res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo borrar el anuncio.' });
  }
});

// POST /api/admin/escrows/:id/cancel — cancela una custodia RETENIDA.
// El pedido pasa a 'cancelado' y el anuncio vuelve a 'disponible',
// como si el trato nunca se hubiera cerrado. Solo vale para custodias
// retenidas: una ya liberada no se puede cancelar.
router.post('/escrows/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const order = await db.get(
      `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
       FROM orders o JOIN listings l ON l.id = o.listing_id
       JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
       WHERE o.id = $1`,
      [id],
    );
    if (!order) return res.status(404).json({ error: 'Custodia no encontrada.' });
    if (order.status !== 'retenido') {
      return res.status(409).json({ error: 'Solo se puede cancelar una custodia retenida. Esta ya está ' + order.status + '.' });
    }
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['cancelado', id]);
    await db.query('UPDATE listings SET status = $1 WHERE id = $2', ['disponible', order.listing_id]);
    const conv = await db.get(
      'SELECT * FROM conversations WHERE listing_id = $1 AND buyer_id = $2 AND seller_id = $3',
      [order.listing_id, order.buyer_id, order.seller_id],
    );
    if (conv) {
      await db.query(
        'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, $3)',
        [conv.id, order.seller_id, 'El administrador canceló la custodia de este trato. El anuncio vuelve a estar disponible.'],
      );
    }
    const updated = await db.get(
      `SELECT o.*, l.title AS listing_title, b.alias AS buyer_alias, s.alias AS seller_alias
       FROM orders o JOIN listings l ON l.id = o.listing_id
       JOIN users b ON b.id = o.buyer_id JOIN users s ON s.id = o.seller_id
       WHERE o.id = $1`,
      [id],
    );
    return res.json({ order: presentOrder(updated) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cancelar la custodia.' });
  }
});

module.exports = router;
