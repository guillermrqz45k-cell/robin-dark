// scripts/test-moderation.js — inhabilitación permanente de una
// cuenta por el dueño (botón «Inhabilitar cuenta» del perfil),
// contra SQLite local.
// Uso: node scripts/test-moderation.js
// Levanta el servidor en un puerto de pruebas con una base SQLite
// nueva y vacía (borra data/robin-dark.db al empezar y al terminar)
// y un servidor falso de Resend en local. NO toca el sitio
// público ni Railway.
//
// Verifica:
// - el dueño inhabilita una cuenta (200, disabled: true) y puede
//   habilitarla de nuevo (200, disabled: false); un usuario
//   normal no puede inhabilitar a nadie (403) y el dueño no puede
//   inhabilitarse a sí mismo (409).
// - la cuenta inhabilitada no puede entrar: con la contraseña
//   correcta responde 403 «Tu cuenta ha sido inhabilitada
//   permanentemente.» (code account_disabled); con la contraseña
//   incorrecta sigue siendo 401 genérico. Un token forjado con la
//   versión actual también da 403 en /api/auth/me (la sesión
//   muere) y no puede publicar.
// - desaparece de la vista de los demás: su perfil da 404 (y sus
//   publicaciones, seguidores y amigos también), no sale en las
//   búsquedas, su publicación no sale en el feed, en Explorar (ni
//   su hashtag en tendencias) ni por enlace directo, su historia
//   no sale en las historias, su reacción no sale en la lista de
//   reacciones y no sale en las sugerencias de Tendencias
//   («Personas que podrías conocer», donde sale todo el mundo
//   menos inhabilitados, con los fundadores/admins primero, luego
//   los verificados y luego los demás). El dueño sí sigue viendo
//   su perfil (con disabled: true), su publicación por enlace y
//   sus listas, y la ve en las búsquedas (con disabled: true).
// - al habilitarla de nuevo, vuelve a verse y a poder entrar.
// - los eventos user_disabled y user_enabled quedan registrados.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'robin-dark.db');
const PORT = 3465;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_RESEND_PORT = 3466;
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
  return withDb((sqlite) => sqlite.prepare('SELECT id, token_version, disabled FROM users WHERE id = ?').get(userId));
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

    console.log('== Preparación ==');
    const owner = { real_name: 'Jefe Dueño', alias: 'jefe', password: 'clave123', email: 'jefe@prueba.com' };
    const victim = { real_name: 'Vic Infractor', alias: 'vic', password: 'clave123', email: 'vic@prueba.com' };
    const viewer = { real_name: 'Mir Espectador', alias: 'mir', password: 'clave123', email: 'mir@prueba.com' };
    const o = await registerAndLogin(owner);
    const v = await registerAndLogin(victim);
    const m = await registerAndLogin(viewer);
    check('dueño registrado y con sesión', Boolean(o.token));
    // El dueño ya no nace admin: se hace admin con el nuevo
    // endpoint (solo el dueño puede dar admin, y en una base
    // limpia el dueño se lo da a sí mismo).
    const grant = await req('POST', '/api/users/jefe/admin', o.token, { admin: true });
    check('el dueño se hace admin con el nuevo endpoint', grant.status === 200 && grant.data.admin === true, JSON.stringify(grant.data));
    // La víctima es verificada (para que salga en las sugerencias
    // cuando está habilitada: las sugerencias solo muestran
    // verificados, con los fundadores/admins primero).
    const verifyVic = await req('POST', '/api/users/vic/verify', o.token, { verified: true });
    check('el dueño verifica a la víctima (200)', verifyVic.status === 200 && verifyVic.data.verified === true, `status=${verifyVic.status} ${JSON.stringify(verifyVic.data)}`);
    // Una segunda admin (fundadora) para probar que los fundadores
    // salen primero en las sugerencias.
    const admin2 = { real_name: 'Ana Fundadora', alias: 'ana', password: 'clave123', email: 'ana@prueba.com' };
    const a = await registerAndLogin(admin2);
    check('segunda admin registrada y con sesión', Boolean(a.token));
    const grantAna = await req('POST', '/api/users/ana/admin', o.token, { admin: true });
    check('el dueño hace admin a ana (fundadora)', grantAna.status === 200 && grantAna.data.admin === true, JSON.stringify(grantAna.data));
    check('víctima registrada y con sesión', Boolean(v.token));
    check('espectador registrado y con sesión', Boolean(m.token));

    // La víctima publica (para comprobar que su contenido se
    // esconde) y cuenta una historia; el espectador publica para
    // que la víctima reaccione a algo.
    const post = await req('POST', '/api/social/posts', v.token, { text: 'Publicación de la víctima que debe esconderse. #victimaescondida' });
    check('la víctima publicó', post.status === 201, `status=${post.status}`);
    const postId = post.data.post && post.data.post.id;
    const story = await req('POST', '/api/social/stories', v.token, { kind: 'story', text: 'Historia de la víctima.' });
    check('la víctima contó una historia', story.status === 201, `status=${story.status}`);
    const viewerPost = await req('POST', '/api/social/posts', m.token, { text: 'Publicación del espectador.' });
    const viewerPostId = viewerPost.data.post && viewerPost.data.post.id;
    const react = await req('POST', `/api/social/posts/${viewerPostId}/like`, v.token, { kind: 'like' });
    check('la víctima reaccionó a la publicación del espectador', react.status === 200, `status=${react.status}`);
    // La víctima sigue al espectador y viceversa (para las listas).
    const f1 = await req('POST', '/api/social/follow/mir', v.token, {});
    const f2 = await req('POST', '/api/social/follow/vic', m.token, {});
    check('la víctima y el espectador se siguen', f1.status === 200 && f2.status === 200, `f1=${f1.status} f2=${f2.status}`);

    console.log('== Inhabilitar ==');
    const noPerm = await req('POST', '/api/users/vic/disable', m.token, { disabled: true });
    check('un usuario normal no puede inhabilitar (403)', noPerm.status === 403, `status=${noPerm.status}`);
    const self = await req('POST', '/api/users/jefe/disable', o.token, { disabled: true });
    check('el dueño no puede inhabilitarse a sí mismo (409)', self.status === 409, `status=${self.status}`);
    const missing = await req('POST', '/api/users/nadie/disable', o.token, { disabled: true });
    check('inhabilitar un alias que no existe da 404', missing.status === 404, `status=${missing.status}`);
    const disable = await req('POST', '/api/users/vic/disable', o.token, { disabled: true });
    check('el dueño inhabilita la cuenta (200, disabled: true)', disable.status === 200 && disable.data.disabled === true, `status=${disable.status} disabled=${disable.data.disabled}`);

    console.log('== No puede entrar ==');
    const loginOk = await req('POST', '/api/auth/login', undefined, { email: victim.email, password: victim.password });
    check('entrar con la contraseña correcta da 403', loginOk.status === 403, `status=${loginOk.status}`);
    check('el error dice que la cuenta fue inhabilitada permanentemente', String(loginOk.data.error || '').includes('inhabilitada permanentemente'), loginOk.data.error || '');
    check('el error trae code account_disabled', loginOk.data.code === 'account_disabled', loginOk.data.code || '');
    const loginBad = await req('POST', '/api/auth/login', undefined, { email: victim.email, password: 'clave-mala' });
    check('con la contraseña incorrecta sigue siendo 401 genérico', loginBad.status === 401, `status=${loginBad.status}`);
    // Token forjado con la versión actual (la inhabilitación sube
    // token_version): la sesión muere con 403, no con 401.
    const vRow = await getUserRow(v.userId);
    const forged = jwt.sign({ id: v.userId, tv: Number(vRow.token_version) || 0 }, JWT_SECRET);
    const me = await req('GET', '/api/auth/me', forged);
    check('un token con la versión actual da 403 en /api/auth/me', me.status === 403 && me.data.code === 'account_disabled', `status=${me.status} code=${me.data.code || ''}`);
    const postBlocked = await req('POST', '/api/social/posts', v.token, { text: 'La víctima intenta publicar inhabilitada.' });
    check('la víctima inhabilitada no puede publicar (401 o 403)', postBlocked.status === 401 || postBlocked.status === 403, `status=${postBlocked.status}`);

    console.log('== Desaparece de la vista de los demás ==');
    const profViewer = await req('GET', '/api/users/vic/profile', m.token);
    check('el perfil da 404 para un usuario normal', profViewer.status === 404, `status=${profViewer.status}`);
    const profOwner = await req('GET', '/api/users/vic/profile', o.token);
    check('el dueño sí ve el perfil (200)', profOwner.status === 200, `status=${profOwner.status}`);
    check('el dueño ve disabled: true en el perfil', profOwner.data.disabled === true, `disabled=${profOwner.data.disabled}`);
    const searchViewer = await req('GET', '/api/users?search=vic', m.token);
    check('la víctima no sale en la búsqueda de un usuario normal', searchViewer.status === 200 && !(searchViewer.data.users || []).some((u) => u.alias === 'vic'), `status=${searchViewer.status}`);
    const searchOwner = await req('GET', '/api/users?search=vic', o.token);
    const foundOwner = (searchOwner.data.users || []).find((u) => u.alias === 'vic');
    check('el dueño sí la ve en la búsqueda (con disabled: true)', Boolean(foundOwner) && foundOwner.disabled === true, `encontrada=${Boolean(foundOwner)}`);
    const feed = await req('GET', '/api/social/feed?tab=para_ti', m.token);
    check('la publicación de la víctima no sale en el feed', feed.status === 200 && !(feed.data.posts || []).some((p) => p.id === postId), `status=${feed.status}`);
    const explore = await req('GET', '/api/social/explore', m.token);
    check('la publicación de la víctima no sale en Explorar', explore.status === 200 && !(explore.data.posts || []).some((p) => p.id === postId), `status=${explore.status}`);
    check('su hashtag no sale en las tendencias de Explorar', explore.status === 200 && !(explore.data.hashtags || []).some((h) => h.tag === 'victimaescondida'), `status=${explore.status}`);
    // Las sugerencias («Personas que podrías conocer») solo
    // muestran verificados: el dueño no sigue a la víctima, así
    // que saldría ahí si no estuviera inhabilitada.
    const trends = await req('GET', '/api/social/trends', o.token);
    check('la víctima no sale en las sugerencias de Tendencias', trends.status === 200 && !(trends.data.suggested_users || []).some((u) => u.alias === 'vic'), `status=${trends.status}`);
    check('su hashtag no sale en las tendencias (endpoint trends)', trends.status === 200 && !(trends.data.hashtags || []).some((h) => h.tag === 'victimaescondida'), `status=${trends.status}`);
    check('la fundadora ana sí sale en las sugerencias', trends.status === 200 && (trends.data.suggested_users || []).some((u) => u.alias === 'ana'), `status=${trends.status}`);
    // En las sugerencias sale todo el mundo (menos inhabilitados):
    // mir no está verificado y también aparece, después de ana.
    const sugDis = (trends.data.suggested_users || []).map((u) => u.alias);
    check('un usuario sin verificar también sale en las sugerencias', sugDis.includes('mir'), `sugerencias=${sugDis.join(',')}`);
    check('la fundadora ana sale primero (antes que mir)', sugDis[0] === 'ana', `sugerencias=${sugDis.join(',')}`);
    const singleViewer = await req('GET', `/api/social/posts/${postId}`, m.token);
    check('la publicación por enlace da 404 para un usuario normal', singleViewer.status === 404, `status=${singleViewer.status}`);
    const singleOwner = await req('GET', `/api/social/posts/${postId}`, o.token);
    check('el dueño sí ve la publicación por enlace (200)', singleOwner.status === 200, `status=${singleOwner.status}`);
    const stories = await req('GET', '/api/social/stories', m.token);
    check('la historia de la víctima no sale en las historias', stories.status === 200 && !(stories.data.groups || []).some((g) => g.author && g.author.alias === 'vic'), `status=${stories.status}`);
    const reactions = await req('GET', `/api/social/posts/${viewerPostId}/reactions`, m.token);
    check('la reacción de la víctima no sale en la lista', reactions.status === 200 && !(reactions.data.reactions || []).some((r) => r.user && r.user.alias === 'vic'), `status=${reactions.status}`);
    const followers = await req('GET', '/api/users/vic/followers', m.token);
    check('los seguidores de la víctima dan 404 para un usuario normal', followers.status === 404, `status=${followers.status}`);
    const followersOwner = await req('GET', '/api/users/vic/followers', o.token);
    check('el dueño sí ve sus seguidores (200)', followersOwner.status === 200, `status=${followersOwner.status}`);
    const postsViewer = await req('GET', '/api/users/vic/posts', m.token);
    check('las publicaciones del perfil dan 404 para un usuario normal', postsViewer.status === 404, `status=${postsViewer.status}`);
    const postsOwner = await req('GET', '/api/users/vic/posts', o.token);
    check('el dueño sí ve sus publicaciones (200, 1)', postsOwner.status === 200 && (postsOwner.data.posts || []).length === 1, `status=${postsOwner.status} n=${(postsOwner.data.posts || []).length}`);

    console.log('== Habilitar de nuevo ==');
    const enable = await req('POST', '/api/users/vic/disable', o.token, { disabled: false });
    check('el dueño habilita la cuenta (200, disabled: false)', enable.status === 200 && enable.data.disabled === false, `status=${enable.status} disabled=${enable.data.disabled}`);
    const profAgain = await req('GET', '/api/users/vic/profile', m.token);
    check('el perfil vuelve a verse (200)', profAgain.status === 200, `status=${profAgain.status}`);
    const feedAgain = await req('GET', '/api/social/feed?tab=para_ti', m.token);
    check('la publicación vuelve a salir en el feed', feedAgain.status === 200 && (feedAgain.data.posts || []).some((p) => p.id === postId), `status=${feedAgain.status}`);
    const exploreAgain = await req('GET', '/api/social/explore', m.token);
    check('la publicación vuelve a salir en Explorar', exploreAgain.status === 200 && (exploreAgain.data.posts || []).some((p) => p.id === postId), `status=${exploreAgain.status}`);
    check('su hashtag vuelve a las tendencias de Explorar', exploreAgain.status === 200 && (exploreAgain.data.hashtags || []).some((h) => h.tag === 'victimaescondida'), `status=${exploreAgain.status}`);
    const trendsAgain = await req('GET', '/api/social/trends', o.token);
    check('la víctima vuelve a las sugerencias de Tendencias', trendsAgain.status === 200 && (trendsAgain.data.suggested_users || []).some((u) => u.alias === 'vic'), `status=${trendsAgain.status}`);
    check('su hashtag vuelve a las tendencias (endpoint trends)', trendsAgain.status === 200 && (trendsAgain.data.hashtags || []).some((h) => h.tag === 'victimaescondida'), `status=${trendsAgain.status}`);
    // Orden: fundadores/admins primero, luego verificados, luego
    // los demás (ana, vic, mir).
    const sug = (trendsAgain.data.suggested_users || []).map((u) => u.alias);
    check('orden de sugerencias: fundadora, verificado, resto', sug[0] === 'ana' && sug[1] === 'vic' && sug[2] === 'mir', `sugerencias=${sug.join(',')}`);
    const loginAgain = await req('POST', '/api/auth/login', undefined, { email: victim.email, password: victim.password });
    check('la víctima puede entrar de nuevo (200)', loginAgain.status === 200, `status=${loginAgain.status}`);

    console.log('== Registro de eventos ==');
    check('evento user_disabled registrado', (await countEvents('user_disabled')) >= 1);
    check('evento user_enabled registrado', (await countEvents('user_enabled')) >= 1);
    check('evento login_disabled registrado', (await countEvents('login_disabled')) >= 1);
  } finally {
    proc.kill('SIGTERM');
    fakeResend.close();
    await new Promise((r) => setTimeout(r, 500));
    if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  }
  console.log(`\nResultado: ${pass} ok, ${fail} fallos`);
  if (failures.length) console.log('Fallos:', failures.join(', '));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
