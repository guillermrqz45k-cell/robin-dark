// src/routes/auth.js — registro e inicio de sesión anónimos.
// POST /api/auth/register { alias, password }
// POST /api/auth/login    { alias, password }
// GET  /api/auth/me      (con token) -> { id, alias }
//
// Correcciones de seguridad:
// - Límite de intentos (authLimiter): antes se podía probar
//   contraseñas sin parar.
// - Login con alias inexistente: antes respondía al instante y
//   con alias existente tardaba lo de bcrypt, lo que filtraba
//   qué alias están registrados. Ahora se hace una comparación
//   bcrypt falsa para tardar lo mismo en ambos casos.
// - Contraseña máxima de 72 bytes: bcrypt trunca en silencio
//   más allá de 72 bytes, así que una contraseña más larga
//   sería más débil de lo que parece.
const express = require('express');
const db = require('../db');
const {
  hashPassword,
  checkPassword,
  checkPasswordDummy,
  passwordTooLong,
  signToken,
  cleanAlias,
} = require('../auth');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { requireObjectBody } = require('../middleware/validate');

const router = express.Router();

function validate(alias, password) {
  if (!alias || alias.length < 3) return 'El alias debe tener al menos 3 caracteres.';
  if (!/^[a-zA-Z0-9_.-]+$/.test(alias)) return 'El alias solo puede tener letras, números, _ . -';
  if (!password || password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  if (passwordTooLong(password)) return 'La contraseña es demasiado larga (máximo 72 caracteres).';
  return null;
}

router.post('/register', authLimiter, requireObjectBody, async (req, res) => {
  try {
    const alias = cleanAlias(req.body.alias);
    const password = String(req.body.password || '');
    const error = validate(alias, password);
    if (error) return res.status(400).json({ error });

    const existing = await db.get('SELECT id FROM users WHERE alias = $1', [alias]);
    if (existing) return res.status(409).json({ error: 'Ese alias ya está en uso. Elige otro.' });

    const passwordHash = await hashPassword(password);
    const created = await db.query(
      'INSERT INTO users (alias, password_hash) VALUES ($1, $2) RETURNING id, alias',
      [alias, passwordHash],
    );
    const user = created.rows[0];
    return res.status(201).json({ token: signToken(user), user: { id: user.id, alias: user.alias } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' });
  }
});

router.post('/login', authLimiter, requireObjectBody, async (req, res) => {
  try {
    const alias = cleanAlias(req.body.alias);
    const password = String(req.body.password || '');
    if (!alias || !password) return res.status(400).json({ error: 'Alias y contraseña son obligatorios.' });
    if (passwordTooLong(password)) return res.status(400).json({ error: 'La contraseña es demasiado larga.' });

    const user = await db.get('SELECT id, alias, password_hash FROM users WHERE alias = $1', [alias]);
    if (!user) {
      // Comparación falsa para que el tiempo de respuesta no revele
      // si el alias existe o no.
      await checkPasswordDummy(password);
      return res.status(401).json({ error: 'Alias o contraseña incorrectos.' });
    }
    const ok = await checkPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Alias o contraseña incorrectos.' });

    return res.json({ token: signToken(user), user: { id: user.id, alias: user.alias } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo entrar. Inténtalo de nuevo.' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { id: req.user.id, alias: req.user.alias } });
});

module.exports = router;
