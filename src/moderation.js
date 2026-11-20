// src/moderation.js — moderación automática de Robin Dark (IA por reglas).
//
// La IA propia de Robin Dark no es un modelo externo: son reglas
// sobre el texto que se publica. Tres decisiones:
// - 'block': se rechaza la publicación y se le dice al usuario por
//   qué (spam de promesas de dinero, insultos evidentes).
// - 'flag': se publica, pero queda marcado para que el dueño lo
//   revise en su panel (pago por fuera de la plataforma, enlaces,
//   teléfonos, gritos en mayúsculas). El dueño aprueba o lo quita.
// - 'ok': no pasa nada raro.
//
// Las listas son cortas a propósito: mejor marcar poco y bien que
// bloquear publicaciones normales por una palabra suelta. Los
// insultos se buscan por palabra completa, no por trozos.
const db = require('./db');

// Promesas de dinero / estafas típicas: se bloquean.
const BLOCK_PATTERNS = [
  /(gana|ganar|gane|duplica|multiplica|triplica)\s+(dinero|plata|pesos|btc|bitcoin|dólares|dolares)/i,
  /dinero\s+(f[aá]cil|r[aá]pido|gratis|seguro)/i,
  /inversi[óo]n\s+garantizada/i,
  /hazte\s+rico/i,
  /(gana|ganar)\s+\$?\s?\d+\s*(al\s+d[ií]a|diarios?|por\s+d[ií]a)/i,
  /duplica\s+tu\s+(dinero|inversi[óo]n|btc|bitcoin)/i,
  /regalo\s+dinero/i,
];

// Insultos evidentes (palabra completa). No es una lista exhaustiva:
// lo que no cae aquí lo puede marcar el dueño desde su panel.
const INSULT_WORDS = [
  'idiota', 'imbécil', 'imbecil', 'estúpido', 'estupido', 'pendejo',
  'mierda', 'puta', 'puto', 'cabrón', 'cabron', 'hijo de puta',
  'malparido', 'gonorrea', 'hijueputa',
];

function hasInsult(text) {
  const words = text.toLowerCase().split(/[^a-záéíóúñü]+/i).filter(Boolean);
  return words.some((w) => INSULT_WORDS.includes(w));
}

// Cosas sospechosas: no se bloquean, pero el dueño las revisa.
// (Sin tienda ya no hay "pago fuera de la plataforma": lo que se
// marca es lo que en una red social huele a spam o a contacto
// para sacar a la gente de aquí.)
const FLAG_PATTERNS = [
  { re: /whatsapp|telegram/i, reason: 'Menciona WhatsApp o Telegram para contactar fuera' },
  { re: /https?:\/\/|www\./i, reason: 'Contiene un enlace externo' },
  { re: /\b3\d{9}\b/, reason: 'Contiene un número de teléfono' },
];

function isShouting(text) {
  const letters = text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
  if (letters.length < 20) return false;
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  return upper / letters.length > 0.7;
}

function checkText(text) {
  const value = String(text || '');
  if (!value.trim()) return { decision: 'ok', reason: null };
  for (const re of BLOCK_PATTERNS) {
    if (re.test(value)) {
      return { decision: 'block', reason: 'Parece una promesa de dinero o una estafa: Robin Dark no permite publicar eso.' };
    }
  }
  if (hasInsult(value)) {
    return { decision: 'block', reason: 'El texto tiene insultos: en Robin Dark se publica con respeto.' };
  }
  for (const { re, reason } of FLAG_PATTERNS) {
    if (re.test(value)) return { decision: 'flag', reason };
  }
  if (isShouting(value)) {
    return { decision: 'flag', reason: 'El texto está casi todo en mayúsculas' };
  }
  return { decision: 'ok', reason: null };
}

// Guarda un aviso para la cola de revisión del dueño. Si el mismo
// contenido ya tiene un aviso pendiente, no se duplica.
async function flagForReview({ targetType, targetId, userId, reason }) {
  const existing = await db.get(
    "SELECT id FROM moderation_flags WHERE target_type = $1 AND target_id = $2 AND status = 'pending'",
    [targetType, targetId],
  );
  if (existing) return existing.id;
  const created = await db.query(
    `INSERT INTO moderation_flags (target_type, target_id, user_id, reason)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [targetType, targetId, userId, reason],
  );
  return created.rows[0].id;
}

// Marca un contenido como borrado por moderación (borrado suave:
// la fila queda, pero deja de verse en el feed, las historias y
// los comentarios).
async function removeTarget(targetType, targetId) {
  if (targetType === 'post') {
    await db.query('UPDATE posts SET deleted = $1 WHERE id = $2', [true, targetId]);
  } else if (targetType === 'story') {
    await db.query('UPDATE stories SET deleted = $1 WHERE id = $2', [true, targetId]);
  } else if (targetType === 'comment') {
    await db.query('UPDATE post_comments SET deleted = $1 WHERE id = $2', [true, targetId]);
  }
}

module.exports = { checkText, flagForReview, removeTarget };
