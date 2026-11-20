// scripts/test-auth-realname.js — pruebas del inicio de sesión con
// nombre real + correo + contraseña y código de verificación al
// correo, de Robin Dark, contra SQLite local.
// Uso: node scripts/test-auth-realname.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y un servidor falso de Resend en local (RESEND_API_URL apunta
// ahí, con una llave de pruebas): así se comprueba que el código
// de verificación se envía de verdad por el mismo conducto que la
// recuperación, sin tocar Resend de verdad ni el sitio público.
// Verifica: registro con nombre real + correo (sin ellos -> 400,
// y SIN token: el registro no da sesión hasta verificar el
// correo, GET /me sin token -> 401), envío del código (llega un
// sale en la respuesta), verificación (código malo -> 400, código
// bueno -> 200 y correo verificado, reutilizarlo -> 400, código
// caducado -> 400, reenviar anula el anterior), login solo por
// correo y contraseña (por alias -> 400, contraseña mala -> 401,
// el login queda BLOQUEADO con 403 hasta confirmar el correo y
// funciona después de verificarlo), alias duplicado -> 409 y
// correo duplicado -> 201 sin revelar nada (aviso al dueño), y
// que el perfil público muestra el nombre real. NO
// toca el sitio público ni Railway.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3463;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_RESEND_PORT = 3499;
const FAKE_RESEND_URL = `http://127.0.0.1:${FAKE_RESEND_PORT}/emails`;
const TEST_KEY = 're_test_key_para_pruebas';

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL ${name} ${extra}`); }
}

async function req(method, p, token, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function waitHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch (e) { /* aún no arranca */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Servidor falso de Resend: guarda cada correo que le llega y
// responde como Resend (201 + id). Así se comprueba el envío sin
// mandar nada de verdad.
const receivedMails = [];
function startFakeResend() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch (e) { /* cuerpo no JSON */ }
      receivedMails.push({
        method: req.method,
        path: req.url,
        auth: req.headers.authorization || '',
        from: parsed.from || '',
        to: parsed.to || [],
        subject: parsed.subject || '',
        text: parsed.text || '',
        html: parsed.html || '',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 're_prueba_123' }));
    });
  });
  return new Promise((resolve) => server.listen(FAKE_RESEND_PORT, '127.0.0.1', () => resolve(server)));
}

function mailsTo(email) {
  return receivedMails.filter((m) => (m.to || []).includes(email));
}

function codeFromMail(mail) {
  const m = String(`${mail.text || ''}\n${mail.html || ''}`).match(/(\d{6})/);
  return m ? m[1] : null;
}

// Caduca a mano el último código de un usuario (escribe directo
// en la base de pruebas, que es del test). Con reintentos por si
// el servidor tiene el archivo tomado en ese instante.
async function expireLastCode(userId) {
  const { DatabaseSync } = require('node:sqlite');
  for (let i = 0; i < 10; i += 1) {
    try {
      const sqlite = new DatabaseSync(DB_FILE);
      try {
        sqlite.prepare('UPDATE email_verification_codes SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, userId);
      } finally {
        sqlite.close();
      }
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const fakeResend = await startFakeResend();
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET: 'secreto-de-pruebas-largo-1234567890',
    RESEND_API_KEY: TEST_KEY,
    RESEND_API_URL: FAKE_RESEND_URL,
    // Se suben los límites solo para la prueba (en producción
    // valen los valores por defecto: 10 de auth y 5 de
    // recuperación / 15 min por IP).
    RATE_LIMIT_AUTH_MAX: '50',
    RATE_LIMIT_RECOVERY_MAX: '50',
  };
  delete env.DATABASE_URL;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Config con llave Resend ==');
    let r = await req('GET', '/api/auth/config');
    check('config: verificación por correo encendida con llave', r.status === 200 && r.data.email_verification === true && r.data.email_recovery === true, JSON.stringify(r.data));

    console.log('== Registro: validaciones ==');
    r = await req('POST', '/api/auth/register', undefined, { alias: 'ana', email: 'ana@example.com', password: 'clave12345' });
    check('registro sin nombre real -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Ana', alias: 'ana', password: 'clave12345' });
    check('registro sin correo -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Ana', alias: 'ana', email: 'no-es-correo', password: 'clave12345' });
    check('registro con correo no válido -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'A', alias: 'ana', email: 'ana@example.com', password: 'clave12345' });
    check('registro con nombre real de 1 letra -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Ana', alias: 'ana', email: 'ana@example.com', password: 'corta' });
    check('registro con contraseña corta -> 400', r.status === 400, JSON.stringify(r.data));

    console.log('== Registro con nombre real + correo ==');
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Ana María', alias: 'ana', email: 'ana@example.com', password: 'clave12345' });
    check('registro -> 201', r.status === 201, JSON.stringify(r.data));
    check('registro devuelve nombre real y correo no verificado', r.data.user && r.data.user.real_name === 'Ana María'
      && r.data.user.email === 'ana@example.com' && r.data.user.email_verified === false, JSON.stringify(r.data.user));
    check('registro dice que el código se envió', r.data.email_verification && r.data.email_verification.code_sent === true, JSON.stringify(r.data.email_verification));
    check('registro NO devuelve token (sin sesión hasta verificar)', !('token' in r.data) && !r.data.token, JSON.stringify(r.data));
    const noSession = await req('GET', '/api/users/me');
    check('sin el token del registro no hay sesión (GET /me -> 401)', noSession.status === 401, JSON.stringify(noSession.data));
    const registerResponse = JSON.stringify(r.data);
    const anaMails = mailsTo('ana@example.com');
    check('llegó 1 correo de verificación a ana@example.com', anaMails.length === 1, `correos=${anaMails.length}`);
    check('el correo sale de noreply@robindark.co', anaMails[0] && anaMails[0].from === 'Robin Dark <noreply@robindark.co>', JSON.stringify(anaMails[0]));
    check('el correo lleva la llave de pruebas (Bearer)', anaMails[0] && anaMails[0].auth === `Bearer ${TEST_KEY}`, JSON.stringify(anaMails[0]));
    const anaCode = anaMails[0] ? codeFromMail(anaMails[0]) : null;
    check('el correo trae un código de 6 dígitos', /^\d{6}$/.test(anaCode || ''), `código=${anaCode}`);
    check('la respuesta NO trae el código en claro', Boolean(anaCode) && !registerResponse.includes(anaCode), registerResponse.slice(0, 200));

    console.log('== Duplicados ==');
    // El correo duplicado NO da 409 (eso revelaría qué correos
    // tienen cuenta): responde 201 como un registro nuevo, sin
    // crear otra cuenta, y avisa al dueño del correo.
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Otra Ana', alias: 'ana2', email: 'ana@example.com', password: 'clave12345' });
    check('correo duplicado -> 201 (no revela nada)', r.status === 201);
    check('correo duplicado no trae id de usuario', !r.data.user || r.data.user.id === null || r.data.user.id === undefined);
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Ana María', alias: 'ana', email: 'ana2@example.com', password: 'clave12345' });
    check('alias duplicado -> 409', r.status === 409);

    console.log('== Login antes de verificar: bloqueado ==');
    r = await req('POST', '/api/auth/login', undefined, { email: 'ana@example.com', password: 'clave12345' });
    check('login con contraseña correcta pero sin verificar -> 403', r.status === 403
      && r.data.code === 'email_verification_required' && r.data.email_verification_required === true, JSON.stringify(r.data));
    check('el 403 no da token', !r.data.token, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/login', undefined, { email: 'ana@example.com', password: 'clave-mala' });
    check('login con contraseña mala -> 401 (antes que el bloqueo)', r.status === 401, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/login', undefined, { login: 'ana', password: 'clave12345' });
    check('login con alias (forma vieja) -> 400: no hay login por alias', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/login', undefined, { email: 'nadie@example.com', password: 'clave12345' });
    check('login con correo inexistente -> 401 genérico', r.status === 401, JSON.stringify(r.data));

    console.log('== Verificación del correo ==');
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'ana@example.com', code: '000000' });
    check('código malo -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'ana@example.com', code: anaCode });
    check('código bueno -> 200 y correo verificado', r.status === 200 && r.data.email_verified === true, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'ana@example.com', code: anaCode });
    check('reutilizar el código -> 400 (un solo uso)', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/login', undefined, { email: 'ana@example.com', password: 'clave12345' });
    check('login después de verificar -> 200 con token', r.status === 200 && Boolean(r.data.token)
      && r.data.user && r.data.user.email_verified === true, JSON.stringify(r.data));
    const anaTok = r.data.token;
    r = await req('GET', '/api/users/me', anaTok);
    check('GET /me muestra el correo verificado', r.status === 200 && r.data.user.email_verified === true && r.data.user.real_name === 'Ana María', JSON.stringify(r.data));
    r = await req('GET', '/api/users/ana/profile');
    check('perfil público muestra el nombre real', r.status === 200 && r.data.real_name === 'Ana María' && r.data.alias === 'ana', JSON.stringify(r.data));

    console.log('== Reenviar el código anula el anterior ==');
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Beto', alias: 'beto', email: 'beto@example.com', password: 'clave12345' });
    check('registro de beto -> 201', r.status === 201, JSON.stringify(r.data));
    const betoCode1 = codeFromMail(mailsTo('beto@example.com')[0]);
    r = await req('POST', '/api/auth/resend-verification', undefined, { email: 'beto@example.com' });
    check('reenviar código -> 200 genérico', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    check('llegó un segundo correo a beto', mailsTo('beto@example.com').length === 2, `correos=${mailsTo('beto@example.com').length}`);
    const betoCode2 = codeFromMail(mailsTo('beto@example.com')[1]);
    check('el segundo código es distinto al primero', Boolean(betoCode2) && betoCode2 !== betoCode1, `c1=${betoCode1} c2=${betoCode2}`);
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'beto@example.com', code: betoCode1 });
    check('el código viejo ya no vale -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'beto@example.com', code: betoCode2 });
    check('el código nuevo sí vale -> 200', r.status === 200 && r.data.email_verified === true, JSON.stringify(r.data));

    console.log('== Reenviar no filtra nada ==');
    const mailsBefore = receivedMails.length;
    r = await req('POST', '/api/auth/resend-verification', undefined, { email: 'nadie@example.com' });
    check('reenviar a correo inexistente -> mismo 200 genérico', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/resend-verification', undefined, { email: 'ana@example.com' });
    check('reenviar a correo ya verificado -> mismo 200 genérico', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    check('ninguno de los dos generó un correo nuevo', receivedMails.length === mailsBefore, `antes=${mailsBefore} ahora=${receivedMails.length}`);

    console.log('== Código caducado ==');
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Cata', alias: 'cata', email: 'cata@example.com', password: 'clave12345' });
    check('registro de cata -> 201', r.status === 201, JSON.stringify(r.data));
    const cataId = r.data.user.id;
    const cataCode = codeFromMail(mailsTo('cata@example.com')[0]);
    check('código de cata capturado', /^\d{6}$/.test(cataCode || ''), `código=${cataCode}`);
    check('código caducado a mano en la base de pruebas', await expireLastCode(cataId));
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'cata@example.com', code: cataCode });
    check('código caducado -> 400', r.status === 400, JSON.stringify(r.data));
    const cataLogin = await req('POST', '/api/auth/login', undefined, { email: 'cata@example.com', password: 'clave12345' });
    check('cata NO entra por correo sin verificar -> 403', cataLogin.status === 403
      && cataLogin.data.code === 'email_verification_required', JSON.stringify(cataLogin.data));
    r = await req('POST', '/api/auth/resend-verification', undefined, { email: 'cata@example.com' });
    check('reenviar el código a cata -> 200', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    const cataCode2 = codeFromMail(mailsTo('cata@example.com')[1]);
    check('llegó un código nuevo a cata', /^\d{6}$/.test(cataCode2 || '') && cataCode2 !== cataCode, `código=${cataCode2}`);
    r = await req('POST', '/api/auth/login', undefined, { email: 'cata@example.com', password: 'clave12345' });
    check('el login sigue bloqueado hasta verificar -> 403', r.status === 403, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/verify-email', undefined, { email: 'cata@example.com', code: cataCode2 });
    check('cata verifica con el código nuevo -> 200', r.status === 200 && r.data.email_verified === true, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/login', undefined, { email: 'cata@example.com', password: 'clave12345' });
    check('cata entra por correo después de verificar -> 200', r.status === 200 && Boolean(r.data.token), JSON.stringify(r.data));

    console.log(`\n${pass} ok, ${fail} fallos`);
    if (failures.length) console.log('Fallos:', failures.join(' | '));
    process.exitCode = fail ? 1 : 0;
  } finally {
    proc.kill();
    fakeResend.close();
    await new Promise((r) => setTimeout(r, 300));
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
