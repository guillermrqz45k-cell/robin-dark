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
        -- Rango con letras: admin / moderator / veteran / new.
        -- 'new' es el rango por defecto al registrarse. El alias de
        -- ADMIN_ALIAS siempre es admin, aunque el campo diga otra
        -- cosa (eso se resuelve en src/reputation.js, no aquí).
        rank TEXT NOT NULL DEFAULT 'new' CHECK (rank IN ('admin', 'moderator', 'veteran', 'new')),
        -- Verificación: el admin verifica usuarios desde el panel.
        -- El alias de ADMIN_ALIAS siempre se muestra verificado.
        verified BOOLEAN NOT NULL DEFAULT FALSE,
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
    // Migración rangos + verificación (2026-11-17): las bases ya
    // creadas (Railway) no tienen rank ni verified. Se añaden sin
    // borrar nada: todos los usuarios existentes quedan como 'new'
    // y sin verificar, que es lo que eran antes.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank TEXT NOT NULL DEFAULT 'new';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;`);
    try {
      await pool.query(`ALTER TABLE users ADD CONSTRAINT users_rank_check CHECK (rank IN ('admin', 'moderator', 'veteran', 'new'));`);
    } catch (e) {
      if (!/already exists/i.test(e.message || '')) throw e;
    }
    await pool.query(`UPDATE users SET rank = 'new' WHERE rank NOT IN ('admin', 'moderator', 'veteran', 'new');`);
    // El dueño se marca por rango, no solo por alias (2026-11-20):
    // si cambia su @usuario, sigue siendo Admin porque el rango
    // vive en su fila (por id). Se marca al arrancar, sin borrar
    // nada; es idempotente.
    if (process.env.ADMIN_ALIAS) {
      await pool.query(`UPDATE users SET rank = 'admin' WHERE alias = $1`, [process.env.ADMIN_ALIAS]);
    }
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
    // Migración social + IA (2026-11-20): red social, registro por
    // correo, verificación con documento, fotos, moderación e IA.
    // Todo aditivo: no se borra ni se cambia nada de lo que ya hay.
    // - users.email: nullable y único en la base (NULL no choca
    //   con NULL en Postgres); la API lo exige al registrarse
    //   desde 2026-11-20 (nombre real + correo + contraseña, sin
    //   cuentas viejas que mantener).
    // - expires_at en milisegundos (BIGINT): igual en Postgres y
    //   SQLite, sin problemas de formato de fecha entre motores.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_photo_id INTEGER;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_photo_id INTEGER;`);
    // Cambio de nombre 1 vez al mes (2026-11-20): cuándo se cambió
    // el nombre real por última vez, en milisegundos (BIGINT, igual
    // en Postgres y SQLite). NULL = nunca se ha cambiado.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name_changed_at BIGINT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS alias_changed_at BIGINT;`);
    // Revocación de sesiones y bloqueo por cuenta (2026-11-20):
    // - token_version: cambia cada vez que se cambia la contraseña;
    //   los tokens con la versión vieja dejan de valer.
    // - failed_logins / locked_until: tras 5 intentos fallidos con
    //   la misma cuenta, la cuenta queda bloqueada 15 minutos
    //   (frena la fuerza bruta aunque venga de muchas IPs).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until BIGINT;`);
    // Inhabilitación permanente por el dueño (2026-11-20): la
    // cuenta inhabilitada no puede entrar y desaparece de la vista
    // de los demás (perfil, búsquedas, feed, listas).
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;`);
    try {
      await pool.query(`ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);`);
    } catch (e) {
      if (!/already exists/i.test(e.message || '')) throw e;
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('avatar', 'cover', 'document', 'post')),
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        -- Dónde viven los bytes: 'db' (BYTEA en esta misma tabla,
        -- funciona sin ninguna cuenta ni llave) o 'r2' (Cloudflare
        -- R2, solo la referencia en r2_key). data es NULL cuando el
        -- backend es R2.
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
        listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
        photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
        deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS post_likes (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (post_id, user_id)
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
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id);
      CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_stories_author ON stories (author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows (followed_id);
      CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings (rated_id);
      CREATE INDEX IF NOT EXISTS idx_flags_status ON moderation_flags (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_verif_status ON verification_requests (status, created_at DESC);
    `);
    // Migración red social sin tienda + grupos + mensajes directos
    // (2026-11-20, decisión de AMO): Robin Dark ya no vende.
    // - stories.photo_id: foto o vídeo corto del estado/reel. El
    //   medio se guarda en photos con kind 'post' (público, como
    //   las fotos de posts): no se toca el CHECK de kind.
    // - groups / group_members: grupos con miembros de verdad.
    // - dm_threads / dm_messages: mensajes directos entre
    //   usuarios. Los chats viejos por anuncio quedan en
    //   conversations/messages, intactos, sin usarse.
    // Todo aditivo: no se borra ni se cambia nada de lo que ya hay.
    await pool.query(`ALTER TABLE stories ADD COLUMN IF NOT EXISTS photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL;`);
    await pool.query(`
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
      CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
      CREATE INDEX IF NOT EXISTS idx_dm_threads_users ON dm_threads (user_a_id, user_b_id);
      CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages (thread_id, created_at ASC);
    `);
    // Migración reacciones + compartir + notificaciones + sentimiento
    // (2026-11-20, para que el port sea fiel a la vista previa):
    // - posts.feeling: sentimiento/actividad elegido en el
    //   compositor (máx. 60 caracteres), se muestra bajo el autor.
    // - post_likes.kind: la reacción es like (👍), love (❤️) o wow
    //   (😮); una por usuario y post (el UNIQUE ya lo garantiza).
    //   Los likes viejos quedan como 'like'.
    // - post_shares: cada Compartir es una fila (sin deduplicar:
    //   compartir dos veces cuenta dos veces, como en la vista
    //   previa); el contador es el número de filas del post.
    // - users.notif_seen_at: instante (ms) hasta el que el usuario
    //   ya vio sus notificaciones; la campana deriva de la
    //   actividad real (reacciones y comentarios en mis posts y
    //   nuevos seguidores), sin tabla nueva.
    // Todo aditivo: no se borra ni se cambia nada de lo que ya hay.
    await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS feeling TEXT NOT NULL DEFAULT '';`);
    await pool.query(`ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'like';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_seen_at BIGINT;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS post_shares (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_post_shares_post ON post_shares (post_id);
    `);
    // Migración muro de grupo (2026-11-20): compartir en un grupo
    // publica en su muro (texto + foto opcional, solo miembros).
    await pool.query(`
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
    `);
    // Migración nombre real + verificación del correo (2026-11-20,
    // decisión de AMO): el registro es solo con nombre real +
    // correo + contraseña, y el correo se verifica con un código
    // de 6 dígitos. No hay cuentas viejas que mantener: el inicio
    // de sesión es solo con correo y contraseña, sin login por
    // alias. Todo aditivo:
    // - users.real_name: nombre real que se muestra en el perfil
    //   (el alias queda como @usuario). Las cuentas que no lo
    //   tienen muestran su alias.
    // - users.email_verified: true cuando el correo ya se verificó
    //   con el código (el login no exige estar verificado).
    // - email_verification_codes: misma forma y mismas reglas que
    //   password_resets (solo hash SHA-256, 15 minutos, un solo
    //   uso), pero separada: un código de verificación no sirve
    //   para cambiar la contraseña ni al revés.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name TEXT NOT NULL DEFAULT '';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_verification_codes (user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        event TEXT NOT NULL,
        ip TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        detail TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at DESC);
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
        rank TEXT NOT NULL DEFAULT 'new' CHECK (rank IN ('admin', 'moderator', 'veteran', 'new')),
        verified INTEGER NOT NULL DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        ip TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        detail TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders (buyer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders (seller_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at ASC);
    `);
    // Migración rangos + verificación en SQLite (bases locales ya
    // creadas): si la tabla users aún no tiene rank o verified, se
    // añaden (todos quedan como 'new' y sin verificar).
    const userCols = sqlite.prepare(`PRAGMA table_info(users)`).all();
    if (!userCols.some((c) => c.name === 'rank')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN rank TEXT NOT NULL DEFAULT 'new' CHECK (rank IN ('admin', 'moderator', 'veteran', 'new'));`);
    }
    if (!userCols.some((c) => c.name === 'verified')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;`);
    }
    // Revocación de sesiones y bloqueo por cuenta (2026-11-20):
    // token_version, failed_logins y locked_until (ver Postgres).
    if (!userCols.some((c) => c.name === 'token_version')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!userCols.some((c) => c.name === 'failed_logins')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!userCols.some((c) => c.name === 'locked_until')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN locked_until INTEGER;`);
    }
    // Inhabilitación permanente por el dueño (2026-11-20).
    if (!userCols.some((c) => c.name === 'disabled')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;`);
    }
    sqlite.exec(`UPDATE users SET rank = 'new' WHERE rank NOT IN ('admin', 'moderator', 'veteran', 'new');`);
    // El dueño se marca por rango, no solo por alias (2026-11-20):
    // si cambia su @usuario, sigue siendo Admin porque el rango
    // vive en su fila (por id). Se marca al arrancar, sin borrar
    // nada; es idempotente.
    if (process.env.ADMIN_ALIAS) {
      sqlite.prepare(`UPDATE users SET rank = 'admin' WHERE alias = ?`).run(process.env.ADMIN_ALIAS);
    }
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
    // Migración social + IA en SQLite (2026-11-20): mismas tablas
    // que en Postgres, con tipos de SQLite (BLOB para la foto,
    // INTEGER 0/1 para booleanos). Todo aditivo.
    const userCols2 = sqlite.prepare(`PRAGMA table_info(users)`).all();
    if (!userCols2.some((c) => c.name === 'email')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN email TEXT;`);
    }
    if (!userCols2.some((c) => c.name === 'bio')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';`);
    }
    if (!userCols2.some((c) => c.name === 'avatar_photo_id')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN avatar_photo_id INTEGER;`);
    }
    if (!userCols2.some((c) => c.name === 'cover_photo_id')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN cover_photo_id INTEGER;`);
    }
    if (!userCols2.some((c) => c.name === 'real_name_changed_at')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN real_name_changed_at INTEGER;`);
    }
    if (!userCols2.some((c) => c.name === 'alias_changed_at')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN alias_changed_at INTEGER;`);
    }
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (email);`);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('avatar', 'cover', 'document', 'post')),
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        storage TEXT NOT NULL DEFAULT 'db' CHECK (storage IN ('db', 'r2')),
        r2_key TEXT,
        data BLOB,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS verification_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        real_name TEXT NOT NULL,
        document_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        review_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at TEXT,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
        photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS post_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (post_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS post_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('story', 'reel')),
        text TEXT NOT NULL DEFAULT '',
        style_key TEXT NOT NULL DEFAULT '',
        expires_at INTEGER,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS story_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (story_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS follows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (follower_id, followed_id),
        CHECK (follower_id <> followed_id)
      );
      CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rater_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rated_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (rater_id, rated_id)
      );
      CREATE TABLE IF NOT EXISTS moderation_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK (target_type IN ('post', 'story', 'comment')),
        target_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        review_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at TEXT,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts (author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes (post_id);
      CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments (post_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_stories_author ON stories (author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows (followed_id);
      CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings (rated_id);
      CREATE INDEX IF NOT EXISTS idx_flags_status ON moderation_flags (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_verif_status ON verification_requests (status, created_at DESC);
    `);
    // Migración red social sin tienda + grupos + mensajes directos
    // en SQLite (2026-11-20): mismas tablas que en Postgres.
    const storyCols = sqlite.prepare(`PRAGMA table_info(stories)`).all();
    if (!storyCols.some((c) => c.name === 'photo_id')) {
      sqlite.exec(`ALTER TABLE stories ADD COLUMN photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL;`);
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS dm_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (user_a_id, user_b_id),
        CHECK (user_a_id < user_b_id)
      );
      CREATE TABLE IF NOT EXISTS dm_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members (group_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
      CREATE INDEX IF NOT EXISTS idx_dm_threads_users ON dm_threads (user_a_id, user_b_id);
      CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages (thread_id, created_at ASC);
    `);
    // Migración reacciones + compartir + notificaciones + sentimiento
    // en SQLite (2026-11-20): las mismas que en Postgres.
    const postCols = sqlite.prepare(`PRAGMA table_info(posts)`).all();
    if (!postCols.some((c) => c.name === 'feeling')) {
      sqlite.exec(`ALTER TABLE posts ADD COLUMN feeling TEXT NOT NULL DEFAULT '';`);
    }
    const likeCols = sqlite.prepare(`PRAGMA table_info(post_likes)`).all();
    if (!likeCols.some((c) => c.name === 'kind')) {
      sqlite.exec(`ALTER TABLE post_likes ADD COLUMN kind TEXT NOT NULL DEFAULT 'like';`);
    }
    const userCols3 = sqlite.prepare(`PRAGMA table_info(users)`).all();
    if (!userCols3.some((c) => c.name === 'notif_seen_at')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN notif_seen_at INTEGER;`);
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS post_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_post_shares_post ON post_shares (post_id);
    `);
    // Migración muro de grupo en SQLite (2026-11-20).
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS group_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_group_posts_group ON group_posts (group_id, created_at DESC);
    `);
    // Migración nombre real + verificación del correo en SQLite
    // (2026-11-20): las mismas que en Postgres.
    const userCols4 = sqlite.prepare(`PRAGMA table_info(users)`).all();
    if (!userCols4.some((c) => c.name === 'real_name')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN real_name TEXT NOT NULL DEFAULT '';`);
    }
    if (!userCols4.some((c) => c.name === 'email_verified')) {
      sqlite.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;`);
    }
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_verification_codes (user_id, created_at DESC);
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
