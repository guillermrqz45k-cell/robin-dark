// src/mail.js — correo de Robin Dark con Resend.
//
// Se usa para los códigos de recuperación de contraseña y para
// los códigos de verificación del correo al registrarse.
// - Remitente: Robin Dark <noreply@robindark.co> (el dominio ya
//   está verificado en Resend).
// - La clave se lee SOLO de la variable RESEND_API_KEY (nunca va
//   en el código). Sin ella, sendMail devuelve { ok: false,
//   error: 'no-configurado' } y la recuperación responde que el
//   correo no está configurado: nunca se inventa un código ni se
//   muestra en pantalla.
// - RESEND_API_URL solo existe para las pruebas locales: apunta
//   a un servidor falso de Resend y nunca se pone en producción.
// - No se instala nada nuevo: Node 22 ya trae fetch.
const FROM = 'Robin Dark <noreply@robindark.co>';
const API_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) return { ok: false, error: 'no-configurado' };
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[mail] Resend respondió', res.status, JSON.stringify(data).slice(0, 300));
      return { ok: false, error: 'resend-error' };
    }
    return { ok: true, id: data.id || null };
  } catch (e) {
    console.error('[mail] no se pudo contactar a Resend:', e.message);
    return { ok: false, error: 'red' };
  }
}

// Código de recuperación de 6 dígitos (el de la vista previa).
function recoveryMail(code) {
  return {
    subject: 'Tu código para recuperar tu contraseña en Robin Dark',
    text: `Tu código de recuperación es: ${code}\n\nCaduca en 15 minutos y solo se puede usar una vez. Si tú no pediste recuperar tu contraseña, ignora este correo.`,
    html: `<p>Tu código de recuperación es:</p><p style="font-size:28px;letter-spacing:6px"><strong>${code}</strong></p><p>Caduca en 15 minutos y solo se puede usar una vez. Si tú no pediste recuperar tu contraseña, ignora este correo.</p>`,
  };
}

// Código de verificación del correo al registrarse (6 dígitos,
// mismo sistema que el de recuperación: solo hash, 15 minutos,
// un solo uso; el código nunca va en la respuesta de la API).
function verificationMail(code) {
  return {
    subject: 'Tu código de verificación en Robin Dark',
    text: `¡Bienvenido a Robin Dark! Tu código de verificación es: ${code}\n\nCaduca en 15 minutos y solo se puede usar una vez. Si tú no creaste esta cuenta, ignora este correo.`,
    html: `<p>¡Bienvenido a Robin Dark! Tu código de verificación es:</p><p style="font-size:28px;letter-spacing:6px"><strong>${code}</strong></p><p>Caduca en 15 minutos y solo se puede usar una vez. Si tú no creaste esta cuenta, ignora este correo.</p>`,
  };
}

module.exports = { isConfigured, sendMail, recoveryMail, verificationMail };
