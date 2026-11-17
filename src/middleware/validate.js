// src/middleware/validate.js — validación de entradas común.
//
// Varios endpoints aceptaban cualquier cosa: IDs no numéricos
// (provocaban errores 500), cuerpos JSON que no eran objetos,
// búsquedas sin límite y precios absurdos. Cada fallo es una
// forma de romper o abusar de la app, así que se valida antes
// de tocar la base de datos.

// ID de ruta: debe ser un entero positivo. Un ID no numérico
// antes llegaba a Postgres/SQLite y devolvía 500; ahora es 400.
function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

function requireIdParam(req, res) {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Identificador no válido.' });
    return null;
  }
  return id;
}

// El cuerpo JSON de un POST debe ser un objeto. Sin esto, un
// cuerpo como "texto" o [1,2] pasaba y luego req.body.alias
// era undefined de formas impredecibles.
function requireObjectBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'El cuerpo de la petición debe ser un objeto JSON.' });
  }
  return next();
}

// Escapa los comodines de LIKE (% y _) en la búsqueda: sin esto,
// buscar "%" devolvía todos los anuncios y "_" coincidía con
// cualquier carácter. No era inyección SQL (la consulta ya era
// parametrizada), pero sí un abuso de la búsqueda.
function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, (c) => `\\${c}`);
}

module.exports = { parseId, requireIdParam, requireObjectBody, escapeLike };
