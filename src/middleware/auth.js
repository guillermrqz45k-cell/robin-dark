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

module.exports = { requireAuth };
