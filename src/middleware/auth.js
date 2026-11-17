// src/middleware/auth.js — protege las rutas que necesitan sesión.
// Lee el token JWT del encabezado Authorization: Bearer <token>.
//
// Separación de tokens: hay dos clases de JWT y cada una solo vale
// para lo suyo:
// - Token de usuario (sin role): rutas de la tienda, chat, pedidos.
// - Token de admin (role: 'admin', id 0): solo /api/admin/*.
// Antes el token de admin se aceptaba en las rutas de usuario y
// luego fallaba con errores 500 de clave foránea (seller_id 0 no
// existe en la tabla users). Ahora cada middleware rechaza el
// token de la otra clase.
const { verifyToken } = require('../auth');

function parseToken(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Necesitas iniciar sesión con tu alias.' });
    return null;
  }
  try {
    req.user = verifyToken(token);
    return req.user;
  } catch (e) {
    res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar.' });
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = parseToken(req, res);
  if (!user) return;
  if (user.role === 'admin') {
    return res.status(403).json({ error: 'Ese token es de administrador: entra como usuario normal para usar la tienda.' });
  }
  return next();
}

// requireAdmin — solo el administrador del sitio.
// El token debe llevar role: 'admin', que solo se emite en
// POST /api/admin/login con las credenciales de ADMIN_ALIAS /
// ADMIN_PASSWORD de las variables de entorno. Un usuario normal
// (aunque tenga sesión válida) recibe 403.
function requireAdmin(req, res, next) {
  const user = parseToken(req, res);
  if (!user) return;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo el administrador puede ver esto.' });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
