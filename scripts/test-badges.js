// scripts/test-badges.js — pruebas de insignias y reglas nuevas de
// Robin Dark (sin rangos ni panel de admin), contra SQLite local.
// Uso: node scripts/test-badges.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y verifica: insignia «Nuevo» los primeros 30 días y marco
// dorado «Antiguo» a partir de los 90 días (según created_at),
// insignia especial «Admin» + ✓ Verificado solo para la cuenta
// del dueño (alias = ADMIN_ALIAS), sin rutas /api/admin (todo 404),
// verificación con documento con puerta de 500 amigos o
// seguidores (409 si no llega, 201 si llega, la aprueba el dueño
// desde su propio perfil), amigos (seguimiento mutuo, listas y
// amigos en común), muro del grupo y Compartir con contador, y
// que las tarjetas de autor ya no llevan rangos. NO toca el sitio
// público ni Railway.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3462;
const BASE = `http://127.0.0.1:${PORT}`;

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

// El registro ya NO devuelve token de sesión: la entrada queda
// bloqueada hasta confirmar el correo. Para las pruebas, el
// correo se marca verificado directo en la base de pruebas y
// luego se entra con correo + contraseña. El flujo de
// verificación en sí lo cubre test-auth-realname.js.
async function markEmailVerified(userId) {
  const { DatabaseSync } = require('node:sqlite');
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

// PNG 1x1 para la foto del documento.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET: 'secreto-de-pruebas-largo-1234567890',
    RATE_LIMIT_AUTH_MAX: '50',
  };
  delete env.DATABASE_URL;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Registro ==');
    const owner = await registerAndLogin({ real_name: 'Jefe', alias: 'jefe', email: 'jefe@example.com', password: 'clave12345' });
    check('registra al dueño (jefe) y entra verificado', owner.register.status === 201 && Boolean(owner.token), JSON.stringify(owner.register.data));
    const ownerTok = owner.token;
    // El dueño ya no nace admin: se hace admin con el nuevo
    // endpoint (solo el dueño puede dar admin, y en una base
    // limpia el dueño se lo da a sí mismo).
    const grant = await req('POST', '/api/users/jefe/admin', ownerTok, { admin: true });
    check('el dueño se hace admin con el nuevo endpoint', grant.status === 200 && grant.data.admin === true, JSON.stringify(grant.data));
    const a = await registerAndLogin({ real_name: 'Nueva Uno', alias: 'nueva1', email: 'nueva1@example.com', password: 'clave12345' });
    check('registra a nueva1 y entra verificada', a.register.status === 201 && Boolean(a.token));
    const tokA = a.token;
    const b = await registerAndLogin({ real_name: 'Amiga Uno', alias: 'amiga1', email: 'amiga1@example.com', password: 'clave12345' });
    check('registra a amiga1 y entra verificada', b.register.status === 201 && Boolean(b.token));
    const tokB = b.token;

    console.log('== Insignia Nuevo (< 30 días) ==');
    let r = await req('GET', '/api/users/nueva1/profile');
    check('perfil nuevo: badge Nuevo', r.data.badge && r.data.badge.key === 'nuevo' && r.data.badge.label === 'Nuevo', JSON.stringify(r.data.badge));
    check('perfil nuevo: seniority nuevo', r.data.seniority === 'nuevo');
    check('perfil nuevo: member_days < 30', typeof r.data.member_days === 'number' && r.data.member_days < 30);
    check('perfil nuevo: no es admin ni verificado', r.data.is_admin === false && r.data.verified === false);

    console.log('== Sin rangos en las tarjetas de autor ==');
    r = await req('POST', '/api/social/posts', tokA, { text: 'Hola, soy nueva por aquí.' });
    check('publica un post', r.status === 201, JSON.stringify(r.data));
    const postId = r.data.post.id;
    r = await req('GET', `/api/social/posts/${postId}`, tokA);
    check('autor del post: is_admin + verified, sin rank', r.data.post.author
      && 'is_admin' in r.data.post.author && 'verified' in r.data.post.author
      && !('rank' in r.data.post.author) && !('rank_badges' in r.data.post.author), JSON.stringify(r.data.post.author));
    r = await req('GET', '/api/users?search=nueva1', tokB);
    check('buscar miembros: tarjeta sin rank', r.status === 200 && r.data.users.length === 1
      && !('rank' in r.data.users[0]) && !('rank_badges' in r.data.users[0]), JSON.stringify(r.data.users));

    console.log('== Insignia Admin del dueño ==');
    r = await req('GET', '/api/users/jefe/profile');
    check('dueño: is_admin true', r.data.is_admin === true);
    check('dueño: badge Admin', r.data.badge && r.data.badge.key === 'admin' && r.data.badge.label === 'Admin', JSON.stringify(r.data.badge));
    check('dueño: verificado (check azul)', r.data.verified === true);
    r = await req('GET', '/api/users/me', ownerTok);
    check('GET /me del dueño: is_admin true, sin rank', r.data.user.is_admin === true && !('rank' in r.data.user), JSON.stringify(r.data.user));

    console.log('== Marco Antiguo (>= 90 días) ==');
    const { DatabaseSync } = require('node:sqlite');
    const sqlite = new DatabaseSync(DB_FILE);
    sqlite.prepare("UPDATE users SET created_at = datetime('now', '-100 days') WHERE alias = 'nueva1'").run();
    sqlite.close();
    r = await req('GET', '/api/users/nueva1/profile');
    check('tras 100 días: member_days >= 90', r.data.member_days >= 90, `días=${r.data.member_days}`);
    check('tras 100 días: seniority antiguo', r.data.seniority === 'antiguo');
    check('tras 100 días: badge ya no es Nuevo', r.data.badge.key !== 'nuevo', JSON.stringify(r.data.badge));

    console.log('== Sin panel de admin ==');
    r = await req('POST', '/api/admin/login', undefined, { real_name: 'Jefe', alias: 'jefe', email: 'jefe@example.com', password: 'clave12345' });
    check('/api/admin/login -> 404', r.status === 404);
    r = await req('GET', '/api/admin/stats', ownerTok);
    check('/api/admin/stats -> 404', r.status === 404);
    r = await req('GET', '/api/admin/users', ownerTok);
    check('/api/admin/users -> 404', r.status === 404);
    r = await req('GET', '/api/admin/moderation', ownerTok);
    check('/api/admin/moderation -> 404', r.status === 404);
    r = await req('GET', '/api/admin/verification-requests', ownerTok);
    check('/api/admin/verification-requests -> 404', r.status === 404);

    console.log('== Amigos y amigos en común ==');
    r = await req('POST', '/api/social/follow/amiga1', tokA, {});
    check('nueva1 sigue a amiga1', r.status === 200 && r.data.following === true);
    r = await req('POST', '/api/social/follow/nueva1', tokB, {});
    check('amiga1 sigue de vuelta', r.status === 200 && r.data.following === true);
    r = await req('GET', '/api/users/nueva1/profile', tokB);
    check('perfil: es amigo (mutuo)', r.data.is_friend === true, JSON.stringify(r.data));
    check('perfil: mutual_follows es número', typeof r.data.mutual_follows === 'number');
    r = await req('GET', '/api/users/nueva1/friends', tokA);
    check('lista de amigos de nueva1 trae a amiga1', r.status === 200
      && (r.data.friends || []).some((f) => f.alias === 'amiga1'), JSON.stringify(r.data));
    r = await req('GET', '/api/users/amiga1/friends', tokB);
    check('lista de amigos de amiga1 trae a nueva1', r.status === 200
      && (r.data.friends || []).some((f) => f.alias === 'nueva1'), JSON.stringify(r.data));
    r = await req('GET', '/api/users/nueva1/followers', tokA);
    check('seguidores de nueva1: 1 (amiga1)', r.data.followers.length === 1 && r.data.followers[0].alias === 'amiga1', JSON.stringify(r.data));

    console.log('== Compartir con contador ==');
    r = await req('POST', `/api/social/posts/${postId}/share`, tokB, {});
    check('compartir -> shares 1', r.status === 200 && r.data.shares === 1, JSON.stringify(r.data));
    r = await req('GET', `/api/social/posts/${postId}`, tokB);
    check('el post muestra shares 1', r.data.post.shares === 1, JSON.stringify(r.data));

    console.log('== Muro del grupo ==');
    r = await req('POST', '/api/social/groups', tokA, { name: 'Grupo de badges', description: 'Para probar el muro' });
    check('crear grupo -> 201', r.status === 201, JSON.stringify(r.data));
    const groupId = r.data.group.id;
    r = await req('POST', `/api/social/groups/${groupId}/join`, tokB, {});
    check('amiga1 se une', r.status === 200 && r.data.joined === true);
    r = await req('POST', `/api/social/groups/${groupId}/posts`, tokB, { text: 'Publicación del muro.' });
    check('publicar en el muro -> 201', r.status === 201 && r.data.post.text === 'Publicación del muro.', JSON.stringify(r.data));
    r = await req('GET', `/api/social/groups/${groupId}/posts`, tokA);
    check('el muro lista la publicación con su autor', r.status === 200 && r.data.posts.length === 1
      && r.data.posts[0].author.alias === 'amiga1' && 'is_admin' in r.data.posts[0].author, JSON.stringify(r.data));

    console.log('== Verificación con documento (puerta de 500) ==');
    r = await req('POST', '/api/users/me/verification', tokA, { real_name: 'Nueva Uno', document: { mime: 'image/png', data: PNG_1X1 } });
    check('con 1 seguidor -> 409 con puerta 500', r.status === 409 && r.data.required === 500
      && r.data.followers_count === 1 && r.data.following_count === 1, JSON.stringify(r.data));
    // 500 seguidores directos en la base (por la API serían
    // lentos por bcrypt): la puerta se mide con datos reales.
    const db2 = new DatabaseSync(DB_FILE);
    const me = db2.prepare("SELECT id FROM users WHERE alias = 'nueva1'").get();
    const insertUser = db2.prepare("INSERT INTO users (alias, password_hash, created_at) VALUES (?, ?, datetime('now'))");
    const insertFollow = db2.prepare("INSERT INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, datetime('now'))");
    db2.exec('BEGIN');
    for (let i = 0; i < 500; i += 1) {
      const fan = insertUser.run(`seguidor500_${i}`, 'x');
      insertFollow.run(Number(fan.lastInsertRowid), me.id);
    }
    db2.exec('COMMIT');
    db2.close();
    r = await req('POST', '/api/users/me/verification', tokA, { real_name: 'Nueva Uno', document: { mime: 'image/png', data: PNG_1X1 } });
    check('con 500+ seguidores la solicitud -> 201', r.status === 201, JSON.stringify(r.data));
    r = await req('POST', '/api/users/me/verification', tokA, { real_name: 'Nueva Uno', document: { mime: 'image/png', data: PNG_1X1 } });
    check('solicitud pendiente duplicada -> 409', r.status === 409);
    r = await req('GET', '/api/users/me/verification-requests', ownerTok);
    check('el dueño ve la solicitud en su perfil', r.status === 200 && r.data.requests.length === 1
      && r.data.requests[0].user_alias === 'nueva1' && r.data.requests[0].status === 'pending', JSON.stringify(r.data));
    const verifId = r.data.requests[0].id;
    r = await req('POST', `/api/users/me/verification-requests/${verifId}/approve`, ownerTok, { note: 'Todo en orden' });
    check('el dueño aprueba -> 200', r.status === 200, JSON.stringify(r.data));
    r = await req('GET', '/api/users/nueva1/profile');
    check('la usuaria queda verificada', r.data.verified === true, JSON.stringify(r.data));
    r = await req('GET', '/api/users/me/verification-requests?status=pending', ownerTok);
    check('tras aprobar, no quedan pendientes', r.status === 200 && r.data.requests.length === 0, JSON.stringify(r.data));
    r = await req('GET', '/api/users/me/verification-requests', ownerTok);
    check('la lista completa muestra la aprobada', r.status === 200 && r.data.requests.length === 1 && r.data.requests[0].status === 'approved', JSON.stringify(r.data));
    r = await req('POST', '/api/users/me/verification', ownerTok, { real_name: 'Jefe', document: { mime: 'image/png', data: PNG_1X1 } });
    check('el dueño ya es verificado: no necesita solicitarlo -> 409', r.status === 409, JSON.stringify(r.data));
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }

  console.log(`\nResultado: ${pass} pasadas, ${fail} fallidas.`);
  if (failures.length) console.log(`Fallidas: ${failures.join(' | ')}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
