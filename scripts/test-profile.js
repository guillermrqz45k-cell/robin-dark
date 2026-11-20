// scripts/test-profile.js — pruebas de perfil, reputación, insignias y
// de mensajes directos de Robin Dark, contra SQLite local.
// Uso: node scripts/test-profile.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar),
// registra 2 usuarios + la cuenta del dueño, publica, sigue, escribe
// por mensajes directos y verifica perfil + insignias (Nuevo/Antiguo,
// Admin del dueño) + tiempo de respuesta. La reputación es social:
// antigüedad + publicaciones + seguidores + fiabilidad (contenidos
// quitados por moderación). NO toca el sitio público ni Railway.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3457;
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

async function waitHealth(proc) {
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

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET: 'secreto-de-pruebas-largo-1234567890',
    // Este test registra 12 usuarios: se sube el límite de
    // intentos de registro solo para la prueba (en producción
    // vale el valor por defecto, 10 / 15 min por IP).
    RATE_LIMIT_AUTH_MAX: '50',
  };
  delete env.DATABASE_URL;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('salud /api/health', await waitHealth(proc));

    console.log('== Registro ==');
    const author = await registerAndLogin({ real_name: 'Autor Uno', alias: 'autor1', email: 'autor1@example.com', password: 'secreto123' });
    check('registra autor y entra verificado', author.register.status === 201 && Boolean(author.token), JSON.stringify(author.register.data));
    const follower = await registerAndLogin({ real_name: 'Seguidor Uno', alias: 'seguidor1', email: 'seguidor1@example.com', password: 'secreto123' });
    check('registra seguidor y entra verificado', follower.register.status === 201 && Boolean(follower.token));
    const adminUser = await registerAndLogin({ real_name: 'Jefe', alias: 'jefe', email: 'jefe@example.com', password: 'secreto123' });
    check('registra la cuenta del dueño (alias de admin) y entra verificada', adminUser.register.status === 201 && Boolean(adminUser.token));
    const authorTok = author.token;
    const followerTok = follower.token;

    console.log('== Perfil público (sin sesión) ==');
    const prof0 = await req('GET', '/api/users/autor1/profile');
    check('perfil público sin token', prof0.status === 200);
    check('perfil no expone password_hash', prof0.status === 200 && !('password_hash' in prof0.data) && !JSON.stringify(prof0.data).includes('password_hash'));
    check('perfil nuevo: reputación 20 (0 días, 0 posts, 0 seguidores, 0 quitados)', prof0.data.reputation === 20, `reputación=${prof0.data.reputation}`);
    check('perfil nuevo: insignia Nuevo', prof0.data.badge && prof0.data.badge.key === 'nuevo');
    check('perfil nuevo: antigüedad "nuevo"', prof0.data.seniority === 'nuevo');
    check('perfil nuevo: Sin datos de respuesta', prof0.data.response_time === 'Sin datos' && prof0.data.response_minutes === null);
    check('perfil nuevo: 0 posts y 0 seguidores', prof0.data.posts_count === 0 && prof0.data.followers_count === 0);
    check('perfil nuevo: sin campos de tienda', !('active_listings' in prof0.data) && !('closed_total' in prof0.data) && !('cancelled' in prof0.data));
    const prof404 = await req('GET', '/api/users/noexiste123/profile');
    check('perfil de alias inexistente → 404', prof404.status === 404);
    const prof400 = await req('GET', '/api/users/a!/profile');
    check('perfil de alias no válido → 400', prof400.status === 400);

    console.log('== Publicar y reputación por actividad ==');
    async function publish(text) {
      return req('POST', '/api/social/posts', authorTok, { text });
    }
    let r = await publish('Mi primer post en Robin Dark.');
    check('publica 1 post', r.status === 201, JSON.stringify(r.data));
    const prof1 = await req('GET', '/api/users/autor1/profile');
    check('tras 1 post: posts = 1', prof1.data.posts_count === 1);
    check('tras 1 post: reputación 24 (0 + 4 + 0 + 20)', prof1.data.reputation === 24, `reputación=${prof1.data.reputation}`);
    check('tras 1 post: insignia sigue Nuevo', prof1.data.badge && prof1.data.badge.key === 'nuevo');
    r = await publish('Mi segundo post.');
    check('publica 2 posts', r.status === 201);
    r = await publish('Mi tercer post.');
    check('publica 3 posts', r.status === 201);
    const prof3 = await req('GET', '/api/users/autor1/profile');
    check('tras 3 posts: posts = 3', prof3.data.posts_count === 3);
    check('tras 3 posts: reputación 32 (0 + 12 + 0 + 20)', prof3.data.reputation === 32, `reputación=${prof3.data.reputation}`);
    check('tras 3 posts: insignia sigue Nuevo (menos de 30 días manda)', prof3.data.badge.key === 'nuevo', JSON.stringify(prof3.data.badge));

    console.log('== Seguir sube la reputación ==');
    r = await req('POST', '/api/social/follow/autor1', followerTok, {});
    check('seguidor1 sigue a autor1', r.status === 200 && r.data.following === true, JSON.stringify(r.data));
    const profF = await req('GET', '/api/users/autor1/profile');
    check('tras 1 seguidor: followers = 1', profF.data.followers_count === 1);
    check('tras 1 seguidor: reputación 34 (0 + 12 + 2 + 20)', profF.data.reputation === 34, `reputación=${profF.data.reputation}`);

    console.log('== Amigos (seguimiento mutuo) ==');
    r = await req('POST', '/api/social/follow/seguidor1', authorTok, {});
    check('autor1 sigue de vuelta a seguidor1', r.status === 200 && r.data.following === true, JSON.stringify(r.data));
    const profMutual = await req('GET', '/api/users/autor1/profile', followerTok);
    check('perfil con sesión: es amigo (mutuo)', profMutual.data.is_friend === true, JSON.stringify(profMutual.data));
    check('perfil con sesión: me sigue de vuelta', profMutual.data.is_followed_by === true);
    check('perfil con sesión: amigos en común contados', typeof profMutual.data.mutual_follows === 'number');
    const friends = await req('GET', '/api/users/autor1/friends', authorTok);
    check('lista de amigos trae a seguidor1', friends.status === 200 && (friends.data.friends || []).some((f) => f.alias === 'seguidor1'), JSON.stringify(friends.data));
    const anonChat = await req('POST', '/api/chat', null, { alias: 'autor1' });
    check('escribir sin sesión → 401', anonChat.status === 401);
    const chat = await req('POST', '/api/chat', followerTok, { alias: 'autor1' });
    check('seguidor abre el hilo con el autor', chat.status === 201 && chat.data.thread && chat.data.thread.id, JSON.stringify(chat.data));
    const threadId = chat.data.thread.id;
    const m1 = await req('POST', `/api/chat/${threadId}/messages`, followerTok, { body: 'Hola, me gustan tus posts.' });
    check('seguidor escribe', m1.status === 201);
    const threads = await req('GET', '/api/chat', authorTok);
    const mine = (threads.data.threads || []).find((t) => t.id === threadId);
    check('el autor ve el hilo con 1 sin leer', mine && mine.unread_count === 1 && threads.data.unread_total === 1, JSON.stringify(mine));
    const m2 = await req('POST', `/api/chat/${threadId}/messages`, authorTok, { body: '¡Gracias!' });
    check('autor responde', m2.status === 201);
    const m3 = await req('POST', `/api/chat/${threadId}/messages`, followerTok, { body: '¿Publicas mañana?' });
    check('seguidor responde de nuevo', m3.status === 201);
    const read = await req('GET', `/api/chat/${threadId}/messages`, authorTok);
    check('al abrir el hilo se marca leído', read.status === 200 && (read.data.messages || []).length === 3);

    console.log('== Tiempo de respuesta ==');
    const profAuthor = await req('GET', '/api/users/autor1/profile');
    check('autor tiene tiempo de respuesta medido', typeof profAuthor.data.response_minutes === 'number' && profAuthor.data.response_minutes >= 0, JSON.stringify(profAuthor.data.response_minutes));
    check('autor: tiempo con formato (no "Sin datos")', profAuthor.data.response_time !== 'Sin datos');
    const profFollower = await req('GET', '/api/users/seguidor1/profile');
    check('seguidor también tiene tiempo de respuesta medido', typeof profFollower.data.response_minutes === 'number' && profFollower.data.response_minutes >= 0);

    console.log('== Insignia especial de Admin del dueño ==');
    const profAdmin = await req('GET', '/api/users/jefe/profile');
    check('alias de admin: is_admin true', profAdmin.data.is_admin === true);
    check('alias de admin: insignia Admin', profAdmin.data.badge && profAdmin.data.badge.key === 'admin' && profAdmin.data.badge.label === 'Admin', JSON.stringify(profAdmin.data.badge));
    check('alias de admin: verificado (check azul)', profAdmin.data.verified === true);

    console.log('== Insignia Top (10 posts + 10 seguidores + 90 días) ==');
    // Envejecer la cuenta 100 días directamente en la base, para
    // probar el umbral de antigüedad sin esperar 90 días.
    const { DatabaseSync } = require('node:sqlite');
    const sqlite = new DatabaseSync(DB_FILE);
    sqlite.prepare("UPDATE users SET created_at = datetime('now', '-100 days') WHERE alias = 'autor1'").run();
    sqlite.close();
    for (let i = 0; i < 7; i += 1) {
      r = await publish(`Post número ${4 + i}.`);
      check(`post ${4 + i} publicado`, r.status === 201);
    }
    for (let i = 1; i <= 9; i += 1) {
      const fanTok = (await registerAndLogin({ real_name: `Fan ${i}`, alias: `fan${i}`, email: `fan${i}@example.com`, password: 'secreto123' })).token;
      check(`registra fan${i} y entra verificado`, Boolean(fanTok));
      r = await req('POST', '/api/social/follow/autor1', fanTok, {});
      check(`fan${i} sigue a autor1`, r.status === 200);
    }
    const profTop = await req('GET', '/api/users/autor1/profile');
    check('tras 10 posts: posts = 10', profTop.data.posts_count === 10);
    check('tras 10 seguidores: followers = 10', profTop.data.followers_count === 10);
    check('tras 100 días: antigüedad >= 90', profTop.data.member_days >= 90, `días=${profTop.data.member_days}`);
    check('Top: reputación 100 (20 + 40 + 20 + 20)', profTop.data.reputation === 100, `reputación=${profTop.data.reputation}`);
    check('Top: insignia Top', profTop.data.badge.key === 'top', JSON.stringify(profTop.data.badge));
    check('Top: antigüedad "antiguo" (marco dorado)', profTop.data.seniority === 'antiguo', `seniority=${profTop.data.seniority}`);

    console.log('== Moderación: contenido marcado, sin panel ni revisión ==');
    // Sin panel de admin ya no hay revisión: el contenido marcado
    // se publica y queda visible; la reputación solo baja si un
    // contenido llega a rechazarse (fórmula unitaria, abajo).
    const noAdmin = await req('POST', '/api/admin/login', null, { alias: 'jefe', password: 'clave-admin-de-pruebas' });
    check('sin panel de admin: /api/admin/login → 404', noAdmin.status === 404, JSON.stringify(noAdmin.data));
    const flagged = await publish('Mira mi página https://ejemplo.com, ahí está todo.');
    check('post con enlace se publica marcado', flagged.status === 201 && flagged.data.moderated === true, JSON.stringify(flagged.data));
    const profFlagged = await req('GET', '/api/users/autor1/profile');
    check('sin rechazo: removed_by_moderation = 0', profFlagged.data.removed_by_moderation === 0);
    check('sin rechazo: reputación sigue en 100', profFlagged.data.reputation === 100, `reputación=${profFlagged.data.reputation}`);
    const { computeReputation, badgeFor } = require('../src/reputation');
    check('fórmula: 1 quitado baja 10 (100 → 90)', computeReputation({ days: 100, posts: 10, followers: 10, rejected: 1 }) === 90);
    check('fórmula: con 1 quitado la insignia Top se mantiene (10 posts + 90 días)', badgeFor({ days: 100, posts: 10, rejected: 1 }).key === 'top');
    check('fórmula: con 1 quitado y 5 posts no hay Confiable', badgeFor({ days: 100, posts: 5, rejected: 1 }).key === 'miembro');

    console.log('== Cliente: sin tienda, con mensajes, perfil, insignias y compartir ==');
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
    check('html: existe #auth-notice', html.includes('id="auth-notice"'));
    check('html: sin "Contactar al vendedor" (ya no hay tienda)', !html.includes('Contactar al vendedor'));
    check('html: sin vista de admin (no hay panel)', !html.includes('id="view-admin"') && !html.includes('view-admin'));
    check('app.js: sin llamadas a la tienda', !appJs.includes('/api/listings') && !appJs.includes('/api/orders'));
    check('app.js: sin BTC ni escrow', !appJs.includes('BTC') && !appJs.includes('escrow') && !appJs.includes('price_sats'));
    check('app.js: sin rangos ni panel de admin', !appJs.includes('rankBadgesHtml') && !appJs.includes('/api/admin') && !appJs.includes('rank-'));
    check('app.js: insignias con badgeHtml (Admin + verificado)', appJs.includes('function badgeHtml') && appJs.includes('badge-verificado') && appJs.includes('adminBadgeHtml') && appJs.includes("author.is_admin") && appJs.includes('author.verified'));
    check('app.js: perfil con antigüedad (Nuevo/Antiguo)', appJs.includes('p.seniority') && appJs.includes('profile-antiguo') && appJs.includes('badge-antiguo'));
    check('app.js: menú de compartir en las publicaciones', appJs.includes('shareMenu') && appJs.includes('Compartir en tu historia') && appJs.includes('Copiar enlace') && appJs.includes('Compartir fuera de la app'));
    check('app.js: amigos y amigos en común', appJs.includes('is_friend') && appJs.includes('mutual_follows') && appJs.includes('/friends'));
    check('app.js: usa /api/chat (mensajes directos)', appJs.includes('/api/chat'));
    check('app.js: abre el perfil con openProfile', appJs.includes('openProfile('));
    check('app.js: chat en vivo con polling y badge (#chat-badge, setInterval)',
      appJs.includes('pollChat') && appJs.includes("$('#chat-badge')") && appJs.includes('CHAT_POLL_MS'));
    check('app.js: sin alert() al abrir el chat', (() => {
      const fnStart = appJs.indexOf('async function openChat');
      if (fnStart < 0) return false;
      const fnBody = appJs.slice(fnStart, appJs.indexOf('\n}\n', fnStart));
      return fnBody.length > 0 && !fnBody.includes('alert(');
    })());
    check('app.js: foco en el input al abrir el chat', appJs.includes('input.focus()'));
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
