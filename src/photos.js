// src/photos.js — almacenamiento de fotos y vídeos de Robin Dark.
//
// Fotos: avatar, portada, documento de identidad y fotos de posts.
// Vídeo corto: historias y reels (MP4/WebM, máximo 20 MB, igual
// que en la vista previa).
// Reglas de fotos: solo JPG/PNG, máximo 5 MB por foto (las mismas
// que en la vista previa). La subida llega como base64 en JSON
// ({ mime, data }).
//
// Dos backends, elegidos por la variable PHOTO_STORAGE:
// - 'db' (por defecto): los bytes van a la tabla photos (BYTEA en
//   Postgres, BLOB en SQLite). Funciona sin crear ninguna cuenta ni
//   poner ninguna llave: es lo que corre en Railway tal cual.
// - 'r2': Cloudflare R2 (src/r2.js). Si PHOTO_STORAGE es 'r2' pero
//   faltan las variables R2_*, se avisa por consola y se usa 'db'
//   (las fotos nunca dejan de funcionar por falta de R2).
//
// El medio de historias y reels se guarda en photos con kind
// 'post' (público, como las fotos de posts): el kind solo marca
// qué es privado (document) y qué es público; el mime dice si
// es imagen o vídeo. Así no se toca el CHECK de kind de la tabla.
//
// Acceso:
// - avatar, cover y post son PÚBLICAS: cualquiera puede verlas en
//   GET /api/photos/:id (o en la URL pública de R2 si está puesta).
// - document es PRIVADA: solo la ve el dueño de la foto o el admin
//   (el documento de identidad nunca es público).
const db = require('./db');
const r2 = require('./r2');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB (vídeo corto)
const ALLOWED_MIME = ['image/jpeg', 'image/png'];
const VIDEO_MIME = ['video/mp4', 'video/webm'];
const PHOTO_KINDS = ['avatar', 'cover', 'document', 'post'];

let warnedR2 = false;

function backend() {
  if (String(process.env.PHOTO_STORAGE || '').toLowerCase() === 'r2') {
    if (r2.isConfigured()) return 'r2';
    if (!warnedR2) {
      warnedR2 = true;
      console.warn('[photos] PHOTO_STORAGE=r2 pero faltan variables R2_*: usando la base de datos para las fotos.');
    }
  }
  return 'db';
}

function isPrivateKind(kind) {
  return kind === 'document';
}

// Decodifica una subida { mime, data } (data en base64, con o sin
// prefijo "data:image/jpeg;base64,"). Devuelve { mime, buffer } o
// un { error } con el mensaje para el cliente.
// - Fotos (por defecto): solo JPG/PNG, máximo 5 MB.
// - Con allowVideo: además MP4/WebM, máximo 20 MB (historias y
//   reels). El vídeo corto se limita por tamaño: un clip de unos
//   segundos en 720p pesa 2-5 MB; 20 MB deja margen sin dejar
//   subir películas enteras. La duración la limita el cliente
//   (60 s) al elegir el vídeo.
function decodeUpload(input, { allowVideo = false } = {}) {
  if (!input || typeof input !== 'object') return { error: 'El archivo tiene que venir como { mime, data }.' };
  const mime = String(input.mime || '').toLowerCase().trim();
  const isVideo = VIDEO_MIME.includes(mime);
  if (isVideo && !allowVideo) {
    return { error: 'Aquí solo se pueden subir fotos JPG o PNG.' };
  }
  if (!ALLOWED_MIME.includes(mime) && !isVideo) {
    return { error: allowVideo ? 'El archivo tiene que ser JPG, PNG, MP4 o WebM.' : 'La foto tiene que ser JPG o PNG.' };
  }
  let data = String(input.data || '').trim();
  if (!data) return { error: 'El archivo viene vacío.' };
  const type = mime.split('/')[0];
  const subtype = mime.split('/')[1];
  const prefix = data.match(new RegExp(`^data:${type}/${subtype};base64,`, 'i'));
  if (prefix) data = data.slice(prefix[0].length);
  if (!/^[A-Za-z0-9+/=_-]+$/.test(data.replace(/\s/g, ''))) {
    return { error: 'El archivo no viene en base64 válido.' };
  }
  let buffer;
  try {
    buffer = Buffer.from(data, 'base64');
  } catch (e) {
    return { error: 'El archivo no viene en base64 válido.' };
  }
  if (!buffer.length) return { error: 'El archivo viene vacío.' };
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (buffer.length > max) {
    return { error: isVideo ? 'El vídeo no puede pesar más de 20 MB.' : 'La foto no puede pesar más de 5 MB.' };
  }
  return { mime, buffer };
}

function photoUrl(row) {
  if (row.storage === 'r2' && row.r2_key && !isPrivateKind(row.kind)) {
    const pub = r2.publicUrl(row.r2_key);
    if (pub) return pub;
  }
  return `/api/photos/${row.id}`;
}

function present(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    size_bytes: Number(row.size_bytes),
    url: photoUrl(row),
    created_at: row.created_at,
  };
}

// Guarda una foto o un vídeo corto nuevo. Devuelve la fila
// presentada (con su URL).
async function savePhoto({ ownerId, kind, mime, buffer }) {
  if (!PHOTO_KINDS.includes(kind)) throw new Error('Tipo de foto no válido.');
  const isVideo = VIDEO_MIME.includes(mime);
  if (!ALLOWED_MIME.includes(mime) && !isVideo) throw new Error('El archivo tiene que ser JPG, PNG, MP4 o WebM.');
  const max = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > max) {
    throw new Error(isVideo ? 'El vídeo no puede pesar más de 20 MB.' : 'La foto no puede pesar más de 5 MB.');
  }
  const store = backend();
  const created = await db.query(
    `INSERT INTO photos (owner_id, kind, mime, size_bytes, storage, r2_key, data)
     VALUES ($1, $2, $3, $4, $5, NULL, $6) RETURNING id, owner_id, kind, mime, size_bytes, storage, r2_key, created_at`,
    [ownerId, kind, mime, buffer.length, store, store === 'db' ? buffer : null],
  );
  const row = created.rows[0];
  if (store === 'r2') {
    const key = `robin-dark/${kind}/${row.id}`;
    try {
      await r2.put(key, buffer, mime);
      await db.query('UPDATE photos SET r2_key = $1 WHERE id = $2', [key, row.id]);
      row.r2_key = key;
    } catch (e) {
      // Si R2 falla, no dejar una fila huérfana: se borra y se avisa.
      await db.query('DELETE FROM photos WHERE id = $1', [row.id]);
      throw e;
    }
  }
  return present(row);
}

// Lee una foto con sus bytes (para servirla). Devuelve null si no existe.
async function getPhoto(id) {
  const row = await db.get('SELECT * FROM photos WHERE id = $1', [id]);
  if (!row) return null;
  if (row.storage === 'r2' && row.r2_key) {
    const remote = await r2.get(row.r2_key);
    return { ...present(row), owner_id: row.owner_id, buffer: remote.buffer };
  }
  const buffer = row.data;
  if (!buffer) return null;
  return { ...present(row), owner_id: row.owner_id, buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer) };
}

// Borra una foto (fila y bytes en R2 si aplica). Solo el dueño o el
// admin deberían llamar a esto (el control está en la ruta).
async function deletePhoto(id) {
  const row = await db.get('SELECT * FROM photos WHERE id = $1', [id]);
  if (!row) return false;
  await db.query('DELETE FROM photos WHERE id = $1', [id]);
  if (row.storage === 'r2' && row.r2_key) {
    try { await r2.remove(row.r2_key); } catch (e) { console.error('[photos] no se pudo borrar en R2:', e.message); }
  }
  return true;
}

// Resuelve las URLs de varias fotos a la vez (para no hacer una
// consulta por autor en cada lista). Devuelve un Map id → url.
// Solo se piden las columnas necesarias para la URL, nunca los bytes.
async function urlsByIds(ids) {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const map = new Map();
  if (!clean.length) return map;
  const placeholders = clean.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `SELECT id, kind, storage, r2_key FROM photos WHERE id IN (${placeholders})`,
    clean,
  );
  for (const row of rows) map.set(row.id, photoUrl(row));
  return map;
}

// Resuelve URL y mime de varias fotos/vídeos a la vez (para no
// hacer una consulta por medio en cada lista). Devuelve un Map
// id → { url, mime }. Solo se piden las columnas necesarias para
// la URL y el tipo, nunca los bytes.
async function infoByIds(ids) {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const map = new Map();
  if (!clean.length) return map;
  const placeholders = clean.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `SELECT id, kind, mime, storage, r2_key FROM photos WHERE id IN (${placeholders})`,
    clean,
  );
  for (const row of rows) map.set(row.id, { url: photoUrl(row), mime: row.mime });
  return map;
}

module.exports = {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  ALLOWED_MIME,
  VIDEO_MIME,
  PHOTO_KINDS,
  backend,
  isPrivateKind,
  decodeUpload,
  photoUrl,
  urlsByIds,
  infoByIds,
  present,
  savePhoto,
  getPhoto,
  deletePhoto,
};
