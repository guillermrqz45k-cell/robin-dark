// server.js — entrada de Robin Dark.
// Mercado abierto en JavaScript (Node.js + Express).
// Base de datos: Postgres en Railway (DATABASE_URL) o SQLite en local.
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
