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

function toSqlitePlaceholders(sql, params = []) {
  // $1, $2, ... -> ?, ?, ...
  // OJO: un mismo $N puede aparecer dos veces (por ejemplo
  // "WHERE buyer_id = $1 OR seller_id = $1"). Postgres reutiliza
  // el parámetro, pero node:sqlite NO: cada ? necesita su propio
  // valor, y si falta lo pone en NULL sin avisar (el vendedor no
  // veía sus conversaciones y la búsqueda por descripción no
  // encontraba nada en local). Por eso aquí se duplica el valor
  // por cada aparición del marcador.
  const outParams = [];
  const outSql = sql.replace(/\$\d+/g, (m) => {
    outParams.push(params[Number(m.slice(1)) - 1]);
    return '?';
  });
  return { sql: outSql, params: outParams };
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
        -- Stock: cuántas unidades quedan de este artículo. Un anuncio
        -- NO es de una sola unidad: se vende unidad a unidad hasta
        -- agotar el stock. Solo se acaba cuando stock llega a 0 o el
        -- vendedor lo marca como agotado. 'vendido' es un estado
        -- antiguo que se conserva por compatibilidad con filas viejas.
        stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
        status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'agotado', 'vendido')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        price_sats BIGINT NOT NULL CHECK (price_sats > 0),
        status TEXT NOT NULL DEFAULT 'retenido' CHECK (status IN ('retenido', 'liberado', 'pagado_btc', 'completado', 'cancelado')),
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
    // Migración stock (2026-11-16): un anuncio ya no es de una sola
    // unidad. Bases ya creadas (Railway) no tienen la columna stock
    // ni el estado 'agotado' en el CHECK. Se añaden sin borrar nada:
    // - stock: 1 por defecto (el comportamiento antiguo era 1 unidad).
    //   Los anuncios viejos ya vendidos quedan con stock 0.
    // - status: se amplía a ('disponible', 'agotado', 'vendido').
    // - Se ELIMINA el índice único parcial idx_orders_listing_active:
    //   era el que impedía más de un pedido por anuncio. Ahora un
    //   mismo anuncio puede tener muchos pedidos (uno por unidad
    //   vendida); contra ventas simultáneas de más protege el
    //   decremento atómico de stock en mark-sold (UPDATE ... WHERE
    //   stock > 0, con rowCount), no un índice único.
    await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 1;`);
    // ADD CONSTRAINT no admite IF NOT EXISTS en todas las versiones
    // de Postgres: si la restricción ya existe, se ignora el error.
    try {
      await pool.query(`ALTER TABLE listings ADD CONSTRAINT listings_stock_check CHECK (stock >= 0);`);
    } catch (e) {
      if (!/already exists/i.test(e.message || '')) throw e;
    }
    await pool.query(`UPDATE listings SET stock = 0 WHERE status = 'vendido' AND stock <> 0;`);
    await pool.query(`
      ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
      ALTER TABLE listings ADD CONSTRAINT listings_status_check
        CHECK (status IN ('disponible', 'agotado', 'vendido'));
    `);
    await pool.query(`DROP INDEX IF EXISTS idx_orders_listing_active;`);
    // Migración custodia: las bases ya creadas (Railway) tienen el CHECK
    // antiguo de orders.status. Se amplía sin borrar pedidos viejos
    // ('pagado_btc' se conserva como estado antiguo válido).
    await pool.query(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check
        CHECK (status IN ('retenido', 'liberado', 'pagado_btc', 'completado', 'cancelado'));
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
        stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
        status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'agotado', 'vendido')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL REFERENCES listings(id),
        buyer_id INTEGER NOT NULL REFERENCES users(id),
        seller_id INTEGER NOT NULL REFERENCES users(id),
        price_sats INTEGER NOT NULL CHECK (price_sats > 0),
        status TEXT NOT NULL DEFAULT 'retenido' CHECK (status IN ('retenido', 'liberado', 'pagado_btc', 'completado', 'cancelado')),
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
    // Migración stock en SQLite (bases locales ya creadas):
    // - Se elimina el índice único parcial de pedidos por anuncio.
    // - Si la tabla listings aún no tiene la columna stock, se añade
    //   (stock 1 por defecto; los anuncios viejos vendidos, stock 0).
    // - SQLite no puede cambiar el CHECK de status con ALTER TABLE,
    //   así que si la tabla vieja solo admite ('disponible',
    //   'vendido'), se reconstruye la tabla con el CHECK nuevo
    //   ('disponible', 'agotado', 'vendido') copiando los datos.
    sqlite.exec(`DROP INDEX IF EXISTS idx_orders_listing_active;`);
    const cols = sqlite.prepare(`PRAGMA table_info(listings)`).all();
    if (!cols.some((c) => c.name === 'stock')) {
      sqlite.exec(`ALTER TABLE listings ADD COLUMN stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0);`);
    }
    sqlite.exec(`UPDATE listings SET stock = 0 WHERE status = 'vendido' AND stock <> 0;`);
    const listingSql = sqlite.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'listings'`,
    ).get();
    if (listingSql && listingSql.sql && !listingSql.sql.includes("'agotado'")) {
      sqlite.exec('PRAGMA foreign_keys = OFF;');
      sqlite.exec('BEGIN;');
      try {
        sqlite.exec(`
          CREATE TABLE listings_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            price_sats INTEGER NOT NULL CHECK (price_sats > 0),
            stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
            status TEXT NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'agotado', 'vendido')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO listings_new (id, seller_id, title, description, price_sats, stock, status, created_at)
            SELECT id, seller_id, title, description, price_sats, stock, status, created_at FROM listings;
          DROP TABLE listings;
          ALTER TABLE listings_new RENAME TO listings;
        `);
        sqlite.exec('COMMIT;');
      } catch (e) {
        try { sqlite.exec('ROLLBACK;'); } catch (_) {}
        throw e;
      } finally {
        sqlite.exec('PRAGMA foreign_keys = ON;');
      }
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);`);
    }
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
  const { sql: sqliteSql, params: sqliteParams } = toSqlitePlaceholders(sql, params);
  const stmt = sqlite.prepare(sqliteSql);
  if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
    return { rows: stmt.all(...sqliteParams), rowCount: 0 };
  }
  // INSERT/UPDATE/DELETE: si trae RETURNING, usar .get() para obtener la fila.
  if (/RETURNING\b/i.test(sql)) {
    const row = stmt.get(...sqliteParams);
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  const info = stmt.run(...sqliteParams);
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
