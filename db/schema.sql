-- Robin Dark — esquema Postgres (Railway).
-- La app crea estas mismas tablas sola al arrancar (src/db.js),
-- este archivo es la referencia / para crearlas a mano si hace falta.
-- Ejecutar con: psql "$DATABASE_URL" -f db/schema.sql
--
-- Robin Dark ya NO tiene tienda (decisión de AMO, 2026-11-20):
-- es solo una red social. Las tablas listings, orders,
-- conversations y messages se conservan tal cual (los datos
-- viejos no se borran), pero ya no se usan: no hay endpoints
-- que las lean o escriban. Las tablas nuevas son las sociales
-- (photos, posts, stories, follows, groups, dm_threads...).
--
-- Stock (histórico, sin uso): un anuncio NO era de una sola unidad.
-- Cada anuncio tenía `stock` (unidades que quedan, por defecto 1).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  alias TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- Nombre real: el nombre que se muestra en el perfil (el alias
  -- queda como @usuario). Obligatorio al registrarse desde
  -- 2026-11-20; las cuentas sin él muestran su alias.
  real_name TEXT NOT NULL DEFAULT '',
  -- Correo obligatorio al registrarse (único). El inicio de
  -- sesión es solo con correo y contraseña: no hay login por
  -- alias ni cuentas viejas que mantener (2026-11-20).
  email TEXT UNIQUE,
  -- true cuando el correo ya se verificó con el código de 6
  -- dígitos. El login no exige estar verificado.
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  -- Biografía del perfil (máximo 300 caracteres en la API).
  bio TEXT NOT NULL DEFAULT '',
  -- Foto de perfil y portada: IDs en photos (sin FK en la
  -- creación, igual que en las migraciones de src/db.js: la
  -- tabla photos se crea después y la referencia se limpia
  -- en la API al borrar la foto).
  avatar_photo_id INTEGER,
  cover_photo_id INTEGER,
  -- Cuándo se cambió el nombre real por última vez (milisegundos
  -- desde epoch). El nombre solo se puede cambiar 1 vez al mes.
  real_name_changed_at BIGINT,
  -- Cuándo se cambió el @usuario por última vez (milisegundos
  -- desde epoch). El @usuario también solo se puede cambiar
  -- 1 vez al mes.
  alias_changed_at BIGINT,
  -- Rango con letras: admin / moderator / veteran / new ('new' por
  -- defecto al registrarse). El alias de ADMIN_ALIAS siempre es
  -- admin, aunque el campo diga otra cosa.
  -- Rango con letras (columna vieja, SIN USO desde 2026-11-20:
  -- no hay rangos A/M/V/N ni moderadores; se conserva para no
  -- borrar datos de las bases ya creadas).
  rank TEXT NOT NULL DEFAULT 'new' CHECK (rank IN ('admin', 'moderator', 'veteran', 'new')),
  -- Verificación: el admin verifica usuarios desde el panel.
  -- El alias de ADMIN_ALIAS siempre se muestra verificado.
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  -- Notificaciones: instante (ms) hasta el que el usuario ya vio
  -- su campana (NULL = nunca). Las notificaciones se derivan de la
  -- actividad real, sin tabla propia.
  notif_seen_at BIGINT,
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

CREATE INDEX IF NOT EXISTS idx_listings_search ON listings USING gin (to_tsvector('spanish', title || ' ' || description));
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
-- NO hay índice único de un pedido por anuncio: un mismo anuncio
-- puede tener muchos pedidos, uno por cada unidad vendida. Contra
-- ventas simultáneas de más protege el decremento atómico de stock
-- en mark-sold (UPDATE ... WHERE stock > 0, con rowCount).
--
-- Tablas sociales (red social, sin tienda):
--
-- photos: fotos y vídeos cortos. kind 'post' cubre las fotos de
-- posts y el medio de historias/reels (público); 'document' es
-- privado (solo el dueño y el admin). storage 'db' guarda los
-- bytes en esta misma tabla (BYTEA); 'r2' guarda solo la
-- referencia en r2_key (Cloudflare R2). data es NULL con R2.
-- expires_at en milisegundos (BIGINT) en password_resets y en
-- stories: igual en Postgres y SQLite, sin problemas de formato.
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'cover', 'document', 'post')),
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  storage TEXT NOT NULL DEFAULT 'db' CHECK (storage IN ('db', 'r2')),
  r2_key TEXT,
  data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Códigos de verificación del correo al registrarse: misma forma
-- y mismas reglas que password_resets (solo hash, 15 minutos, un
-- solo uso), en tabla aparte para que un código de verificación
-- no sirva para cambiar la contraseña ni al revés.
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Actividad sospechosa: intentos fallidos de entrar, códigos
-- erróneos, límites alcanzados y acciones del dueño. Se guarda
-- el evento, la IP, el usuario (si se conoce) y un detalle con el
-- correo enmascarado. El dueño la consulta en
-- GET /api/users/me/security-events.
CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  ip TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  real_name TEXT NOT NULL,
  document_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  feeling TEXT NOT NULL DEFAULT '',
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_likes (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'like',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_shares (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stories (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('story', 'reel')),
  text TEXT NOT NULL DEFAULT '',
  style_key TEXT NOT NULL DEFAULT '',
  photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  expires_at BIGINT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_likes (
  id SERIAL PRIMARY KEY,
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (story_id, user_id)
);

CREATE TABLE IF NOT EXISTS follows (
  id SERIAL PRIMARY KEY,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  rater_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rater_id, rated_id)
);

CREATE TABLE IF NOT EXISTS moderation_flags (
  id SERIAL PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'story', 'comment')),
  target_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_threads (
  id SERIAL PRIMARY KEY,
  user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_a_id, user_b_id),
  CHECK (user_a_id < user_b_id)
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id);
CREATE INDEX IF NOT EXISTS idx_post_shares_post ON post_shares (post_id);

CREATE TABLE IF NOT EXISTS group_posts (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_posts_group ON group_posts (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_stories_author ON stories (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows (followed_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings (rated_id);
CREATE INDEX IF NOT EXISTS idx_flags_status ON moderation_flags (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_verification_codes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verif_status ON verification_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
CREATE INDEX IF NOT EXISTS idx_dm_threads_users ON dm_threads (user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages (thread_id, created_at ASC);
