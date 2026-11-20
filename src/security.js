// src/security.js — registro de actividad sospechosa de Robin Dark.
//
// Cada intento fallido de entrar, cada código de verificación
// erróneo, cada límite de peticiones alcanzado y cada acción del
// dueño queda guardado en la tabla security_events y además sale
// en los logs del servidor con el prefijo [security], para que el
// dueño lo vea en Railway. El dueño puede consultar los últimos
// eventos en GET /api/users/me/security-events.
//
// La tabla se crea sola al arrancar (src/db.js + db/schema.sql),
// en Postgres y en SQLite, sin borrar nada. El registro nunca
// rompe la petición: si la base falla, solo se avisa por consola.
const db = require('./db');

// El correo se guarda enmascarado (primeros 2 caracteres + ***):
// basta para reconocer a qué cuenta apuntaba el intento, sin
// dejar el correo entero en el registro de seguridad.
function maskEmail(email) {
  const e = String(email || '');
  const at = e.indexOf('@');
  if (at <= 0) return '***';
  const local = e.slice(0, at);
  const shown = local.length <= 2 ? `${local[0] || ''}*` : `${local.slice(0, 2)}***`;
  return `${shown}@${e.slice(at + 1)}`;
}

async function logEvent({ event, ip, userId, detail }) {
  const row = {
    event: String(event || 'unknown'),
    ip: ip ? String(ip) : null,
    userId: userId || null,
    detail: detail ? String(detail) : null,
  };
  console.warn(`[security] ${row.event} ip=${row.ip || '-'} user=${row.userId || '-'} ${row.detail || ''}`);
  try {
    await db.query(
      'INSERT INTO security_events (event, ip, user_id, detail, created_at) VALUES ($1, $2, $3, $4, $5)',
      [row.event, row.ip, row.userId, row.detail, Date.now()],
    );
  } catch (e) {
    console.warn('[security] no se pudo guardar el evento', row.event, e.message);
  }
}

async function listEvents(limit = 100) {
  const n = Number(limit) > 0 ? Math.min(Number(limit), 500) : 100;
  const { rows } = await db.query(
    'SELECT id, event, ip, user_id, detail, created_at FROM security_events ORDER BY created_at DESC, id DESC LIMIT $1',
    [n],
  );
  return rows;
}

// Cuenta los eventos de un tipo para un usuario en los últimos
// `windowMs` milisegundos: sirve para frenar por cuenta (no solo
// por IP) los intentos de adivinar el código de verificación.
async function countEvents(event, userId, windowMs) {
  const { rows } = await db.query(
    'SELECT COUNT(*) AS n FROM security_events WHERE event = $1 AND user_id = $2 AND created_at > $3',
    [event, userId, Date.now() - windowMs],
  );
  return rows.length ? Number(rows[0].n) || 0 : 0;
}

module.exports = { logEvent, listEvents, countEvents, maskEmail };
