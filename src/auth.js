// src/auth.js — autenticación anónima de Robin Dark.
// Solo alias + contraseña. Sin correo, sin teléfono, sin ubicación.
// Contraseñas con bcrypt (hash + sal). Sesión con JWT.
//
// SEGURIDAD DEL SECRETO JWT:
// - Antes había un secreto por defecto en el código: cualquiera que
//   leyera el repo podía falsificar tokens de cualquier usuario (y
//   del admin). Eso ya no existe.
// - En producción (DATABASE_URL configurado, como en Railway) el
//   arranque FALLA si JWT_SECRET no está puesto o tiene menos de
//   32 caracteres: mejor no arrancar que arrancar falsificable.
// - En local sin DATABASE_URL se permite un secreto de desarrollo,
//   pero se avisa por consola.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEV_SECRET = 'robin-dark-dev-secret-solo-para-local';
const JWT_SECRET = process.env.JWT_SECRET || '';
const IS_PRODUCTION_LIKE = Boolean(process.env.DATABASE_URL);

if (IS_PRODUCTION_LIKE) {
  if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET === DEV_SECRET) {
    throw new Error(
      'JWT_SECRET no configurado o demasiado corto: en producción debe ser una cadena secreta de al menos 32 caracteres (ponla en Variables de Railway). El servidor no arranca sin un secreto fuerte.',
    );
  }
} else if (!JWT_SECRET) {
  console.warn(
    '[auth] AVISO: usando secreto JWT de desarrollo. Nunca uses este modo con DATABASE_URL ni en producción.',
  );
}

const SECRET = JWT_SECRET || DEV_SECRET;
const JWT_EXPIRES = '30d';

// bcrypt trunca silenciosamente las contraseñas a 72 bytes: dos
// contraseñas que solo difieren después del byte 72 serían iguales.
// Por eso se rechaza cualquier contraseña de más de 72 bytes.
const MAX_PASSWORD_BYTES = 72;

function passwordTooLong(password) {
  return Buffer.byteLength(String(password || ''), 'utf8') > MAX_PASSWORD_BYTES;
}

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Hash falso para comparar cuando el alias no existe: así el login
// tarda lo mismo exista o no el alias, y no se filtra por tiempo
// qué alias están registrados. Se genera una sola vez por arranque.
const DUMMY_HASH = bcrypt.hashSync('robin-dark-usuario-inexistente', 12);
function checkPasswordDummy(password) {
  return bcrypt.compare(password, DUMMY_HASH);
}

function signToken(user, extra = {}) {
  return jwt.sign({ id: user.id, alias: user.alias, ...extra }, SECRET, {
    expiresIn: JWT_EXPIRES,
    algorithm: 'HS256',
  });
}

function verifyToken(token) {
  // Algoritmo fijado a HS256: nunca se acepta un token 'none' ni
  // un cambio de algoritmo que permita verificar con otra clave.
  return jwt.verify(token, SECRET, { algorithms: ['HS256'] });
}

function cleanAlias(alias) {
  return String(alias || '').trim().slice(0, 30);
}

module.exports = {
  hashPassword,
  checkPassword,
  checkPasswordDummy,
  passwordTooLong,
  signToken,
  verifyToken,
  cleanAlias,
};
