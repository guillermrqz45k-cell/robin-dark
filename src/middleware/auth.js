// src/middleware/auth.js — protege las rutas que necesitan sesión.
// Lee el token JWT del encabezado Authorization: Bearer <token>.
//
// Hay una sola clase de token: el de usuario (sin role). El dueño
// del sitio es un usuario más: se identifica por su alias
// (ADMIN_ALIAS, isOwner) y lleva rango 'admin' en su fila, como
// los admins que él concede (isAdminUser, solo por rango). No hay
// panel de administrador ni login de admin. Un token viejo con
// role: 'admin' se rechaza en las rutas de usuario, porque nunca
// fue un token de usuario válido.
//
// El token solo prueba quién eres: el rango y la validez de la
// sesión se comprueban siempre contra la base de datos, nunca
// contra lo que diga el payload del token. Así, un token con el
// rango cambiado a mano no sirve para nada, y cambiar la
// contraseña invalida los tokens viejos (la versión del token
// cambia al cambiar la contraseña). Los tokens viejos, que no
// llevan versión, se tratan como versión 0.
const { verifyToken } = require('../auth');
const db = require('../db');

async function loadSessionUser(payload) {
  if (!payload || !payload.id) return null;
  const row = await db.get('SELECT id, alias, rank, token_version, disabled FROM users WHERE id = $1', [payload.id]);
  if (!row) return null;
  const tokenVersion = Number(payload.tv) || 0;
  if (tokenVersion !== (Number(row.token_version) || 0)) return null;
  // La cuenta inhabilitada por el dueño no puede usar la red:
  // su sesión queda muerta (el login también la rechaza).
  if (row.disabled === true || row.disabled === 1 || row.disabled === '1') return { id: row.id, alias: row.alias, rank: row.rank, disabled: true };
  return { id: row.id, alias: row.alias, rank: row.rank, disabled: false };
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Necesitas iniciar sesión con tu correo.' });
  }
  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    return res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar.' });
  }
  if (payload.role === 'admin') {
    return res.status(403).json({ error: 'Ese token es de administrador: entra como usuario normal para usar la red social.' });
  }
  try {
    const user = await loadSessionUser(payload);
    if (!user) return res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar.' });
    // Cuenta inhabilitada de forma permanente por el dueño: la
    // sesión que tenía deja de valer y se le dice por qué.
    if (user.disabled) {
      return res.status(403).json({ error: 'Tu cuenta ha sido inhabilitada permanentemente.', code: 'account_disabled' });
    }
    req.user = user;
    return next();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo comprobar tu sesión. Inténtalo de nuevo.' });
  }
}

// optionalAuth — lee el token si viene, pero nunca exige sesión:
// las rutas públicas (fotos de perfil, documentos del dueño)
// deciden ellas mismas quién puede ver qué. Un token no válido
// (o con la versión vieja) se ignora como si no hubiera sesión.
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const user = await loadSessionUser(payload);
    // Una cuenta inhabilitada no tiene sesión para las rutas
    // públicas: se la trata como si no hubiera entrado (su perfil
    // y su contenido desaparecen de la vista de los demás).
    req.user = user && !user.disabled ? user : null;
  } catch (e) {
    req.user = null;
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };
