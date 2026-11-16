// public/app.js — interfaz de Robin Dark (JavaScript, sin frameworks).
// Habla con la API del servidor: /api/auth, /api/listings, /api/orders, /api/chat.
const api = {
  token: localStorage.getItem('rd_token') || null,
  user: JSON.parse(localStorage.getItem('rd_user') || 'null'),
  async call(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Algo salió mal.');
    return data;
  },
  saveAuth({ token, user }) {
    this.token = token; this.user = user;
    localStorage.setItem('rd_token', token);
    localStorage.setItem('rd_user', JSON.stringify(user));
  },
  logout() {
    this.token = null; this.user = null;
    localStorage.removeItem('rd_token');
    localStorage.removeItem('rd_user');
  },
};

const $ = (s) => document.querySelector(s);
const listingsEl = $('#listings');
let currentConv = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  const el = $('#view-' + name);
  if (el) el.hidden = false;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'account') loadAccount();
  if (name === 'chat') loadConversations();
}

document.querySelectorAll('.nav-btn').forEach((b) => {
  b.addEventListener('click', () => {
    if ((b.dataset.view === 'sell' || b.dataset.view === 'account' || b.dataset.view === 'chat') && !api.user) {
      showView('auth');
      return;
    }
    showView(b.dataset.view);
  });
});

function renderAuthArea() {
  const area = $('#auth-area');
  if (api.user) {
    area.innerHTML = `<span class="who">◆ ${esc(api.user.alias)}</span> <button id="logout-btn" class="ghost">Salir</button>`;
    $('#logout-btn').addEventListener('click', () => { api.logout(); renderAuthArea(); showView('shop'); loadListings(); });
  } else {
    area.innerHTML = `<button id="enter-btn" class="cta">Entrar / Crear cuenta</button>`;
    $('#enter-btn').addEventListener('click', () => showView('auth'));
  }
}

// ---- Tienda ----
async function loadListings() {
  const q = $('#search-input').value.trim();
  try {
    const data = await api.call('/api/listings' + (q ? '?search=' + encodeURIComponent(q) : ''));
    $('#empty-shop').hidden = data.listings.length > 0;
    listingsEl.innerHTML = data.listings.map((l) => `
      <article class="card listing" data-id="${l.id}">
        <h3>${esc(l.title)}</h3>
        <p class="muted">${esc(l.description || '')}</p>
        <p class="price">${esc(l.price_display)}</p>
        <p class="muted small">Vendedor: ${esc(l.seller_alias)} · Pagos solo en BTC</p>
        <div class="row">
          <button class="buy-btn" data-id="${l.id}">Comprar con BTC</button>
          <button class="ghost chat-btn" data-id="${l.id}">Hablar con el vendedor</button>
        </div>
      </article>`).join('');
  } catch (e) {
    listingsEl.innerHTML = `<p class="msg error">${esc(e.message)}</p>`;
  }
}

listingsEl.addEventListener('click', async (ev) => {
  const buy = ev.target.closest('.buy-btn');
  const chatBtn = ev.target.closest('.chat-btn');
  if (buy) return buyListing(Number(buy.dataset.id));
  if (chatBtn) return openChatForListing(Number(chatBtn.dataset.id));
});

async function buyListing(id) {
  if (!api.user) { showView('auth'); return; }
  if (!confirm('¿Comprar este artículo con BTC? El pago es solo en Bitcoin.')) return;
  try {
    const data = await api.call('/api/orders', { method: 'POST', body: JSON.stringify({ listing_id: id }) });
    alert(`Compra hecha con BTC: ${data.order.price_display}. Ya se abrió el chat con el vendedor.`);
    currentConv = data.conversation_id;
    loadListings(); showView('chat'); loadConversations();
  } catch (e) { alert(e.message); }
}

async function openChatForListing(id) {
  if (!api.user) { showView('auth'); return; }
  try {
    const data = await api.call('/api/chat', { method: 'POST', body: JSON.stringify({ listing_id: id }) });
    currentConv = data.conversation.id;
    showView('chat'); loadConversations();
  } catch (e) { alert(e.message); }
}

$('#search-btn').addEventListener('click', loadListings);
$('#search-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') loadListings(); });

// ---- Vender ----
$('#sell-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const msg = $('#sell-msg');
  try {
    const data = await api.call('/api/listings', {
      method: 'POST',
      body: JSON.stringify({ title: fd.get('title'), description: fd.get('description'), price_btc: fd.get('price_btc') }),
    });
    msg.textContent = `Publicado: ${data.listing.title} por ${data.listing.price_display}.`;
    msg.className = 'msg ok';
    ev.target.reset(); loadListings();
  } catch (e) { msg.textContent = e.message; msg.className = 'msg error'; }
});

// ---- Mi cuenta ----
async function loadAccount() {
  const el = $('#account-content');
  if (!api.user) { el.innerHTML = '<p class="muted">Entra con tu alias para ver tus anuncios, compras y ventas.</p>'; return; }
  try {
    const d = await api.call('/api/orders/account');
    const list = (items, empty) => items.length ? items.map((o) => `
      <div class="card small"><strong>${esc(o.listing_title || o.title)}</strong><br>
      <span class="price">${esc(o.price_display)}</span> · ${esc(o.status)}<br>
      <span class="muted small">${o.buyer_alias ? `Comprador: ${esc(o.buyer_alias)} · Vendedor: ${esc(o.seller_alias)}` : ''}</span></div>`).join('') : `<p class="muted">${empty}</p>`;
    el.innerHTML = `<h3>Mis anuncios</h3>${list(d.listings, 'No has publicado nada todavía.')}
      <h3>Mis compras</h3>${list(d.purchases, 'No has comprado nada todavía.')}
      <h3>Mis ventas</h3>${list(d.sales, 'No has vendido nada todavía.')}`;
  } catch (e) { el.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
}

// ---- Chat ----
async function loadConversations() {
  const el = $('#conv-list');
  if (!api.user) { el.innerHTML = '<p class="muted">Entra para ver tus mensajes.</p>'; return; }
  try {
    const d = await api.call('/api/chat');
    if (!d.conversations.length) { el.innerHTML = '<p class="muted">No tienes conversaciones todavía.</p>'; return; }
    el.innerHTML = d.conversations.map((c) => {
      const other = c.buyer_id === api.user.id ? c.seller_alias : c.buyer_alias;
      return `<button class="conv ${currentConv === c.id ? 'active' : ''}" data-id="${c.id}">
        <strong>${esc(c.listing_title)}</strong><br><span class="muted small">con ${esc(other)}</span></button>`;
    }).join('');
    if (currentConv) loadMessages(currentConv);
  } catch (e) { el.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
}

$('#conv-list').addEventListener('click', (ev) => {
  const b = ev.target.closest('.conv');
  if (b) { currentConv = Number(b.dataset.id); loadConversations(); }
});

async function loadMessages(id) {
  try {
    const d = await api.call(`/api/chat/${id}/messages`);
    $('#chat-messages').innerHTML = d.messages.map((m) => `
      <div class="bubble ${m.sender_id === api.user.id ? 'mine' : ''}">
        <strong>${esc(m.sender_alias)}</strong><br>${esc(m.body)}</div>`).join('') || '<p class="muted">Sin mensajes todavía.</p>';
    $('#chat-form').hidden = false;
  } catch (e) { $('#chat-messages').innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
}

$('#chat-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('#chat-input');
  if (!input.value.trim() || !currentConv) return;
  try {
    await api.call(`/api/chat/${currentConv}/messages`, { method: 'POST', body: JSON.stringify({ body: input.value }) });
    input.value = ''; loadMessages(currentConv);
  } catch (e) { alert(e.message); }
});

// ---- Acceso anónimo ----
async function authSubmit(form, path, msgEl) {
  const fd = new FormData(form);
  try {
    const data = await api.call(path, { method: 'POST', body: JSON.stringify({ alias: fd.get('alias'), password: fd.get('password') }) });
    api.saveAuth(data); renderAuthArea();
    msgEl.textContent = `Bienvenido, ${data.user.alias}.`; msgEl.className = 'msg ok';
    showView('shop'); loadListings();
  } catch (e) { msgEl.textContent = e.message; msgEl.className = 'msg error'; }
}
$('#register-form').addEventListener('submit', (ev) => { ev.preventDefault(); authSubmit(ev.target, '/api/auth/register', ev.target.querySelector('[data-msg]')); });
$('#login-form').addEventListener('submit', (ev) => { ev.preventDefault(); authSubmit(ev.target, '/api/auth/login', ev.target.querySelector('[data-msg]')); });

// Modal (detalle rápido, sin categorías)
$('#modal-close').addEventListener('click', () => { $('#modal').hidden = true; });
$('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') $('#modal').hidden = true; });

renderAuthArea();
loadListings();
