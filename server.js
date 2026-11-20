// server.js — entrada de Robin Dark.
// Red social en JavaScript (Node.js + Express). Robin Dark ya no
// tiene tienda (decisión de AMO, 2026-11-20): no hay anuncios,
// pedidos ni custodia. Las tablas listings/orders/conversations/
// messages quedan en la base de datos, intactas, sin usarse.
// Base de datos: Postgres en Railway (DATABASE_URL) o SQLite en local.
require('dotenv').config();
const express = require('express');
const fs = require('fs');
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

app.use(express.json({ limit: '30mb' })); // 30 MB: las fotos (avatar,
// portada, documento, posts) llegan en base64 dentro del JSON y una
// foto de 5 MB son ~6,7 MB en base64; un vídeo corto de 20 MB son
// ~26,7 MB. El 413 sigue protegiendo contra cuerpos mayores.

// Versionado de app.js y styles.css: cada despliegue cambia la
// versión (?v=) y el teléfono ya no puede seguir usando un JS viejo
// guardado en caché. Antes el HTML se servía tal cual y el JS con
// "max-age=0" sin versión: una pestaña que llevaba días abierta o
// un navegador móvil con caché agresiva seguía corriendo el código
// de antes del arreglo. El HTML nunca se guarda (no-store), así que
// cada visita trae la versión nueva del JS y del CSS.
const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSET_VERSION = (() => {
  try {
    const mtimes = ['app.js', 'styles.css', 'index.html'].map((f) => fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs);
    return String(Math.floor(Math.max(...mtimes) / 1000));
  } catch (e) { return '1'; }
})();
function sendVersionedIndex(req, res) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
    .replace('src="app.js"', `src="app.js?v=${ASSET_VERSION}"`)
    .replace('href="styles.css"', `href="styles.css?v=${ASSET_VERSION}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
}
app.get('/', sendVersionedIndex);
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  },
}));

// Límite general de la API (ver src/middleware/rateLimit.js).
// /api/health queda fuera: Railway la comprueba constantemente.
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'robin-dark', db: db.usePostgres ? 'postgres' : 'sqlite' });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
// Sin tienda: /api/listings y /api/orders ya no se montan. Las
// tablas quedan en la base de datos, intactas, sin usarse.
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/stats', require('./src/routes/stats'));
// Sin panel de administrador: no se monta /api/admin. El dueño
// (alias de ADMIN_ALIAS) aprueba las verificaciones desde su
// propio perfil (GET/POST /api/users/me/verification-requests).
app.use('/api/social', require('./src/routes/social'));
app.use('/api/social/groups', require('./src/routes/groups'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/photos', require('./src/routes/photos'));

// Cualquier ruta no API sirve la app.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada.' });
  sendVersionedIndex(req, res);
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
  // Sin RESEND_API_KEY no se puede enviar ningún código de
  // verificación: como el login queda bloqueado hasta confirmar
  // el correo, en producción nadie podría entrar. Se avisa bien
  // fuerte en el arranque para que se vea en los logs de Railway.
  // En local y en los tests no pasa nada: ahí no hace falta.
  if (!process.env.RESEND_API_KEY) {
    console.warn('[robin-dark] AVISO: sin RESEND_API_KEY no se envían los códigos de verificación ni de recuperación. En producción la llave es obligatoria: sin ella nadie puede confirmar su correo y el login queda bloqueado para todos.');
  }
  if (process.env.RESEND_API_URL) {
    console.warn('[robin-dark] AVISO: RESEND_API_URL está puesto (solo existe para las pruebas locales). En producción NO debe estar: los correos deben salir por api.resend.com.');
  }
  app.listen(PORT, () => {
    console.log(`[robin-dark] Escuchando en http://localhost:${PORT}`);
  });
}

if (require.main === module) start();

module.exports = app;
