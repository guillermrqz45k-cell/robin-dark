// src/routes/users.js — perfil público y reputación de Robin Dark.
//
// GET /api/users/:alias/profile es PÚBLICO (sin token): cualquiera
// puede ver el perfil de un vendedor antes de contactarlo, igual
// que ve sus anuncios en la tienda. Solo devuelve datos que ya
// son públicos o se derivan de ellos: alias, fecha de registro,
// anuncios activos, tratos cerrados/cancelados, tiempo medio de
// respuesta y reputación. NUNCA devuelve password_hash ni ningún
// dato privado (no hay correo, teléfono ni ubicación en la base).
const express = require('express');
const db = require('../db');
const { formatBtc } = require('../db');
const {
  CLOSED_STATUSES, daysSince, computeReputation, badgeFor, median, formatResponseTime,
  rankInfo, effectiveVerified,
} = require('../reputation');

const router = express.Router();
const ALIAS_RE = /^[a-zA-Z0-9_.-]{3,30}$/;

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

router.get('/:alias/profile', async (req, res) => {
  try {
    const alias = String(req.params.alias || '');
    if (!ALIAS_RE.test(alias)) {
      return res.status(400).json({ error: 'Alias no válido.' });
    }
    const user = await db.get('SELECT id, alias, rank, verified, created_at FROM users WHERE alias = $1', [alias]);
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });

    const closedIn = `(${CLOSED_STATUSES.map((s) => `'${s}'`).join(', ')})`;
    const [activeRow, closedSellerRow, closedBuyerRow, cancelledRow] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM listings WHERE seller_id = $1 AND status = $2', [user.id, 'disponible']),
      db.get(`SELECT COUNT(*) AS n FROM orders WHERE seller_id = $1 AND status IN ${closedIn}`, [user.id]),
      db.get(`SELECT COUNT(*) AS n FROM orders WHERE buyer_id = $1 AND status IN ${closedIn}`, [user.id]),
      db.get("SELECT COUNT(*) AS n FROM orders WHERE (seller_id = $1 OR buyer_id = $1) AND status = 'cancelado'", [user.id]),
    ]);
    const activeListings = await db.query(
      `SELECT l.*, u.alias AS seller_alias FROM listings l
       JOIN users u ON u.id = l.seller_id
       WHERE l.seller_id = $1 AND l.status = 'disponible'
       ORDER BY l.created_at DESC LIMIT 20`,
      [user.id],
    );
    const messageRows = await db.query(
      `SELECT m.conversation_id, m.sender_id, m.created_at FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.buyer_id = $1 OR c.seller_id = $1
       ORDER BY m.conversation_id ASC, m.created_at ASC, m.id ASC`,
      [user.id],
    );

    const days = daysSince(user.created_at);
    const closedAsSeller = Number(closedSellerRow.n);
    const closedAsBuyer = Number(closedBuyerRow.n);
    const closed = closedAsSeller + closedAsBuyer;
    const cancelled = Number(cancelledRow.n);
    const responseMinutes = responseTimeMinutes(messageRows.rows, user.id);
    const isAdmin = Boolean(process.env.ADMIN_ALIAS) && user.alias === process.env.ADMIN_ALIAS;
    const info = rankInfo({ rank: user.rank, alias: user.alias });

    return res.json({
      alias: user.alias,
      member_since: user.created_at,
      member_days: days,
      is_admin: isAdmin,
      badge: badgeFor({ isAdmin, days, closed, cancelled }),
      // Rango con letras y verificación: viajan con el perfil para
      // que el cliente los muestre junto a la insignia de reputación.
      ...info,
      verified: effectiveVerified({ verified: user.verified, alias: user.alias }),
      reputation: computeReputation({ days, closed, cancelled }),
      active_listings_count: Number(activeRow.n),
      active_listings: activeListings.rows.map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        price_sats: Number(l.price_sats),
        price_btc: formatBtc(l.price_sats),
        price_display: `₿ ${formatBtc(l.price_sats)}`,
        stock: Number(l.stock ?? 1),
        stock_label: Number(l.stock ?? 1) === 1 ? '1 unidad' : `${Number(l.stock ?? 1)} unidades`,
        status: l.status,
        seller_alias: l.seller_alias,
        created_at: l.created_at,
      })),
      closed_as_seller: closedAsSeller,
      closed_as_buyer: closedAsBuyer,
      closed_total: closed,
      cancelled,
      response_minutes: responseMinutes === null ? null : Math.round(responseMinutes * 10) / 10,
      response_time: formatResponseTime(responseMinutes),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar el perfil.' });
  }
});

module.exports = router;
