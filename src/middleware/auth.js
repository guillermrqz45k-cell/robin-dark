// src/middleware/auth.js — protege las rutas que necesitan sesión.
// Lee el token JWT del encabezado Authorization: Bearer <token>.
const { verifyToken } = require('../auth');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Necesitas iniciar sesión con tu alias.' });
  }
  try {
    req.user = verifyToken(token);
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar.' });
  }
}

// requireAdmin — solo el administrador del sitio.
// El token debe llevar role: 'admin', que solo se emite en
// POST /api/admin/login con las credenciales de ADMIN_ALIAS /
// ADMIN_PASSWORD de las variables de entorno. Un usuario normal
// (aunque tenga sesión válida) recibe 403.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador puede ver esto.' });
    }
    return next();
  });
}

module.exports = { requireAuth, requireAdmin };
