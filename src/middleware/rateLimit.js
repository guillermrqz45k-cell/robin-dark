// src/middleware/rateLimit.js — límites de velocidad contra
// fuerza bruta y abuso.
//
// Antes no había ningún límite: un atacante podía probar contraseñas
// sin parar contra /api/auth/login, y crear
// cuentas sin límite contra /api/auth/register.
//
// Se usa express-rate-limit por IP. En Railway la app está detrás
// del proxy de Railway, así que server.js pone
// app.set('trust proxy', 1) para que req.ip sea la IP real del
// visitante y no la del proxy (sin eso, todos compartirían el
// mismo límite y un atacante bloquearía a todo el mundo).
//
// Los límites se pueden subir en local con variables de entorno
// (útil para las pruebas automatizadas), pero en producción valen
// los valores por defecto.
const rateLimit = require('express-rate-limit');

function numEnv(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

// Límite general de la API: 300 peticiones / 15 min por IP.
// Suficiente para uso normal; frena escaneos y abusos masivos.
// La salud (/api/health) no pasa por este límite: Railway la
// comprueba constantemente y no debe contar como abuso.
const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: numEnv('RATE_LIMIT_API_MAX', 300),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera unos minutos e inténtalo de nuevo.' },
  skip: (req) => req.path === '/health' || req.path === '/api/health',
});

// Login y registro: 10 intentos / 15 min por IP. Con bcrypt (coste
// 12) cada intento ya es caro; 10 intentos no bastan para adivinar
// una contraseña, y el límite frena los diccionarios.
const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: numEnv('RATE_LIMIT_AUTH_MAX', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});

// Recuperación de contraseña: 5 intentos / 15 min por IP. Pedir
// códigos sin parar es una forma de abusar del correo (y de
// adivinar el código de otra persona, aunque sea de 6 dígitos).
const recoveryLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: numEnv('RATE_LIMIT_RECOVERY_MAX', 5),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de recuperación. Espera 15 minutos e inténtalo de nuevo.' },
});

// Asistente de IA: 60 preguntas / 15 min por IP. Aunque el
// asistente es por reglas (no cuesta por pregunta), el límite
// frena que alguien lo use para raspar la plataforma.
const aiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: numEnv('RATE_LIMIT_AI_MAX', 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas preguntas a la asistente. Espera unos minutos.' },
});

module.exports = { apiLimiter, authLimiter, recoveryLimiter, aiLimiter };
