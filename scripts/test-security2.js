// scripts/test-security2.js — segunda ronda de pruebas de seguridad
// de Robin Dark (hallazgos de la prueba de ataque 1 contra 1),
// contra SQLite local.
// Uso: node scripts/test-security2.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y un servidor falso de Resend en local (RESEND_API_URL apunta
// ahí, con una llave de pruebas). Los límites por IP se suben
// solo para la prueba, para aislar el bloqueo por cuenta (en
// producción valen los valores por defecto).
// NO toca el sitio público ni Railway.
//
// Verifica:
// - revocación de sesiones: al cambiar la contraseña, el token
//   viejo deja de valer (401) y el nuevo funciona.
// - dueño por base de datos: un token con el rango 'admin' forjado
//   a mano (con el secreto de pruebas) NO sirve para verificar a
//   otro usuario, ver las solicitudes ni abrir un documento
//   privado; el dueño de verdad sí puede.
// - bloqueo por cuenta: 5 intentos fallidos con la misma cuenta
//   bloquean la cuenta 15 minutos (429) aunque el límite por IP
//   no se haya alcanzado; al cambiar la contraseña se desbloquea.
// - códigos por cuenta: 5 códigos malos con la misma cuenta
//   bloquean el intento (429).
// - registro sin enumeración: registrarse con un correo que ya
//   existe responde 201 (no 409), no crea otra cuenta y avisa al
//   dueño del correo; el alias repetido sigue dando 409.
// - sin HTML en nombre y bio: las etiquetas se quitan al guardar.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');
const { stripHtml } = require('../src/auth');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3461;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_RESEND_PORT = 3462;
const FAKE_RESEND_URL = `http://127.0.0.1:${FAKE_RESEND_PORT}/emails`;
const TEST_KEY = 're_test_key_para_pruebas';
const JWT_SECRET = 'secreto-de-pruebas-largo-1234567890';

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
// responde como Resend (200 + id). Así se comprueba el envío sin
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

// Acceso directo a la base de pruebas (solo lectura/escritura
// del test). Con reintentos por si el servidor tiene el archivo
// tomado en ese instante.
async function withDb(fn) {
  for (let i = 0; i < 10; i += 1) {
    try {
      const sqlite = new DatabaseSync(DB_FILE);
      try {
        return fn(sqlite);
      } finally {
        sqlite.close();
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('no se pudo abrir la base de pruebas');
}

async function markEmailVerified(userId) {
  return withDb((sqlite) => {
    sqlite.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
    return true;
  });
}

async function registerAndLogin(user) {
  const register = await req('POST', '/api/auth/register', undefined, user);
  let token = null;
  if (register.status === 201 && register.data.user) {
    await markEmailVerified(register.data.user.id);
    const login = await req('POST', '/api/auth/login', undefined, { email: user.email, password: user.password });
    if (login.status === 200) token = login.data.token || null;
  }
  return { register, token };
}

async function countEvents(event) {
  return withDb((sqlite) => {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM security_events WHERE event = ?').get(event);
    return row ? Number(row.n) : 0;
  });
}

async function countUsers() {
  return withDb((sqlite) => {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM users').get();
    return row ? Number(row.n) : 0;
  });
}

// Mete un documento privado (foto de identidad) directo en la
// base de pruebas, como lo haría la solicitud de verificación.
async function insertDocumentPhoto(userId) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  return withDb((sqlite) => {
    const info = sqlite.prepare("INSERT INTO photos (owner_id, kind, mime, size_bytes, storage, data) VALUES (?, 'document', 'image/png', ?, 'db', ?)").run(userId, png.length, png);
    return Number(info.lastInsertRowid);
  });
}

async function main() {
  console.log('== stripHtml (sin servidor) ==');
  check('stripHtml quita las etiquetas', stripHtml('<p>hola</p> <b>mundo</b>') === 'hola mundo');
  check('stripHtml conserva un < suelto', stripHtml('a < b') === 'a < b');
  check('stripHtml quita un script entero', stripHtml('<script>alert(1)</script> Ana') === 'alert(1) Ana');

  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const fakeResend = await startFakeResend();
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET,
    RESEND_API_KEY: TEST_KEY,
    RESEND_API_URL: FAKE_RESEND_URL,
    // Se suben los límites por IP solo para la prueba, para aislar
    // el bloqueo por cuenta (en producción valen los valores por
    // defecto: 10 de auth y 5 de recuperación / 15 min por IP).
    RATE_LIMIT_AUTH_MAX: '50',
    RATE_LIMIT_RECOVERY_MAX: '50',
  };
  delete env.DATABASE_URL;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Revocación de sesiones ==');
    const author = { real_name: 'Ana Prueba', alias: 'ana', password: 'clave123', email: 'ana@prueba.com' };
    const owner = { real_name: 'Jefe Dueño', alias: 'jefe', password: 'clave123', email: 'jefe@prueba.com' };
    const a = await registerAndLogin(author);
    check('autora registrada y con sesión', a.register.status === 201 && Boolean(a.token));
    const o = await registerAndLogin(owner);
    check('dueño registrado y con sesión', o.register.status === 201 && Boolean(o.token));
    const me1 = await req('GET', '/api/auth/me', a.token);
    check('token viejo vale antes del cambio', me1.status === 200);
    const forgot = await req('POST', '/api/auth/forgot', undefined, { email: author.email });
    check('recuperación pedida (200)', forgot.status === 200);
    const recMail = mailsTo(author.email).find((m) => (m.subject || '').includes('recuperar'));
    const recCode = recMail ? codeFromMail(recMail) : null;
    check('código de recuperación en el correo', Boolean(recCode) && /^\d{6}$/.test(recCode));
    const reset = await req('POST', '/api/auth/reset', undefined, { email: author.email, code: recCode, password: 'nueva123' });
    check('contraseña cambiada (200)', reset.status === 200);
    const meOld = await req('GET', '/api/auth/me', a.token);
    check('token viejo ya NO vale tras cambiar la contraseña (401)', meOld.status === 401);
    const loginOld = await req('POST', '/api/auth/login', undefined, { email: author.email, password: 'clave123' });
    check('contraseña vieja ya no entra (401)', loginOld.status === 401);
    const loginNew = await req('POST', '/api/auth/login', undefined, { email: author.email, password: 'nueva123' });
    check('contraseña nueva entra (200)', loginNew.status === 200 && Boolean(loginNew.data.token));
    const meNew = await req('GET', '/api/auth/me', loginNew.data.token);
    check('token nuevo vale (200)', meNew.status === 200);

    console.log('== Dueño por base de datos (token forjado) ==');
    const victim = { real_name: 'Víctor Víctima', alias: 'victor', password: 'clave123', email: 'victor@prueba.com' };
    const v = await registerAndLogin(victim);
    check('víctima registrada y con sesión', v.register.status === 201 && Boolean(v.token));
    // Token forjado a mano con el secreto de pruebas: dice ser
    // admin, pero en la base es un usuario normal (la autora).
    // La víctima es otra persona: su documento no lo puede abrir.
    // Se le pone la versión de token actual de la autora (leída
    // de su token válido), para que el rechazo venga del rango
    // y no de la versión: el rango forjado no debe servir.
    const authorTv = (jwt.decode(loginNew.data.token) || {}).tv || 0;
    const forged = jwt.sign({ id: a.register.data.user.id, alias: 'ana', rank: 'admin', tv: authorTv }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '30d' });
    const forgedVerify = await req('POST', `/api/users/${victim.alias}/verify`, forged, { verified: true });
    check('token forjado NO verifica a otro usuario (403)', forgedVerify.status === 403);
    const forgedRequests = await req('GET', '/api/users/me/verification-requests', forged);
    check('token forjado NO ve las solicitudes del dueño (403)', forgedRequests.status === 403);
    const docId = await insertDocumentPhoto(v.register.data.user.id);
    check('documento privado creado en la base', docId > 0);
    const forgedDoc = await fetch(`${BASE}/api/photos/${docId}`, { headers: { Authorization: `Bearer ${forged}` } });
    check('token forjado NO abre el documento privado (403)', forgedDoc.status === 403);
    const victimDoc = await fetch(`${BASE}/api/photos/${docId}`, { headers: { Authorization: `Bearer ${v.token}` } });
    check('la dueña sí abre su documento (200)', victimDoc.status === 200);
    const ownerDoc = await fetch(`${BASE}/api/photos/${docId}`, { headers: { Authorization: `Bearer ${o.token}` } });
    check('el dueño sí abre el documento (200)', ownerDoc.status === 200);
    const ownerVerify = await req('POST', `/api/users/${victim.alias}/verify`, o.token, { verified: true });
    check('el dueño de verdad sí verifica (200)', ownerVerify.status === 200 && ownerVerify.data.verified === true);

    console.log('== Bloqueo por cuenta ==');
    const locked = { real_name: 'Luis Bloqueo', alias: 'luis', password: 'clave123', email: 'luis@prueba.com' };
    const l = await registerAndLogin(locked);
    check('usuario de bloqueo registrado y con sesión', l.register.status === 201 && Boolean(l.token));
    const failedBefore = await countEvents('login_failed');
    let bad401 = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = await req('POST', '/api/auth/login', undefined, { email: locked.email, password: 'mala1234' });
      if (r.status === 401) bad401 += 1;
    }
    check('5 intentos fallidos -> 401 cada uno', bad401 === 5);
    const sixth = await req('POST', '/api/auth/login', undefined, { email: locked.email, password: 'mala1234' });
    check('6º intento con la misma cuenta -> 429 (cuenta bloqueada)', sixth.status === 429);
    const correctWhileLocked = await req('POST', '/api/auth/login', undefined, { email: locked.email, password: 'clave123' });
    check('contraseña correcta estando bloqueado -> 429', correctWhileLocked.status === 429);
    check('login_failed registrado (+5)', (await countEvents('login_failed')) === failedBefore + 5);
    check('login_blocked registrado', (await countEvents('login_blocked')) >= 1);
    const forgotL = await req('POST', '/api/auth/forgot', undefined, { email: locked.email });
    check('recuperación pedida para desbloquear (200)', forgotL.status === 200);
    const recMailL = mailsTo(locked.email).find((m) => (m.subject || '').includes('recuperar'));
    const recCodeL = recMailL ? codeFromMail(recMailL) : null;
    const resetL = await req('POST', '/api/auth/reset', undefined, { email: locked.email, code: recCodeL, password: 'nueva456' });
    check('contraseña cambiada para desbloquear (200)', resetL.status === 200);
    const loginAfterReset = await req('POST', '/api/auth/login', undefined, { email: locked.email, password: 'nueva456' });
    check('tras cambiar la contraseña, la cuenta ya entra (200)', loginAfterReset.status === 200);

    console.log('== Códigos por cuenta ==');
    const pending = { real_name: 'Pedro Pendiente', alias: 'pedro', password: 'clave123', email: 'pedro@prueba.com' };
    const p = await req('POST', '/api/auth/register', undefined, pending);
    check('usuario pendiente registrado', p.status === 201 && p.data.user && p.data.user.id);
    let bad400 = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = await req('POST', '/api/auth/verify-email', undefined, { email: pending.email, code: '000000' });
      if (r.status === 400) bad400 += 1;
    }
    check('5 códigos malos -> 400 cada uno', bad400 === 5);
    const sixthCode = await req('POST', '/api/auth/verify-email', undefined, { email: pending.email, code: '000000' });
    check('6º código malo con la misma cuenta -> 429', sixthCode.status === 429);
    check('verify_code_failed registrado (5)', (await countEvents('verify_code_failed')) === 5);

    console.log('== Registro sin enumeración ==');
    const usersBefore = await countUsers();
    const dup = await req('POST', '/api/auth/register', undefined, { real_name: 'Ana Copia', alias: 'anacopia', password: 'clave123', email: author.email });
    check('correo ya registrado NO da 409 (responde 201)', dup.status === 201);
    check('no se crea otra cuenta', (await countUsers()) === usersBefore);
    check('la respuesta no revela nada (sin id de usuario)', !dup.data.user || dup.data.user.id === null || dup.data.user.id === undefined);
    const notice = mailsTo(author.email).find((m) => (m.subject || '').includes('intentó crear una cuenta'));
    check('el dueño del correo recibe el aviso', Boolean(notice));
    check('register_email_taken registrado', (await countEvents('register_email_taken')) >= 1);
    const dupAlias = await req('POST', '/api/auth/register', undefined, { real_name: 'Otro', alias: 'ana', password: 'clave123', email: 'otro@prueba.com' });
    check('alias repetido sigue dando 409 (es público)', dupAlias.status === 409);

    console.log('== Sin HTML en nombre y bio ==');
    const htmlUser = { real_name: '<b>Ana</b> <script>alert(1)</script>', alias: 'anah', password: 'clave123', email: 'anah@prueba.com' };
    const h = await req('POST', '/api/auth/register', undefined, htmlUser);
    check('registro con HTML en el nombre -> 201', h.status === 201 && h.data.user);
    const profile = await req('GET', `/api/users/${htmlUser.alias}/profile`);
    check('el nombre guardado no tiene etiquetas', profile.status === 200 && !(profile.data.real_name || '').includes('<'));
    const hLogin = await registerAndLogin({ real_name: 'Hugo Bio', alias: 'hugo', password: 'clave123', email: 'hugo@prueba.com' });
    check('usuario de bio registrado y con sesión', hLogin.register.status === 201 && Boolean(hLogin.token));
    const bioPatch = await req('PATCH', '/api/users/me/profile', hLogin.token, { bio: '<svg onload=alert(1)>hola <i>mundo</i>' });
    check('bio con HTML se guarda sin etiquetas', bioPatch.status === 200 && !(bioPatch.data.user.bio || '').includes('<') && (bioPatch.data.user.bio || '').includes('hola'));
    const namePatch = await req('PATCH', '/api/users/me/profile', hLogin.token, { real_name: '<b>Pedro</b>' });
    check('nombre con HTML se guarda sin etiquetas', namePatch.status === 200 && (namePatch.data.user.real_name || '') === 'Pedro');
  } finally {
    proc.kill('SIGTERM');
    fakeResend.close();
    await new Promise((r) => setTimeout(r, 500));
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }

  console.log(`\nResultado: ${pass} pasadas, ${fail} fallidas.`);
  if (failures.length) console.log(`Fallidas: ${failures.join(' | ')}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
