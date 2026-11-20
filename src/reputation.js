// src/reputation.js — reputación e insignias de Robin Dark.
//
// Todo se calcula SOLO con datos reales de la base de datos:
// antigüedad, publicaciones, seguidores y contenidos quitados
// por moderación. No hay estrellas, no hay valoraciones
// inventadas y ningún número se escribe a mano.
//
// Reputación (0–100):
//   antigüedad:  min(días, 90) / 90 * 20    (hasta 20 puntos, 90 días o más)
//   actividad:   min(posts, 10) / 10 * 40   (hasta 40 puntos, 10 posts o más)
//   comunidad:   min(seguidores, 10) / 10 * 20 (hasta 20 puntos, 10 seguidores o más)
//   fiabilidad:  20 puntos si ningún contenido suyo fue quitado por
//                moderación, y 10 menos por cada contenido quitado,
//                hasta 0 (mínimo 0).
//   reputación = antigüedad + actividad + comunidad + fiabilidad,
//   redondeada, entre 0 y 100.
// Ejemplos: un usuario nuevo (0 días, 0 posts, 0 seguidores,
// 0 quitados) = 0 + 0 + 0 + 20 = 20.
// Un usuario con 10 posts, 10 seguidores, 90 días y 0 quitados
// = 20 + 40 + 20 + 20 = 100.
// Un usuario con 5 posts, 5 seguidores, 45 días y 1 quitado
// = 10 + 20 + 10 + 10 = 50.
//
// Insignias del perfil (en este orden, la primera que se cumpla):
//   Admin:       el alias es el ADMIN_ALIAS de entorno (el dueño
//                del sitio): insignia especial dorada + ✓ Verificado.
//   Nuevo:       menos de 30 días en la plataforma.
//   Top:         10 o más posts Y 90 o más días de antigüedad.
//   Confiable:   3 o más posts Y 0 contenidos quitados por moderación.
//   Miembro:     todo lo demás.
// El servidor calcula la insignia y la devuelve; el cliente solo la
// muestra, nunca la calcula por su cuenta, así no hay dos versiones
// distintas de los umbrales.
//
// Antigüedad (marco del perfil, según la fecha de creación):
//   seniority(days): 'nuevo' si lleva menos de 30 días, 'antiguo'
//   si lleva 90 días o más (marco dorado especial en el perfil),
//   null entre 30 y 89 días. La insignia «Nuevo» y el marco
//   «Antiguo» salen de la misma fecha, no hay dos cuentas distintas.
//
// Verificación (columna users.verified): un usuario verificado
// muestra el ✓ Verificado azul junto a su alias. El alias de
// ADMIN_ALIAS siempre se muestra verificado, aunque el campo
// guardado sea false. Los demás solo pueden pedir la verificación
// con documento si tienen 500 o más amigos o seguidores, y la
// aprueba el dueño desde su propio perfil.
//
// NO hay rangos con letras (A/M/V/N) ni rol de moderador: se
// quitaron del port por decisión del dueño (2026-11-20). La columna
// users.rank queda en la base, sin usarse, para no borrar datos.
function isAdminAlias(alias) {
  return Boolean(process.env.ADMIN_ALIAS) && alias === process.env.ADMIN_ALIAS;
}

// Verificación efectiva: el campo guardado, o el alias de admin,
// que siempre se muestra verificado. El campo llega como boolean
// (Postgres) o como 0/1 (SQLite).
function effectiveVerified({ verified = false, alias = '' } = {}) {
  if (isAdminAlias(alias)) return true;
  return verified === true || verified === 1 || verified === '1';
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function daysSince(createdAt) {
  if (!createdAt) return 0;
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt).replace(' ', 'T'));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function computeReputation({ days = 0, posts = 0, followers = 0, rejected = 0 } = {}) {
  const agePoints = (Math.min(days, 90) / 90) * 20;
  const activityPoints = (Math.min(posts, 10) / 10) * 40;
  const communityPoints = (Math.min(followers, 10) / 10) * 20;
  const reliabilityPoints = Math.max(0, 20 - Math.max(0, rejected) * 10);
  return Math.round(clamp(agePoints + activityPoints + communityPoints + reliabilityPoints, 0, 100));
}

function badgeFor({ isAdmin = false, days = 0, posts = 0, rejected = 0 } = {}) {
  if (isAdmin) return { key: 'admin', label: 'Admin' };
  if (days < 30) return { key: 'nuevo', label: 'Nuevo' };
  if (posts >= 10 && days >= 90) return { key: 'top', label: 'Top' };
  if (posts >= 3 && rejected === 0) return { key: 'confiable', label: 'Confiable' };
  return { key: 'miembro', label: 'Miembro' };
}

// Antigüedad del perfil: 'nuevo' (< 30 días), 'antiguo'
// (>= 90 días, marco dorado especial) o null (entre medias).
function seniority(days = 0) {
  if (days >= 90) return 'antiguo';
  if (days < 30) return 'nuevo';
  return null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Tiempo medio de respuesta: mediana, en minutos, del tiempo entre
// un mensaje recibido y la respuesta de ese usuario en el mismo chat.
// Si no hay ningún par mensaje-recibido/respuesta, null ("Sin datos").
// La mediana (y no la media) evita que una sola respuesta tardía
// dispare el número. Se formatea aparte para mostrarlo.
function formatResponseTime(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'Sin datos';
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = parseFloat((minutes / 60).toFixed(1));
  return `${hours} h`;
}

module.exports = { clamp, daysSince, computeReputation, badgeFor, seniority, median, formatResponseTime, isAdminAlias, effectiveVerified };
