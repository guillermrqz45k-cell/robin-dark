// src/middleware/auth.js — protege las rutas que necesitan sesión.
// Lee el token JWT del encabezado Authorization: Bearer <token>.
//
// Hay una sola clase de token: el de usuario (sin role). El dueño
// del sitio es un usuario más: su alias es el de ADMIN_ALIAS y se
// reconoce por alias, no por un token aparte (no hay panel de
// administrador ni login de admin). Un token viejo con role:
// 'admin' se rechaza en las rutas de usuario, porque nunca fue
// un token de usuario válido.
const { verifyToken } = require('../auth');

function parseToken(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Necesitas iniciar sesión con tu correo.' });
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
    return res.status(403).json({ error: 'Ese token es de administrador: entra como usuario normal para usar la red social.' });
  }
  return next();
}

// optionalAuth — lee el token si viene, pero nunca exige sesión:
// las rutas públicas (fotos de perfil, documentos del dueño)
// deciden ellas mismas quién puede ver qué. Un token no válido
// se ignora como si no hubiera sesión.
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = verifyToken(token);
  } catch (e) {
    req.user = null;
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };
