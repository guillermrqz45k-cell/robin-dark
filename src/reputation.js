// src/reputation.js — reputación e insignias de Robin Dark.
//
// Todo se calcula SOLO con datos reales de la base de datos: tratos
// cerrados, tratos cancelados y antigüedad. No hay estrellas, no hay
// valoraciones inventadas y ningún número se escribe a mano.
//
// Reputación (0–100):
//   antigüedad:  min(días, 90) / 90 * 20   (hasta 20 puntos, 90 días o más)
//   tratos:      min(cerrados, 10) / 10 * 60 (hasta 60 puntos, 10 tratos o más)
//   fiabilidad:  20 puntos si no hay tratos cancelados, y 10 menos por
//                cada trato cancelado, hasta 0 (mínimo 0).
//   reputación = antigüedad + tratos + fiabilidad, redondeada, entre 0 y 100.
// Ejemplos: un usuario nuevo (0 días, 0 tratos, 0 cancelados) = 0 + 0 + 20 = 20.
// Un usuario con 10 tratos, 90 días y 0 cancelados = 20 + 60 + 20 = 100.
// Un usuario con 5 tratos, 45 días y 1 cancelado = 10 + 30 + 10 = 50.
//
// Insignias (en este orden, la primera que se cumpla):
//   ✓ Verificado: el alias es el ADMIN_ALIAS de entorno (el dueño del sitio).
//   Top:         10 o más tratos cerrados Y 90 o más días de antigüedad.
//   Confiable:   3 o más tratos cerrados Y 0 tratos cancelados.
//   Nuevo:       todo lo demás (menos de 30 días o 0 tratos, entre otros).
// El servidor calcula la insignia y la devuelve; el cliente solo la
// muestra, nunca la calcula por su cuenta, así no hay dos versiones
// distintas de los umbrales.
//
// Rangos con letras (jerarquía, columna users.rank; el admin los
// cambia desde el panel con POST /api/admin/users/:id/rank):
//   admin     → A · el dueño muestra TODAS las letras: A, M, V y N
//   moderator → M · muestra M, V y N
//   veteran   → V · muestra V y N
//   new       → N · muestra solo N (es el rango por defecto al registrarse)
// El alias de ADMIN_ALIAS siempre es admin, aunque el campo guardado
// diga otra cosa: el admin es único, no se puede asignar a nadie más
// ni quitarse al propio admin.
//
// Verificación (columna users.verified; el admin la cambia con
// POST /api/admin/users/:id/verify): un usuario verificado muestra
// la insignia ✓ Verificado junto a sus letras de rango. El alias de
// ADMIN_ALIAS siempre se muestra verificado, aunque el campo
// guardado sea false.
const RANKS = ['admin', 'moderator', 'veteran', 'new'];
const RANK_LETTERS = { admin: 'A', moderator: 'M', veteran: 'V', new: 'N' };
const RANK_LABELS = { admin: 'Admin', moderator: 'Moderador', veteran: 'Veterano', new: 'Nuevo usuario' };
const RANK_BADGES = {
  admin: ['A', 'M', 'V', 'N'],
  moderator: ['M', 'V', 'N'],
  veteran: ['V', 'N'],
  new: ['N'],
};
// Rangos que el admin puede asignar desde el panel: nunca 'admin'.
// El rango Admin es único del dueño (ADMIN_ALIAS).
const ASSIGNABLE_RANKS = ['moderator', 'veteran', 'new'];

function isAdminAlias(alias) {
  return Boolean(process.env.ADMIN_ALIAS) && alias === process.env.ADMIN_ALIAS;
}

// Rango efectivo: el del campo, salvo el alias de admin, que
// siempre es admin. Un valor guardado no válido cae a 'new'.
function effectiveRank({ rank = 'new', alias = '' } = {}) {
  if (isAdminAlias(alias)) return 'admin';
  return RANKS.includes(rank) ? rank : 'new';
}

function rankBadgesFor(rank) {
  const r = RANKS.includes(rank) ? rank : 'new';
  return [...RANK_BADGES[r]];
}

// Todo lo que el cliente necesita para mostrar el rango: la letra,
// la etiqueta y la lista de letras que le corresponden.
function rankInfo({ rank = 'new', alias = '' } = {}) {
  const effective = effectiveRank({ rank, alias });
  return {
    rank: effective,
    rank_letter: RANK_LETTERS[effective],
    rank_label: RANK_LABELS[effective],
    rank_badges: rankBadgesFor(effective),
  };
}

// Verificación efectiva: el campo guardado, o el alias de admin,
// que siempre se muestra verificado. El campo llega como boolean
// (Postgres) o como 0/1 (SQLite).
function effectiveVerified({ verified = false, alias = '' } = {}) {
  if (isAdminAlias(alias)) return true;
  return verified === true || verified === 1 || verified === '1';
}
const CLOSED_STATUSES = ['liberado', 'completado'];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function daysSince(createdAt) {
  if (!createdAt) return 0;
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt).replace(' ', 'T'));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function computeReputation({ days = 0, closed = 0, cancelled = 0 } = {}) {
  const agePoints = (Math.min(days, 90) / 90) * 20;
  const dealsPoints = (Math.min(closed, 10) / 10) * 60;
  const reliabilityPoints = Math.max(0, 20 - Math.max(0, cancelled) * 10);
  return Math.round(clamp(agePoints + dealsPoints + reliabilityPoints, 0, 100));
}

function badgeFor({ isAdmin = false, days = 0, closed = 0, cancelled = 0 } = {}) {
  if (isAdmin) return { key: 'verificado', label: '✓ Verificado' };
  if (closed >= 10 && days >= 90) return { key: 'top', label: 'Top' };
  if (closed >= 3 && cancelled === 0) return { key: 'confiable', label: 'Confiable' };
  return { key: 'nuevo', label: 'Nuevo' };
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

module.exports = { CLOSED_STATUSES, clamp, daysSince, computeReputation, badgeFor, median, formatResponseTime, RANKS, RANK_LETTERS, RANK_LABELS, RANK_BADGES, ASSIGNABLE_RANKS, isAdminAlias, effectiveRank, rankBadgesFor, rankInfo, effectiveVerified };
