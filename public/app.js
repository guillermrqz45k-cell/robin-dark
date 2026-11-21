// public/app.js — Robin Dark, red social (sin tienda, sin panel de
// admin, sin rangos). JavaScript vainilla, sin paso de build.
// Habla solo con la API de este mismo servidor (/api/*).
// - Vistas: Inicio (banner, compositor, historias, reels, feed),
//   Explorar, Grupos (con muro), Mensajes (directos), Perfil,
//   Amigos, Reels, IA, Notificaciones.
// - Insignias: Admin (solo el dueño) + ✓ Verificado, Nuevo < 30 días,
//   marco dorado Antiguo >= 90 días (la antigüedad viene del servidor).
// - Compartir: a tu historia, a un grupo, a un amigo por mensaje,
//   copiar enlace (#post-<id>) o fuera de la app.
// - Sin ventanas emergentes: los avisos van a #notice. Sin llamadas a tienda.
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const CHAT_POLL_MS = 5000;
const MAX_PHOTO_MB = 5;
const MAX_VIDEO_MB = 20;
const FEELINGS = ['', '😊 Feliz', '❤️ Enamorado', '💪 Motivado', '🙏 Agradecido', '🎉 Celebrando', '🌿 Tranquilo', '🔥 Con toda la energía', '💼 Trabajando'];
const STORY_STYLES = {
  oro: 'linear-gradient(135deg,#f59e0b,#92400e)',
  noche: 'linear-gradient(135deg,#1e1b4b,#312e81)',
  bosque: 'linear-gradient(135deg,#14532d,#166534)',
  fuego: 'linear-gradient(135deg,#dc2626,#7f1d1d)',
  uva: 'linear-gradient(135deg,#7c3aed,#4c1d95)',
};

// Iconos SVG de la interfaz (trazo, currentColor, 24px): el emoji
// queda solo dentro del contenido del usuario (sentimientos,
// textos), nunca como icono de interfaz.
const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><path d="M16 4.6a3 3 0 0 1 0 5.9"/><path d="M16.5 15.3c2.4.5 4.2 2 5 4.7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="18.5" cy="14" r="1.1" fill="currentColor" stroke="none"/>',
  ghost: '<path d="M12 3a7 7 0 0 0-7 7v10l2.3-1.7 2.4 1.7 2.3-1.7 2.3 1.7 2.4-1.7L19 20V10a7 7 0 0 0-7-7z"/><circle cx="9.5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="10" r="1.3" fill="currentColor" stroke="none"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
  thumb: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  wow: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/><ellipse cx="12" cy="15.5" rx="2.2" ry="3"/>',
  comment: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5l13 13"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  fire: '<path d="M12 2c1 3-2 4.5-2 7 0 1.5 1 2.5 2 2.5S14 10.5 14 9c2 1.5 3 3.5 3 5.5A5 5 0 0 1 7 14.5C7 9 10 6 12 2z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/>',
};
function ico(name) {
  const inner = ICON_PATHS[name] || '';
  return `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

let me = null; // usuario actual ({id, alias, email, is_admin, verified, ...})
let token = localStorage.getItem('rd_token') || null;
let currentView = 'inicio';
let feedTab = 'para_ti';
let feedHashtag = null;
let profileAlias = null;
let profileTab = 'publicaciones';
let profileData = null;
let chatThreadId = null;
let chatOtherAlias = null;
let chatPollTimer = null;
let notifTimer = null;
let groupDetailId = null;
let shareMenuFor = null;
let storyViewer = null; // {groups, groupIdx, storyIdx}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(ts) {
  const t = typeof ts === 'number' ? ts : Date.parse(String(ts || '').replace(' ', 'T'));
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'Ahora mismo';
  const m = Math.floor(s / 60);
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `Hace ${d} d`;
  return new Date(t).toLocaleDateString('es-ES');
}

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

async function api(path, opts) {
  const res = await fetch(path, {
    ...(opts || {}),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((opts && opts.headers) || {}) },
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
  // 401: la sesión caducó o el token ya no vale. Solo se actúa
  // en el endpoint crítico de autenticación (/api/users/me): el
  // login devuelve 401 por credenciales incorrectas, así que
  // /api/auth/* no es señal de caducidad. Los sondeos
  // (pollChat, refreshBadges) pasan noLogoutOn401 y nunca echan
  // al usuario de la vista: el 401 se devuelve sin navegar.
  // Al caducar de verdad se avisa y se abre el login, sin ir al
  // inicio y sin perder la vista en la que estaba.
  if (res.status === 401 && !(opts && opts.noLogoutOn401)) {
    if (String(path || '').startsWith('/api/users/me')) {
      saveSession(null, null);
      stopPolling();
      notice('Tu sesión caducó. Entra de nuevo para seguir.');
      openAuthModal('login');
    }
  }
  // Cuenta inhabilitada de forma permanente por el dueño: si había
  // una sesión activa (token), se cierra y se le dice por qué. Si
  // no había sesión (el intento de entrar), el error lo muestra el
  // formulario de entrar, así que aquí no se hace nada.
  if (res.status === 403 && data && data.code === 'account_disabled' && token) {
    logout(true);
    notice(data.error || 'Tu cuenta ha sido inhabilitada permanentemente.', 10000);
  }
  return { status: res.status, data };
}

let noticeTimer = null;
function notice(msg, ms) {
  const el = $('#notice');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, ms || 6000);
}

function showModal(html, wide) {
  const m = $('#modal');
  const card = $('#modal-card');
  card.className = 'modal-card' + (wide ? ' wide' : '');
  card.innerHTML = html;
  // La CSP del servidor bloquea los onclick y los style en línea,
  // así que la X de cada cuadro se conecta aquí (igual que Escape
  // y el toque fuera del cuadro). Lo mismo para el input de
  // "Copiar enlace", que se selecciona al tocarlo.
  card.querySelectorAll('.close-btn').forEach((b) => b.addEventListener('click', closeModal));
  card.querySelectorAll('input[readonly]').forEach((i) => i.addEventListener('click', () => i.select()));
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(file);
  });
}

// Achica una foto grande (las del teléfono suelen pesar más de
// 5 MB) para que entre en el límite al subirla y no se pierda
// sin aviso. Devuelve { mime: 'image/jpeg', data, kind: 'image' }
// o null si no se pudo achicar. Respeta la orientación EXIF
// (createImageBitmap con imageOrientation) para que la foto no
// salga girada; si no está disponible, usa un Image normal.
async function downscaleImage(file, maxSide = 1600) {
  let source = null;
  // createImageBitmap existe en la mayoría de navegadores, pero en
  // algunos teléfonos (WebView viejos, ciertos Android) existe y
  // falla al leer el archivo: si falla, se cae al método con
  // <img> en vez de devolver null y perder la foto.
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        source = null;
      }
    }
    if (!source) {
      const url = URL.createObjectURL(file);
      try {
        source = await new Promise((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error('No se pudo leer la imagen.'));
          im.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const w = source.width;
    const h = source.height;
    if (!w || !h) return null;
    const scale = (w > maxSide || h > maxSide) ? Math.min(maxSide / w, maxSide / h) : 1;
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d').drawImage(source, 0, 0, cw, ch);
    if (source.close) source.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return null;
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      r.readAsDataURL(blob);
    });
    if (!data) return null;
    return { mime: 'image/jpeg', data, kind: 'image' };
  } catch (e) {
    if (source && source.close) source.close();
    return null;
  }
}

// Último error de pickMedia, para que el cuadro que lo llama lo
// muestre dentro del modal en vez de perder la foto en silencio.
let lastPickError = '';

async function pickMedia(file) {
  if (!file) return null;
  const isHeic = /^image\/(heic|heif)$/i.test(file.type);
  const isImg = /^image\/(png|jpe?g)$/i.test(file.type) || isHeic;
  const isVid = /^video\/(mp4|webm)$/i.test(file.type);
  if (!isImg && !isVid) {
    lastPickError = 'Solo se aceptan fotos JPG/PNG o vídeos MP4/WebM.';
    notice(lastPickError);
    return null;
  }
  // HEIC (fotos de iPhone): se intenta convertir a JPG con el
  // navegador (Safari lo decodifica); si no se puede, se avisa
  // claro en vez de perder la foto en silencio.
  if (isHeic) {
    const small = await downscaleImage(file);
    if (small) { lastPickError = ''; return small; }
    lastPickError = 'Esa foto es HEIC y este navegador no la pudo convertir a JPG. Usa una foto JPG o PNG.';
    notice(lastPickError);
    return null;
  }
  const max = isImg ? MAX_PHOTO_MB : MAX_VIDEO_MB;
  // Las fotos del teléfono suelen pesar más de 5 MB: se achican
  // antes de subirlas para que entren en el límite y no se pierdan
  // sin aviso (antes se rechazaban y el guardado seguía sin la foto).
  if (isImg && file.size > 1024 * 1024) {
    const small = await downscaleImage(file);
    if (small && small.data.length * 0.75 < file.size) { lastPickError = ''; return small; }
  }
  if (file.size > max * 1024 * 1024) {
    lastPickError = `El archivo es muy grande: máximo ${max} MB.`;
    notice(lastPickError);
    return null;
  }
  const data = await fileToBase64(file);
  lastPickError = '';
  return { mime: file.type, data, kind: isImg ? 'image' : 'video' };
}

function fetchBlobAsBase64(url) {
  return fetch(url).then((r) => r.blob()).then((b) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ mime: b.type, data: String(r.result).split(',')[1] || '' });
    r.onerror = () => reject(new Error('No se pudo leer la foto.'));
    r.readAsDataURL(b);
  }));
}

// ---------- Insignias y tarjetas de autor ----------

function badgeHtml(badge) {
  if (!badge) return '';
  const cls = {
    admin: 'admin-badge', nuevo: 'badge-nuevo', top: 'badge-top',
    confiable: 'badge-confiable', miembro: 'badge-miembro', verificado: 'badge-verificado',
  }[badge.key] || 'badge-miembro';
  return `<span class="${cls}">${esc(badge.label)}</span>`;
}

function adminBadgeHtml(is_admin) {
  return is_admin ? '<span class="admin-badge">👑 Admin</span>' : '';
}

function verifiedHtml(verified) {
  return verified ? '<span class="verified-badge" title="Verificado">✓</span>' : '';
}

function avatarHtml(author, size) {
  const cls = 'avatar' + (size === 'sm' ? ' avatar-sm' : size === 'lg' ? ' avatar-lg' : '');
  const letter = esc((author && author.alias ? author.alias[0] : '?').toUpperCase());
  if (author && author.avatar_url) return `<img class="${cls}" src="${esc(author.avatar_url)}" alt="">`;
  return `<span class="${cls} avatar-fallback" aria-hidden="true">${letter}</span>`;
}

function authorLine(author) {
  if (!author) return '';
  return `<button type="button" class="post-author" data-alias="${esc(author.alias)}">${esc(author.alias)}</button> ${adminBadgeHtml(author.is_admin)}${verifiedHtml(author.verified)}`;
}

function badgeLine(author, badge) {
  return `${authorLine(author)} ${badge ? badgeHtml(badge) : ''}`;
}

// ---------- Sesión ----------

function saveSession(t, user) {
  token = t;
  me = user;
  if (t) { localStorage.setItem('rd_token', t); localStorage.setItem('rd_user', JSON.stringify(user)); }
  else { localStorage.removeItem('rd_token'); localStorage.removeItem('rd_user'); }
  renderTopbar();
  updateAuthNotice();
}

function logout(silent) {
  saveSession(null, null);
  stopPolling();
  if (!silent) notice('Sesión cerrada.');
  showView('inicio');
}

async function loadMe() {
  if (!token) return;
  const r = await api('/api/users/me');
  if (r.status === 200 && r.data.user) {
    me = r.data.user;
    localStorage.setItem('rd_user', JSON.stringify(me));
    renderTopbar();
    updateAuthNotice();
  } else if (r.status === 401) {
    saveSession(null, null);
  }
}

function updateAuthNotice() {
  const el = $('#auth-notice');
  if (el) el.hidden = Boolean(me);
}

function requireLogin(action) {
  if (me) return true;
  openAuthModal();
  notice(`Entra con tu cuenta para ${action}.`);
  return false;
}

// ---------- Barra superior ----------

function renderTopbar() {
  const av = $('#top-avatar-img');
  if (!av) return;
  if (me && me.avatar_url) av.innerHTML = `<img class="avatar avatar-sm" style="width:32px;height:32px" src="${esc(me.avatar_url)}" alt="">`;
  else if (me) av.textContent = esc(me.alias[0].toUpperCase());
  else av.innerHTML = ico('user');
}

function setBadge(id, n) {
  const el = $(id);
  if (!el) return;
  if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.hidden = false; }
  else el.hidden = true;
}

async function refreshBadges() {
  if (!me) { setBadge('#chat-badge', 0); setBadge('#chat-badge-mobile', 0); setBadge('#notif-badge', 0); return; }
  const c = await api('/api/chat', { noLogoutOn401: true });
  if (c.status === 200) {
    const unread = c.data.unread_total || 0;
    const badgeEl = $('#chat-badge');
    if (badgeEl) {
      if (unread > 0) { badgeEl.textContent = unread > 99 ? '99+' : String(unread); badgeEl.hidden = false; }
      else badgeEl.hidden = true;
    }
    setBadge('#chat-badge-mobile', unread);
  }
  const n = await api('/api/social/notifications', { noLogoutOn401: true });
  if (n.status === 200) setBadge('#notif-badge', n.data.unread || 0);
}

$('#top-home').addEventListener('click', () => showView('inicio'));
$('#brand-home').addEventListener('click', () => showView('inicio'));
$('#top-friends').addEventListener('click', () => showView('amigos'));
$('#top-messages').addEventListener('click', () => showView('mensajes'));
$('#top-avatar').addEventListener('click', () => { if (me) openProfile(me.alias); else openAuthModal(); });
$('#top-bell').addEventListener('click', async () => {
  const panel = $('#notif-panel');
  if (!panel) return;
  if (panel.hidden) {
    await renderNotifPanel();
    panel.hidden = false;
  } else panel.hidden = true;
});
$('#notif-close').addEventListener('click', () => { $('#notif-panel').hidden = true; });
$('#notif-all').addEventListener('click', () => { $('#notif-panel').hidden = true; showView('notificaciones'); });
$('#sugg-all').addEventListener('click', () => showView('amigos'));
$('#groups-all').addEventListener('click', () => showView('grupos'));
$('#trends-all').addEventListener('click', () => showView('explorar'));

let searchTimer = null;
$('#top-search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  const box = $('#top-search-results');
  if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    if (!me) { box.innerHTML = '<p class="muted small" style="padding:8px">Entra para buscar miembros.</p>'; box.hidden = false; return; }
    const r = await api(`/api/users?search=${encodeURIComponent(q)}`);
    if (r.status !== 200) { box.hidden = true; return; }
    box.innerHTML = r.data.users.length
      ? r.data.users.map((u) => `<button type="button" class="thread-row" data-alias="${esc(u.alias)}">${avatarHtml(u, 'sm')}<span><strong>${esc(u.alias)}</strong> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}<br><span class="muted small">${u.followers_count || 0} seguidores</span></span></button>`).join('')
      : '<p class="muted small" style="padding:8px">Sin resultados.</p>';
    box.hidden = false;
  }, 300);
});
$('#top-search-results').addEventListener('click', (e) => {
  const b = e.target.closest('[data-alias]');
  if (!b) return;
  $('#top-search-results').hidden = true;
  $('#top-search-input').value = '';
  $('.topbar').classList.remove('search-open');
  openProfile(b.dataset.alias);
});

// En el teléfono el buscador es un icono: abre el buscador
// desplegable bajo la barra superior.
$('#top-search-toggle').addEventListener('click', () => {
  const bar = $('.topbar');
  bar.classList.toggle('search-open');
  if (bar.classList.contains('search-open')) {
    const input = $('#top-search-input');
    if (input) input.focus();
  }
});
$('#top-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('.topbar').classList.remove('search-open');
});

// ---------- Menú PC y navegación ----------

const MENU = [
  { key: 'inicio', label: 'Inicio', ico: 'home', go: () => showView('inicio') },
  { key: 'explorar', label: 'Explorar', ico: 'compass', go: () => showView('explorar') },
  { key: 'amigos', label: 'Amigos', ico: 'users', go: () => showView('amigos') },
  { key: 'grupos', label: 'Grupos', ico: 'users', go: () => showView('grupos') },
  { key: 'reels', label: 'Reels', ico: 'play', go: () => showView('reels') },
  { key: 'ia', label: 'Asistente IA', ico: 'ghost', go: () => showView('ia') },
  { key: 'notificaciones', label: 'Notificaciones', ico: 'bell', go: () => showView('notificaciones') },
];

function renderMenu() {
  const nav = $('#pc-menu');
  nav.innerHTML = MENU.map((m) => `<button type="button" class="menu-btn${currentView === m.key ? ' active' : ''}" data-menu="${m.key}"><span class="menu-chip">${ico(m.ico)}</span>${m.label}</button>`).join('');
  $$('.bottom-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
  const fab = $('#ia-fab');
  if (fab) fab.classList.toggle('active', currentView === 'ia');
}
$('#pc-menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-menu]');
  if (!b) return;
  const item = MENU.find((m) => m.key === b.dataset.menu);
  if (item) item.go();
});
$$('.bottom-btn[data-view]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.view === 'perfil' && !requireLogin('ver tu perfil')) return; showView(b.dataset.view); }));
$('#bottom-create').addEventListener('click', () => {
  if (!requireLogin('publicar')) return;
  showView('inicio');
  setTimeout(() => { const t = $('#composer-text'); if (t) t.focus(); }, 50);
});
// Botón flotante de la asistente en el teléfono: la única
// entrada a la IA en móvil (el menú lateral es una fila de chips
// y el bottomnav no tiene IA).
$('#ia-fab').addEventListener('click', () => showView('ia'));

const VIEWS = ['inicio', 'explorar', 'grupos', 'mensajes', 'perfil', 'amigos', 'reels', 'ia', 'notificaciones'];
function showView(name) {
  currentView = name;
  VIEWS.forEach((v) => { const el = $(`#view-${v}`); if (el) el.hidden = v !== name; });
  renderMenu();
  window.scrollTo({ top: 0 });
  if (name === 'inicio') renderInicio();
  if (name === 'explorar') renderExplorar();
  if (name === 'grupos') renderGrupos();
  if (name === 'mensajes') renderMensajes();
  if (name === 'amigos') renderAmigos();
  if (name === 'reels') renderReels();
  if (name === 'ia') renderIA();
  if (name === 'notificaciones') renderNotificaciones();
  if (name === 'perfil') { if (!profileAlias && me) profileAlias = me.alias; renderPerfil(); }
}

// ---------- Polling ----------

function startPolling() {
  stopPolling();
  chatPollTimer = setInterval(pollChat, CHAT_POLL_MS);
  notifTimer = setInterval(refreshBadges, 30000);
}
function stopPolling() {
  if (chatPollTimer) clearInterval(chatPollTimer);
  if (notifTimer) clearInterval(notifTimer);
  chatPollTimer = null;
  notifTimer = null;
}

async function pollChat() {
  if (!me) return;
  const c = await api('/api/chat', { noLogoutOn401: true });
  if (c.status === 200) {
    setBadge('#chat-badge', c.data.unread_total || 0);
    setBadge('#chat-badge-mobile', c.data.unread_total || 0);
    if (currentView === 'mensajes' && !chatThreadId) renderThreadList(c.data.threads || []);
  }
  if (currentView === 'mensajes' && chatThreadId) {
    const r = await api(`/api/chat/${chatThreadId}/messages`, { noLogoutOn401: true });
    if (r.status === 200) renderChatMessages(r.data.messages || [], false);
  }
}

// ---------- Inicio ----------

let composerPhoto = null; // {mime, data, kind}
let composerFeeling = '';

async function renderInicio() {
  const el = $('#view-inicio');
  el.innerHTML = `
    <div class="banner"><div class="banner-inner">
      <span class="ghost-badge" aria-hidden="true"><svg viewBox="0 0 64 64" class="ghost-svg"><path d="M32 6c-11 0-19 8.6-19 20v22.5c0 2.8 3.6 4 5.2 1.8L22 45c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l2.4-3.2c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l3.8-5.3c1.6 2.2 5.2 1 5.2-1.8V26C51 14.6 43 6 32 6z"/><circle cx="24" cy="26" r="3.4" fill="#070716"/><circle cx="40" cy="26" r="3.4" fill="#070716"/><path d="M27 36c2 2.4 8 2.4 10 0" stroke="#070716" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg></span>
      <div><p class="banner-title">Robin Dark</p><p class="banner-sub">Tu mundo, tu gente, tu red</p><p class="banner-tag">Aquí cada idea cuenta…</p></div>
    </div></div>
    <div class="card" id="composer-card">
      <div class="composer">
        ${me ? avatarHtml(me) : `<span class="avatar avatar-fallback">${ico('user')}</span>`}
        <textarea id="composer-text" rows="2" placeholder="¿Qué estás pensando${me ? ', ' + esc(me.alias) : ''}?" aria-label="Escribe una publicación"></textarea>
      </div>
      <div id="composer-preview" class="photo-preview" hidden></div>
      <div class="composer-actions">
        <label class="action-btn" for="composer-photo">${ico('image')} Foto/video</label>
        <input id="composer-photo" type="file" accept="image/png,image/jpeg,video/mp4,video/webm" hidden>
        <button type="button" class="action-btn" id="composer-feeling-btn">${ico('smile')} Sentimiento/actividad</button>
        <button type="button" class="cta" id="composer-publish" style="margin-left:auto">Publicar</button>
      </div>
      <div id="composer-feelings" class="feeling-picker" hidden></div>
    </div>
    <div id="stories-row" class="stories-row"></div>
    <div id="reels-strip"></div>
    <div class="tabs" role="tablist">
      <button type="button" class="pill${feedTab === 'para_ti' ? ' active' : ''}" data-feedtab="para_ti">Para ti</button>
      <button type="button" class="pill${feedTab === 'siguiendo' ? ' active' : ''}" data-feedtab="siguiendo">Siguiendo</button>
      <button type="button" class="pill${feedTab === 'tendencias' ? ' active' : ''}" data-feedtab="tendencias">Tendencias</button>
    </div>
    <div id="ai-recs"></div>
    <div id="feed-list"></div>`;
  $('#composer-photo').addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m) { e.target.value = ''; return; }
    composerPhoto = m;
    const prev = $('#composer-preview');
    prev.hidden = false;
    prev.innerHTML = m.kind === 'image'
      ? `<img src="data:${esc(m.mime)};base64,${m.data}" alt="Foto elegida"><button type="button" class="ghost-btn" id="composer-photo-remove">Quitar</button>`
      : `<video src="data:${esc(m.mime)};base64,${m.data}" controls style="max-width:100%;border-radius:10px"></video><button type="button" class="ghost-btn" id="composer-photo-remove">Quitar</button>`;
    $('#composer-photo-remove').addEventListener('click', () => { composerPhoto = null; prev.hidden = true; prev.innerHTML = ''; $('#composer-photo').value = ''; });
  });
  $('#composer-feeling-btn').addEventListener('click', () => {
    const box = $('#composer-feelings');
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = FEELINGS.filter(Boolean).map((f) => `<button type="button" class="feeling-chip${composerFeeling === f ? ' active' : ''}" data-feeling="${esc(f)}">${esc(f)}</button>`).join('')
      + `<button type="button" class="feeling-chip" data-feeling="">Sin sentimiento</button>`;
  });
  $('#composer-feelings').addEventListener('click', (e) => {
    const b = e.target.closest('[data-feeling]');
    if (!b) return;
    composerFeeling = b.dataset.feeling;
    $$('#composer-feelings .feeling-chip').forEach((c) => c.classList.toggle('active', c.dataset.feeling === composerFeeling && composerFeeling !== ''));
    $('#composer-feelings').hidden = true;
  });
  $('#composer-publish').addEventListener('click', publishPost);
  $$('#view-inicio [data-feedtab]').forEach((b) => b.addEventListener('click', () => {
    feedTab = b.dataset.feedtab;
    feedHashtag = null;
    renderInicio();
  }));
  await Promise.all([renderStoriesRow(), renderReelsStrip(), renderFeed(), renderAiRecs(), loadRightbar()]);
}

async function publishPost() {
  if (!requireLogin('publicar')) return;
  const text = ($('#composer-text').value || '').trim();
  if (!text && !composerPhoto) { notice('Escribe algo o sube una foto o un vídeo.'); return; }
  const body = { text };
  if (composerFeeling) body.feeling = composerFeeling;
  if (composerPhoto) body.photo = { mime: composerPhoto.mime, data: composerPhoto.data };
  const r = await api('/api/social/posts', { method: 'POST', body: JSON.stringify(body) });
  if (r.status === 201) {
    composerPhoto = null;
    composerFeeling = '';
    notice(r.data.moderated ? 'Publicado, pero quedó marcado para revisión.' : '¡Publicado!');
    renderInicio();
  } else if (r.status === 422) notice(r.data.error || 'No se pudo publicar.');
  else notice(r.data.error || 'No se pudo publicar.');
}

async function renderStoriesRow() {
  const row = $('#stories-row');
  if (!row) return;
  const r = await api('/api/social/stories');
  const groups = r.status === 200 ? (r.data.groups || []) : [];
  let html = `<button type="button" class="story-circle" id="story-create"><span class="story-ring create">+</span><span class="muted small">Crear historia</span></button>`;
  html += groups.map((g, gi) => {
    const first = g.stories[0] || {};
    const media = first.media_url;
    const inner = media
      ? (first.media_type === 'video' ? `<span class="story-ring story-video-ring">${ico('play')}</span>` : `<span class="story-ring"><img src="${esc(media)}" alt=""></span>`)
      : `<span class="story-ring" style="background:${STORY_STYLES[first.style_key] || STORY_STYLES.oro}">${esc((g.author.alias || '?')[0].toUpperCase())}</span>`;
    return `<button type="button" class="story-circle" data-story-group="${gi}">${inner}<span class="muted small">${esc(g.author.alias)}</span></button>`;
  }).join('');
  row.innerHTML = html;
  $('#story-create').addEventListener('click', () => { if (requireLogin('crear una historia')) openStoryModal(); });
  $$('#stories-row [data-story-group]').forEach((b) => b.addEventListener('click', () => openStoryViewer(groups, Number(b.dataset.storyGroup))));
}

async function renderReelsStrip() {
  const el = $('#reels-strip');
  if (!el) return;
  const r = await api('/api/social/reels');
  const reels = r.status === 200 ? (r.data.reels || []) : [];
  if (!reels.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:14px 0 10px">Reels <span class="title-gradient">en vertical</span></h2><button type="button" class="link-btn" id="reels-more">Ver todos</button></div>
    <div class="reels-row" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px">${reels.slice(0, 8).map((s) => reelCard(s)).join('')}</div>`;
  $('#reels-more').addEventListener('click', () => showView('reels'));
  $$('#reels-strip .reel-card').forEach((c) => c.addEventListener('click', () => openStoryViewer([{ author: { alias: c.dataset.author }, stories: [reelToStory(c)] }], 0)));
}

function reelToStory(card) {
  return { id: Number(card.dataset.id), text: card.dataset.text || '', media_url: card.dataset.media || '', media_type: card.dataset.mtype || 'image', author: { alias: card.dataset.author } };
}

function reelCard(s) {
  const media = s.media_url
    ? (s.media_type === 'video' ? `<video src="${esc(s.media_url)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(s.media_url)}" alt="">`)
    : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:15px;font-weight:700;padding:12px;text-align:center">${esc(s.text || '')}</div>`;
  return `<div class="reel-card" data-id="${s.id}" data-author="${esc(s.author ? s.author.alias : '')}" data-text="${esc(s.text || '')}" data-media="${esc(s.media_url || '')}" data-mtype="${esc(s.media_type || '')}">
    ${media}<span class="reel-play">${ico('play')}</span>
    <div class="reel-info"><span class="reel-text">${esc(s.text || '')}</span><span class="reel-meta">${ico('heart')} ${s.likes_count || 0} · ${esc(s.author ? s.author.alias : '')}</span></div>
  </div>`;
}

async function renderFeed() {
  const list = $('#feed-list');
  if (!list) return;
  let url = `/api/social/feed?tab=${feedTab}`;
  if (feedHashtag) url += `&hashtag=${encodeURIComponent(feedHashtag)}`;
  const r = await api(url);
  if (r.status !== 200) { list.innerHTML = '<div class="empty"><h3>No se pudo cargar el feed</h3><p class="muted">Inténtalo de nuevo.</p></div>'; return; }
  const posts = r.data.posts || [];
  if (!posts.length) {
    list.innerHTML = `<div class="empty"><h3>${feedTab === 'siguiendo' ? 'Todavía no sigues a nadie' : 'Aún no hay publicaciones'}</h3><p class="muted">${feedTab === 'siguiendo' ? 'Sigue a alguien desde Explorar y sus publicaciones saldrán aquí.' : 'Sé la primera persona en publicar algo.'}</p></div>`;
    return;
  }
  list.innerHTML = posts.map((p) => postCard(p)).join('');
  bindPostCards(list);
}

function postCard(p) {
  const media = p.photo_url
    ? (p.photo_type === 'video' ? `<video class="post-photo" src="${esc(p.photo_url)}" controls preload="metadata"></video>` : `<img class="post-photo" src="${esc(p.photo_url)}" alt="Foto de la publicación">`)
    : '';
  const totalReactions = (p.reactions ? (p.reactions.like || 0) + (p.reactions.love || 0) + (p.reactions.wow || 0) : p.likes_count || 0);
  return `<article class="card post" data-post-id="${p.id}">
    <div class="post-head">${avatarHtml(p.author)}<div style="flex:1;min-width:0">
      <div>${authorLine(p.author)}</div>
      <div class="post-time">${timeAgo(p.created_at)}${p.feeling ? ` · <span class="post-feeling">${esc(p.feeling)}</span>` : ''}</div>
    </div>${me && me.id === p.author.id ? `<button type="button" class="link-btn" data-delete-post="${p.id}">Borrar</button>` : ''}</div>
    ${p.text ? `<p class="post-text">${linkify(p.text)}</p>` : ''}
    ${media}
    <div class="post-counts"><button type="button" class="link-btn" data-reactors="${p.id}">${ico('thumb')} ${p.reactions ? p.reactions.like || 0 : 0} · ${ico('heart')} ${p.reactions ? p.reactions.love || 0 : 0} · ${ico('wow')} ${p.reactions ? p.reactions.wow || 0 : 0}</button><span>${ico('comment')} ${p.comments_count || 0} comentarios</span><span>${ico('share')} ${p.shares || 0} veces compartido</span></div>
    <div class="post-actions">
      <button type="button" class="action-btn${p.my_reaction ? ' active' : ''}" data-like-post="${p.id}">${p.my_reaction === 'love' ? `${ico('heart')} Me encanta` : p.my_reaction === 'wow' ? `${ico('wow')} Me asombra` : `${ico('thumb')} Me gusta`}</button>
      <button type="button" class="action-btn" data-comments-post="${p.id}">${ico('comment')} Comentar</button>
      <span class="share-wrap"><button type="button" class="action-btn" data-share-post="${p.id}">${ico('share')} Compartir</button></span>
    </div>
    <div class="reaction-pop" data-reaction-pop="${p.id}" hidden>
      <button type="button" class="react-btn react-like${p.my_reaction === 'like' ? ' active' : ''}" data-react="${p.id}|like" aria-label="Me gusta">${ico('thumb')}</button>
      <button type="button" class="react-btn react-love${p.my_reaction === 'love' ? ' active' : ''}" data-react="${p.id}|love" aria-label="Me encanta">${ico('heart')}</button>
      <button type="button" class="react-btn react-wow${p.my_reaction === 'wow' ? ' active' : ''}" data-react="${p.id}|wow" aria-label="Me asombra">${ico('wow')}</button>
    </div>
    <div data-comments="${p.id}"></div>
  </article>`;
}

function bindPostCards(root) {
  $$('[data-like-post]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.likePost;
    const pop = $(`[data-reaction-pop="${id}"]`, root);
    if (pop) pop.hidden = !pop.hidden;
  }));
  $$('[data-react]', root).forEach((b) => b.addEventListener('click', async () => {
    const [id, kind] = b.dataset.react.split('|');
    if (!requireLogin('reaccionar')) return;
    const r = await api(`/api/social/posts/${id}/like`, { method: 'POST', body: JSON.stringify({ kind }) });
    if (r.status === 200) renderFeed();
    else notice(r.data.error || 'No se pudo reaccionar.');
  }));
  $$('[data-comments-post]', root).forEach((b) => b.addEventListener('click', () => loadComments(Number(b.dataset.commentsPost))));
  $$('[data-reactors]', root).forEach((b) => b.addEventListener('click', () => openReactors(Number(b.dataset.reactors))));
  $$('[data-share-post]', root).forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openShareMenu(Number(b.dataset.sharePost), b);
  }));
  $$('[data-delete-post]', root).forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/api/social/posts/${b.dataset.deletePost}`, { method: 'DELETE' });
    if (r.status === 200) { notice('Publicación borrada.'); renderFeed(); }
    else notice(r.data.error || 'No se pudo borrar.');
  }));
  $$('[data-alias]', root).forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.alias)));
}

async function openReactors(postId) {
  const r = await api(`/api/social/posts/${postId}/reactions`);
  if (r.status !== 200) { notice(r.data.error || 'No se pudo ver quién reaccionó.'); return; }
  const list = r.data.reactions || [];
  const groups = [['like', `${ico('thumb')} Me gusta`], ['love', `${ico('heart')} Me encanta`], ['wow', `${ico('wow')} Me asombra`]];
  const body = list.length ? groups.map(([kind, label]) => {
    const users = list.filter((x) => x.kind === kind);
    if (!users.length) return '';
    return `<h3 style="margin-top:12px">${label} (${users.length})</h3>` + users.map((x) => `<div class="friend-row">${avatarHtml(x.user)}<div style="flex:1"><button type="button" class="friend-name" data-alias="${esc(x.user.alias)}">${esc(x.user.alias)}</button> ${adminBadgeHtml(x.user.is_admin)}${verifiedHtml(x.user.verified)}</div></div>`).join('');
  }).join('') : '<p class="muted">Aún nadie ha reaccionado a esta publicación.</p>';
  showModal(`<div class="modal-head"><h2>Reacciones</h2><button type="button" class="close-btn">✕</button></div>${body}`);
  $$('#modal-card [data-alias]').forEach((b) => b.addEventListener('click', () => { closeModal(); openProfile(b.dataset.alias); }));
}

async function loadComments(postId) {
  const box = $(`[data-comments="${postId}"]`);
  if (!box) return;
  if (box.dataset.open === '1') { box.innerHTML = ''; box.dataset.open = ''; return; }
  const r = await api(`/api/social/posts/${postId}/comments`);
  const comments = r.status === 200 ? (r.data.comments || []) : [];
  box.dataset.open = '1';
  box.innerHTML = comments.map((c) => `<div class="comment">${avatarHtml(c.author, 'sm')}<div class="comment-body"><div>${authorLine(c.author)}</div><p>${linkify(c.text)}</p></div></div>`).join('')
    + `<form class="comment-form" data-comment-form="${postId}"><input name="text" placeholder="Escribe un comentario…" maxlength="500" aria-label="Escribe un comentario"><button type="submit" class="ghost-btn">Comentar</button></form>`;
  const form = $(`[data-comment-form="${postId}"]`, box);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireLogin('comentar')) return;
    const text = form.text.value.trim();
    if (!text) return;
    const rr = await api(`/api/social/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
    if (rr.status === 201) { loadComments(postId); renderFeed(); }
    else notice(rr.data.error || 'No se pudo comentar.');
  });
}

// ---------- Menú de compartir ----------

function closeShareMenu() {
  const m = $('.share-menu');
  if (m) m.remove();
  shareMenuFor = null;
}
document.addEventListener('click', (e) => {
  if (shareMenuFor && !e.target.closest('.share-menu') && !e.target.closest('[data-share-post]')) closeShareMenu();
});

async function openShareMenu(postId, anchorBtn) {
  closeShareMenu();
  if (!requireLogin('compartir')) return;
  const wrap = anchorBtn.closest('.share-wrap');
  const menu = document.createElement('div');
  menu.className = 'share-menu';
  menu.innerHTML = `
    <button type="button" data-share="story"><span>${ico('book')}</span>Compartir en tu historia</button>
    <button type="button" data-share="group"><span>${ico('users')}</span>Compartir en un grupo</button>
    <button type="button" data-share="friend"><span>${ico('mail')}</span>Enviar a un amigo por mensaje</button>
    <button type="button" data-share="copy"><span>${ico('link')}</span>Copiar enlace</button>
    <button type="button" data-share="outside"><span>${ico('share')}</span>Compartir fuera de la app</button>`;
  wrap.appendChild(menu);
  shareMenuFor = postId;
  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    const kind = b.dataset.share;
    closeShareMenu();
    if (kind === 'story') await shareToStory(postId);
    if (kind === 'group') await shareToGroup(postId);
    if (kind === 'friend') await shareToFriend(postId);
    if (kind === 'copy') await copyPostLink(postId);
    if (kind === 'outside') await shareOutside(postId);
  });
}

async function getPost(postId) {
  const r = await api(`/api/social/posts/${postId}`);
  return r.status === 200 ? r.data.post : null;
}

async function shareToStory(postId) {
  const p = await getPost(postId);
  if (!p) { notice('No se encontró la publicación.'); return; }
  const body = { kind: 'story', text: p.text || '' };
  if (p.photo_url) {
    try {
      const media = await fetchBlobAsBase64(p.photo_url);
      body.media = { mime: media.mime, data: media.data };
    } catch (e) { notice('No se pudo copiar la foto a tu historia.'); return; }
  }
  const r = await api('/api/social/stories', { method: 'POST', body: JSON.stringify(body) });
  if (r.status === 201) { notice('Compartido en tu historia.'); renderStoriesRow(); }
  else notice(r.data.error || 'No se pudo compartir en tu historia.');
}

async function shareToGroup(postId) {
  const p = await getPost(postId);
  if (!p) { notice('No se encontró la publicación.'); return; }
  const g = await api('/api/social/groups?mine=1');
  const groups = g.status === 200 ? (g.data.groups || []).filter((x) => x.is_member) : [];
  if (!groups.length) { notice('Primero únete a un grupo para compartir ahí.'); showView('grupos'); return; }
  showModal(`<div class="modal-head"><h2>Compartir en un grupo</h2><button type="button" class="close-btn">✕</button></div>
    <p class="muted">Elige el grupo donde se publicará:</p>
    ${groups.map((x) => `<button type="button" class="thread-row" data-share-group="${x.id}"><span class="group-ico">${ico('users')}</span><span><strong>${esc(x.name)}</strong><br><span class="muted small">${x.member_count} miembros</span></span></button>`).join('')}`);
  $$('#modal [data-share-group]').forEach((b) => b.addEventListener('click', async () => {
    const body = { text: p.text || '' };
    if (p.photo_url) {
      try {
        const media = await fetchBlobAsBase64(p.photo_url);
        body.photo = { mime: media.mime, data: media.data };
      } catch (e) { notice('No se pudo copiar la foto al grupo.'); return; }
    }
    const r = await api(`/api/social/groups/${b.dataset.shareGroup}/posts`, { method: 'POST', body: JSON.stringify(body) });
    closeModal();
    if (r.status === 201) notice('Compartido en el grupo.');
    else notice(r.data.error || 'No se pudo compartir en el grupo.');
  }));
}

async function shareToFriend(postId) {
  const p = await getPost(postId);
  if (!p) { notice('No se encontró la publicación.'); return; }
  const f = await api(`/api/users/${me.alias}/following`);
  const friends = f.status === 200 ? (f.data.following || []) : [];
  if (!friends.length) { notice('Primero sigue a alguien para enviarle la publicación.'); showView('explorar'); return; }
  const link = `${location.origin}/#post-${postId}`;
  showModal(`<div class="modal-head"><h2>Enviar a un amigo</h2><button type="button" class="close-btn">✕</button></div>
    <p class="muted">Elige a quién le llega por mensaje:</p>
    ${friends.map((u) => `<button type="button" class="thread-row" data-share-friend="${u.id}" data-alias="${esc(u.alias)}">${avatarHtml(u, 'sm')}<span><strong>${esc(u.alias)}</strong> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}</span></button>`).join('')}`);
  $$('#modal [data-share-friend]').forEach((b) => b.addEventListener('click', async () => {
    const t = await api('/api/chat', { method: 'POST', body: JSON.stringify({ user_id: Number(b.dataset.shareFriend) }) });
    if (t.status !== 201 && t.status !== 200) { notice('No se pudo abrir el chat.'); return; }
    const text = p.text ? `Te comparto esta publicación de @${p.author.alias}: «${p.text.slice(0, 200)}» ${link}` : `Te comparto esta publicación de @${p.author.alias}: ${link}`;
    const m = await api(`/api/chat/${t.data.thread.id}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) });
    closeModal();
    if (m.status === 201) { notice(`Enviado a @${b.dataset.alias} por mensaje.`); }
    else notice(m.data.error || 'No se pudo enviar.');
  }));
}

async function copyPostLink(postId) {
  const link = `${location.origin}/#post-${postId}`;
  try {
    await navigator.clipboard.writeText(link);
    notice('Enlace copiado.');
  } catch (e) {
    showModal(`<div class="modal-head"><h2>Copiar enlace</h2><button type="button" class="close-btn">✕</button></div><p class="muted">Copia el enlace de la publicación:</p><input readonly value="${esc(link)}">`);
  }
}

async function shareOutside(postId) {
  const link = `${location.origin}/#post-${postId}`;
  const p = await getPost(postId);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Robin Dark', text: p && p.text ? p.text.slice(0, 200) : 'Mira esta publicación en Robin Dark', url: link });
      return;
    } catch (e) { /* el usuario cerró el menú: no es un error */ return; }
  }
  await copyPostLink(postId);
  notice('Tu navegador no tiene menú para compartir: el enlace quedó copiado.');
}

async function openDeepLink() {
  const m = location.hash.match(/^#post-(\d+)$/);
  if (!m) return;
  const p = await getPost(Number(m[1]));
  if (!p) return;
  showModal(`<div class="modal-head"><h2>Publicación</h2><button type="button" class="close-btn">✕</button></div><div style="margin-top:12px">${postCard(p)}</div>`, true);
  bindPostCards($('#modal-card'));
}

// ---------- Historias: crear y ver ----------

function openStoryModal() {
  let media = null;
  showModal(`<div class="modal-head"><h2>Crear historia</h2><button type="button" class="close-btn">✕</button></div>
    <p class="muted">Las historias duran 24 horas. Puedes poner texto, foto o vídeo corto.</p>
    <textarea id="story-text" rows="3" placeholder="¿Qué quieres contar?" maxlength="500"></textarea>
    <div class="composer-actions">
      <label class="action-btn" for="story-media">${ico('image')} Foto/video</label>
      <input id="story-media" type="file" accept="image/png,image/jpeg,video/mp4,video/webm" hidden>
      <select id="story-style" aria-label="Estilo de la historia">
        <option value="oro">Oro</option><option value="noche">Noche</option><option value="bosque">Bosque</option><option value="fuego">Fuego</option><option value="uva">Uva</option>
      </select>
      <button type="button" class="cta" id="story-publish" style="margin-left:auto">Publicar historia</button>
    </div>
    <div id="story-preview" class="photo-preview" hidden></div>
    <p class="muted small">También puedes crear un reel (se queda visible): desde la vista Reels, con el botón «Crear reel».</p>`);
  $('#story-media').addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m) { e.target.value = ''; return; }
    media = m;
    const prev = $('#story-preview');
    prev.hidden = false;
    prev.innerHTML = m.kind === 'image'
      ? `<img src="data:${esc(m.mime)};base64,${m.data}" alt="Medio elegido">`
      : `<video src="data:${esc(m.mime)};base64,${m.data}" controls style="max-width:100%;border-radius:10px"></video>`;
  });
  $('#story-publish').addEventListener('click', async () => {
    const text = ($('#story-text').value || '').trim();
    const styleKey = $('#story-style').value;
    if (!text && !media) { notice('Pon texto o sube una foto o un vídeo.'); return; }
    const body = { kind: 'story', text, style_key: styleKey };
    if (media) body.media = { mime: media.mime, data: media.data };
    const r = await api('/api/social/stories', { method: 'POST', body: JSON.stringify(body) });
    if (r.status === 201) { closeModal(); notice('Historia publicada.'); renderStoriesRow(); }
    else notice(r.data.error || 'No se pudo publicar la historia.');
  });
}

function openStoryViewer(groups, groupIdx) {
  storyViewer = { groups, groupIdx, storyIdx: 0 };
  renderStoryViewer();
}

function renderStoryViewer() {
  if (!storyViewer) return;
  const g = storyViewer.groups[storyViewer.groupIdx];
  if (!g) { storyViewer = null; closeModal(); return; }
  const s = g.stories[storyViewer.storyIdx];
  if (!s) { storyViewer = null; closeModal(); return; }
  const media = s.media_url
    ? (s.media_type === 'video' ? `<video src="${esc(s.media_url)}" controls autoplay style="max-width:100%;max-height:60vh;border-radius:12px"></video>` : `<img src="${esc(s.media_url)}" alt="Historia">`)
    : `<div class="story-text-big" style="background:${STORY_STYLES[s.style_key] || STORY_STYLES.oro};color:#fff">${esc(s.text || '')}</div>`;
  showModal(`<div class="story-viewer">
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span>${avatarHtml(g.author, 'sm')} <strong>${esc(g.author.alias)}</strong> ${adminBadgeHtml(g.author.is_admin)}${verifiedHtml(g.author.verified)}</span>
      <span class="muted small">${timeAgo(s.created_at)} · ♥ ${s.likes_count || 0}</span>
    </div>
    ${media}
    ${s.text && s.media_url ? `<p style="margin-top:10px">${linkify(s.text)}</p>` : ''}
    <div class="viewer-nav">
      <button type="button" class="ghost-btn" id="story-prev">← Anterior</button>
      <button type="button" class="ghost-btn" id="story-like">${ico('heart')} Me gusta</button>
      <button type="button" class="ghost-btn" id="story-next">Siguiente →</button>
    </div>
    <p class="muted small" style="margin-top:10px">Historia ${storyViewer.storyIdx + 1} de ${g.stories.length} · ${esc(g.author.alias)}</p>
  </div>`);
  $('#story-prev').addEventListener('click', () => {
    if (storyViewer.storyIdx > 0) { storyViewer.storyIdx -= 1; renderStoryViewer(); }
    else if (storyViewer.groupIdx > 0) { storyViewer.groupIdx -= 1; storyViewer.storyIdx = storyViewer.groups[storyViewer.groupIdx].stories.length - 1; renderStoryViewer(); }
  });
  $('#story-next').addEventListener('click', () => {
    if (storyViewer.storyIdx < g.stories.length - 1) { storyViewer.storyIdx += 1; renderStoryViewer(); }
    else if (storyViewer.groupIdx < storyViewer.groups.length - 1) { storyViewer.groupIdx += 1; storyViewer.storyIdx = 0; renderStoryViewer(); }
    else { closeModal(); storyViewer = null; }
  });
  $('#story-like').addEventListener('click', async () => {
    if (!requireLogin('dar Me gusta')) return;
    const r = await api(`/api/social/stories/${s.id}/like`, { method: 'POST', body: JSON.stringify({}) });
    if (r.status === 200) notice(r.data.liked ? 'Te gusta esta historia.' : 'Ya no te gusta.');
    else notice(r.data.error || 'No se pudo dar Me gusta.');
  });
}

// ---------- Recomendaciones de la IA en Inicio ----------

async function renderAiRecs() {
  const el = $('#ai-recs');
  if (!el || !me) { if (el) el.innerHTML = ''; return; }
  const r = await api('/api/ai/recommendations');
  const items = r.status === 200 ? (r.data.recommendations || []) : [];
  if (!items.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="card"><h3 style="margin:0 0 4px">${ico('ghost')} Para ti, de la asistente</h3><p class="muted small" style="margin:0 0 10px">Recomendaciones según a quién sigues y qué te gusta.</p>
    ${items.slice(0, 3).map((it) => `<div class="comment"><div class="comment-body"><div>${esc(it.author_alias)} ${adminBadgeHtml(it.author_is_admin)}${verifiedHtml(it.author_verified)}</div><p>${linkify(it.text || '')}</p><p class="muted small">${esc(it.reason || '')}</p></div></div>`).join('')}</div>`;
}

// ---------- Columna derecha ----------

async function loadRightbar() {
  const sug = $('#suggested-users');
  const grp = $('#suggested-groups');
  const tr = $('#trending-tags');
  const st = $('#stats-strip');
  if (sug) {
    const r = await api('/api/social/trends');
    if (r.status === 200) {
      sug.innerHTML = (r.data.suggested_users || []).slice(0, 5).map((u) => `<button type="button" class="thread-row" data-alias="${esc(u.alias)}">${avatarHtml(u, 'sm')}<span><strong>${esc(u.alias)}</strong> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}<br><span class="muted small">${u.mutual_follows || 0} amigos en común</span></span></button>`).join('') || '<p class="muted small">Sin sugerencias por ahora.</p>';
      if (tr) tr.innerHTML = (r.data.hashtags || []).slice(0, 8).map((h) => `<button type="button" class="link-btn" data-hashtag="${esc(h.tag)}">#${esc(h.tag)} (${h.count})</button>`).join('') || '<p class="muted small">Sin tendencias por ahora.</p>';
    } else if (sug) sug.innerHTML = '<p class="muted small">Entra para ver sugerencias.</p>';
  }
  if (grp) {
    const r = await api('/api/social/groups');
    if (r.status === 200) grp.innerHTML = (r.data.groups || []).slice(0, 4).map((g) => `<button type="button" class="thread-row" data-group="${g.id}"><span class="group-ico">${ico('users')}</span><span><strong>${esc(g.name)}</strong><br><span class="muted small">${g.member_count} miembros</span></span></button>`).join('') || '<p class="muted small">Aún no hay grupos.</p>';
  }
  if (st) {
    const r = await api('/api/stats');
    if (r.status === 200) st.innerHTML = `<span><strong>${r.data.users || 0}</strong> usuarios</span><span><strong>${r.data.posts || 0}</strong> publicaciones</span><span><strong>${r.data.groups || 0}</strong> grupos</span><span><strong>${r.data.follows || 0}</strong> seguimientos</span>`;
  }
  const shortcuts = $('#my-groups-shortcuts');
  if (shortcuts) {
    const r = await api('/api/social/groups?mine=1');
    if (r.status === 200 && (r.data.groups || []).length) {
      shortcuts.innerHTML = r.data.groups.map((g) => `<button type="button" class="thread-row" data-group="${g.id}"><span class="group-ico">${ico('users')}</span><span><strong>${esc(g.name)}</strong><br><span class="muted small">${g.member_count} miembros</span></span></button>`).join('');
    } else shortcuts.innerHTML = '<p class="muted small">Entra para ver tus grupos.</p>';
  }
  $$('#suggested-users [data-alias], #trending-tags [data-hashtag]').forEach((b) => {
    if (b.dataset.alias) b.addEventListener('click', () => openProfile(b.dataset.alias));
    if (b.dataset.hashtag) b.addEventListener('click', () => { feedTab = 'para_ti'; feedHashtag = b.dataset.hashtag; showView('inicio'); });
  });
  $$('#suggested-groups [data-group], #my-groups-shortcuts [data-group]').forEach((b) => b.addEventListener('click', () => { groupDetailId = Number(b.dataset.group); showView('grupos'); }));
}

// ---------- Explorar ----------

async function renderExplorar() {
  const el = $('#view-explorar');
  el.innerHTML = `<div class="card"><h2 style="margin:0 0 10px">${ico('compass')} Explorar</h2>
    <input id="explore-search" type="search" placeholder="Buscar personas por alias…" aria-label="Buscar personas" autocomplete="off">
    <div id="explore-results" style="margin-top:10px"></div></div>
    <div class="card"><h3 style="margin:0 0 10px">${ico('fire')} Tendencias</h3><div id="explore-trends"><p class="muted">Cargando…</p></div></div>
    <div class="card"><h3 style="margin:0 0 10px">Personas que podrías conocer</h3><div id="explore-suggested"><p class="muted">Cargando…</p></div></div>
    <div id="explore-posts"></div>`;
  let timer = null;
  $('#explore-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#explore-results').innerHTML = ''; return; }
    timer = setTimeout(async () => {
      if (!me) { $('#explore-results').innerHTML = '<p class="muted">Entra para buscar miembros.</p>'; return; }
      const r = await api(`/api/users?search=${encodeURIComponent(q)}`);
      if (r.status !== 200) return;
      $('#explore-results').innerHTML = r.data.users.map((u) => `<div class="friend-row">${avatarHtml(u)}<div style="flex:1"><button type="button" class="friend-name" data-alias="${esc(u.alias)}">${esc(u.alias)}</button> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}<div class="friend-sub">${u.followers_count || 0} seguidores</div></div><button type="button" class="ghost-btn" data-follow="${esc(u.alias)}">Seguir</button></div>`).join('') || '<p class="muted">Sin resultados.</p>';
      bindFollowButtons($('#explore-results'));
      $$('#explore-results [data-alias]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.alias)));
    }, 300);
  });
  const t = await api('/api/social/trends');
  if (t.status === 200) {
    $('#explore-trends').innerHTML = (t.data.hashtags || []).map((h) => `<button type="button" class="link-btn" data-hashtag="${esc(h.tag)}">#${esc(h.tag)} (${h.count})</button>`).join('') || '<p class="muted">Sin tendencias por ahora.</p>';
    $('#explore-suggested').innerHTML = (t.data.suggested_users || []).map((u) => `<div class="friend-row">${avatarHtml(u)}<div style="flex:1"><button type="button" class="friend-name" data-alias="${esc(u.alias)}">${esc(u.alias)}</button> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}<div class="friend-sub">${u.mutual_follows || 0} amigos en común · ${u.followers_count || 0} seguidores</div></div><button type="button" class="ghost-btn" data-follow="${esc(u.alias)}">Seguir</button></div>`).join('') || '<p class="muted">Sin sugerencias por ahora.</p>';
    bindFollowButtons($('#explore-suggested'));
    $$('#explore-suggested [data-alias]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.alias)));
    $$('#explore-trends [data-hashtag]').forEach((b) => b.addEventListener('click', () => { feedTab = 'para_ti'; feedHashtag = b.dataset.hashtag; showView('inicio'); }));
  }
  const ex = await api('/api/social/explore');
  if (ex.status === 200 && (ex.data.posts || []).length) {
    $('#explore-posts').innerHTML = `<h3 style="margin:14px 0 10px">Publicaciones para descubrir</h3>` + ex.data.posts.map((p) => postCard(p)).join('');
    bindPostCards($('#explore-posts'));
  }
}

function bindFollowButtons(root) {
  $$('[data-follow]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!requireLogin('seguir')) return;
    const r = await api(`/api/social/follow/${encodeURIComponent(b.dataset.follow)}`, { method: 'POST', body: JSON.stringify({}) });
    if (r.status === 200) {
      b.textContent = r.data.following ? 'Siguiendo ✓' : 'Seguir';
      notice(r.data.following ? `Ahora sigues a @${b.dataset.follow}.` : `Dejaste de seguir a @${b.dataset.follow}.`);
    } else notice(r.data.error || 'No se pudo seguir.');
  }));
}

// ---------- Grupos ----------

async function renderGrupos() {
  const el = $('#view-grupos');
  if (groupDetailId) { await renderGroupDetail(); return; }
  el.innerHTML = `<div class="card"><h2 style="margin:0 0 10px">${ico('users')} Grupos</h2>
    <p class="muted">Crea tu grupo o únete a los que hay. El número de miembros es real.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="group-name" placeholder="Nombre del grupo" maxlength="80" style="flex:1;min-width:180px"><input id="group-desc" placeholder="Descripción (opcional)" maxlength="500" style="flex:2;min-width:180px"><button type="button" class="cta" id="group-create">Crear grupo</button></div></div>
    <div id="groups-list"><p class="muted">Cargando grupos…</p></div>`;
  $('#group-create').addEventListener('click', async () => {
    if (!requireLogin('crear un grupo')) return;
    const name = ($('#group-name').value || '').trim();
    const description = ($('#group-desc').value || '').trim();
    if (!name) { notice('Ponle un nombre al grupo.'); return; }
    const r = await api('/api/social/groups', { method: 'POST', body: JSON.stringify({ name, description }) });
    if (r.status === 201) { notice('Grupo creado.'); groupDetailId = r.data.group.id; renderGrupos(); }
    else notice(r.data.error || 'No se pudo crear el grupo.');
  });
  const r = await api('/api/social/groups');
  if (r.status !== 200) { $('#groups-list').innerHTML = '<p class="muted">No se pudieron cargar los grupos.</p>'; return; }
  const groups = r.data.groups || [];
  $('#groups-list').innerHTML = groups.length
    ? groups.map((g) => `<div class="card group-card"><span class="group-ico">${ico('users')}</span><div style="flex:1"><h4>${esc(g.name)}</h4><p class="muted">${esc(g.description || '')}</p><p class="muted small">Creado por ${esc(g.creator.alias)} · ${g.member_count} miembros</p></div><button type="button" class="ghost-btn" data-group-open="${g.id}">Ver grupo</button>${g.is_member ? `<button type="button" class="ghost-btn" data-group-leave="${g.id}">Salir</button>` : `<button type="button" class="cta" data-group-join="${g.id}">Unirme</button>`}</div>`).join('')
    : '<div class="empty"><h3>Aún no hay grupos</h3><p class="muted">Crea el primero con el formulario de arriba.</p></div>';
  $$('#groups-list [data-group-open]').forEach((b) => b.addEventListener('click', () => { groupDetailId = Number(b.dataset.groupOpen); renderGrupos(); }));
  $$('#groups-list [data-group-join]').forEach((b) => b.addEventListener('click', async () => {
    if (!requireLogin('unirte a un grupo')) return;
    const rr = await api(`/api/social/groups/${b.dataset.groupJoin}/join`, { method: 'POST', body: JSON.stringify({}) });
    if (rr.status === 200) { notice('Te uniste al grupo.'); renderGrupos(); }
    else notice(rr.data.error || 'No se pudo unir.');
  }));
  $$('#groups-list [data-group-leave]').forEach((b) => b.addEventListener('click', async () => {
    const rr = await api(`/api/social/groups/${b.dataset.groupLeave}/leave`, { method: 'POST', body: JSON.stringify({}) });
    if (rr.status === 200) { notice('Saliste del grupo.'); renderGrupos(); }
    else notice(rr.data.error || 'No se pudo salir.');
  }));
}

async function renderGroupDetail() {
  const el = $('#view-grupos');
  const r = await api(`/api/social/groups/${groupDetailId}`);
  if (r.status !== 200) { groupDetailId = null; notice('Ese grupo no existe.'); renderGrupos(); return; }
  const g = r.data.group;
  const members = r.data.members || g.members || [];
  const wall = await api(`/api/social/groups/${groupDetailId}/posts`);
  const wallPosts = wall.status === 200 ? (wall.data.posts || []) : [];
  el.innerHTML = `<button type="button" class="link-btn" id="group-back">← Todos los grupos</button>
    <div class="card"><div class="group-card"><span class="group-ico">${ico('users')}</span><div style="flex:1"><h2 style="margin:0">${esc(g.name)}</h2><p class="muted">${esc(g.description || '')}</p><p class="muted small">Creado por ${esc(g.creator.alias)} · ${g.member_count} miembros</p></div>
    ${g.is_member ? `<button type="button" class="ghost-btn" id="group-leave">Salir del grupo</button>` : `<button type="button" class="cta" id="group-join">Unirme</button>`}
    ${g.is_creator ? `<button type="button" class="danger-btn" id="group-delete">Borrar grupo</button>` : ''}</div></div>
    <div class="card"><h3 style="margin:0 0 10px">Miembros (${members.length})</h3>
      ${members.map((m) => `<div class="friend-row">${avatarHtml(m, 'sm')}<div style="flex:1"><button type="button" class="friend-name" data-alias="${esc(m.alias)}">${esc(m.alias)}</button> ${adminBadgeHtml(m.is_admin)}${verifiedHtml(m.verified)}</div></div>`).join('') || '<p class="muted">Sin miembros.</p>'}</div>
    <div class="card"><h3 style="margin:0 0 10px">Muro del grupo</h3>
      ${g.is_member ? `<div class="composer"><textarea id="wall-text" rows="2" placeholder="Escribe algo en el muro del grupo…" maxlength="2000"></textarea></div>
      <div class="composer-actions"><label class="action-btn" for="wall-photo">${ico('image')} Foto</label><input id="wall-photo" type="file" accept="image/png,image/jpeg" hidden><button type="button" class="cta" id="wall-publish" style="margin-left:auto">Publicar en el muro</button></div>
      <div id="wall-preview" class="photo-preview" hidden></div>` : '<p class="muted">Únete al grupo para publicar en su muro.</p>'}
      <div id="wall-list" style="margin-top:14px">${wallPosts.length ? wallPosts.map((p) => `<article class="post" data-wall-post="${p.id}" style="border-top:1px solid var(--border);padding-top:12px"><div class="post-head">${avatarHtml(p.author, 'sm')}<div style="flex:1"><div>${authorLine(p.author)}</div><div class="post-time">${timeAgo(p.created_at)}</div></div>${(me && (me.id === p.author.id || g.is_creator)) ? `<button type="button" class="link-btn" data-wall-delete="${p.id}">Borrar</button>` : ''}</div>${p.text ? `<p class="post-text">${linkify(p.text)}</p>` : ''}${p.photo_url ? `<img class="post-photo" src="${esc(p.photo_url)}" alt="Foto del muro">` : ''}</article>`).join('') : '<p class="muted">El muro está vacío: sé la primera persona en publicar.</p>'}</div></div>`;
  $('#group-back').addEventListener('click', () => { groupDetailId = null; renderGrupos(); });
  $$('#view-grupos [data-alias]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.alias)));
  const joinBtn = $('#group-join');
  if (joinBtn) joinBtn.addEventListener('click', async () => {
    if (!requireLogin('unirte a un grupo')) return;
    const rr = await api(`/api/social/groups/${groupDetailId}/join`, { method: 'POST', body: JSON.stringify({}) });
    if (rr.status === 200) { notice('Te uniste al grupo.'); renderGroupDetail(); }
    else notice(rr.data.error || 'No se pudo unir.');
  });
  const leaveBtn = $('#group-leave');
  if (leaveBtn) leaveBtn.addEventListener('click', async () => {
    const rr = await api(`/api/social/groups/${groupDetailId}/leave`, { method: 'POST', body: JSON.stringify({}) });
    if (rr.status === 200) { notice('Saliste del grupo.'); renderGroupDetail(); }
    else notice(rr.data.error || 'No se pudo salir.');
  });
  const delBtn = $('#group-delete');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const rr = await api(`/api/social/groups/${groupDetailId}`, { method: 'DELETE' });
    if (rr.status === 200) { notice('Grupo borrado.'); groupDetailId = null; renderGrupos(); }
    else notice(rr.data.error || 'No se pudo borrar el grupo.');
  });
  let wallPhoto = null;
  const wallFile = $('#wall-photo');
  if (wallFile) wallFile.addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m || m.kind !== 'image') { if (m) notice('En el muro solo se aceptan fotos.'); e.target.value = ''; return; }
    wallPhoto = m;
    const prev = $('#wall-preview');
    prev.hidden = false;
    prev.innerHTML = `<img src="data:${esc(m.mime)};base64,${m.data}" alt="Foto elegida">`;
  });
  const wallPub = $('#wall-publish');
  if (wallPub) wallPub.addEventListener('click', async () => {
    const text = ($('#wall-text').value || '').trim();
    if (!text && !wallPhoto) { notice('Escribe algo o sube una foto.'); return; }
    const body = { text };
    if (wallPhoto) body.photo = { mime: wallPhoto.mime, data: wallPhoto.data };
    const rr = await api(`/api/social/groups/${groupDetailId}/posts`, { method: 'POST', body: JSON.stringify(body) });
    if (rr.status === 201) { notice('Publicado en el muro.'); renderGroupDetail(); }
    else notice(rr.data.error || 'No se pudo publicar en el muro.');
  });
  $$('#view-grupos [data-wall-delete]').forEach((b) => b.addEventListener('click', async () => {
    const rr = await api(`/api/social/groups/${groupDetailId}/posts/${b.dataset.wallDelete}`, { method: 'DELETE' });
    if (rr.status === 200) { notice('Publicación del muro borrada.'); renderGroupDetail(); }
    else notice(rr.data.error || 'No se pudo borrar.');
  }));
}

// ---------- Reels ----------

async function renderReels() {
  const el = $('#view-reels');
  el.innerHTML = `<div class="card"><h2 style="margin:0 0 6px">${ico('play')} Reels</h2><p class="muted">Reels con foto o vídeo corto. Se quedan visibles, no caducan.</p>
    <button type="button" class="cta" id="reel-create">Crear reel</button></div>
    <div id="reels-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px"><p class="muted">Cargando reels…</p></div>`;
  $('#reel-create').addEventListener('click', () => { if (requireLogin('crear un reel')) openReelModal(); });
  const r = await api('/api/social/reels');
  const reels = r.status === 200 ? (r.data.reels || []) : [];
  const grid = $('#reels-grid');
  if (!reels.length) { grid.innerHTML = '<div class="empty"><h3>Aún no hay reels</h3><p class="muted">Crea el primero con el botón de arriba.</p></div>'; return; }
  grid.innerHTML = reels.map((s) => reelCard(s)).join('');
  $$('#reels-grid .reel-card').forEach((c) => c.addEventListener('click', () => openStoryViewer([{ author: { alias: c.dataset.author }, stories: [reelToStory(c)] }], 0)));
}

function openReelModal() {
  let media = null;
  showModal(`<div class="modal-head"><h2>Crear reel</h2><button type="button" class="close-btn">✕</button></div>
    <p class="muted">Un reel necesita foto o vídeo corto (MP4/WebM, hasta 20 MB). Se queda visible.</p>
    <textarea id="reel-text" rows="2" placeholder="¿De qué trata tu reel?" maxlength="500"></textarea>
    <div class="composer-actions">
      <label class="action-btn" for="reel-media">${ico('image')} Foto/video</label>
      <input id="reel-media" type="file" accept="image/png,image/jpeg,video/mp4,video/webm" hidden>
      <button type="button" class="cta" id="reel-publish" style="margin-left:auto">Publicar reel</button>
    </div>
    <div id="reel-preview" class="photo-preview" hidden></div>`);
  $('#reel-media').addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m) { e.target.value = ''; return; }
    media = m;
    const prev = $('#reel-preview');
    prev.hidden = false;
    prev.innerHTML = m.kind === 'image'
      ? `<img src="data:${esc(m.mime)};base64,${m.data}" alt="Medio elegido">`
      : `<video src="data:${esc(m.mime)};base64,${m.data}" controls style="max-width:100%;border-radius:10px"></video>`;
  });
  $('#reel-publish').addEventListener('click', async () => {
    const text = ($('#reel-text').value || '').trim();
    if (!media) { notice('Un reel necesita foto o vídeo.'); return; }
    const r = await api('/api/social/stories', { method: 'POST', body: JSON.stringify({ kind: 'reel', text, media: { mime: media.mime, data: media.data } }) });
    if (r.status === 201) { closeModal(); notice('Reel publicado.'); renderReels(); }
    else notice(r.data.error || 'No se pudo publicar el reel.');
  });
}

// ---------- Amigos ----------

async function renderAmigos() {
  const el = $('#view-amigos');
  if (!me) {
    el.innerHTML = `<div class="empty"><h3>Entra para ver a tus amigos</h3><p class="muted">Necesitas una cuenta para seguir gente y ver tus amigos.</p><button type="button" class="cta" id="amigos-login">Entrar o crear mi cuenta</button></div>`;
    $('#amigos-login').addEventListener('click', openAuthModal);
    return;
  }
  el.innerHTML = `<div class="card"><h2 style="margin:0 0 10px">${ico('users')} Amigos</h2>
    <div class="tabs">
      <button type="button" class="pill active" data-amigos-tab="amigos">Amigos</button>
      <button type="button" class="pill" data-amigos-tab="seguidores">Seguidores</button>
      <button type="button" class="pill" data-amigos-tab="seguidos">Seguidos</button>
      <button type="button" class="pill" data-amigos-tab="sugerencias">Sugerencias</button>
    </div>
    <div id="amigos-list"><p class="muted">Cargando…</p></div></div>`;
  const load = async (tab) => {
    $$('#view-amigos [data-amigos-tab]').forEach((b) => b.classList.toggle('active', b.dataset.amigosTab === tab));
    const list = $('#amigos-list');
    if (tab === 'sugerencias') {
      const r = await api('/api/social/trends');
      const users = r.status === 200 ? (r.data.suggested_users || []) : [];
      list.innerHTML = users.length ? users.map((u) => friendRow(u, true)).join('') : '<p class="muted">Sin sugerencias por ahora.</p>';
    } else {
      const path = tab === 'amigos' ? `/api/users/${me.alias}/friends` : tab === 'seguidores' ? `/api/users/${me.alias}/followers` : `/api/users/${me.alias}/following`;
      const r = await api(path);
      const key = tab === 'amigos' ? 'friends' : tab === 'seguidores' ? 'followers' : 'following';
      const users = r.status === 200 ? (r.data[key] || []) : [];
      list.innerHTML = users.length ? users.map((u) => friendRow(u, tab !== 'seguidos')).join('') : `<p class="muted">${tab === 'amigos' ? 'Aún no tienes amigos: sigue a alguien y que te siga de vuelta.' : tab === 'seguidores' ? 'Aún nadie te sigue.' : 'Aún no sigues a nadie.'}</p>`;
    }
    $$('#amigos-list [data-alias]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.alias)));
    bindFollowButtons($('#amigos-list'));
  };
  $$('#view-amigos [data-amigos-tab]').forEach((b) => b.addEventListener('click', () => load(b.dataset.amigosTab)));
  await load('amigos');
}

function friendRow(u, showFollow) {
  return `<div class="friend-row">${avatarHtml(u)}<div style="flex:1"><button type="button" class="friend-name" data-alias="${esc(u.alias)}">${esc(u.alias)}</button> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}<div class="friend-sub">${u.mutual_follows !== undefined ? `${u.mutual_follows} amigos en común · ` : ''}${u.followers_count || 0} seguidores</div></div>${showFollow ? `<button type="button" class="ghost-btn" data-follow="${esc(u.alias)}">Seguir</button>` : ''}</div>`;
}

// ---------- Mensajes directos ----------

async function renderMensajes() {
  const el = $('#view-mensajes');
  if (!me) {
    el.innerHTML = `<div class="empty"><h3>Entra para escribir mensajes</h3><p class="muted">Necesitas una cuenta para hablar por privado.</p><button type="button" class="cta" id="mensajes-login">Entrar o crear mi cuenta</button></div>`;
    $('#mensajes-login').addEventListener('click', openAuthModal);
    return;
  }
  el.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">${ico('mail')} Mensajes</h2><button type="button" class="cta" id="new-message">${ico('mail')} Nuevo mensaje</button></div>
    <div id="thread-list" style="margin-top:10px"><p class="muted">Cargando hilos…</p></div></div>
    <div id="chat-view"></div>`;
  $('#new-message').addEventListener('click', openNewMessageModal);
  const r = await api('/api/chat');
  if (r.status === 200) renderThreadList(r.data.threads || []);
  if (chatThreadId) openChat(chatThreadId, chatOtherAlias, true);
}

function renderThreadList(threads) {
  const list = $('#thread-list');
  if (!list) return;
  if (!threads.length) { list.innerHTML = '<p class="muted">Aún no tienes conversaciones. Pulsa «Nuevo mensaje», elige a un miembro y empieza a hablarle. También puedes abrir su perfil y tocar «Mensaje».</p>'; return; }
  list.innerHTML = threads.map((t) => {
    const o = t.other_user || {};
    return `<button type="button" class="thread-row" data-thread="${t.id}" data-alias="${esc(o.alias || '')}">${avatarHtml(o)}<span style="flex:1;min-width:0"><strong>${esc(o.alias || '')}</strong> ${adminBadgeHtml(o.is_admin)}${verifiedHtml(o.verified)}<br><span class="thread-last">${esc(t.last_body || 'Sin mensajes todavía')}</span></span>${t.unread_count > 0 ? `<span class="thread-unread">${t.unread_count}</span>` : ''}</button>`;
  }).join('');
  $$('#thread-list [data-thread]').forEach((b) => b.addEventListener('click', () => openChat(Number(b.dataset.thread), b.dataset.alias)));
}

function openNewMessageModal() {
  showModal(`<div class="modal-head"><h2>${ico('mail')} Nuevo mensaje</h2><button type="button" class="close-btn">✕</button></div>
    <p class="muted">Busca a un miembro y empieza a hablarle:</p>
    <input id="newmsg-search" type="search" placeholder="Buscar por alias…" autocomplete="off">
    <div id="newmsg-results" class="newmsg-results" style="margin-top:10px"><p class="muted">Escribe al menos 2 letras.</p></div>`);
  let timer = null;
  $('#newmsg-search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#newmsg-results').innerHTML = '<p class="muted">Escribe al menos 2 letras.</p>'; return; }
    $('#newmsg-results').innerHTML = '<p class="muted">Buscando…</p>';
    timer = setTimeout(async () => {
      const r = await api(`/api/users?search=${encodeURIComponent(q)}`);
      if (r.status !== 200) { $('#newmsg-results').innerHTML = '<p class="muted">No se pudo buscar. Inténtalo de nuevo.</p>'; return; }
      $('#newmsg-results').innerHTML = r.data.users.map((u) => {
        // La sub-línea muestra los contadores cuando el servidor
        // los devuelve; si no vienen, no se inventa un 0.
        const subs = [];
        if (typeof u.followers_count === 'number') subs.push(`${u.followers_count} seguidores`);
        if (typeof u.mutual_follows === 'number' && u.mutual_follows > 0) subs.push(`${u.mutual_follows} amigos en común`);
        const sub = subs.length ? `<div class="friend-sub">${subs.join(' · ')}</div>` : '';
        return `<div class="newmsg-row">${avatarHtml(u)}<div style="flex:1;min-width:0"><button type="button" class="friend-name" data-alias="${esc(u.alias)}">${esc(u.alias)}</button> ${adminBadgeHtml(u.is_admin)}${verifiedHtml(u.verified)}${sub}</div><button type="button" class="cta newmsg-btn" data-newmsg="${u.id}" data-alias="${esc(u.alias)}">${ico('mail')} Mensaje</button></div>`;
      }).join('') || '<p class="muted">Sin resultados.</p>';
      $$('#newmsg-results [data-alias]').forEach((b) => b.addEventListener('click', () => { closeModal(); openProfile(b.dataset.alias); }));
      $$('#newmsg-results [data-newmsg]').forEach((b) => b.addEventListener('click', async () => {
        closeModal();
        const t = await api('/api/chat', { method: 'POST', body: JSON.stringify({ user_id: Number(b.dataset.newmsg) }) });
        if (t.status === 201 || t.status === 200) openChat(t.data.thread.id, b.dataset.alias);
        else notice(t.data.error || 'No se pudo abrir el chat.');
      }));
    }, 300);
  });
  $('#newmsg-search').focus();
}

async function openChat(threadId, otherAlias, keepInput) {
  chatThreadId = threadId;
  chatOtherAlias = otherAlias || chatOtherAlias;
  const view = $('#chat-view');
  if (!view) return;
  view.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${ico('comment')} ${esc(chatOtherAlias || 'Chat')}</h3><button type="button" class="link-btn" id="chat-close">Cerrar</button></div>
    <div id="chat-box" class="chat-box" style="margin-top:12px;max-height:50vh;overflow-y:auto"></div>
    <form id="chat-form" class="chat-input-row"><input id="chat-input" placeholder="Escribe un mensaje…" maxlength="2000" autocomplete="off" aria-label="Escribe un mensaje"><button type="submit" class="cta">Enviar</button></form></div>`;
  $('#chat-close').addEventListener('click', () => { chatThreadId = null; chatOtherAlias = null; view.innerHTML = ''; });
  const form = $('#chat-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const body = (input.value || '').trim();
    if (!body) return;
    const r = await api(`/api/chat/${chatThreadId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    if (r.status === 201) { input.value = ''; const m = await api(`/api/chat/${chatThreadId}/messages`); if (m.status === 200) renderChatMessages(m.data.messages || [], true); }
    else notice(r.data.error || 'No se pudo enviar el mensaje.');
  });
  const r = await api(`/api/chat/${chatThreadId}/messages`);
  if (r.status === 200) renderChatMessages(r.data.messages || [], true);
  const input = $('#chat-input');
  if (input) input.focus();
}

function renderChatMessages(messages, scroll) {
  const box = $('#chat-box');
  if (!box) return;
  if (!messages.length) { box.innerHTML = '<p class="muted">Sin mensajes todavía. Escribe el primero.</p>'; return; }
  box.innerHTML = messages.map((m) => `<div class="chat-msg${me && m.sender_id === me.id ? ' mine' : ''}"><div><strong>${esc(m.sender_alias)}</strong> ${adminBadgeHtml(m.sender_is_admin)}${verifiedHtml(m.sender_verified)}</div><div>${linkify(m.body)}</div><div class="chat-meta">${timeAgo(m.created_at)}</div></div>`).join('');
  if (scroll) box.scrollTop = box.scrollHeight;
}

// ---------- Perfil ----------

function openProfile(alias) {
  profileAlias = alias;
  profileTab = 'publicaciones';
  showView('perfil');
}

async function renderPerfil() {
  const el = $('#view-perfil');
  if (!profileAlias) { el.innerHTML = '<div class="empty"><h3>Sin perfil</h3><p class="muted">Elige a un miembro para ver su perfil.</p></div>'; return; }
  const r = await api(`/api/users/${encodeURIComponent(profileAlias)}/profile`);
  if (r.status !== 200) { el.innerHTML = '<div class="empty"><h3>Perfil no encontrado</h3><p class="muted">Ese alias no existe.</p></div>'; return; }
  const p = r.data;
  profileData = p;
  const isOwn = me && me.alias === p.alias;
  // La portada se pinta con <img> en vez de background-image: el
  // fondo degradado del CSS (background: linear-gradient) ganaba
  // en algunos teléfonos y la foto no se veía aunque cover_url
  // estuviera guardada (la foto sí subía: se veía en la
  // publicación «actualizó su foto de portada»). Con <img> la foto
  // siempre se muestra y el degradado queda detrás por si falla.
  const coverImg = p.cover_url ? `<img class="profile-cover-img" src="${esc(p.cover_url)}" alt="Foto de portada de @${esc(p.alias)}">` : '';
  el.innerHTML = `<div class="card${p.seniority === 'antiguo' ? ' profile-antiguo' : ''}" style="padding:0;overflow:hidden">
    <div class="profile-cover">${coverImg}${isOwn ? `<button type="button" class="cover-change-btn" id="profile-cover-change">${ico('camera')} Cambiar portada</button><input id="profile-cover-file" type="file" accept="image/png,image/jpeg,image/heic,image/heif" hidden>` : ''}</div>
    <div style="padding:0 16px 16px">
      <div class="profile-head">
        <span class="profile-avatar-wrap">${avatarHtml({ alias: p.alias, avatar_url: p.avatar_url }, 'lg')}${isOwn ? `<button type="button" class="avatar-cam-btn" id="profile-avatar-change" aria-label="Cambiar foto de perfil">${ico('camera')}</button><input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/heic,image/heif" hidden>` : ''}</span>
        <div style="flex:1;min-width:200px"><h1 class="profile-name">${esc(p.real_name || p.alias)} ${adminBadgeHtml(p.is_admin)}${verifiedHtml(p.verified)}</h1>
        <div class="muted small">@${esc(p.alias)}</div>
        <div style="margin-top:4px">${badgeHtml(p.badge)}${p.seniority === 'antiguo' ? ' <span class="badge-antiguo">★ Antiguo</span>' : ''}${p.seniority === 'nuevo' ? ' <span class="seniority-tag">Perfil nuevo</span>' : ''}${p.disabled ? ` <span class="disabled-badge">${ico('ban')} Cuenta inhabilitada</span>` : ''}</div>
        <div class="profile-stats"><span><strong>${p.posts_count || 0}</strong> publicaciones</span><button type="button" class="link-btn" data-stat-tab="amigos"><strong>${p.followers_count || 0}</strong> seguidores</button><button type="button" class="link-btn" data-stat-tab="amigos"><strong>${p.following_count || 0}</strong> seguidos</button><span><strong>${p.ratings_count || 0}</strong> valoraciones</span><span>${ico('star')} ${p.avg_stars === null || p.avg_stars === undefined ? '—' : p.avg_stars}</span></div></div>
      </div>
      ${p.bio ? `<p style="margin:12px 0 0">${linkify(p.bio)}</p>` : ''}
      <div class="profile-actions">
        ${isOwn ? `<button type="button" class="cta" id="profile-edit">Editar perfil</button><button type="button" class="ghost-btn" id="profile-logout">Cerrar sesión</button>`
          : `<button type="button" class="cta" id="profile-follow">${p.is_following ? 'Siguiendo ✓' : 'Seguir'}</button><button type="button" class="ghost-btn" id="profile-message">${ico('mail')} Mensaje</button>${me && me.is_admin ? `${p.verified ? `<button type="button" class="danger-btn" id="profile-verify">Quitar verificado</button>` : `<button type="button" class="cta" id="profile-verify">${ico('check')} Dar verificado</button>`}${p.disabled ? `<button type="button" class="cta" id="profile-disable">Habilitar cuenta</button>` : `<button type="button" class="danger-btn" id="profile-disable">${ico('ban')} Inhabilitar cuenta</button>`}` : ''}${me && me.is_owner ? `${p.is_admin ? `<button type="button" class="danger-btn" id="profile-admin">Quitar admin</button>` : `<button type="button" class="cta" id="profile-admin">${ico('star')} Hacer admin</button>`}` : ''}`}
      </div>
      ${p.is_friend ? `<p class="muted small">${ico('users')} Son amigos (se siguen mutuamente) · ${p.mutual_follows || 0} amigos en común</p>` : ''}
      <div class="tabs">
        <button type="button" class="pill${profileTab === 'publicaciones' ? ' active' : ''}" data-ptab="publicaciones">Publicaciones</button>
        <button type="button" class="pill${profileTab === 'informacion' ? ' active' : ''}" data-ptab="informacion">Información</button>
        <button type="button" class="pill${profileTab === 'amigos' ? ' active' : ''}" data-ptab="amigos">Amigos</button>
        <button type="button" class="pill${profileTab === 'fotos' ? ' active' : ''}" data-ptab="fotos">Fotos</button>
      </div>
      <div id="profile-tab"></div>
    </div></div>`;
  $$('#view-perfil [data-ptab]').forEach((b) => b.addEventListener('click', () => { profileTab = b.dataset.ptab; renderPerfilTab(); $$('#view-perfil [data-ptab]').forEach((x) => x.classList.toggle('active', x.dataset.ptab === profileTab)); }));
  $$('#view-perfil [data-stat-tab]').forEach((b) => b.addEventListener('click', () => { profileTab = b.dataset.statTab; renderPerfilTab(); $$('#view-perfil [data-ptab]').forEach((x) => x.classList.toggle('active', x.dataset.ptab === profileTab)); }));
  const editBtn = $('#profile-edit');
  if (editBtn) editBtn.addEventListener('click', openEditProfileModal);
  const logoutBtn = $('#profile-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => logout());
  // Cambiar la foto de perfil o de portada sin pasar por «Editar
  // perfil»: el botón de cámara sobre el avatar y el de la
  // portada suben la foto directamente (y se publica sola, como
  // al cambiarla desde el modal). Si la foto no se puede usar,
  // se avisa y no se guarda nada.
  const avChangeBtn = $('#profile-avatar-change');
  if (avChangeBtn) avChangeBtn.addEventListener('click', () => $('#profile-avatar-file').click());
  const avFile = $('#profile-avatar-file');
  if (avFile) avFile.addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m || m.kind !== 'image') { notice(m ? 'La foto de perfil debe ser JPG/PNG.' : (lastPickError || 'No se pudo usar esa foto.')); e.target.value = ''; return; }
    const rr = await api('/api/users/me/profile', { method: 'PATCH', body: JSON.stringify({ avatar: { mime: m.mime, data: m.data } }) });
    if (rr.status === 200) { notice('Foto de perfil actualizada.'); renderPerfil(); }
    else notice(rr.data.error || 'No se pudo guardar la foto de perfil.');
  });
  const coverChangeBtn = $('#profile-cover-change');
  if (coverChangeBtn) coverChangeBtn.addEventListener('click', () => $('#profile-cover-file').click());
  const coverFile = $('#profile-cover-file');
  if (coverFile) coverFile.addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m || m.kind !== 'image') { notice(m ? 'La foto de portada debe ser JPG/PNG.' : (lastPickError || 'No se pudo usar esa foto.')); e.target.value = ''; return; }
    const rr = await api('/api/users/me/profile', { method: 'PATCH', body: JSON.stringify({ cover: { mime: m.mime, data: m.data } }) });
    if (rr.status === 200) { notice('Foto de portada actualizada.'); renderPerfil(); }
    else notice(rr.data.error || 'No se pudo guardar la foto de portada.');
  });
  const followBtn = $('#profile-follow');
  if (followBtn) followBtn.addEventListener('click', async () => {
    if (!requireLogin('seguir')) return;
    const rr = await api(`/api/social/follow/${encodeURIComponent(p.alias)}`, { method: 'POST', body: JSON.stringify({}) });
    if (rr.status === 200) { notice(rr.data.following ? `Ahora sigues a @${p.alias}.` : `Dejaste de seguir a @${p.alias}.`); renderPerfil(); }
    else notice(rr.data.error || 'No se pudo seguir.');
  });
  const msgBtn = $('#profile-message');
  if (msgBtn) msgBtn.addEventListener('click', async () => {
    if (!requireLogin('escribir')) return;
    const rr = await api('/api/chat', { method: 'POST', body: JSON.stringify({ alias: p.alias }) });
    if (rr.status === 201 || rr.status === 200) { showView('mensajes'); openChat(rr.data.thread.id, p.alias); }
    else notice(rr.data.error || 'No se pudo abrir el chat.');
  });
  const verifyBtn = $('#profile-verify');
  if (verifyBtn) verifyBtn.addEventListener('click', async () => {
    const give = !p.verified;
    const rr = await api(`/api/users/${encodeURIComponent(p.alias)}/verify`, { method: 'POST', body: JSON.stringify({ verified: give }) });
    if (rr.status === 200) { notice(give ? `Ahora @${p.alias} está verificado.` : `Se quitó el verificado a @${p.alias}.`); renderPerfil(); }
    else notice(rr.data.error || 'No se pudo cambiar el verificado.');
  });
  // Botón del dueño para inhabilitar (o habilitar) una cuenta que
  // no cumple las normas: la cuenta deja de entrar y desaparece
  // de la vista de los demás. Se pide confirmación porque es
  // permanente (se puede deshacer con «Habilitar cuenta»).
  const disableBtn = $('#profile-disable');
  if (disableBtn) disableBtn.addEventListener('click', async () => {
    const disabling = !p.disabled;
    if (disabling && !window.confirm(`¿Inhabilitar la cuenta de @${p.alias} de forma permanente? No podrá entrar y su perfil y sus publicaciones dejarán de verse.`)) return;
    const rr = await api(`/api/users/${encodeURIComponent(p.alias)}/disable`, { method: 'POST', body: JSON.stringify({ disabled: disabling }) });
    if (rr.status === 200) { notice(disabling ? `La cuenta de @${p.alias} quedó inhabilitada permanentemente.` : `La cuenta de @${p.alias} quedó habilitada de nuevo.`); renderPerfil(); }
    else notice(rr.data.error || 'No se pudo cambiar la cuenta.');
  });
  // Botón del dueño para dar o quitar el admin a quien él quiera:
  // solo el dueño lo ve (me.is_owner), no los admins concedidos.
  // Se pide confirmación porque el admin puede verificar cuentas
  // e inhabilitar a quienes no cumplan las normas.
  const adminBtn = $('#profile-admin');
  if (adminBtn) adminBtn.addEventListener('click', async () => {
    const give = !p.is_admin;
    if (!window.confirm(give ? `¿Hacer admin a @${p.alias}? Podrá verificar cuentas e inhabilitar a quienes no cumplan las normas.` : `¿Quitar el admin a @${p.alias}? Dejará de poder verificar e inhabilitar cuentas.`)) return;
    const rr = await api(`/api/users/${encodeURIComponent(p.alias)}/admin`, { method: 'POST', body: JSON.stringify({ admin: give }) });
    if (rr.status === 200) { notice(give ? `@${p.alias} ahora es admin.` : `Se quitó el admin a @${p.alias}.`); renderPerfil(); }
    else notice(rr.data.error || 'No se pudo cambiar el admin.');
  });
  await renderPerfilTab();
}

async function renderPerfilTab() {
  const box = $('#profile-tab');
  if (!box || !profileData) return;
  const p = profileData;
  const isOwn = me && me.alias === p.alias;
  if (profileTab === 'publicaciones') {
    const r = await api(`/api/users/${encodeURIComponent(p.alias)}/posts`);
    const posts = r.status === 200 ? (r.data.posts || []) : [];
    box.innerHTML = posts.length ? posts.map((x) => postCard(x)).join('') : '<p class="muted">Aún no hay publicaciones.</p>';
    bindPostCards(box);
  } else if (profileTab === 'fotos') {
    const r = await api(`/api/users/${encodeURIComponent(p.alias)}/posts`);
    const posts = r.status === 200 ? (r.data.posts || []).filter((x) => x.photo_url) : [];
    box.innerHTML = posts.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${posts.map((x) => `<button type="button" data-photo-post="${x.id}" style="padding:0;border:0;background:none"><img class="post-photo" style="margin:0" src="${esc(x.photo_url)}" alt="Foto de ${esc(p.alias)}"></button>`).join('')}</div>`
      : '<p class="muted">Aún no hay fotos.</p>';
    $$('#profile-tab [data-photo-post]').forEach((b) => b.addEventListener('click', async () => {
      const post = await getPost(Number(b.dataset.photoPost));
      if (!post) return;
      showModal(`<div class="modal-head"><h2>Foto de @${esc(p.alias)}</h2><button type="button" class="close-btn">✕</button></div><div style="margin-top:12px">${postCard(post)}</div>`, true);
      bindPostCards($('#modal-card'));
    }));
  } else if (profileTab === 'amigos') {
    const fr = await api(`/api/users/${encodeURIComponent(p.alias)}/friends`);
    const friends = fr.status === 200 ? (fr.data.friends || []) : [];
    const fo = await api(`/api/users/${encodeURIComponent(p.alias)}/followers`);
    const followers = fo.status === 200 ? (fo.data.followers || []) : [];
    const fi = await api(`/api/users/${encodeURIComponent(p.alias)}/following`);
    const following = fi.status === 200 ? (fi.data.following || []) : [];
    box.innerHTML = `<h3>Amigos (${friends.length})</h3>${friends.map((u) => friendRow(u, false)).join('') || '<p class="muted">Sin amigos todavía.</p>'}
      <h3 style="margin-top:16px">Seguidores (${followers.length})</h3>${followers.map((u) => friendRow(u, false)).join('') || '<p class="muted">Sin seguidores todavía.</p>'}
      <h3 style="margin-top:16px">Seguidos (${following.length})</h3>${following.map((u) => friendRow(u, false)).join('') || '<p class="muted">No sigue a nadie todavía.</p>'}`;
    $$('#profile-tab [data-alias]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.alias)));
  } else {
    box.innerHTML = `<dl class="info-grid">
      <dt>Miembro desde</dt><dd>${esc(p.member_since || '')} (${p.member_days || 0} días)</dd>
      <dt>Antigüedad</dt><dd>${p.seniority === 'antiguo' ? '★ Antiguo (marco dorado, 90 días o más)' : p.seniority === 'nuevo' ? 'Nuevo (menos de 30 días)' : 'Miembro'}</dd>
      <dt>Reputación</dt><dd>${p.reputation || 0} / 100</dd>
      <dt>Tiempo de respuesta</dt><dd>${esc(p.response_time || 'Sin datos')}</dd>
      <dt>Biografía</dt><dd>${esc(p.bio || '—')}</dd>
    </dl>
    ${isOwn ? `<div style="margin-top:16px">${emailSection()}</div>` : ''}
    <div style="margin-top:16px">${verificationSection(p, isOwn)}</div>`;
    bindEmailSection();
    bindVerificationSection(p, isOwn);
  }
}

function verificationSection(p, isOwn) {
  // El panel de solicitudes es solo del dueño (me.is_owner): un
  // admin concedido no es el dueño y no ve ni resuelve solicitudes.
  if (isOwn && me && me.is_owner) {
    return `<h3>✓ Verificado (Admin)</h3><p class="muted">Eres el dueño de Robin Dark: tu perfil lleva la insignia especial «Admin» y el ✓ Verificado.</p><div id="owner-verif-list"><p class="muted">Cargando solicitudes…</p></div>`;
  }
  if (isOwn) {
    if (p.verified) return `<h3>✓ Verificado</h3><p class="muted">Tu perfil ya está verificado.</p>`;
    const canAsk = (p.followers_count || 0) >= 500 || (p.following_count || 0) >= 500;
    if (!canAsk) return `<h3>Verificación</h3><p class="muted">Para pedir la verificación necesitas tener 500 o más amigos o 500 o más seguidores. Ahora tienes ${p.followers_count || 0} seguidores y ${p.following_count || 0} seguidos.</p>`;
    return `<h3>Verificación</h3><p class="muted">Ya tienes 500 o más amigos o seguidores: puedes pedir la verificación con tu nombre real y una foto de tu documento. El dueño la revisa y la aprueba. Tu nombre real y tu documento nunca se muestran en público.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="verif-name" placeholder="Nombre real" maxlength="120" style="flex:1;min-width:180px"><label class="action-btn" for="verif-doc">${ico('doc')} Foto del documento</label><input id="verif-doc" type="file" accept="image/png,image/jpeg" hidden><button type="button" class="cta" id="verif-send">Pedir verificación</button></div>
      <p class="muted small" id="verif-doc-name"></p><div id="verif-status"></div>`;
  }
  return p.verified ? '<h3>✓ Verificado</h3><p class="muted">Este perfil está verificado.</p>' : '';
}

// Sección del correo en mi propio perfil (pestaña Información):
// muestra si el correo está verificado y, si no, permite poner
// el código de 6 dígitos o pedir uno nuevo.
function emailSection() {
  if (!me || !me.email) return '<h3>Correo</h3><p class="muted">No tienes correo registrado.</p>';
  if (me.email_verified) return `<h3>Correo</h3><p class="muted">✓ Correo verificado: ${esc(me.email)}</p>`;
  return `<h3>Correo</h3><p class="muted">Tu correo <strong>${esc(me.email)}</strong> aún no está verificado. Te enviamos un código de 6 dígitos al registrarte (caduca en 15 minutos).</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="email-code" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos" style="flex:1;min-width:160px"><button type="button" class="cta" id="email-verify">Verificar correo</button><button type="button" class="ghost-btn" id="email-resend">Reenviar código</button></div>
    <p class="muted small" id="email-verify-status"></p>`;
}

async function bindEmailSection() {
  if (!me || !me.email || me.email_verified) return;
  const verifyBtn = $('#email-verify');
  if (verifyBtn) verifyBtn.addEventListener('click', async () => {
    const code = ($('#email-code').value || '').trim();
    const r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: me.email, code }) });
    const st = $('#email-verify-status');
    if (r.status === 200) { await loadMe(); notice('¡Correo verificado!'); renderPerfilTab(); }
    else if (st) st.textContent = r.data.error || 'No se pudo verificar el correo.';
  });
  const resendBtn = $('#email-resend');
  if (resendBtn) resendBtn.addEventListener('click', async () => {
    const r = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: me.email }) });
    const st = $('#email-verify-status');
    if (r.status === 200 && st) st.textContent = 'Si tu correo aún no está verificado, te enviamos un código nuevo.';
    else notice(r.data.error || 'No se pudo reenviar el código.');
  });
}

async function bindVerificationSection(p, isOwn) {
  if (isOwn && me && me.is_owner) {
    const box = $('#owner-verif-list');
    if (!box) return;
    const r = await api('/api/users/me/verification-requests?status=pending');
    const reqs = r.status === 200 ? (r.data.requests || []) : [];
    box.innerHTML = reqs.length
      ? reqs.map((x) => `<div class="verif-req"><p><strong>@${esc(x.user_alias)}</strong> — ${esc(x.real_name)}</p><p class="muted small">Solicitada ${timeAgo(x.created_at)}</p><img class="doc-thumb" src="${esc(x.document_url)}" alt="Documento de verificación"><div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="cta" data-verif-approve="${x.id}">Aprobar y dar verificado</button><button type="button" class="danger-btn" data-verif-reject="${x.id}">Rechazar</button></div></div>`).join('')
      : '<p class="muted">No hay solicitudes de verificación pendientes.</p>';
    $$('#owner-verif-list [data-verif-approve]').forEach((b) => b.addEventListener('click', async () => {
      const rr = await api(`/api/users/me/verification-requests/${b.dataset.verifApprove}/approve`, { method: 'POST', body: JSON.stringify({}) });
      if (rr.status === 200) { notice('Verificado otorgado.'); renderPerfilTab(); }
      else notice(rr.data.error || 'No se pudo aprobar.');
    }));
    $$('#owner-verif-list [data-verif-reject]').forEach((b) => b.addEventListener('click', async () => {
      const rr = await api(`/api/users/me/verification-requests/${b.dataset.verifReject}/reject`, { method: 'POST', body: JSON.stringify({}) });
      if (rr.status === 200) { notice('Solicitud rechazada.'); renderPerfilTab(); }
      else notice(rr.data.error || 'No se pudo rechazar.');
    }));
    return;
  }
  if (!isOwn || p.verified) return;
  const canAsk = (p.followers_count || 0) >= 500 || (p.following_count || 0) >= 500;
  if (!canAsk) return;
  let doc = null;
  const docInput = $('#verif-doc');
  if (docInput) docInput.addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    if (!m || m.kind !== 'image') { if (m) notice('El documento debe ser una foto JPG/PNG.'); e.target.value = ''; return; }
    doc = m;
    const nameEl = $('#verif-doc-name');
    if (nameEl) nameEl.textContent = 'Documento elegido ✓ (JPG/PNG, hasta 5 MB)';
  });
  const sendBtn = $('#verif-send');
  if (sendBtn) sendBtn.addEventListener('click', async () => {
    const realName = ($('#verif-name').value || '').trim();
    if (!realName) { notice('Escribe tu nombre real.'); return; }
    if (!doc) { notice('Sube una foto de tu documento.'); return; }
    const r = await api('/api/users/me/verification', { method: 'POST', body: JSON.stringify({ real_name: realName, document: { mime: doc.mime, data: doc.data } }) });
    const statusEl = $('#verif-status');
    if (r.status === 201) { if (statusEl) statusEl.innerHTML = '<p><strong>Solicitud enviada.</strong> El dueño la revisará y te dará el verificado si la aprueba.</p>'; notice('Solicitud de verificación enviada.'); }
    else notice(r.data.error || 'No se pudo enviar la solicitud.');
  });
  const st = await api('/api/users/me/verification');
  const statusEl = $('#verif-status');
  if (st.status === 200 && st.data.request && statusEl) {
    statusEl.innerHTML = `<p class="muted">Ya tienes una solicitud ${st.data.request.status === 'pending' ? 'pendiente de revisión' : st.data.request.status === 'approved' ? 'aprobada' : 'rechazada'}.</p>`;
  }
}

function openEditProfileModal() {
  const p = profileData;
  if (!p) return;
  let avatar = null;
  let cover = null;
  // El nombre solo se puede cambiar 1 vez al mes: si el último
  // cambio fue hace menos de 30 días, el campo queda bloqueado y
  // se dice cuándo se podrá de nuevo.
  const nextNameChange = p.real_name_changed_at ? Number(p.real_name_changed_at) + 30 * 24 * 60 * 60 * 1000 : 0;
  const nameLocked = nextNameChange > Date.now();
  const nextNameDate = nameLocked ? new Date(nextNameChange).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  // El @usuario también solo se puede cambiar 1 vez al mes.
  const nextAliasChange = p.alias_changed_at ? Number(p.alias_changed_at) + 30 * 24 * 60 * 60 * 1000 : 0;
  const aliasLocked = nextAliasChange > Date.now();
  const nextAliasDate = aliasLocked ? new Date(nextAliasChange).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  showModal(`<div class="modal-head"><h2>Editar perfil</h2><button type="button" class="close-btn">✕</button></div>
    <label class="muted small">Nombre${nameLocked ? ` (podrás cambiarlo de nuevo el ${nextNameDate})` : ' (solo se puede cambiar 1 vez al mes)'}</label>
    <input id="edit-name" maxlength="100" value="${esc(p.real_name || '')}"${nameLocked ? ' disabled' : ''}>
    <label class="muted small">@ Usuario${aliasLocked ? ` (podrás cambiarlo de nuevo el ${nextAliasDate})` : ' (solo se puede cambiar 1 vez al mes)'}</label>
    <input id="edit-alias" maxlength="30" value="${esc(p.alias || '')}"${aliasLocked ? ' disabled' : ''}>
    <label class="muted small">Biografía (máx. 300 caracteres)</label>
    <textarea id="edit-bio" rows="3" maxlength="300">${esc(p.bio || '')}</textarea>
    <div class="composer-actions">
      <label class="action-btn" for="edit-avatar">${ico('image')} Foto de perfil</label>
      <input id="edit-avatar" type="file" accept="image/png,image/jpeg,image/heic,image/heif" hidden>
      <label class="action-btn" for="edit-cover">${ico('image')} Foto de portada</label>
      <input id="edit-cover" type="file" accept="image/png,image/jpeg,image/heic,image/heif" hidden>
    </div>
    <div id="edit-avatar-preview" class="photo-preview" hidden></div>
    <div id="edit-cover-preview" class="photo-preview" hidden></div>
    <p class="form-error" id="edit-photo-error" hidden></p>
    <p class="muted small">JPG o PNG (o HEIC de iPhone, que se convierte sola), hasta 5 MB. Las fotos se guardan y no se borran.</p>
    <button type="button" class="cta" id="edit-save" style="margin-top:10px">Guardar cambios</button>`);
  // Vista previa en vivo y bloqueo del descarte silencioso: si
  // la foto elegida no se pudo usar (HEIC que no se convierte,
  // más de 5 MB que no se achica…), el error queda dentro del
  // modal y el guardado se bloquea hasta que se elija una foto
  // válida o se descarten las que fallaron.
  let avatarFailed = false;
  let coverFailed = false;
  function showPhotoError(msg) {
    const err = $('#edit-photo-error');
    if (!err) return;
    err.innerHTML = `<span>${esc(msg)}</span> <button type="button" class="link-btn" id="edit-photo-dismiss">Descartar</button>`;
    err.hidden = false;
    $('#edit-photo-dismiss').addEventListener('click', () => {
      avatarFailed = false; coverFailed = false;
      err.hidden = true; err.innerHTML = '';
    });
  }
  function clearPhotoError() {
    const err = $('#edit-photo-error');
    if (err) { err.hidden = true; err.innerHTML = ''; }
  }
  $('#edit-avatar').addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    const prev = $('#edit-avatar-preview');
    if (m && m.kind === 'image') {
      avatar = m; avatarFailed = false; clearPhotoError();
      prev.hidden = false;
      prev.innerHTML = `<img src="data:${esc(m.mime)};base64,${m.data}" alt="Foto de perfil elegida"><button type="button" class="ghost-btn" id="edit-avatar-remove">Quitar</button>`;
      $('#edit-avatar-remove').addEventListener('click', () => { avatar = null; avatarFailed = false; prev.hidden = true; prev.innerHTML = ''; $('#edit-avatar').value = ''; clearPhotoError(); });
    } else {
      avatar = null; avatarFailed = true;
      prev.hidden = true; prev.innerHTML = '';
      showPhotoError(m ? 'La foto de perfil debe ser JPG/PNG.' : `Esa foto de perfil no se pudo usar: ${lastPickError || 'formato no aceptado.'}`);
      e.target.value = '';
    }
  });
  $('#edit-cover').addEventListener('change', async (e) => {
    const m = await pickMedia(e.target.files[0]);
    const prev = $('#edit-cover-preview');
    if (m && m.kind === 'image') {
      cover = m; coverFailed = false; clearPhotoError();
      prev.hidden = false;
      prev.innerHTML = `<img src="data:${esc(m.mime)};base64,${m.data}" alt="Foto de portada elegida"><button type="button" class="ghost-btn" id="edit-cover-remove">Quitar</button>`;
      $('#edit-cover-remove').addEventListener('click', () => { cover = null; coverFailed = false; prev.hidden = true; prev.innerHTML = ''; $('#edit-cover').value = ''; clearPhotoError(); });
    } else {
      cover = null; coverFailed = true;
      prev.hidden = true; prev.innerHTML = '';
      showPhotoError(m ? 'La foto de portada debe ser JPG/PNG.' : `Esa foto de portada no se pudo usar: ${lastPickError || 'formato no aceptado.'}`);
      e.target.value = '';
    }
  });
  $('#edit-save').addEventListener('click', async () => {
    if (avatarFailed || coverFailed) {
      showPhotoError('Hay una foto que no se pudo usar: elige una foto JPG/PNG válida o toca «Descartar» para guardar sin ella.');
      return;
    }
    const body = { bio: ($('#edit-bio').value || '').trim() };
    if (!nameLocked) {
      const name = ($('#edit-name').value || '').trim();
      if (!name) { notice('Escribe un nombre.'); return; }
      body.real_name = name;
    }
    if (!aliasLocked) {
      const alias = ($('#edit-alias').value || '').trim();
      if (!alias) { notice('Escribe un @usuario.'); return; }
      body.alias = alias;
    }
    if (avatar) body.avatar = { mime: avatar.mime, data: avatar.data };
    if (cover) body.cover = { mime: cover.mime, data: cover.data };
    const r = await api('/api/users/me/profile', { method: 'PATCH', body: JSON.stringify(body) });
    if (r.status === 200) {
      closeModal();
      // Si cambió el @usuario, el servidor devuelve un token nuevo
      // con el alias nuevo: se guarda y se recarga el perfil.
      if (r.data.token) { saveSession(r.data.token, r.data.user); await loadMe(); }
      if (r.data.user && r.data.user.alias) profileAlias = r.data.user.alias;
      notice(r.data.published_posts ? 'Perfil actualizado. Tu foto también se publicó en el inicio.' : 'Perfil actualizado.');
      renderTopbar(); renderPerfil();
    }
    else notice(r.data.error || 'No se pudo guardar el perfil.');
  });
}

// ---------- IA ----------

async function renderIA() {
  const el = $('#view-ia');
  el.innerHTML = `<div class="card"><div class="ghost-hero"><span class="ghost-badge" aria-hidden="true"><svg viewBox="0 0 64 64" class="ghost-svg"><path d="M32 6c-11 0-19 8.6-19 20v22.5c0 2.8 3.6 4 5.2 1.8L22 45c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l2.4-3.2c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l3.8-5.3c1.6 2.2 5.2 1 5.2-1.8V26C51 14.6 43 6 32 6z"/><circle cx="24" cy="26" r="3.4" fill="#070716"/><circle cx="40" cy="26" r="3.4" fill="#070716"/><path d="M27 36c2 2.4 8 2.4 10 0" stroke="#070716" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg></span>
    <p class="ghost-greeting">¡Buuu! Soy la asistente de Robin Dark</p>
    <p class="muted">Te ayudo con cómo publicar, las historias y los reels, seguir gente, los grupos, los mensajes, Explorar, tu perfil, tu contraseña y la verificación. También te recomiendo reels y publicaciones.</p></div>
    <div id="ai-chat" class="chat-box" style="margin-top:12px"></div>
    <form id="ai-form" class="chat-input-row"><input id="ai-input" placeholder="Pregúntame algo de Robin Dark…" maxlength="500" autocomplete="off" aria-label="Pregunta a la asistente"><button type="submit" class="cta">Preguntar</button></form></div>
    <div class="card"><h3 style="margin:0 0 10px">Recomendaciones para ti</h3><div id="ai-recs-full"><p class="muted">Cargando…</p></div></div>`;
  $('#ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireLogin('preguntar a la asistente')) return;
    const input = $('#ai-input');
    const q = (input.value || '').trim();
    if (!q) return;
    input.value = '';
    const box = $('#ai-chat');
    box.innerHTML += `<div class="chat-msg mine"><div>${linkify(q)}</div></div>`;
    const r = await api('/api/ai/ask', { method: 'POST', body: JSON.stringify({ question: q }) });
    box.innerHTML += `<div class="chat-msg"><div>${ico('ghost')} ${r.status === 200 ? linkify(r.data.answer) : 'La asistente no pudo responder. Inténtalo de nuevo.'}</div></div>`;
    box.scrollTop = box.scrollHeight;
  });
  const recs = await api('/api/ai/recommendations');
  const box = $('#ai-recs-full');
  if (recs.status !== 200) { box.innerHTML = '<p class="muted">Entra para ver recomendaciones.</p>'; return; }
  const items = recs.data.recommendations || [];
  box.innerHTML = items.length
    ? items.map((it) => `<div class="comment"><div class="comment-body"><div>${esc(it.author_alias)} ${adminBadgeHtml(it.author_is_admin)}${verifiedHtml(it.author_verified)}</div><p>${linkify(it.text || '')}</p><p class="muted small">${esc(it.reason || '')}</p></div></div>`).join('')
    : '<p class="muted">Sin recomendaciones por ahora: sigue a alguien o dale Me gusta a algo y la asistente te recomendará.</p>';
}

// ---------- Notificaciones ----------

async function renderNotifPanel() {
  const list = $('#notif-list');
  if (!list) return;
  if (!me) { list.innerHTML = '<p class="muted" style="padding:12px">Entra para ver tus notificaciones.</p>'; return; }
  const r = await api('/api/social/notifications');
  if (r.status !== 200) { list.innerHTML = '<p class="muted" style="padding:12px">No se pudieron cargar.</p>'; return; }
  const items = r.data.notifications || [];
  list.innerHTML = items.length
    ? items.map((n) => `<div class="notif-item${n.unread ? ' unread' : ''}" data-notif-alias="${esc(n.actor_alias || '')}"><span class="notif-ico">${n.kind === 'like' ? ico('thumb') : n.kind === 'comment' ? ico('comment') : ico('users')}</span><span><strong>${esc(n.actor_alias || '')}</strong> ${esc(n.text || '')}<br><span class="muted small">${timeAgo(n.created_at)}</span></span></div>`).join('')
    : '<p class="muted" style="padding:12px">Sin notificaciones todavía.</p>';
  $$('#notif-list [data-notif-alias]').forEach((b) => b.addEventListener('click', () => { $('#notif-panel').hidden = true; openProfile(b.dataset.notifAlias); }));
  if (r.data.unread > 0) {
    await api('/api/social/notifications/seen', { method: 'POST', body: JSON.stringify({}) });
    setBadge('#notif-badge', 0);
  }
}

async function renderNotificaciones() {
  const el = $('#view-notificaciones');
  el.innerHTML = `<div class="card"><h2 style="margin:0 0 10px">${ico('bell')} Notificaciones</h2><div id="notif-full"><p class="muted">Cargando…</p></div></div>`;
  if (!me) { $('#notif-full').innerHTML = '<p class="muted">Entra para ver tus notificaciones.</p>'; return; }
  const r = await api('/api/social/notifications');
  const items = r.status === 200 ? (r.data.notifications || []) : [];
  $('#notif-full').innerHTML = items.length
    ? items.map((n) => `<div class="notif-item${n.unread ? ' unread' : ''}" data-notif-alias="${esc(n.actor_alias || '')}"><span class="notif-ico">${n.kind === 'like' ? ico('thumb') : n.kind === 'comment' ? ico('comment') : ico('users')}</span><span><strong>${esc(n.actor_alias || '')}</strong> ${esc(n.text || '')}<br><span class="muted small">${timeAgo(n.created_at)}</span></span></div>`).join('')
    : '<p class="muted">Sin notificaciones todavía.</p>';
  $$('#notif-full [data-notif-alias]').forEach((b) => b.addEventListener('click', () => openProfile(b.dataset.notifAlias)));
  if (r.data.unread > 0) {
    await api('/api/social/notifications/seen', { method: 'POST', body: JSON.stringify({}) });
    setBadge('#notif-badge', 0);
  }
}

// ---------- Autenticación ----------

function openAuthModal(mode) {
  let m = mode || 'login';
  let verifyEmail = '';
  // Si el envío del código falló, el cuadro de verificación lo dice
  // en vez de afirmar que el código se envió (fallo silencioso).
  let verifySendFailed = false;
  // Si se llega a la verificación porque el login quedó bloqueado
  // por correo sin confirmar, se avisa de que hay que confirmarlo
  // para poder entrar. En los dos casos (registro o login
  // bloqueado) no hay sesión todavía: al verificar o al pulsar
  // "Lo haré después" se vuelve al inicio de sesión.
  let verifyFromLogin = false;
  const render = () => {
    if (m === 'login') {
      showModal(`<div class="modal-close-row"><button type="button" class="close-btn" aria-label="Cerrar">✕</button></div><div class="ghost-hero"><span class="ghost-badge" aria-hidden="true"><svg viewBox="0 0 64 64" class="ghost-svg"><path d="M32 6c-11 0-19 8.6-19 20v22.5c0 2.8 3.6 4 5.2 1.8L22 45c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l2.4-3.2c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l3.8-5.3c1.6 2.2 5.2 1 5.2-1.8V26C51 14.6 43 6 32 6z"/><circle cx="24" cy="26" r="3.4" fill="#070716"/><circle cx="40" cy="26" r="3.4" fill="#070716"/><path d="M27 36c2 2.4 8 2.4 10 0" stroke="#070716" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg></span>
      <p class="ghost-greeting">¡Buuu! ¡Hola!</p><p class="muted">Entra a Robin Dark con tu correo y tu contraseña.</p></div>
      <form id="auth-form"><label class="muted small">Correo</label><input id="auth-login" type="email" autocomplete="username" placeholder="correo@example.com"><label class="muted small">Contraseña</label><input id="auth-pass" type="password" autocomplete="current-password" placeholder="Contraseña"><p class="muted small" id="auth-error" style="color:var(--danger)"></p><button type="submit" class="cta" style="width:100%">Entrar</button></form>
      <p class="auth-switch"><button type="button" class="link-btn" id="auth-forgot">¿Olvidaste tu contraseña?</button></p>
      <p class="auth-switch">¿No tienes cuenta? <button type="button" class="link-btn" id="auth-to-register">Crear cuenta nueva</button></p>`);
      $('#auth-to-register').addEventListener('click', () => { m = 'register'; render(); });
      $('#auth-forgot').addEventListener('click', () => { m = 'forgot'; render(); });
      $('#auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = ($('#auth-login').value || '').trim();
        const password = $('#auth-pass').value || '';
        const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        if (r.status === 200) {
          saveSession(r.data.token, r.data.user);
          closeModal();
          notice(`¡Buuu! ¡Hola, ${r.data.user.real_name || '@' + r.data.user.alias}!`);
          startPolling();
          refreshBadges();
          showView('inicio');
        } else if (r.status === 403 && (r.data.code === 'email_verification_required' || r.data.email_verification_required)) {
          // Correo sin confirmar: la entrada queda bloqueada hasta
          // verificarlo. Se muestra el paso de verificación con
          // ese mismo correo para confirmarlo ahí mismo.
          verifyEmail = r.data.email || email;
          verifyFromLogin = true;
          m = 'verify';
          render();
        } else $('#auth-error').textContent = r.data.error || 'No se pudo entrar.';
      });
    } else if (m === 'register') {
      showModal(`<div class="modal-close-row"><button type="button" class="close-btn" aria-label="Cerrar">✕</button></div><div class="ghost-hero"><span class="ghost-badge" aria-hidden="true"><svg viewBox="0 0 64 64" class="ghost-svg"><path d="M32 6c-11 0-19 8.6-19 20v22.5c0 2.8 3.6 4 5.2 1.8L22 45c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l2.4-3.2c1.2-1.6 3.4-1.6 4.6 0l2.4 3.2c1.2 1.6 3.4 1.6 4.6 0l3.8-5.3c1.6 2.2 5.2 1 5.2-1.8V26C51 14.6 43 6 32 6z"/><circle cx="24" cy="26" r="3.4" fill="#070716"/><circle cx="40" cy="26" r="3.4" fill="#070716"/><path d="M27 36c2 2.4 8 2.4 10 0" stroke="#070716" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg></span>
      <p class="ghost-greeting">¡Buuu! Crea tu cuenta</p><p class="muted">Con tu nombre real, tu correo y una contraseña. Te enviamos un código de verificación a tu correo.</p></div>
      <form id="auth-form"><label class="muted small">Nombre real</label><input id="auth-realname" autocomplete="name" placeholder="Tu nombre real" maxlength="100"><label class="muted small">Alias (@usuario)</label><input id="auth-alias" autocomplete="username" placeholder="alias" maxlength="30"><label class="muted small">Correo</label><input id="auth-email" type="email" autocomplete="email" placeholder="correo@example.com"><label class="muted small">Contraseña (6 o más caracteres)</label><input id="auth-pass" type="password" autocomplete="new-password" placeholder="Contraseña"><p class="muted small" id="auth-error" style="color:var(--danger)"></p><button type="submit" class="cta" style="width:100%">Crear cuenta nueva</button></form>
      <p class="auth-switch">¿Ya tienes cuenta? <button type="button" class="link-btn" id="auth-to-login">Entrar</button></p>`);
      $('#auth-to-login').addEventListener('click', () => { m = 'login'; render(); });
      $('#auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const realName = ($('#auth-realname').value || '').trim();
        const alias = ($('#auth-alias').value || '').trim();
        const email = ($('#auth-email').value || '').trim();
        const password = $('#auth-pass').value || '';
        const r = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ real_name: realName, alias, email, password }) });
        if (r.status === 201) {
          // Sin sesión al registrarse: la entrada queda bloqueada
          // hasta confirmar el correo. Solo se muestra el paso de
          // verificación (poner el código o reenviarlo); "Lo haré
          // después" vuelve al inicio de sesión sin sesión.
          verifyFromLogin = false;
          m = 'verify';
          verifyEmail = email;
          verifySendFailed = !(r.data.email_verification && r.data.email_verification.code_sent);
          render();
          if (verifySendFailed) {
            notice('No pudimos enviarte el código por correo; usa «Reenviar código» para pedirlo de nuevo.');
          }
        } else $('#auth-error').textContent = r.data.error || 'No se pudo crear la cuenta.';
      });
    } else if (m === 'verify') {
      showModal(`<div class="modal-head"><h2>Verifica tu correo</h2><button type="button" class="close-btn">✕</button></div>
      <p class="muted">${verifyFromLogin ? 'Para poder entrar, primero confirma tu correo. ' : ''}Te enviamos un código de 6 dígitos a <strong>${esc(verifyEmail || '')}</strong> (caduca en 15 minutos). Ponlo aquí:</p>${verifySendFailed ? '<p style="color:var(--danger)">No pudimos enviarte el código por correo. Toca «Reenviar código» para pedirlo de nuevo.</p>' : ''}
      <form id="auth-form"><label class="muted small">Código de 6 dígitos</label><input id="verify-code" inputmode="numeric" maxlength="6" placeholder="123456"><p class="muted small" id="auth-error" style="color:var(--danger)"></p><button type="submit" class="cta" style="width:100%">Verificar correo</button></form>
      <p class="auth-switch"><button type="button" class="link-btn" id="verify-resend">Reenviar código</button> · <button type="button" class="link-btn" id="verify-later">Lo haré después</button></p>`);
      $('#verify-later').addEventListener('click', () => {
        // Sin sesión: "Lo haré después" vuelve al inicio de
        // sesión, no entra a la app.
        verifyFromLogin = false;
        m = 'login';
        render();
      });
      $('#verify-resend').addEventListener('click', async () => {
        const rr = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: verifyEmail }) });
        if (rr.status === 200) {
          verifySendFailed = false;
          $('#auth-error').textContent = '';
          notice('Si ese correo está registrado y aún no está verificado, te enviamos un código.');
        } else {
          verifySendFailed = true;
          $('#auth-error').textContent = rr.data.error || 'No se pudo reenviar el código.';
          notice(rr.data.error || 'No se pudo reenviar el código.');
        }
      });
      $('#auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = ($('#verify-code').value || '').trim();
        const r = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: verifyEmail, code }) });
        if (r.status === 200) {
          // Verificado: todavía no hay sesión (el registro no da
          // token y el login estaba bloqueado), así que se vuelve
          // al inicio de sesión para entrar ya verificado.
          verifyFromLogin = false;
          m = 'login';
          render();
          notice('¡Correo verificado! Ya puedes entrar.');
        } else $('#auth-error').textContent = r.data.error || 'No se pudo verificar el correo.';
      });
    } else {
      showModal(`<div class="modal-head"><h2>¿Olvidaste tu contraseña?</h2><button type="button" class="close-btn">✕</button></div>
      <p class="muted">Escribe tu correo y te llega un código de 6 dígitos (caduca en 15 minutos).</p>
      <form id="auth-form"><label class="muted small">Correo</label><input id="auth-email" type="email" placeholder="correo@example.com"><p class="muted small" id="auth-error" style="color:var(--danger)"></p><button type="submit" class="cta" style="width:100%">Enviar código</button></form>
      <p class="auth-switch"><button type="button" class="link-btn" id="auth-to-login">Volver a Entrar</button></p>`);
      $('#auth-to-login').addEventListener('click', () => { m = 'login'; render(); });
      $('#auth-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = ($('#auth-email').value || '').trim();
        const r = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
        if (r.status === 200) {
          showModal(`<div class="modal-head"><h2>Código enviado</h2><button type="button" class="close-btn">✕</button></div>
          <p class="muted">Si ese correo existe en Robin Dark, ya te llegó un código de 6 dígitos. Ponlo aquí con tu contraseña nueva:</p>
          <form id="reset-form"><label class="muted small">Código de 6 dígitos</label><input id="reset-code" inputmode="numeric" maxlength="6" placeholder="123456"><label class="muted small">Contraseña nueva</label><input id="reset-pass" type="password" placeholder="Contraseña nueva"><p class="muted small" id="reset-error" style="color:var(--danger)"></p><button type="submit" class="cta" style="width:100%">Cambiar contraseña</button></form>`);
          $('#reset-form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const code = ($('#reset-code').value || '').trim();
            const password = $('#reset-pass').value || '';
            const rr = await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) });
            if (rr.status === 200) { closeModal(); notice('Contraseña cambiada. Ya puedes entrar.'); m = 'login'; openAuthModal('login'); }
            else $('#reset-error').textContent = rr.data.error || 'No se pudo cambiar la contraseña.';
          });
        } else $('#auth-error').textContent = r.data.error || 'No se pudo enviar el código.';
      });
    }
  };
  render();
}

// ---------- Cookies: consentimiento ----------
// El consentimiento de cookies es de verdad: se guarda en una
// cookie REAL (rd_cookie_consent) y, como respaldo, en
// localStorage con el mismo nombre. La sesión (rd_token, rd_user)
// sigue en localStorage, no en cookies. Sin onclick ni style en
// línea: todo se conecta con addEventListener y clases CSS.
const COOKIE_CONSENT_NAME = 'rd_cookie_consent';
const COOKIE_CONSENT_DAYS = 365;

function readCookie(name) {
  const prefix = `${name}=`;
  const parts = String(document.cookie || '').split(';');
  for (const part of parts) {
    const c = part.trim();
    if (c.startsWith(prefix)) return decodeURIComponent(c.slice(prefix.length));
  }
  return null;
}

function getCookieConsent() {
  // Primero la cookie real; si no está (el navegador la borró),
  // el respaldo de localStorage.
  try {
    const fromCookie = readCookie(COOKIE_CONSENT_NAME);
    if (fromCookie) return JSON.parse(fromCookie);
  } catch (e) { /* valor corrupto: se ignora */ }
  try {
    const fromStorage = localStorage.getItem(COOKIE_CONSENT_NAME);
    if (fromStorage) return JSON.parse(fromStorage);
  } catch (e) { /* valor corrupto: se ignora */ }
  return null;
}

function saveCookieConsent(prefs) {
  const value = {
    necesarias: true,
    preferencias: Boolean(prefs.preferencias),
    estadisticas: Boolean(prefs.estadisticas),
    marketing: Boolean(prefs.marketing),
    ts: Date.now(),
  };
  const encoded = encodeURIComponent(JSON.stringify(value));
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_CONSENT_NAME}=${encoded}; max-age=${COOKIE_CONSENT_DAYS * 24 * 60 * 60}; path=/; SameSite=Lax${secure}`;
  try { localStorage.setItem(COOKIE_CONSENT_NAME, JSON.stringify(value)); } catch (e) { /* sin almacenamiento: la cookie basta */ }
  return value;
}

function hideCookieBanner() {
  const banner = $('#cookie-banner');
  if (banner) banner.remove();
}

function openCookieSettings() {
  const current = getCookieConsent() || {};
  showModal(`<div class="modal-head"><h2>Configuración de cookies</h2><button type="button" class="close-btn">✕</button></div>
    <p class="muted small">Elige qué cookies aceptas. Las necesarias siempre están activas porque sin ellas el sitio no funciona. Más detalle en la <a href="/legal/cookies.html">Política de cookies</a>.</p>
    <label class="cookie-toggle"><span><strong>Necesarias</strong><br><span class="muted small">Imprescindibles para que el sitio funcione.</span></span><input type="checkbox" checked disabled></label>
    <label class="cookie-toggle"><span><strong>Preferencias</strong><br><span class="muted small">Recuerdan tus ajustes dentro del sitio.</span></span><input type="checkbox" id="cookie-pref"${current.preferencias ? ' checked' : ''}></label>
    <label class="cookie-toggle"><span><strong>Estadísticas</strong><br><span class="muted small">Nos ayudarían a saber qué partes del sitio se usan más.</span></span><input type="checkbox" id="cookie-stats"${current.estadisticas ? ' checked' : ''}></label>
    <label class="cookie-toggle"><span><strong>Marketing</strong><br><span class="muted small">Se usarían para anuncios. Hoy no hay publicidad en Robin Dark.</span></span><input type="checkbox" id="cookie-marketing"${current.marketing ? ' checked' : ''}></label>
    <button type="button" class="cta cookie-save-btn" id="cookie-save">Guardar preferencias</button>`);
  $('#cookie-save').addEventListener('click', () => {
    saveCookieConsent({
      preferencias: $('#cookie-pref').checked,
      estadisticas: $('#cookie-stats').checked,
      marketing: $('#cookie-marketing').checked,
    });
    closeModal();
    hideCookieBanner();
    notice('Preferencias de cookies guardadas.');
  });
}

function showCookieBanner() {
  if ($('#cookie-banner') || getCookieConsent()) return;
  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Aviso de cookies');
  banner.innerHTML = `<p>Usamos cookies para que Robin Dark funcione y para recordar tus preferencias. Puedes aceptarlas todas, rechazarlas o configurarlas. Más detalle en la <a href="/legal/cookies.html">Política de cookies</a>.</p>
    <div class="cookie-banner-btns">
      <button type="button" class="cta cookie-accept">Aceptar todo</button>
      <button type="button" class="ghost-btn cookie-reject">Rechazar</button>
      <button type="button" class="ghost-btn cookie-settings">Configurar</button>
    </div>`;
  banner.querySelector('.cookie-accept').addEventListener('click', () => {
    saveCookieConsent({ preferencias: true, estadisticas: true, marketing: true });
    hideCookieBanner();
  });
  banner.querySelector('.cookie-reject').addEventListener('click', () => {
    saveCookieConsent({ preferencias: false, estadisticas: false, marketing: false });
    hideCookieBanner();
  });
  banner.querySelector('.cookie-settings').addEventListener('click', openCookieSettings);
  document.body.appendChild(banner);
}

function initCookieConsent() {
  // El botón del pie reabre el panel de configuración.
  const settingsBtn = $('#footer-cookie-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', openCookieSettings);
  showCookieBanner();
}

// ---------- Inicio de la app ----------

(async function init() {
  try {
    const saved = JSON.parse(localStorage.getItem('rd_user') || 'null');
    if (token && saved) { me = saved; renderTopbar(); updateAuthNotice(); }
  } catch (e) { /* usuario guardado corrupto: se ignora */ }
  renderMenu();
  if (token) { await loadMe(); startPolling(); refreshBadges(); }
  showView('inicio');
  openDeepLink();
  initCookieConsent();
})();
