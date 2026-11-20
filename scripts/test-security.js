// scripts/test-security.js — pruebas de seguridad de Robin Dark,
// contra SQLite local.
// Uso: node scripts/test-security.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y un servidor falso de Resend en local (RESEND_API_URL apunta
// ahí, con una llave de pruebas): así se comprueba el registro de
// actividad sospechosa y la comprobación del contenido real de los
// archivos subidos, sin tocar Resend de verdad ni el sitio público.
// Los límites de peticiones se dejan en sus valores por defecto
// (10 de auth y 5 de recuperación / 15 min por IP), para comprobar
// que el límite responde 429 y queda registrado.
//
// Verifica:
// - magic bytes: un HTML o un SVG etiquetado como image/png se
//   rechaza; un PNG y un JPG reales pasan; MP4 con 'ftyp' pasa y
//   sin él se rechaza; WebM con EBML pasa.
// - registro de seguridad: login con contraseña mala y con correo
//   no registrado dejan un evento login_failed; código de
//   verificación malo deja verify_code_failed; pedir recuperación
//   deja recovery_requested; reenviar el código deja
//   verification_resent; el dueño otorgando el verificado deja
//   verify_granted; el dueño puede listar los eventos (GET
//   /api/users/me/security-events) y un usuario normal recibe 403.
// - límite de peticiones: tras muchos intentos de login seguidos,
//   el servidor responde 429 y queda un evento rate_limited.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { decodeUpload, matchesMagicBytes } = require('../src/photos');
const security = require('../src/security');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3459;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_RESEND_PORT = 3460;
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

// El registro ya NO devuelve token de sesión: la entrada queda
// bloqueada hasta confirmar el correo. Para las pruebas, el
// correo se marca verificado directo en la base de pruebas y
// luego se entra con correo + contraseña. Con reintentos por si
// el servidor tiene el archivo tomado en ese instante.
async function markEmailVerified(userId) {
  for (let i = 0; i < 10; i += 1) {
    try {
      const sqlite = new DatabaseSync(DB_FILE);
      try {
        sqlite.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
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

// Registra, marca el correo verificado en la base de pruebas y
// entra con correo + contraseña. Devuelve { register, token }.
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

// Cuenta los eventos de seguridad de un tipo en la base de
// pruebas. Con reintentos por si el servidor tiene el archivo
// tomado en ese instante.
async function countEvents(event) {
  for (let i = 0; i < 10; i += 1) {
    try {
      const sqlite = new DatabaseSync(DB_FILE);
      try {
        const row = sqlite.prepare('SELECT COUNT(*) AS n FROM security_events WHERE event = ?').get(event);
        return row ? Number(row.n) : 0;
      } finally {
        sqlite.close();
      }
    } catch (e) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return -1;
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function main() {
  console.log('== Magic bytes (sin servidor) ==');
  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  check('PNG real de 1x1 pasa', !decodeUpload({ mime: 'image/png', data: png1x1 }).error);
  check('HTML etiquetado como PNG se rechaza',
    (decodeUpload({ mime: 'image/png', data: b64('<html><script>alert(1)</script></html>') }).error || '').includes('no es un JPG o PNG válido'));
  check('SVG etiquetado como PNG se rechaza',
    (decodeUpload({ mime: 'image/png', data: b64('<svg onload=alert(1)>') }).error || '').includes('no es un JPG o PNG válido'));
  const jpegReal = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
  check('JPG real pasa', !decodeUpload({ mime: 'image/jpeg', data: b64(jpegReal) }).error);
  check('PNG etiquetado como JPG se rechaza',
    (decodeUpload({ mime: 'image/jpeg', data: png1x1 }).error || '').includes('no es un JPG o PNG válido'));
  const mp4Real = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
  check('MP4 real pasa (con allowVideo)', !decodeUpload({ mime: 'video/mp4', data: b64(mp4Real) }, { allowVideo: true }).error);
  check('MP4 sin ftyp se rechaza',
    (decodeUpload({ mime: 'video/mp4', data: b64([0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00]) }, { allowVideo: true }).error || '').includes('no es un MP4 o WebM válido'));
  check('WebM real pasa (con allowVideo)', !decodeUpload({ mime: 'video/webm', data: b64([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00]) }, { allowVideo: true }).error);
  check('MP4 sin allowVideo se rechaza', (decodeUpload({ mime: 'video/mp4', data: b64(mp4Real) }).error || '').includes('solo se pueden subir fotos'));
  check('matchesMagicBytes exportado y coherente', matchesMagicBytes(Buffer.from(jpegReal), 'image/jpeg') && !matchesMagicBytes(Buffer.from(jpegReal), 'image/png'));
  check('maskEmail enmascara el correo', security.maskEmail('guillermo@example.com') === 'gu***@example.com');

  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const fakeResend = await startFakeResend();
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET: 'secreto-de-pruebas-largo-1234567890',
    RESEND_API_KEY: TEST_KEY,
    RESEND_API_URL: FAKE_RESEND_URL,
  };
  delete env.DATABASE_URL;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Registro de seguridad ==');
    const author = { real_name: 'Ana Prueba', alias: 'ana', password: 'clave123', email: 'ana@prueba.com' };
    const owner = { real_name: 'Jefe Dueño', alias: 'jefe', password: 'clave123', email: 'jefe@prueba.com' };
    const a = await registerAndLogin(author);
    check('autora registrada y con sesión', a.register.status === 201 && Boolean(a.token));
    check('registro NO devuelve token de sesión', !a.register.data.token);
    const o = await registerAndLogin(owner);
    check('dueño registrado y con sesión', o.register.status === 201 && Boolean(o.token));

    const bad1 = await req('POST', '/api/auth/login', undefined, { email: author.email, password: 'mala1234' });
    const bad2 = await req('POST', '/api/auth/login', undefined, { email: author.email, password: 'mala1234' });
    check('login con contraseña mala -> 401', bad1.status === 401 && bad2.status === 401);
    const badUnknown = await req('POST', '/api/auth/login', undefined, { email: 'nadie@prueba.com', password: 'mala1234' });
    check('login con correo no registrado -> 401', badUnknown.status === 401);
    check('login_failed registrado (3 intentos)', (await countEvents('login_failed')) === 3);

    const pending = { real_name: 'Pedro Pendiente', alias: 'pedro', password: 'clave123', email: 'pedro@prueba.com' };
    const p = await req('POST', '/api/auth/register', undefined, pending);
    check('usuario pendiente registrado (sin verificar)', p.status === 201 && p.data.user && p.data.user.id);
    const mails = mailsTo(pending.email);
    check('código de verificación enviado por el correo falso', mails.length === 1);
    const code = mails.length ? codeFromMail(mails[0]) : null;
    check('código de 6 dígitos en el correo', Boolean(code) && /^\d{6}$/.test(code));
    const wrongCode = await req('POST', '/api/auth/verify-email', undefined, { email: pending.email, code: '000000' });
    check('código malo -> 400', wrongCode.status === 400);
    check('verify_code_failed registrado', (await countEvents('verify_code_failed')) === 1);
    if (code) {
      const goodCode = await req('POST', '/api/auth/verify-email', undefined, { email: pending.email, code });
      check('código bueno -> 200 y correo verificado', goodCode.status === 200 && goodCode.data.email_verified === true);
    }

    const forgot = await req('POST', '/api/auth/forgot', undefined, { email: author.email });
    check('recuperación responde lo genérico (200)', forgot.status === 200);
    check('recovery_requested registrado', (await countEvents('recovery_requested')) === 1);
    check('correo de recuperación llegó al falso Resend (2 en total: verificación + recuperación)', mailsTo(author.email).length === 2);

    const pending2 = { real_name: 'Rosa Reenvío', alias: 'rosa', password: 'clave123', email: 'rosa@prueba.com' };
    const p2 = await req('POST', '/api/auth/register', undefined, pending2);
    check('segunda usuaria pendiente registrada', p2.status === 201);
    const resend = await req('POST', '/api/auth/resend-verification', undefined, { email: pending2.email });
    check('reenvío responde lo genérico (200)', resend.status === 200);
    check('verification_resent registrado', (await countEvents('verification_resent')) === 1);

    const grant = await req('POST', `/api/users/${author.alias}/verify`, o.token, { verified: true });
    check('dueño otorga el verificado', grant.status === 200 && grant.data.verified === true);
    check('verify_granted registrado', (await countEvents('verify_granted')) === 1);

    const events = await req('GET', '/api/users/me/security-events', o.token);
    check('dueño lista los eventos (200)', events.status === 200 && Array.isArray(events.data.events));
    const kinds = new Set((events.data.events || []).map((e) => e.event));
    check('la lista trae login_failed, verify_code_failed, recovery_requested, verification_resent y verify_granted',
      ['login_failed', 'verify_code_failed', 'recovery_requested', 'verification_resent', 'verify_granted'].every((k) => kinds.has(k)));
    const forbidden = await req('GET', '/api/users/me/security-events', a.token);
    check('usuario normal NO puede listar los eventos (403)', forbidden.status === 403);

    console.log('== Límite de peticiones ==');
    let saw429 = false;
    for (let i = 0; i < 11; i += 1) {
      const r = await req('POST', '/api/auth/login', undefined, { email: author.email, password: 'mala1234' });
      if (r.status === 429) saw429 = true;
    }
    check('muchos intentos seguidos -> al menos un 429', saw429);
    check('rate_limited registrado', (await countEvents('rate_limited')) >= 1);
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
