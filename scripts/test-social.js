// scripts/test-social.js — pruebas de la red social + IA propia de
// Robin Dark, contra SQLite local.
// Uso: node scripts/test-social.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y verifica: registro con nombre real + correo (sin token hasta
// verificar el correo) y login solo por correo bloqueado con 403
// hasta confirmar el correo, recuperación genérica sin llave
// Resend, foto de avatar (subida
// y lectura, documento privado que otro usuario no puede abrir),
// posts con moderación (insulto -> 422, pago externo -> se publica
// marcado y queda visible, no hay cola de revisión), feed Para ti /
// Siguiendo, like y comentario, seguir, historias 24h (agrupadas
// por autor), reels, tendencias y explorar, IA por reglas
// (preguntas de vender y de escrow, recomendaciones vacías sin
// actividad), valoraciones con estrellas, perfil público con bio,
// avatar y seguidores, verificación con documento con puerta de
// 500 amigos o seguidores (409 si no llega, aprobación del dueño
// desde su propio perfil -> verificado), sin panel de admin
// (rutas /api/admin/* -> 404), reacciones 👍/❤️/😮
// (quitar con la misma, cambiar con otra, tipo no válido -> 400),
// Compartir con contador, sentimiento del compositor y
// notificaciones de la campana (reacción, comentario y seguir,
// marcar vistas -> 0 sin ver), y que las rutas sociales y de IA
// exigen sesión. NO toca el sitio público ni Railway.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3460;
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

// PNG 1x1 para las pruebas de fotos.
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET: 'secreto-de-pruebas-largo-1234567890',
    // Se sube el límite de intentos de registro/login solo para la
    // prueba (en producción vale el valor por defecto, 10 / 15 min).
    RATE_LIMIT_AUTH_MAX: '50',
  };
  delete env.DATABASE_URL;
  delete env.RESEND_API_KEY;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Registro y login con correo ==');
    let r = await req('GET', '/api/auth/config');
    check('config: recuperación por correo apagada sin llave', r.status === 200 && r.data.email_recovery === false && r.data.email_verification === false, JSON.stringify(r.data));
    // prueba1 se registra directo (sin el helper) para comprobar
    // la puerta: el registro no da token y el login queda
    // bloqueado hasta verificar el correo.
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Prueba Uno', alias: 'prueba1', password: 'clave12345', email: 'prueba1@example.com' });
    check('registro con nombre real + correo -> 201', r.status === 201, JSON.stringify(r.data));
    check('registro devuelve el correo y el nombre real', r.data.user && r.data.user.email === 'prueba1@example.com' && r.data.user.real_name === 'Prueba Uno');
    check('registro sin llave Resend: código no enviado', r.data.email_verification && r.data.email_verification.code_sent === false, JSON.stringify(r.data));
    check('registro NO devuelve token (sin sesión hasta verificar)', !r.data.token, JSON.stringify(r.data));
    check('registro deja el correo sin verificar', r.data.user && r.data.user.email_verified === false, JSON.stringify(r.data.user));
    const prueba1Id = r.data.user.id;
    r = await req('GET', '/api/users/me');
    check('sin token no hay sesión (GET /me -> 401)', r.status === 401, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/login', undefined, { email: 'prueba1@example.com', password: 'clave12345' });
    check('login por correo sin verificar -> 403 (bloqueado hasta confirmar el correo)', r.status === 403
      && r.data.code === 'email_verification_required', JSON.stringify(r.data));
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Prueba Uno', alias: 'prueba1', password: 'clave12345', email: 'otro@example.com' });
    check('alias duplicado -> 409', r.status === 409);
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Prueba Dos', alias: 'prueba2', password: 'clave12345', email: 'prueba1@example.com' });
    check('correo duplicado -> 409', r.status === 409);
    r = await req('POST', '/api/auth/register', undefined, { real_name: 'Prueba Dos', alias: 'prueba2', password: 'clave12345' });
    check('registro sin correo -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', '/api/auth/register', undefined, { alias: 'prueba2', password: 'clave12345', email: 'prueba2@example.com' });
    check('registro sin nombre real -> 400', r.status === 400, JSON.stringify(r.data));
    const u2 = await registerAndLogin({ real_name: 'Prueba Dos', alias: 'prueba2', password: 'clave12345', email: 'prueba2@example.com' });
    check('registro de prueba2 -> 201', u2.register.status === 201, JSON.stringify(u2.register.data));
    const tok2 = u2.token;
    check('prueba1 verifica el correo en la base de pruebas', await markEmailVerified(prueba1Id));
    const login1 = await req('POST', '/api/auth/login', undefined, { email: 'prueba1@example.com', password: 'clave12345' });
    check('tras verificar, prueba1 entra con correo y contraseña', login1.status === 200 && Boolean(login1.data.token), JSON.stringify(login1.data));
    const tok1 = login1.data.token;
    r = await req('POST', '/api/auth/login', undefined, { login: 'prueba2', password: 'clave12345' });
    check('login con alias (forma vieja) -> 400: no hay login por alias', r.status === 400, JSON.stringify(r.data));
    r = await req('GET', '/api/users/me', tok1);
    check('GET /me trae correo, nombre real y contadores en 0', r.status === 200 && r.data.user.email === 'prueba1@example.com'
      && r.data.user.real_name === 'Prueba Uno' && r.data.user.email_verified === true
      && r.data.user.followers_count === 0 && r.data.user.following_count === 0, JSON.stringify(r.data));
    r = await req('GET', '/api/users/prueba1/profile');
    check('perfil público muestra el nombre real', r.status === 200 && r.data.real_name === 'Prueba Uno' && r.data.alias === 'prueba1', JSON.stringify(r.data));
    r = await req('POST', '/api/auth/forgot', undefined, { email: 'prueba1@example.com' });
    check('forgot sin llave Resend -> 200 genérico', r.status === 200 && r.data.ok === true);
    r = await req('POST', '/api/auth/forgot', undefined, { email: 'nadie@example.com' });
    check('forgot con correo inexistente -> mismo 200 genérico', r.status === 200 && r.data.ok === true);

    console.log('== Foto de avatar ==');
    r = await req('PATCH', '/api/users/me/profile', tok1, { bio: 'Hola, vendo de todo.', avatar: { mime: 'image/png', data: PNG_1X1 } });
    check('PATCH perfil con avatar -> 200', r.status === 200, JSON.stringify(r.data));
    check('perfil guarda bio y avatar_url', r.data.user && r.data.user.bio === 'Hola, vendo de todo.'
      && r.data.user.avatar_url && r.data.user.avatar_url.startsWith('/api/photos/'), JSON.stringify(r.data));
    const avatarUrl = r.data.user.avatar_url;
    const pic = await fetch(BASE + avatarUrl);
    check('la foto del avatar se sirve como image/png', pic.status === 200 && pic.headers.get('content-type') === 'image/png', `status ${pic.status}`);

    console.log('== Posts y moderación ==');
    r = await req('POST', '/api/social/posts', tok1, { text: 'Hola, este es mi primer post en Robin Dark.' });
    check('publicar post -> 201', r.status === 201, JSON.stringify(r.data));
    const postId = r.data.post.id;
    r = await req('POST', '/api/social/posts', tok1, { text: 'Eres un maldito estafador, hijo de puta.' });
    check('insulto -> 422 con motivo', r.status === 422 && Boolean(r.data.error), JSON.stringify(r.data));
    r = await req('POST', '/api/social/posts', tok1, { text: 'Mira mi página https://ejemplo.com, ahí está todo.' });
    check('enlace externo -> 201 y moderated=true', r.status === 201 && r.data.moderated === true, JSON.stringify(r.data));
    const flaggedPostId = r.data.post.id;
    r = await req('GET', '/api/social/feed?tab=para_ti', tok1);
    check('feed Para ti trae el post', r.status === 200 && r.data.posts.some((p) => p.id === postId), JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, {});
    check('like -> 200 y liked=true', r.status === 200 && r.data.liked === true, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/comments`, tok2, { text: '¡Bienvenido!' });
    check('comentario -> 201', r.status === 201, JSON.stringify(r.data));
    r = await req('GET', `/api/social/posts/${postId}`, tok1);
    check('el post cuenta 1 like y 1 comentario', r.data.post.likes_count === 1 && r.data.post.comments_count === 1, JSON.stringify(r.data));

    console.log('== Seguir, historias, reels, tendencias ==');
    r = await req('POST', '/api/social/follow/prueba1', tok2, {});
    check('seguir -> 200 y following=true', r.status === 200 && r.data.following === true, JSON.stringify(r.data));
    r = await req('GET', '/api/users/prueba1/followers', tok1);
    check('seguidores de prueba1: 1 (prueba2)', r.data.followers.length === 1 && r.data.followers[0].alias === 'prueba2', JSON.stringify(r.data));
    r = await req('GET', '/api/social/feed?tab=siguiendo', tok2);
    check('feed Siguiendo trae el post', r.status === 200 && r.data.posts.some((p) => p.id === postId), JSON.stringify(r.data));
    r = await req('POST', '/api/social/stories', tok1, { kind: 'story', text: 'Mi historia de hoy' });
    check('historia de texto -> 201', r.status === 201, JSON.stringify(r.data));
    const storyId = r.data.story.id;
    r = await req('GET', '/api/social/stories', tok1);
    check('historias agrupadas por autor', r.status === 200 && r.data.groups.some((g) => g.stories.some((x) => x.id === storyId)), JSON.stringify(r.data));
    r = await req('GET', '/api/social/reels', tok1);
    check('reels -> 200 con lista', r.status === 200 && Array.isArray(r.data.reels), JSON.stringify(r.data));
    r = await req('GET', '/api/social/trends', tok1);
    check('tendencias -> hashtags y sugeridos', r.status === 200 && Array.isArray(r.data.hashtags) && Array.isArray(r.data.suggested_users), JSON.stringify(r.data));
    r = await req('GET', '/api/social/explore', tok1);
    check('explorar trae posts', r.status === 200 && r.data.posts.length >= 1, JSON.stringify(r.data));

    console.log('== IA propia ==');
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Cómo vendo un producto?' });
    check('IA: vender -> dice que ya no hay tienda', r.status === 200 && r.data.answer && /ya no tiene tienda/i.test(r.data.answer), JSON.stringify(r.data));
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Qué es el escrow?' });
    check('IA: escrow -> dice que ya no hay tienda', r.status === 200 && /ya no tiene tienda/i.test(r.data.answer), JSON.stringify(r.data));
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Quién es el admin?' });
    check('IA: admin -> habla del dueño y su insignia', r.status === 200 && /Admin/i.test(r.data.answer) && /dueño/i.test(r.data.answer), JSON.stringify(r.data));
    r = await req('GET', '/api/ai/recommendations', tok1);
    check('IA: recomendaciones sin actividad -> lista', r.status === 200 && Array.isArray(r.data.recommendations), JSON.stringify(r.data));

    console.log('== Valoraciones y perfil público ==');
    r = await req('POST', '/api/users/prueba1/rate', tok2, { stars: 5 });
    check('valorar con 5 estrellas -> 200', r.status === 200 && r.data.avg_stars === 5, JSON.stringify(r.data));
    r = await req('GET', '/api/users/prueba1/profile');
    check('perfil público: bio, avatar, seguidores y estrellas', r.data.bio === 'Hola, vendo de todo.'
      && r.data.avatar_url && r.data.avatar_url.startsWith('/api/photos/')
      && r.data.followers_count === 1 && r.data.posts_count === 2
      && r.data.avg_stars === 5 && r.data.ratings_count === 1, JSON.stringify(r.data));

    console.log('== Reacciones, compartir, sentimiento y notificaciones ==');
    // El post ya tiene 1 like (👍) de prueba2 de la sección anterior.
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, { kind: 'like' });
    check('mismo like otra vez lo quita', r.status === 200 && r.data.liked === false && r.data.my_reaction === null && r.data.reactions.like === 0, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, { kind: 'love' });
    check('love -> my_reaction love, 1 love y 0 like', r.status === 200 && r.data.liked === true && r.data.my_reaction === 'love' && r.data.reactions.love === 1 && r.data.reactions.like === 0, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, { kind: 'wow' });
    check('wow cambia el tipo (1 wow, 0 love)', r.status === 200 && r.data.my_reaction === 'wow' && r.data.reactions.wow === 1 && r.data.reactions.love === 0, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, { kind: 'banana' });
    check('reacción no válida -> 400', r.status === 400, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, { kind: 'wow' });
    check('mismo wow otra vez lo quita', r.status === 200 && r.data.liked === false && r.data.my_reaction === null, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/like`, tok2, {});
    check('like sin tipo es 👍', r.status === 200 && r.data.liked === true && r.data.my_reaction === 'like' && r.data.reactions.like === 1, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/share`, tok2, {});
    check('compartir -> shares 1', r.status === 200 && r.data.shares === 1, JSON.stringify(r.data));
    r = await req('POST', `/api/social/posts/${postId}/share`, tok2, {});
    check('compartir otra vez -> shares 2', r.status === 200 && r.data.shares === 2, JSON.stringify(r.data));
    r = await req('GET', `/api/social/posts/${postId}`, tok2);
    check('el post muestra shares 2, reactions y my_reaction', r.data.post.shares === 2 && r.data.post.reactions.like === 1 && r.data.post.my_reaction === 'like' && r.data.post.likes_count === 1, JSON.stringify(r.data));
    r = await req('POST', '/api/social/posts', tok1, { text: 'Hoy es un buen día.', feeling: '😊 se siente feliz' });
    check('post con sentimiento -> 201 y feeling guardado', r.status === 201 && r.data.post.feeling === '😊 se siente feliz', JSON.stringify(r.data));
    r = await req('GET', '/api/social/notifications', tok1);
    check('notificaciones de prueba1: like, comentario y seguir (3 sin ver)', r.status === 200 && r.data.unread === 3
      && ['like', 'comment', 'follow'].every((k) => r.data.notifications.some((n) => n.kind === k)), JSON.stringify(r.data));
    r = await req('GET', '/api/social/notifications', undefined);
    check('notificaciones sin token -> 401', r.status === 401);
    r = await req('POST', '/api/social/notifications/seen', tok1, {});
    check('marcar vistas -> 200', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    r = await req('GET', '/api/social/notifications', tok1);
    check('tras marcar vistas: 3 notificaciones, 0 sin ver', r.status === 200 && r.data.notifications.length === 3 && r.data.unread === 0, JSON.stringify(r.data));
    r = await req('GET', '/api/users?search=prueba1', tok2);
    check('buscar miembros por alias: encuentra prueba1 con tarjeta de autor', r.status === 200 && r.data.users.length === 1 && r.data.users[0].alias === 'prueba1' && 'is_admin' in r.data.users[0] && 'verified' in r.data.users[0], JSON.stringify(r.data));
    r = await req('GET', '/api/users?search=prueba1', tok1);
    check('buscar miembros no se incluye a uno mismo', r.status === 200 && r.data.users.length === 0, JSON.stringify(r.data));
    r = await req('GET', '/api/users?search=zzzznadie', tok2);
    check('buscar miembros sin coincidencias: lista vacía', r.status === 200 && r.data.users.length === 0, JSON.stringify(r.data));
    r = await req('GET', '/api/users?search=prueba1', undefined);
    check('buscar miembros sin token -> 401', r.status === 401);

    console.log('== Sesión obligatoria ==');
    r = await req('POST', '/api/social/posts', undefined, { text: 'sin token' });
    check('publicar sin token -> 401', r.status === 401);
    r = await req('POST', '/api/ai/ask', undefined, { question: 'hola' });
    check('preguntar a la IA sin token -> 401', r.status === 401);

    console.log('== Verificación con documento (puerta de 500) ==');
    r = await req('POST', '/api/users/me/verification', tok1, { real_name: 'Prueba Uno', document: { mime: 'image/png', data: PNG_1X1 } });
    check('con 1 seguidor no llega a 500 -> 409 con conteos', r.status === 409 && r.data.required === 500 && r.data.followers_count === 1, JSON.stringify(r.data));
    // Darle 500 seguidores directos en la base (500 registros por
    // la API serían lentos por bcrypt): la puerta se mide con
    // datos reales de follows.
    const { DatabaseSync } = require('node:sqlite');
    const sqlite = new DatabaseSync(DB_FILE);
    const me = sqlite.prepare("SELECT id FROM users WHERE alias = 'prueba1'").get();
    const insertUser = sqlite.prepare("INSERT INTO users (alias, password_hash, created_at) VALUES (?, ?, datetime('now'))");
    const insertFollow = sqlite.prepare("INSERT INTO follows (follower_id, followed_id, created_at) VALUES (?, ?, datetime('now'))");
    sqlite.exec('BEGIN');
    for (let i = 0; i < 500; i += 1) {
      const fan = insertUser.run(`fan500_${i}`, 'x');
      insertFollow.run(Number(fan.lastInsertRowid), me.id);
    }
    sqlite.exec('COMMIT');
    sqlite.close();
    r = await req('POST', '/api/users/me/verification', tok1, { real_name: 'Prueba Uno', document: { mime: 'image/png', data: PNG_1X1 } });
    check('con 500+ seguidores la solicitud -> 201', r.status === 201, JSON.stringify(r.data));
    r = await req('POST', '/api/users/me/verification', tok1, { real_name: 'Prueba Uno', document: { mime: 'image/png', data: PNG_1X1 } });
    check('segunda solicitud pendiente -> 409', r.status === 409);
    r = await req('GET', '/api/users/me/verification', tok1);
    check('mi solicitud trae document_url propia', r.data.request && Boolean(r.data.request.document_url), JSON.stringify(r.data));
    const docUrl = r.data.request.document_url;
    const otherDoc = await fetch(BASE + docUrl, { headers: { Authorization: `Bearer ${tok2}` } });
    check('otro usuario NO puede abrir mi documento (403)', otherDoc.status === 403, `status ${otherDoc.status}`);

    console.log('== Dueño: aprueba la verificación desde su perfil ==');
    // La cuenta del dueño (alias = ADMIN_ALIAS) entra como un
    // usuario más; no hay login de admin ni panel.
    const owner = await registerAndLogin({ real_name: 'Jefe', alias: 'jefe', email: 'jefe@example.com', password: 'clave12345' });
    check('registro del dueño -> 201', owner.register.status === 201, JSON.stringify(owner.register.data));
    const ownerTok = owner.token;
    r = await req('GET', '/api/users/me/verification-requests', ownerTok);
    check('el dueño ve la lista de solicitudes', r.status === 200 && r.data.requests.length === 1
      && r.data.requests[0].real_name === 'Prueba Uno', JSON.stringify(r.data));
    const verifId = r.data.requests[0].id;
    const docOwner = await fetch(BASE + r.data.requests[0].document_url, { headers: { Authorization: `Bearer ${ownerTok}` } });
    check('el dueño sí puede abrir el documento', docOwner.status === 200 && docOwner.headers.get('content-type') === 'image/png', `status ${docOwner.status}`);
    r = await req('GET', '/api/users/me/verification-requests', tok2);
    check('un usuario normal NO ve las solicitudes (403)', r.status === 403, JSON.stringify(r.data));
    r = await req('POST', `/api/users/me/verification-requests/${verifId}/approve`, ownerTok, { note: 'OK' });
    check('el dueño aprueba la verificación -> 200', r.status === 200, JSON.stringify(r.data));
    r = await req('GET', '/api/users/prueba1/profile');
    check('usuario aprobado queda verificado', r.data.verified === true, JSON.stringify(r.data));

    console.log('== Sin panel de admin ==');
    r = await req('POST', '/api/admin/login', undefined, { alias: 'jefe', password: 'clave12345' });
    check('/api/admin/login -> 404', r.status === 404, JSON.stringify(r.data));
    r = await req('GET', '/api/admin/stats', ownerTok);
    check('/api/admin/stats -> 404', r.status === 404, JSON.stringify(r.data));
    r = await req('GET', '/api/admin/moderation', ownerTok);
    check('/api/admin/moderation -> 404', r.status === 404, JSON.stringify(r.data));
    r = await req('GET', `/api/social/posts/${flaggedPostId}`, tok1);
    check('el post marcado sigue visible (no hay revisión que lo quite)', r.status === 200, JSON.stringify(r.data));

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
