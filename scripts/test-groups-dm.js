// scripts/test-groups-dm.js — pruebas de grupos, mensajes directos
// e historias con foto y vídeo de Robin Dark, contra SQLite local.
// Uso: node scripts/test-groups-dm.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y verifica: grupos (crear, unirse, salir, conteo real de
// miembros, detalle con miembros, borrar solo el creador),
// mensajes directos (abrir hilo por alias, no escribirse a uno
// mismo, enviar, badge de no leídos, al abrir se marca leído, un
// tercero no puede abrir el hilo), historias con foto real y
// reels con vídeo corto MP4 (media_url/media_type, Range 206),
// reel sin medio -> 400, historia vacía -> 400, texto bloqueado
// con medio -> 422, borrar historia borra su medio, IA sin
// comercio (vender/escrow -> no hay tienda; grupos y vídeo),
// stats públicos sin tienda, muro del grupo, sin panel de admin,
// y que los endpoints de tienda dan 404. NO toca el sitio
// público ni Railway.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3461;
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

// PNG 1x1 y un MP4 mínimo (solo cabecera, para probar el conducto).
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FAKE_MP4 = Buffer.from('00000018667479706d703432000000016d70343269736f6d', 'hex').toString('base64');

async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const env = {
    ...process.env, PORT: String(PORT), ADMIN_ALIAS: 'jefe',
    JWT_SECRET: 'secreto-de-pruebas-largo-1234567890',
  };
  delete env.DATABASE_URL;
  delete env.RESEND_API_KEY;
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    console.log('== Arranque ==');
    check('servidor responde /api/health', await waitHealth());

    console.log('== Registro ==');
    const a = await registerAndLogin({ real_name: 'Ana', alias: 'ana', email: 'ana@example.com', password: 'clave12345' });
    const b = await registerAndLogin({ real_name: 'Beto', alias: 'beto', email: 'beto@example.com', password: 'clave12345' });
    const c = await registerAndLogin({ real_name: 'Cata', alias: 'cata', email: 'cata@example.com', password: 'clave12345' });
    check('registro de 3 usuarios y entran verificados', a.register.status === 201 && b.register.status === 201 && c.register.status === 201
      && Boolean(a.token) && Boolean(b.token) && Boolean(c.token));
    const tok1 = a.token;
    const tok2 = b.token;
    const tok3 = c.token;

    console.log('== Sin tienda ==');
    let r = await req('GET', '/api/listings');
    check('/api/listings da 404', r.status === 404, `status=${r.status}`);
    r = await req('GET', '/api/orders');
    check('/api/orders da 404', r.status === 404, `status=${r.status}`);

    console.log('== Grupos ==');
    r = await req('POST', '/api/social/groups', tok1, { name: 'Fans del rap', description: 'Para hablar de tiraderas' });
    check('crear grupo -> 201, 1 miembro, soy creadora', r.status === 201 && r.data.group.member_count === 1 && r.data.group.is_creator === true, JSON.stringify(r.data));
    const groupId = r.data.group.id;
    r = await req('POST', `/api/social/groups/${groupId}/join`, tok2, {});
    check('unirse -> 2 miembros', r.status === 200 && r.data.joined === true && r.data.member_count === 2, JSON.stringify(r.data));
    r = await req('GET', `/api/social/groups/${groupId}`);
    check('detalle: 2 miembros listados', r.status === 200 && r.data.group.member_count === 2 && r.data.group.members.length === 2, JSON.stringify(r.data));
    r = await req('GET', '/api/social/groups');
    check('lista pública con conteo real', r.status === 200 && r.data.groups.length === 1 && r.data.groups[0].member_count === 2, JSON.stringify(r.data));
    r = await req('POST', `/api/social/groups/${groupId}/leave`, tok2, {});
    check('salir -> 1 miembro', r.status === 200 && r.data.joined === false && r.data.member_count === 1, JSON.stringify(r.data));
    r = await req('DELETE', `/api/social/groups/${groupId}`, tok2);
    check('borrar grupo sin ser creador -> 403', r.status === 403, `status=${r.status}`);
    r = await req('DELETE', `/api/social/groups/${groupId}`, tok1);
    check('la creadora borra el grupo', r.status === 200, JSON.stringify(r.data));
    r = await req('GET', '/api/social/groups');
    check('lista vacía tras borrar', r.status === 200 && r.data.groups.length === 0, JSON.stringify(r.data));

    console.log('== Mensajes directos ==');
    r = await req('POST', '/api/chat', tok1, { alias: 'beto' });
    check('abrir hilo con beto -> 201', r.status === 201 && r.data.thread.other_user.alias === 'beto', JSON.stringify(r.data));
    const threadId = r.data.thread.id;
    r = await req('POST', '/api/chat', tok1, { alias: 'ana' });
    check('no me puedo escribir a mí misma -> 400', r.status === 400, `status=${r.status}`);
    r = await req('POST', `/api/chat/${threadId}/messages`, tok1, { body: 'Hola Beto, ¿qué tal?' });
    check('enviar mensaje -> 201', r.status === 201, JSON.stringify(r.data));
    r = await req('GET', '/api/chat', tok2);
    check('beto ve 1 sin leer y último mensaje', r.data.unread_total === 1 && r.data.threads[0].unread_count === 1
      && r.data.threads[0].last_body === 'Hola Beto, ¿qué tal?', JSON.stringify(r.data));
    r = await req('GET', `/api/chat/${threadId}/messages`, tok2);
    check('abrir el hilo trae el mensaje', r.status === 200 && r.data.messages.length === 1, JSON.stringify(r.data));
    r = await req('GET', '/api/chat', tok2);
    check('al abrir se marca leído (0 sin leer)', r.data.unread_total === 0, JSON.stringify(r.data));
    r = await req('GET', `/api/chat/${threadId}/messages`, tok3);
    check('un tercero no puede abrir el hilo -> 403', r.status === 403, `status=${r.status}`);

    console.log('== Historias con foto y vídeo ==');
    r = await req('POST', '/api/social/stories', tok1, { kind: 'story', text: 'Mi día', media: { mime: 'image/png', data: PNG_1X1 } });
    check('historia con foto -> 201, media_type image', r.status === 201 && r.data.story.media_url && r.data.story.media_type === 'image', JSON.stringify(r.data));
    const storyMediaUrl = r.data.story.media_url;
    const pic = await fetch(BASE + storyMediaUrl);
    check('la foto de la historia se sirve como image/png', pic.status === 200 && pic.headers.get('content-type') === 'image/png', `status ${pic.status}`);
    r = await req('POST', '/api/social/stories', tok1, { kind: 'reel', text: 'Mi reel', media: { mime: 'video/mp4', data: FAKE_MP4 } });
    check('reel con vídeo MP4 -> 201, media_type video', r.status === 201 && r.data.story.media_url && r.data.story.media_type === 'video', JSON.stringify(r.data));
    const reelId = r.data.story.id;
    const reelUrl = r.data.story.media_url;
    const full = await fetch(BASE + reelUrl);
    check('el vídeo se sirve como video/mp4', full.status === 200 && full.headers.get('content-type') === 'video/mp4', `status ${full.status}`);
    const range = await fetch(BASE + reelUrl, { headers: { Range: 'bytes=0-9' } });
    check('Range devuelve 206 con Content-Range', range.status === 206 && Boolean(range.headers.get('content-range')), `status ${range.status}`);
    r = await req('POST', '/api/social/stories', tok1, { kind: 'reel', text: 'Sin medio' });
    check('reel sin medio -> 400', r.status === 400, `status=${r.status}`);
    r = await req('POST', '/api/social/stories', tok1, { kind: 'story' });
    check('historia vacía (sin texto ni medio) -> 400', r.status === 400, `status=${r.status}`);
    r = await req('POST', '/api/social/stories', tok1, { kind: 'story', text: 'Eres un idiota', media: { mime: 'image/png', data: PNG_1X1 } });
    check('historia con insulto y foto -> 422', r.status === 422, `status=${r.status}`);
    r = await req('DELETE', `/api/social/stories/${reelId}`, tok1);
    check('borrar el reel -> 200', r.status === 200, JSON.stringify(r.data));
    const gone = await fetch(BASE + reelUrl);
    check('el medio del reel borrado ya no existe (404)', gone.status === 404, `status ${gone.status}`);

    console.log('== IA sin comercio ==');
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Cómo vendo un producto?' });
    check('IA: vender -> dice que ya no hay tienda', r.status === 200 && /ya no tiene tienda/i.test(r.data.answer), JSON.stringify(r.data));
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Qué es el escrow?' });
    check('IA: escrow -> dice que ya no hay tienda', r.status === 200 && /ya no tiene tienda/i.test(r.data.answer), JSON.stringify(r.data));
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Cómo me uno a un grupo?' });
    check('IA: grupos -> responde de grupos', r.status === 200 && /grupo/i.test(r.data.answer), JSON.stringify(r.data));
    r = await req('POST', '/api/ai/ask', tok1, { question: '¿Puedo subir un vídeo a mi historia?' });
    check('IA: vídeo en historia -> responde de foto y vídeo', r.status === 200 && /v[ií]deo/i.test(r.data.answer), JSON.stringify(r.data));

    console.log('== Muro del grupo ==');
    r = await req('POST', '/api/social/groups', tok1, { name: 'Muro de prueba', description: 'Grupo para el muro' });
    check('crear grupo del muro -> 201', r.status === 201, JSON.stringify(r.data));
    const wallGroupId = r.data.group.id;
    r = await req('POST', `/api/social/groups/${wallGroupId}/posts`, tok3, { text: 'No soy miembro' });
    check('no miembro no puede publicar en el muro -> 403', r.status === 403, `status=${r.status}`);
    r = await req('POST', `/api/social/groups/${wallGroupId}/join`, tok2, {});
    check('beto se une al grupo del muro', r.status === 200 && r.data.joined === true);
    r = await req('POST', `/api/social/groups/${wallGroupId}/posts`, tok2, { text: 'Hola, este es el muro.' });
    check('miembro publica en el muro -> 201', r.status === 201 && r.data.post && r.data.post.text === 'Hola, este es el muro.', JSON.stringify(r.data));
    const wallPostId = r.data.post.id;
    r = await req('GET', `/api/social/groups/${wallGroupId}/posts`, tok2);
    check('el muro lista la publicación', r.status === 200 && r.data.posts.length === 1 && r.data.posts[0].id === wallPostId, JSON.stringify(r.data));
    r = await req('GET', `/api/social/groups/${wallGroupId}/posts`, tok3);
    check('no miembro no puede leer el muro -> 403', r.status === 403, `status=${r.status}`);
    r = await req('DELETE', `/api/social/groups/${wallGroupId}/posts/${wallPostId}`, tok3);
    check('otro usuario no puede borrar del muro -> 403', r.status === 403, `status=${r.status}`);
    r = await req('DELETE', `/api/social/groups/${wallGroupId}/posts/${wallPostId}`, tok2);
    check('el autor borra su publicación del muro', r.status === 200, JSON.stringify(r.data));
    r = await req('GET', `/api/social/groups/${wallGroupId}/posts`, tok1);
    check('el muro queda vacío tras borrar', r.status === 200 && r.data.posts.length === 0, JSON.stringify(r.data));

    console.log('== Stats sin tienda, sin panel de admin ==');
    r = await req('GET', '/api/stats');
    check('stats públicos: usuarios, grupos y mensajes', r.data.users === 3 && r.data.messages === 1, JSON.stringify(r.data));
    check('stats públicos: sin campos de tienda', !('listings' in r.data) && !('tratos_cerrados' in r.data), JSON.stringify(r.data));
    r = await req('POST', '/api/admin/login', undefined, { alias: 'jefe', password: 'clave12345' });
    check('/api/admin/login -> 404 (sin panel)', r.status === 404, `status=${r.status}`);
    r = await req('GET', '/api/admin/stats', tok1);
    check('/api/admin/stats -> 404 (sin panel)', r.status === 404, `status=${r.status}`);
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
