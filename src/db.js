// src/db.js — capa de base de datos de Robin Dark.
//
// - En Railway: usa Postgres con DATABASE_URL (paquete `pg`).
// - En local (sin DATABASE_URL): usa SQLite con el módulo built-in
//   `node:sqlite` y el archivo data/robin-dark.db.
// - No se guarda ubicación, IP, correo ni teléfono en ninguna tabla.
//   Solo alias + contraseña cifrada, anuncios, pedidos y mensajes.
const fs = require('fs');
const path = require('path');

const usePostgres = Boolean(process.env.DATABASE_URL);

let pool = null; // pg
let sqlite = null; // node:sqlite DatabaseSync

function toSqlitePlaceholders(sql) {
  // $1, $2, ... -> ?, ?, ...
  return sql.replace(/\$\d+/g, '?');
}

function formatBtc(sats) {
  return (Number(sats) / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

async function init() {
  if (usePostgres) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        alias TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS listings (
        id SERIAL PRIMARY KEY,
        seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_sats BIGINT NOT NULL CHECK (price_sats > 0),
        status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'vendido')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        price_sats BIGINT NOT NULL CHECK (price_sats > 0),
        status TEXT NOT NULL DEFAULT 'pagado_btc' CHECK (status IN ('pagado_btc', 'completado', 'cancelado')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (listing_id, buyer_id, seller_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
    `);
    console.log('[db] Postgres conectado (DATABASE_URL)');
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const dataDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    sqlite = new DatabaseSync(path.join(dataDir, 'robin-dark.db'));
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alias TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_sats INTEGER NOT NULL CHECK (price_sats > 0),
        status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'vendido')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        price_sats INTEGER NOT NULL CHECK (price_sats > 0),
        status TEXT NOT NULL DEFAULT 'pagado_btc' CHECK (status IN ('pagado_btc', 'completado', 'cancelado')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (listing_id, buyer_id, seller_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
    `);
    console.log('[db] SQLite local (data/robin-dark.db)');
  }
}

// query() -> { rows } en ambos motores.
// En SQLite, $1/$2 se convierten a ? y se usa RETURNING para inserts.
async function query(sql, params = []) {
  if (usePostgres) {
    const res = await pool.query(sql, params);
    return { rows: res.rows, rowCount: res.rowCount };
  }
  const stmt = sqlite.prepare(toSqlitePlaceholders(sql));
  if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
    return { rows: stmt.all(...params), rowCount: 0 };
  }
  // INSERT/UPDATE/DELETE: si trae RETURNING, usar .get() para obtener la fila.
  if (/RETURNING\b/i.test(sql)) {
    const row = stmt.get(...params);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  const info = stmt.run(...params);
  return { rows: [], rowCount: info.changes, lastID: Number(info.lastInsertRowid) };
}

async function get(sql, params = []) {
  const res = await query(sql, params);
  return res.rows[0] || null;
}

async function run(sql, params = []) {
  const res = await query(sql, params);
  return { lastID: res.lastID ?? res.rows[0]?.id ?? null, changes: res.rowCount };
}

async function close() {
  if (pool) await pool.end();
  if (sqlite) sqlite.close();
}

module.exports = { init, query, get, run, close, usePostgres, formatBtc };
