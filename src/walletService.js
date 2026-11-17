// src/walletService.js — lógica compartida del monedero recargable.
//
// Saldo en USD (centavos, entero >= 0) por usuario. Nunca se guardan
// números de tarjeta, CVV ni datos de la tarjeta: el cobro lo hace
// Stripe Checkout fuera de esta base; aquí solo quedan el importe,
// el estado de la recarga y el id de la sesión de Stripe.
//
// Acreditar una recarga solo puede pasar UNA vez: el cambio a
// 'completado' es atómico (UPDATE ... WHERE status='pendiente') y
// solo si esa actualización tocó 1 fila se suma el importe al
// saldo. Un segundo intento (doble clic del admin, reintento del
// webhook de Stripe) ve rowCount 0 y no acredita nada.
const db = require('./db');

function formatUsd(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function presentTopup(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    user_alias: row.user_alias || null,
    amount_usd_cents: Number(row.amount_usd_cents),
    amount_usd: formatUsd(row.amount_usd_cents),
    status: row.status,
    method: row.method || 'tarjeta',
    stripe_session_id: row.stripe_session_id || null,
    created_at: row.created_at,
  };
}

async function ensureWallet(userId) {
  if (db.usePostgres) {
    await db.query(
      'INSERT INTO wallets (user_id, balance_usd_cents) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
      [userId],
    );
  } else {
    await db.query('INSERT OR IGNORE INTO wallets (user_id, balance_usd_cents) VALUES ($1, 0)', [userId]);
  }
}

async function getWallet(userId) {
  await ensureWallet(userId);
  const row = await db.get('SELECT * FROM wallets WHERE user_id = $1', [userId]);
  return { balance_usd_cents: Number(row ? row.balance_usd_cents : 0) };
}

// Acredita una recarga pendiente: pasa a 'completado' y suma el
// importe al saldo. Devuelve { ok: true, topup } o { ok: false,
// reason: 'not_found' | 'not_pending', topup }.
async function creditTopup(topupId) {
  const topup = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
  if (!topup) return { ok: false, reason: 'not_found', topup: null };
  const flipped = await db.query(
    "UPDATE topups SET status = 'completado' WHERE id = $1 AND status = 'pendiente'",
    [topupId],
  );
  if (!flipped.rowCount) {
    const current = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
    return { ok: false, reason: 'not_pending', topup: presentTopup(current) };
  }
  await ensureWallet(topup.user_id);
  await db.query(
    'UPDATE wallets SET balance_usd_cents = balance_usd_cents + $1 WHERE user_id = $2',
    [Number(topup.amount_usd_cents), topup.user_id],
  );
  const updated = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
  return { ok: true, topup: presentTopup(updated) };
}

// Rechaza una recarga pendiente: pasa a 'rechazado' sin acreditar.
async function rejectTopup(topupId) {
  const topup = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
  if (!topup) return { ok: false, reason: 'not_found', topup: null };
  const flipped = await db.query(
    "UPDATE topups SET status = 'rechazado' WHERE id = $1 AND status = 'pendiente'",
    [topupId],
  );
  if (!flipped.rowCount) {
    const current = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
    return { ok: false, reason: 'not_pending', topup: presentTopup(current) };
  }
  const updated = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
  return { ok: true, topup: presentTopup(updated) };
}

module.exports = { formatUsd, presentTopup, ensureWallet, getWallet, creditTopup, rejectTopup };
