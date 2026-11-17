-- Robin Dark — esquema Postgres (Railway).
-- La app crea estas mismas tablas sola al arrancar (src/db.js),
-- este archivo es la referencia / para crearlas a mano si hace falta.
-- Ejecutar con: psql "$DATABASE_URL" -f db/schema.sql
--
-- Stock: un anuncio NO es de una sola unidad. Cada anuncio tiene
-- `stock` (unidades que quedan, por defecto 1). Cada venta descuenta
-- 1 unidad; el anuncio sigue disponible mientras stock > 0 y solo
-- se agota cuando stock llega a 0 o el vendedor lo marca como
-- agotado. 'vendido' es un estado antiguo, solo por compatibilidad.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  card_approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_sats BIGINT NOT NULL CHECK (price_sats > 0),
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

-- Monedero recargable con tarjeta (saldo en USD, en centavos).
-- Solo usuarios con card_approved (aprobados por el admin) pueden
-- pedir recargas. El cobro lo hace Stripe Checkout; aquí nunca se
-- guardan números de tarjeta ni CVV. Estados de recarga: pendiente,
-- completado (saldo acreditado, una sola vez) y rechazado.
CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance_usd_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_usd_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_usd_cents BIGINT NOT NULL CHECK (amount_usd_cents >= 500 AND amount_usd_cents <= 50000),
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'completado', 'rechazado')),
  method TEXT NOT NULL DEFAULT 'tarjeta',
  stripe_session_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topups_user ON topups (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topups_status ON topups (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listings_search ON listings USING gin (to_tsvector('spanish', title || ' ' || description));
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
-- NO hay índice único de un pedido por anuncio: un mismo anuncio
-- puede tener muchos pedidos, uno por cada unidad vendida. Contra
-- ventas simultáneas de más protege el decremento atómico de stock
-- en mark-sold (UPDATE ... WHERE stock > 0, con rowCount).
