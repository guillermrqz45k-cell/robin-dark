// src/present.js — presentación común de autores en Robin Dark.
//
// El cliente nunca calcula insignias por su cuenta: todo sale del
// servidor con las mismas funciones que usa el perfil público
// (src/reputation.js). La foto de perfil se resuelve con
// photos.urlsByIds (un Map id → url) para no hacer una consulta
// por autor en cada lista.
//
// La tarjeta del autor lleva: alias, is_admin (el dueño: rango
// 'admin' en su fila o alias de ADMIN_ALIAS — el rango es lo que
// sobrevive a un cambio de @usuario) y verified. NO hay rangos
// con letras (A/M/V/N): se quitaron del port por decisión del
// dueño (2026-11-20).
const { isAdminUser, effectiveVerified } = require('./reputation');

function authorCard(row, photoUrls = new Map()) {
  if (!row) return null;
  const avatarId = row.avatar_photo_id ? Number(row.avatar_photo_id) : null;
  return {
    id: row.id,
    alias: row.alias,
    is_admin: isAdminUser(row),
    verified: effectiveVerified({ verified: row.verified, alias: row.alias, rank: row.rank }),
    avatar_url: avatarId ? (photoUrls.get(avatarId) || null) : null,
  };
}

// Saca los avatar_photo_id de varias filas de usuario para
// resolverlos de una vez con photos.urlsByIds.
function collectAvatarIds(rows) {
  return (rows || [])
    .map((r) => r.avatar_photo_id || r.author_avatar_photo_id || r.seller_avatar_photo_id)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

module.exports = { authorCard, collectAvatarIds };
