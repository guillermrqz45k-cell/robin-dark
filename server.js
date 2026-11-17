// server.js — entrada de Robin Dark.
// Mercado abierto en JavaScript (Node.js + Express).
// Base de datos: Postgres en Railway (DATABASE_URL) o SQLite en local.
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const db = require('./src/db');
const { apiLimiter } = require('./src/middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway pone la app detrás de su proxy: sin esto, req.ip sería
// siempre la IP del proxy y el límite de velocidad bloquearía a
// todos los usuarios a la vez. Con 'trust proxy: 1' req.ip es la
// IP real del visitante (la que Railway pone en X-Forwarded-For).
app.set('trust proxy', 1);

// Cabeceras de seguridad (antes no había ninguna):
// - Content-Security-Policy: solo se cargan scripts, estilos e
//   imágenes del propio sitio. Sin esto, un XSS podría cargar
//   código de fuera y robar el token JWT guardado en localStorage.
// - X-Frame-Options DENY: la tienda no se puede meter en un iframe
//   de otra web (clickjacking).
// - X-Content-Type-Options nosniff, Referrer-Policy y
//   Strict-Transport-Security (HTTPS en Railway) incluidos.
// No hay recursos externos en la página (todo es local), así que
// la CSP estricta no rompe nada.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // no hay recursos cross-origin
    frameguard: { action: 'deny' }, // ni siquiera el mismo origen en iframe
  }),
);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Límite general de la API (ver src/middleware/rateLimit.js).
// /api/health queda fuera: Railway la comprueba constantemente.
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'robin-dark', db: db.usePostgres ? 'postgres' : 'sqlite' });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/listings', require('./src/routes/listings'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/stats', require('./src/routes/stats'));
app.use('/api/admin', require('./src/routes/admin'));

// Cualquier ruta no API sirve la app.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  // JSON mal formado o demasiado grande: antes caía en el 500
  // genérico. Un cuerpo que no es JSON válido es un error del
  // cliente (400), no del servidor; y un cuerpo mayor de 1 MB
  // es 413, no 500.
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo debe ser JSON válido.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo es demasiado grande.' });
  }
  return next(err);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

async function start() {
  await db.init();
  app.listen(PORT, () => {
    console.log(`[robin-dark] Escuchando en http://localhost:${PORT}`);
  });
}

if (require.main === module) start();

module.exports = app;
