// src/routes/wallet.js — monedero recargable con tarjeta.
//
// Solo usuarios APROBADOS por el admin pueden recargar con tarjeta:
// el admin pone `card_approved` por usuario (POST /api/admin/users/:id/
// approve-card) y sin esa aprobación la recarga responde 403.
//
// Flujo:
// 1. Usuario aprobado pide una recarga: POST /api/wallet/topup/request
//    { amount_usd } ($5–$500) -> recarga en estado 'pendiente'.
// 2. Pago con tarjeta (si Stripe está configurado): POST
//    /api/wallet/topup/:id/checkout crea una sesión de Stripe
//    Checkout y devuelve su URL; el usuario paga en la página de
//    Stripe (la tarjeta nunca pasa por este servidor).
// 3. Stripe avisa por webhook (POST /api/wallet/stripe-webhook, con
//    firma verificada) y al completarse el pago la recarga pasa a
//    'completado' y el saldo se acredita UNA sola vez (idempotente).
// 4. Si Stripe NO está configurado, el checkout responde 503 y la
//    recarga queda 'pendiente' para revisión manual del admin, que
//    puede completarla (acredita el saldo) o rechazarla desde su
//    panel (POST /api/admin/topups/:id/complete | /reject).
//
// El saldo es en USD (centavos). Los anuncios siguen costando solo
// en BTC y la custodia (retenido -> liberado) no cambia: pagar
// anuncios con el saldo es el siguiente paso y necesita decidir
// la conversión BTC/USD.
//
// Nunca se guardan números de tarjeta, CVV ni datos de la tarjeta.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireIdParam, requireObjectBody } = require('../middleware/validate');
const { formatUsd, presentTopup, getWallet, creditTopup } = require('../walletService');

const router = express.Router();

const MIN_USD = 5;
const MAX_USD = 500;

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  // Carga perezosa: sin clave de Stripe el servidor arranca igual
  // y el checkout responde 503 con un mensaje claro.
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// GET /api/wallet/balance — mi saldo y si tengo tarjeta aprobada.
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const user = await db.get('SELECT card_approved FROM users WHERE id = $1', [req.user.id]);
    const wallet = await getWallet(req.user.id);
    return res.json({
      balance_usd_cents: wallet.balance_usd_cents,
      balance_usd: formatUsd(wallet.balance_usd_cents),
      card_approved: Boolean(user && (user.card_approved === true || user.card_approved === 1)),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar tu saldo.' });
  }
});

// POST /api/wallet/topup/request { amount_usd } — pedir una recarga.
// Solo usuarios aprobados por el admin (403 si no). Importe $5–$500.
router.post('/topup/request', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const amountUsd = Number(req.body.amount_usd);
    if (!Number.isFinite(amountUsd) || amountUsd < MIN_USD || amountUsd > MAX_USD) {
      return res.status(400).json({ error: `El importe de la recarga debe estar entre $${MIN_USD} y $${MAX_USD}.` });
    }
    const cents = Math.round(amountUsd * 100);
    if (!Number.isInteger(cents) || cents < 500 || cents > 50000) {
      return res.status(400).json({ error: 'El importe debe tener como máximo 2 decimales.' });
    }
    const user = await db.get('SELECT card_approved FROM users WHERE id = $1', [req.user.id]);
    if (!user || !(user.card_approved === true || user.card_approved === 1)) {
      return res.status(403).json({ error: 'Solo usuarios aprobados por el admin pueden recargar con tarjeta. Pide la aprobación al administrador.' });
    }
    const created = await db.query(
      `INSERT INTO topups (user_id, amount_usd_cents, status, method)
       VALUES ($1, $2, 'pendiente', 'tarjeta') RETURNING *`,
      [req.user.id, cents],
    );
    return res.status(201).json({ topup: presentTopup(created.rows[0]) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo crear la recarga.' });
  }
});

// GET /api/wallet/topups — mis recargas.
router.get('/topups', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM topups WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
      [req.user.id],
    );
    return res.json({ topups: rows.map(presentTopup) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudieron cargar tus recargas.' });
  }
});

// POST /api/wallet/topup/:id/checkout — crear la sesión de pago de
// Stripe para una recarga pendiente mía. Sin claves de Stripe: 503.
router.post('/topup/:id/checkout', requireAuth, requireObjectBody, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const topup = await db.get('SELECT * FROM topups WHERE id = $1', [id]);
    if (!topup) return res.status(404).json({ error: 'Recarga no encontrada.' });
    if (topup.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Esa recarga no es tuya.' });
    }
    if (topup.status !== 'pendiente') {
      return res.status(409).json({ error: 'Esa recarga ya no está pendiente.' });
    }
    if (!stripeConfigured()) {
      return res.status(503).json({
        error: 'Pagos con tarjeta aún no configurados: falta la clave de Stripe. Tu recarga queda pendiente para revisión del administrador.',
      });
    }
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Recarga de saldo — Robin Dark' },
          unit_amount: Number(topup.amount_usd_cents),
        },
        quantity: 1,
      }],
      success_url: `${base}/?topup=ok`,
      cancel_url: `${base}/?topup=cancelado`,
      metadata: { topup_id: String(topup.id), user_id: String(topup.user_id) },
    });
    await db.query('UPDATE topups SET stripe_session_id = $1 WHERE id = $2', [session.id, topup.id]);
    const updated = await db.get('SELECT * FROM topups WHERE id = $1', [id]);
    return res.json({ checkout_url: session.url, topup: presentTopup(updated) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo crear el pago con tarjeta.' });
  }
});

// Webhook de Stripe (se monta en server.js con express.raw, ANTES
// de express.json: la verificación de la firma necesita el cuerpo
// crudo, no el JSON ya parseado).
// checkout.session.completed -> acredita la recarga UNA vez.
// La sesión se comprueba contra el stripe_session_id guardado y
// creditTopup solo acredita si la recarga sigue 'pendiente'.
async function stripeWebhook(req, res) {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) {
    return res.status(503).json({ error: 'Webhook de Stripe no configurado.' });
  }
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Falta la firma de Stripe.' });
  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    return res.status(400).json({ error: 'Firma de Stripe no válida.' });
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const topupId = Number(session.metadata && session.metadata.topup_id);
      if (Number.isInteger(topupId) && topupId > 0) {
        const topup = await db.get('SELECT * FROM topups WHERE id = $1', [topupId]);
        if (topup && (!topup.stripe_session_id || topup.stripe_session_id === session.id)) {
          await creditTopup(topupId);
        }
      }
    }
    return res.json({ received: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo procesar el aviso de Stripe.' });
  }
}

module.exports = router;
module.exports.stripeWebhook = stripeWebhook;
