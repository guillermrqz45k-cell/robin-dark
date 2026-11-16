// src/auth.js — autenticación anónima de Robin Dark.
// Solo alias + contraseña. Sin correo, sin teléfono, sin ubicación.
// Contraseñas con bcrypt (hash + sal). Sesión con JWT.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'robin-dark-dev-secret-cambialo-en-produccion';
const JWT_EXPIRES = '30d';

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  return jwt.sign({ id: user.id, alias: user.alias }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function cleanAlias(alias) {
  return String(alias || '').trim().slice(0, 30);
}

module.exports = { hashPassword, checkPassword, signToken, verifyToken, cleanAlias };
