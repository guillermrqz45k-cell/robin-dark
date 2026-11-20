// src/routes/auth.js — registro e inicio de sesión de Robin Dark.
//
// POST /api/auth/register { real_name, alias, email, password }
// POST /api/auth/login    { email, password }
// GET  /api/auth/me      (con token) -> { id, alias, real_name, email, email_verified, is_admin, verified }
// GET  /api/auth/config  -> { email_recovery, email_verification }
// POST /api/auth/verify-email { email, code } — verifica el correo
// POST /api/auth/resend-verification { email } — reenvía el código
// POST /api/auth/forgot  { email } -> código de 6 dígitos por correo
// POST /api/auth/reset   { email, code, password }
//
// Registro (desde 2026-11-20, decisión de AMO): SOLO con nombre
// real + correo + contraseña. El alias queda como @usuario (el
// nombre que se muestra en el perfil es el nombre real). Al
// registrarse se envía un código de verificación de 6 dígitos al
// correo con Resend (mismo sistema que el de recuperación: solo
// hash SHA-256, caduca en 15 minutos, un solo uso, remitente
// noreply@robindark.co, clave desde RESEND_API_KEY). Sin la llave
// el registro funciona igual pero el código no se puede enviar
// (la respuesta lo dice con code_sent: false). El registro NO
// devuelve token de sesión (decisión de AMO, 2026-11-20): quien se
// acaba de registrar no queda dentro; la respuesta solo dice que el
// código fue enviado. El login SÍ exige el correo verificado: sin
// confirmar el correo, la entrada queda bloqueada (403,
// email_verification_required) hasta verificarlo.
// Inicio de sesión SOLO con correo y contraseña. NO hay login por
// alias ni cuentas viejas que mantener (decisión de AMO,
// 2026-11-20): todo limpio de nuevo, sin migrar usuarios ni datos
// viejos. El alias solo sirve como @usuario público y para abrir
// perfiles (/api/users/:alias/profile).
//
// Correcciones de seguridad:
// - Límite de intentos (authLimiter): antes se podía probar
//   contraseñas sin parar.
// - Login con correo inexistente: antes respondía al instante y
//   con correo existente tardaba lo de bcrypt, lo que filtraba
//   qué correos están registrados. Ahora se hace una comparación
//   bcrypt falsa para tardar lo mismo en ambos casos.
// - Contraseña máxima de 72 bytes: bcrypt trunca en silencio
//   más allá de 72 bytes, así que una contraseña más larga
//   sería más débil de lo que parece.
// - /verify-email y /resend-verification usan el mismo límite
//   que la recuperación (5 / 15 min): pedir códigos sin parar es
//   una forma de abusar del correo y de adivinar el código de
//   otra persona, aunque sea de 6 dígitos.
// - /resend-verification responde siempre lo mismo, exista o no
//   el correo y esté o no verificado: no se filtra por la
//   respuesta qué correos están registrados ni verificados.
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const {
  hashPassword,
  checkPassword,
  checkPasswordDummy,
  passwordTooLong,
  signToken,
  cleanAlias,
  cleanEmail,
  validEmail,
  hashCode,
} = require('../auth');
const { requireAuth } = require('../middleware/auth');
const { authLimiter, recoveryLimiter } = require('../middleware/rateLimit');
const { requireObjectBody } = require('../middleware/validate');
const { isAdminAlias, isAdminUser, effectiveVerified } = require('../reputation');
const mail = require('../mail');

const router = express.Router();
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutos
const RESET_GENERIC = 'Si ese correo está registrado, te enviamos un código de recuperación.';
const RESEND_GENERIC = 'Si ese correo está registrado y aún no está verificado, te enviamos un código.';

// Respuesta genérica de /forgot: no revela si el correo existe.
function forgotReply(res) {
  return res.json({ ok: true, message: RESET_GENERIC });
}

// Respuesta genérica de /resend-verification: no revela si el
// correo existe ni si ya está verificado.
function resendReply(res) {
  return res.json({ ok: true, message: RESEND_GENERIC });
}

function cleanRealName(name) {
  return String(name || '').trim().slice(0, 100);
}

function isVerifiedFlag(value) {
  return value === true || value === 1 || value === '1';
}

function validateRegister(realName, alias, password, email) {
  if (!realName || realName.length < 2) return 'Pon tu nombre real (mínimo 2 caracteres).';
  if (!alias || alias.length < 3) return 'El alias debe tener al menos 3 caracteres.';
  if (!/^[a-zA-Z0-9_.-]+$/.test(alias)) return 'El alias solo puede tener letras, números, _ . -';
  if (!password || password.length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  if (passwordTooLong(password)) return 'La contraseña es demasiado larga (máximo 72 caracteres).';
  if (!email || !validEmail(email)) return 'El correo no es válido.';
  return null;
}

function presentUser(user) {
  return {
    id: user.id,
    alias: user.alias,
    real_name: user.real_name || '',
    email: user.email || null,
    email_verified: isVerifiedFlag(user.email_verified),
    is_admin: isAdminUser(user),
    verified: effectiveVerified({ verified: user.verified, alias: user.alias, rank: user.rank }),
  };
}

// Genera un código de verificación de 6 dígitos, anula los
// anteriores sin usar de ese usuario, lo guarda solo como hash
// y lo envía por correo. Devuelve true si se envió.
async function sendVerificationCode(user) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = Date.now() + RESET_CODE_TTL_MS;
  await db.query('UPDATE email_verification_codes SET used = $1 WHERE user_id = $2 AND used = $3', [true, user.id, false]);
  await db.query(
    'INSERT INTO email_verification_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, hashCode(code), expiresAt],
  );
  const sent = await mail.sendMail({ to: user.email, ...mail.verificationMail(code) });
  if (!sent.ok) {
    console.error('[auth] no se pudo enviar el código de verificación a', user.email, sent.error);
    return false;
  }
  return true;
}

router.post('/register', authLimiter, requireObjectBody, async (req, res) => {
  try {
    const realName = cleanRealName(req.body.real_name);
    const alias = cleanAlias(req.body.alias);
    const password = String(req.body.password || '');
    const email = req.body.email === undefined || req.body.email === null || req.body.email === ''
      ? null
      : cleanEmail(req.body.email);
    const error = validateRegister(realName, alias, password, email);
    if (error) return res.status(400).json({ error });

    const existing = await db.get('SELECT id FROM users WHERE alias = $1', [alias]);
    if (existing) return res.status(409).json({ error: 'Ese alias ya está en uso. Elige otro.' });
    const emailTaken = await db.get('SELECT id FROM users WHERE email = $1', [email]);
    if (emailTaken) return res.status(409).json({ error: 'Ese correo ya está en uso en otra cuenta.' });

    const passwordHash = await hashPassword(password);
    // El dueño nace con rango 'admin' para que siga siéndolo
    // aunque cambie su @usuario después (el rango vive en su fila).
    const rank = isAdminAlias(alias) ? 'admin' : 'new';
    const created = await db.query(
      'INSERT INTO users (alias, password_hash, email, real_name, rank) VALUES ($1, $2, $3, $4, $5) RETURNING id, alias, real_name, email, email_verified, rank, verified',
      [alias, passwordHash, email, realName, rank],
    );
    const user = created.rows[0];
    // El código de verificación se envía al registrarse. Sin la
    // llave de Resend no se puede enviar: el registro igual queda
    // creado y el usuario puede pedir el código después, cuando
    // el correo esté configurado (POST /resend-verification).
    let codeSent = false;
    if (mail.isConfigured()) {
      codeSent = await sendVerificationCode(user);
    } else {
      console.warn('[auth] registro sin RESEND_API_KEY: no se envió el código de verificación.');
    }
    // Sin token de sesión: la entrada queda bloqueada hasta
    // confirmar el correo. Quien se acaba de registrar solo recibe
    // la confirmación de que el código fue enviado; para entrar
    // tiene que verificar el correo y luego iniciar sesión.
    return res.status(201).json({
      user: presentUser(user),
      email_verification: { required: true, code_sent: codeSent },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' });
  }
});

// POST /api/auth/verify-email { email, code } — verifica el
// correo con el código. El código tiene que ser el último, no
// estar usado y no haber caducado. Al usarlo queda marcado como
// usado: un solo uso. No exige sesión: el código es la prueba de
// que ese correo es tuyo (igual que /reset).
router.post('/verify-email', recoveryLimiter, requireObjectBody, async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const code = String(req.body.code || '').trim();
    const bad = () => res.status(400).json({ error: 'El código no es válido o ya caducó.' });
    if (!validEmail(email) || !/^\d{6}$/.test(code)) return bad();

    const user = await db.get('SELECT id, email_verified FROM users WHERE email = $1', [email]);
    if (!user) return bad();
    const row = await db.get(
      `SELECT * FROM email_verification_codes WHERE user_id = $1 AND used = $2
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [user.id, false],
    );
    if (!row) return bad();
    if (row.expires_at <= Date.now()) return bad();
    if (row.code_hash !== hashCode(code)) return bad();

    const marked = await db.query(
      'UPDATE email_verification_codes SET used = $1 WHERE id = $2 AND used = $3',
      [true, row.id, false],
    );
    if (!marked.rowCount) return bad();
    await db.query('UPDATE users SET email_verified = $1 WHERE id = $2', [true, user.id]);
    return res.json({ ok: true, email_verified: true, message: 'Correo verificado. Ya puedes usar tu cuenta.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo verificar el correo. Inténtalo de nuevo.' });
  }
});

// POST /api/auth/resend-verification { email } — reenvía el
// código de verificación (por ejemplo, si caducó). Siempre
// responde lo mismo (200), exista o no el correo y esté o no
// verificado. Un código nuevo anula el anterior sin usar.
router.post('/resend-verification', recoveryLimiter, requireObjectBody, async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    if (!validEmail(email)) return resendReply(res);
    const user = await db.get('SELECT id, email, email_verified FROM users WHERE email = $1', [email]);
    if (!user) return resendReply(res);
    if (isVerifiedFlag(user.email_verified)) return resendReply(res);
    if (!mail.isConfigured()) {
      console.warn('[auth] reenvío de código pedido pero RESEND_API_KEY no está configurado.');
      return resendReply(res);
    }
    await sendVerificationCode(user);
    return resendReply(res);
  } catch (e) {
    console.error(e);
    return resendReply(res);
  }
});

router.post('/login', authLimiter, requireObjectBody, async (req, res) => {
  try {
    // Solo correo + contraseña: no hay login por alias (decisión
    // de AMO, 2026-11-20). El alias solo es el @usuario público.
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!validEmail(email) || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
    if (passwordTooLong(password)) return res.status(400).json({ error: 'La contraseña es demasiado larga.' });

    const user = await db.get(
      'SELECT id, alias, real_name, email, email_verified, password_hash, rank, verified FROM users WHERE email = $1',
      [email],
    );
    if (!user) {
      // Comparación falsa para que el tiempo de respuesta no revele
      // si el correo existe o no.
      await checkPasswordDummy(password);
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const ok = await checkPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });

    // La entrada queda bloqueada hasta confirmar el correo
    // (decisión de AMO, 2026-11-20): sin verificar, no se entra,
    // ni siquiera con la contraseña correcta. El cliente muestra
    // el paso de verificación con ese mismo correo.
    if (!isVerifiedFlag(user.email_verified)) {
      return res.status(403).json({
        error: 'Primero confirma tu correo. Te enviamos un código de verificación de 6 dígitos.',
        code: 'email_verification_required',
        email_verification_required: true,
        email: user.email,
      });
    }

    return res.json({ token: signToken(user), user: presentUser(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo entrar. Inténtalo de nuevo.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, alias, real_name, email, email_verified, rank, verified FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!user) return res.status(404).json({ error: 'Ese usuario no existe.' });
    return res.json({ user: presentUser(user) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar tu cuenta.' });
  }
});

// GET /api/auth/config — dice si el correo está disponible
// (RESEND_API_KEY puesto): recuperación y verificación de correo
// usan el mismo remitente y la misma llave. El cliente lo usa
// para no ofrecer un "¿Olvidaste tu contraseña?" ni una
// verificación que no puede cumplir.
router.get('/config', async (req, res) => {
  const configured = mail.isConfigured();
  res.json({ email_recovery: configured, email_verification: configured });
});

// POST /api/auth/forgot { email } — pide el código de recuperación.
// Siempre responde lo mismo (200), exista o no el correo: no se
// filtra por la respuesta qué correos están registrados. El código
// nuevo anula cualquier código anterior sin usar de ese usuario.
router.post('/forgot', recoveryLimiter, requireObjectBody, async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    if (!validEmail(email)) return forgotReply(res);
    const user = await db.get('SELECT id, email FROM users WHERE email = $1', [email]);
    if (!user) return forgotReply(res);
    if (!mail.isConfigured()) {
      console.warn('[auth] recuperación pedida pero RESEND_API_KEY no está configurado.');
      return forgotReply(res);
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = Date.now() + RESET_CODE_TTL_MS;
    await db.query("UPDATE password_resets SET used = $1 WHERE user_id = $2 AND used = $3", [true, user.id, false]);
    await db.query(
      'INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashCode(code), expiresAt],
    );
    const sent = await mail.sendMail({ to: user.email, ...mail.recoveryMail(code) });
    if (!sent.ok) {
      console.error('[auth] no se pudo enviar el código de recuperación a', user.email);
      return forgotReply(res);
    }
    return forgotReply(res);
  } catch (e) {
    console.error(e);
    return forgotReply(res);
  }
});

// POST /api/auth/reset { email, code, password } — cambia la
// contraseña con el código. El código tiene que ser el último,
// no estar usado y no haber caducado. Al usarlo queda marcado
// como usado: un solo uso.
router.post('/reset', recoveryLimiter, requireObjectBody, async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const code = String(req.body.code || '').trim();
    const password = String(req.body.password || '');
    if (!validEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'El código no es válido o ya caducó.' });
    }
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    if (passwordTooLong(password)) return res.status(400).json({ error: 'La contraseña es demasiado larga (máximo 72 caracteres).' });

    const user = await db.get('SELECT id FROM users WHERE email = $1', [email]);
    if (!user) return res.status(400).json({ error: 'El código no es válido o ya caducó.' });
    const reset = await db.get(
      `SELECT * FROM password_resets WHERE user_id = $1 AND used = $2
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [user.id, false],
    );
    const bad = () => res.status(400).json({ error: 'El código no es válido o ya caducó.' });
    if (!reset) return bad();
    if (reset.expires_at <= Date.now()) return bad();
    if (reset.code_hash !== hashCode(code)) return bad();

    const marked = await db.query(
      'UPDATE password_resets SET used = $1 WHERE id = $2 AND used = $3',
      [true, reset.id, false],
    );
    if (!marked.rowCount) return bad();
    const passwordHash = await hashPassword(password);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
    return res.json({ ok: true, message: 'Contraseña cambiada. Ya puedes entrar con tu contraseña nueva.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' });
  }
});

module.exports = router;
