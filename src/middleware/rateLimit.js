// src/middleware/rateLimit.js — límites de velocidad contra
// fuerza bruta y abuso.
//
// Antes no había ningún límite: un atacante podía probar contraseñas
// sin parar contra /api/auth/login y /api/admin/login, y crear
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

// Login de administrador: solo 5 intentos / 15 min por IP. El
// panel de admin es el objetivo más valioso; aquí el límite es
// el más estricto.
const adminLoginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: numEnv('RATE_LIMIT_ADMIN_MAX', 5),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de administrador. Espera 15 minutos.' },
});

module.exports = { apiLimiter, authLimiter, adminLoginLimiter };
