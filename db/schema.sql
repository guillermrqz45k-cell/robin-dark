-- Robin Dark — esquema Postgres (Railway).
-- La app crea estas mismas tablas sola al arrancar (src/db.js),
-- este archivo es la referencia / para crearlas a mano si hace falta.
-- Ejecutar con: psql "$DATABASE_URL" -f db/schema.sql

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

CREATE INDEX IF NOT EXISTS idx_listings_search ON listings USING gin (to_tsvector('spanish', title || ' ' || description));
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
