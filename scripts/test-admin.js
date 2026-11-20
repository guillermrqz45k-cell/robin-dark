// scripts/test-admin.js — modelo de admin de Robin Dark: solo
// Darkmous (el dueño, alias ADMIN_ALIAS) puede ser admin o dar
// el admin a quien él quiera. Nadie se vuelve admin por su
// cuenta, ni registrándose con el alias del dueño.
// Uso: node scripts/test-admin.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y un servidor falso de Resend en local. NO toca el sitio
// público ni Railway.
//
// Verifica:
// - registrarse con el alias de ADMIN_ALIAS ya NO da admin
//   (rank 'new', is_admin false, is_owner true).
// - el dueño se hace admin con POST /api/users/:alias/admin
//   (200, rank 'admin', is_admin true, insignia Admin).
// - un usuario normal no puede dar admin (403) y un admin
//   concedido tampoco (403, solo el dueño).
// - el dueño quita admin (200, rank 'new') y no puede quitarse
//   su propio admin (409); alias inexistente 404.
// - un admin concedido puede verificar a un usuario (200) pero
//   no puede inhabilitar a otro admin (409) ni al dueño (409);
//   el dueño sí puede inhabilitar a un admin concedido (200).
// - is_owner llega en el login y en /me (y en /api/users/me).
// - los eventos admin_granted y admin_revoked quedan registrados.
// - el cliente tiene el botón «Hacer admin» / «Quitar admin»
//   solo para el dueño (me.is_owner).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3467;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_RESEND_PORT = 3468;
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

function startFakeResend() {
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 're_prueba_123' }));
    });
  });
  return new Promise((resolve) => server.listen(FAKE_RESEND_PORT, '127.0.0.1', () => resolve(server)));
}

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
  let userId = null;
  if (register.status === 201 && register.data.user) {
    userId = register.data.user.id;
    await markEmailVerified(userId);
    const login = await req('POST', '/api/auth/login', undefined, { email: user.email, password: user.password });
    if (login.status === 200) token = login.data.token || null;
  }
  return { register, token, userId };
}

async function getUserRow(userId) {
  return withDb((sqlite) => sqlite.prepare('SELECT id, alias, rank, disabled FROM users WHERE id = ?').get(userId));
}

async function countEvents(event) {
  return withDb((sqlite) => {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM security_events WHERE event = ?').get(event);
    return row ? Number(row.n) : 0;
  });
}

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const fakeResend = await startFakeResend();
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET,
    RESEND_API_KEY: TEST_KEY,
    RESEND_API_URL: FAKE_RESEND_URL,
    RATE_LIMIT_AUTH_MAX: '50',
    RATE_LIMIT_RECOVERY_MAX: '50',
  };
  delete env.DATABASE_URL;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Registrarse con el alias del dueño ya NO da admin ==');
    const owner = { real_name: 'Jefe Dueño', alias: 'jefe', password: 'clave123', email: 'jefe@prueba.com' };
    const o = await registerAndLogin(owner);
    check('dueño registrado y con sesión', o.register.status === 201 && Boolean(o.token), JSON.stringify(o.register.data));
    check('al registrarse con el alias de ADMIN_ALIAS, is_admin es false', o.register.data.user && o.register.data.user.is_admin === false, JSON.stringify(o.register.data.user));
    check('al registrarse con el alias de ADMIN_ALIAS, is_owner es true', o.register.data.user && o.register.data.user.is_owner === true, JSON.stringify(o.register.data.user));
    const ownerRow = await getUserRow(o.userId);
    check('el rango guardado al registrarse es new', ownerRow && ownerRow.rank === 'new', JSON.stringify(ownerRow));
    const profBefore = await req('GET', '/api/users/jefe/profile');
    check('el perfil del dueño recién registrado no es admin', profBefore.data.is_admin === false && !(profBefore.data.badge && profBefore.data.badge.key === 'admin'), JSON.stringify(profBefore.data.badge));

    console.log('== El dueño se hace admin con el nuevo endpoint ==');
    const selfGrant = await req('POST', '/api/users/jefe/admin', o.token, { admin: true });
    check('el dueño se da admin a sí mismo (200, admin: true)', selfGrant.status === 200 && selfGrant.data.admin === true && selfGrant.data.alias === 'jefe', `status=${selfGrant.status} ${JSON.stringify(selfGrant.data)}`);
    const ownerRow2 = await getUserRow(o.userId);
    check('el rango guardado ahora es admin', ownerRow2 && ownerRow2.rank === 'admin', JSON.stringify(ownerRow2));
    const profOwner = await req('GET', '/api/users/jefe/profile');
    check('el perfil del dueño ahora es admin con insignia Admin', profOwner.data.is_admin === true && profOwner.data.badge && profOwner.data.badge.key === 'admin', JSON.stringify(profOwner.data.badge));
    check('evento admin_granted registrado', (await countEvents('admin_granted')) >= 1);

    console.log('== Preparación: usuarios normales ==');
    const vic = { real_name: 'Vic Normal', alias: 'vic', password: 'clave123', email: 'vic@prueba.com' };
    const ana = { real_name: 'Ana Normal', alias: 'ana', password: 'clave123', email: 'ana@prueba.com' };
    const luis = { real_name: 'Luis Normal', alias: 'luis', password: 'clave123', email: 'luis@prueba.com' };
    const v = await registerAndLogin(vic);
    const a = await registerAndLogin(ana);
    const l = await registerAndLogin(luis);
    check('vic, ana y luis registrados y con sesión', Boolean(v.token) && Boolean(a.token) && Boolean(l.token));
    check('un usuario normal no es dueño (is_owner false)', l.register.data.user && l.register.data.user.is_owner === false, JSON.stringify(l.register.data.user));

    console.log('== Solo el dueño da admin ==');
    const noPerm = await req('POST', '/api/users/luis/admin', a.token, { admin: true });
    check('un usuario normal no puede dar admin (403)', noPerm.status === 403, `status=${noPerm.status}`);
    const missing = await req('POST', '/api/users/nadie/admin', o.token, { admin: true });
    check('dar admin a un alias que no existe da 404', missing.status === 404, `status=${missing.status}`);
    const grantVic = await req('POST', '/api/users/vic/admin', o.token, { admin: true });
    check('el dueño da admin a vic (200, admin: true)', grantVic.status === 200 && grantVic.data.admin === true && grantVic.data.alias === 'vic', `status=${grantVic.status} ${JSON.stringify(grantVic.data)}`);
    const grantAna = await req('POST', '/api/users/ana/admin', o.token, { admin: true });
    check('el dueño da admin a ana (200)', grantAna.status === 200 && grantAna.data.admin === true, `status=${grantAna.status}`);
    const profVic = await req('GET', '/api/users/vic/profile');
    check('vic ahora es admin con insignia Admin', profVic.data.is_admin === true && profVic.data.badge && profVic.data.badge.key === 'admin', JSON.stringify(profVic.data.badge));
    const vicGrant = await req('POST', '/api/users/luis/admin', v.token, { admin: true });
    check('un admin concedido NO puede dar admin (403)', vicGrant.status === 403, `status=${vicGrant.status}`);
    const vicRevoke = await req('POST', '/api/users/ana/admin', v.token, { admin: false });
    check('un admin concedido NO puede quitar admin (403)', vicRevoke.status === 403, `status=${vicRevoke.status}`);

    console.log('== Un admin concedido verifica, pero no inhabilita a otro admin ni al dueño ==');
    const vicVerify = await req('POST', '/api/users/luis/verify', v.token, { verified: true });
    check('un admin concedido sí puede verificar a un usuario (200)', vicVerify.status === 200 && vicVerify.data.verified === true, `status=${vicVerify.status} ${JSON.stringify(vicVerify.data)}`);
    const vicDisableAna = await req('POST', '/api/users/ana/disable', v.token, { disabled: true });
    check('un admin concedido NO puede inhabilitar a otro admin (409)', vicDisableAna.status === 409, `status=${vicDisableAna.status}`);
    const vicDisableOwner = await req('POST', '/api/users/jefe/disable', v.token, { disabled: true });
    check('un admin concedido NO puede inhabilitar al dueño (409)', vicDisableOwner.status === 409, `status=${vicDisableOwner.status}`);
    const ownerDisableAna = await req('POST', '/api/users/ana/disable', o.token, { disabled: true });
    check('el dueño SÍ puede inhabilitar a un admin concedido (200)', ownerDisableAna.status === 200 && ownerDisableAna.data.disabled === true, `status=${ownerDisableAna.status} ${JSON.stringify(ownerDisableAna.data)}`);
    const ownerEnableAna = await req('POST', '/api/users/ana/disable', o.token, { disabled: false });
    check('el dueño habilita de nuevo al admin concedido (200)', ownerEnableAna.status === 200 && ownerEnableAna.data.disabled === false, `status=${ownerEnableAna.status}`);

    console.log('== El dueño quita admin ==');
    const revokeAna = await req('POST', '/api/users/ana/admin', o.token, { admin: false });
    check('el dueño quita admin a ana (200, admin: false)', revokeAna.status === 200 && revokeAna.data.admin === false, `status=${revokeAna.status} ${JSON.stringify(revokeAna.data)}`);
    const anaRow = await getUserRow(a.userId);
    check('el rango guardado de ana vuelve a ser new', anaRow && anaRow.rank === 'new', JSON.stringify(anaRow));
    const profAna = await req('GET', '/api/users/ana/profile');
    check('ana ya no es admin en su perfil', profAna.data.is_admin === false, JSON.stringify(profAna.data));
    check('evento admin_revoked registrado', (await countEvents('admin_revoked')) >= 1);
    const selfRevoke = await req('POST', '/api/users/jefe/admin', o.token, { admin: false });
    check('el dueño NO puede quitarse su propio admin (409)', selfRevoke.status === 409, `status=${selfRevoke.status}`);
    const ownerRow3 = await getUserRow(o.userId);
    check('el dueño sigue siendo admin tras intentarlo', ownerRow3 && ownerRow3.rank === 'admin', JSON.stringify(ownerRow3));

    console.log('== is_owner en login y /me ==');
    const loginOwner = await req('POST', '/api/auth/login', undefined, { email: owner.email, password: owner.password });
    check('el login del dueño trae is_owner true e is_admin true', loginOwner.status === 200 && loginOwner.data.user.is_owner === true && loginOwner.data.user.is_admin === true, JSON.stringify(loginOwner.data.user));
    const loginLuis = await req('POST', '/api/auth/login', undefined, { email: luis.email, password: luis.password });
    check('el login de un usuario normal trae is_owner false', loginLuis.status === 200 && loginLuis.data.user.is_owner === false, JSON.stringify(loginLuis.data.user));
    const meOwner = await req('GET', '/api/auth/me', o.token);
    check('GET /api/auth/me del dueño trae is_owner true', meOwner.status === 200 && meOwner.data.user.is_owner === true, JSON.stringify(meOwner.data.user));
    const meUsers = await req('GET', '/api/users/me', o.token);
    check('GET /api/users/me del dueño trae is_owner true', meUsers.status === 200 && meUsers.data.user.is_owner === true, JSON.stringify(meUsers.data.user));

    console.log('== Cliente: botón de admin solo para el dueño ==');
    const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    check('app.js: botón Hacer admin / Quitar admin (profile-admin)', appJs.includes('profile-admin') && appJs.includes('Hacer admin') && appJs.includes('Quitar admin'), 'sin profile-admin');
    check('app.js: el botón solo se muestra si me.is_owner', appJs.includes('me.is_owner'), 'sin me.is_owner');
    check('app.js: llama a POST /api/users/:alias/admin', appJs.includes('/admin') && appJs.includes('admin: give'), 'sin llamada a /admin');
    check('app.js: el panel de solicitudes es solo del dueño (me.is_owner)', appJs.includes('me.is_owner') && appJs.includes('owner-verif-list'), 'sin panel del dueño');
  } finally {
    proc.kill('SIGTERM');
    fakeResend.close();
    await new Promise((r) => setTimeout(r, 500));
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }
  console.log(`\nResultado: ${pass} pasadas, ${fail} fallidas.`);
  if (failures.length) console.log('Fallidas:', failures.join(', '));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
