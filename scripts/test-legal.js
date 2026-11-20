// scripts/test-legal.js — pruebas del paquete legal de Robin Dark:
// aviso legal, privacidad, cookies y términos; pie con enlaces,
// consentimiento de cookies real, robots.txt y sitemap.xml.
// Solo comprueba archivos (no levanta el servidor ni toca el
// sitio público ni Railway).
// Uso: node scripts/test-legal.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL ${name} ${extra}`); }
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

const LEGAL = ['aviso-legal.html', 'privacidad.html', 'cookies.html', 'terminos.html'];
const KEY_PHRASES = ['DarkMous', 'robindarkoficial@gmail.com', 'Ley 1581', 'rd_cookie_consent', 'Última actualización'];

console.log('== Páginas legales ==');
for (const file of LEGAL) {
  const full = path.join(PUBLIC, 'legal', file);
  check(`existe public/legal/${file}`, fs.existsSync(full));
  if (!fs.existsSync(full)) continue;
  const html = read(full);
  for (const phrase of KEY_PHRASES) {
    check(`${file} contiene «${phrase}»`, html.includes(phrase));
  }
  check(`${file} enlaza ../styles.css`, html.includes('href="../styles.css"'));
  check(`${file} tiene «Volver a Robin Dark» a /`, html.includes('href="/"') && html.includes('Volver a Robin Dark'));
  for (const other of LEGAL) {
    if (other !== file) check(`${file} enlaza ${other}`, html.includes(`href="${other}"`));
  }
  check(`${file} sin onclick en línea`, !html.includes('onclick='));
}

console.log('== robots.txt y sitemap.xml ==');
const robots = path.join(PUBLIC, 'robots.txt');
check('existe public/robots.txt', fs.existsSync(robots));
if (fs.existsSync(robots)) {
  const txt = read(robots);
  check('robots.txt permite todo (Allow: /)', txt.includes('Allow: /'));
  check('robots.txt anuncia el sitemap', txt.includes('Sitemap: https://robindark.co/sitemap.xml'));
}
const sitemap = path.join(PUBLIC, 'sitemap.xml');
check('existe public/sitemap.xml', fs.existsSync(sitemap));
if (fs.existsSync(sitemap)) {
  const xml = read(sitemap);
  check('sitemap lista la página principal', xml.includes('<loc>https://robindark.co/</loc>'));
  for (const file of LEGAL) {
    check(`sitemap lista ${file}`, xml.includes(`<loc>https://robindark.co/legal/${file}</loc>`));
  }
  check('sitemap con lastmod 2026-11-20', xml.includes('<lastmod>2026-11-20</lastmod>'));
}

console.log('== index.html: pie y metas ==');
const indexHtml = read(path.join(PUBLIC, 'index.html'));
check('index.html tiene meta description', indexHtml.includes('<meta name="description"'));
check('index.html tiene Open Graph (og:title, og:url)', indexHtml.includes('og:title') && indexHtml.includes('og:url') && indexHtml.includes('https://robindark.co'));
check('index.html tiene el pie .site-footer', indexHtml.includes('class="site-footer"'));
for (const file of LEGAL) {
  check(`el pie enlaza ${file}`, indexHtml.includes(`href="/legal/${file}"`));
}
check('el pie tiene el botón Configuración de cookies', indexHtml.includes('id="footer-cookie-settings"'));
check('el pie firma © 2026 Robin Dark — DarkMous', indexHtml.includes('© 2026 Robin Dark — DarkMous'));

console.log('== app.js: consentimiento de cookies ==');
const appJs = read(path.join(PUBLIC, 'app.js'));
for (const needle of ['rd_cookie_consent', 'document.cookie', 'Aceptar todo', 'Configurar', 'getCookieConsent', 'Guardar preferencias', 'footer-cookie-settings']) {
  check(`app.js contiene «${needle}»`, appJs.includes(needle));
}
check('app.js escribe la cookie con SameSite=Lax', appJs.includes('SameSite=Lax'));
check('app.js guarda el respaldo en localStorage', appJs.includes('localStorage.setItem(COOKIE_CONSENT_NAME'));
const cookieStart = appJs.indexOf('// ---------- Cookies: consentimiento ----------');
const cookieEnd = appJs.indexOf('// ---------- Inicio de la app ----------');
const cookieSection = cookieStart >= 0 && cookieEnd > cookieStart ? appJs.slice(cookieStart, cookieEnd) : '';
check('la sección de cookies existe en app.js', cookieSection.length > 0);
check('el código nuevo de cookies no tiene onclick en línea', cookieSection.length > 0 && !cookieSection.includes('onclick='));
check('el código nuevo de cookies no tiene style en línea', cookieSection.length > 0 && !cookieSection.includes('style='));

console.log('== styles.css: estilos legales y de cookies ==');
const css = read(path.join(PUBLIC, 'styles.css'));
for (const cls of ['.site-footer', '.cookie-banner', '.cookie-toggle', '.legal-page']) {
  check(`styles.css tiene ${cls}`, css.includes(cls));
}

console.log(`\nResultado: ${pass} pasadas, ${fail} fallidas.`);
if (failures.length) console.log(`Fallidas: ${failures.join(' | ')}`);
process.exit(fail ? 1 : 0);
