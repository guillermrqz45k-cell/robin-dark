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
          ${l.seller_id === api.user?.id
            ? '<span class="muted small">Es tu anuncio. El trato se cierra en el chat y solo tú puedes marcarlo como vendido.</span>'
            : '<button class="cta contact-btn" data-id="${l.id}">Contactar al vendedor</button>'}
        </div>
        <p class="muted small">El chat es solo para contactar y negociar. No hay compra automática: nada se vende por enviar un mensaje.</p>
      </article>`).join('');
  } catch (e) {
    listingsEl.innerHTML = `<p class="msg error">${esc(e.message)}</p>`;
  }
}

listingsEl.addEventListener('click', async (ev) => {
  const contact = ev.target.closest('.contact-btn');
  if (contact) return openChatForListing(Number(contact.dataset.id));
});

// El chat solo abre la conversación con el vendedor. No compra nada,
// no crea ningún pedido y no marca el anuncio como vendido.
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
// El estado de custodia se muestra en cada pedido, para comprador y
// vendedor. Solo el comprador ve el botón de confirmar recepción;
// el vendedor NUNCA puede liberar el pago.
async function loadAccount() {
  const el = $('#account-content');
  if (!api.user) { el.innerHTML = '<p class="muted">Entra con tu alias para ver tus anuncios, compras y ventas.</p>'; return; }
  try {
    const d = await api.call('/api/orders/account');
    const orderCard = (o, extra = '') => `
      <div class="card small"><strong>${esc(o.listing_title || o.title)}</strong><br>
      <span class="price">${esc(o.price_display)}</span> · ${esc(o.status)}<br>
      <span class="muted small">${esc(o.escrow_label || o.status)}</span><br>
      <span class="muted small">${o.buyer_alias ? `Comprador: ${esc(o.buyer_alias)} · Vendedor: ${esc(o.seller_alias)}` : ''}</span>
      ${extra}</div>`;
    const myListingsHtml = d.listings.length ? d.listings.map((o) => `
      <div class="card small"><strong>${esc(o.title)}</strong><br>
      <span class="price">${esc(o.price_display)}</span> · ${esc(o.status)}<br>
      ${o.status === 'disponible'
        ? `<button class="cta mark-sold-btn" data-id="${o.id}">Marcar como vendido</button>
           <p class="muted small">Solo tú, el vendedor, puedes marcarlo, cuando cierres el trato en el chat.</p>`
        : '<p class="muted small">Vendido. El pago queda en custodia hasta que el comprador confirme que recibió el producto.</p>'}
      </div>`).join('') : '<p class="muted">No has publicado nada todavía.</p>';
    const purchasesHtml = d.purchases.length ? d.purchases.map((o) => orderCard(o, o.status === 'retenido'
      ? `<br><button class="cta confirm-receipt-btn" data-id="${o.id}">Confirmar que recibí el producto</button>
         <p class="muted small">Al confirmar, el pago retenido se libera al vendedor. Solo tú puedes hacerlo.</p>`
      : '')).join('') : '<p class="muted">No has comprado nada todavía.</p>';
    const salesHtml = d.sales.length ? d.sales.map((o) => orderCard(o, o.status === 'retenido'
      ? '<br><p class="muted small">El pago está retenido en custodia. Solo el comprador puede liberarlo cuando confirme que recibió el producto.</p>'
      : '')).join('') : '<p class="muted">No has vendido nada todavía.</p>';
    el.innerHTML = `<h3>Mis anuncios</h3>${myListingsHtml}
      <h3>Mis compras</h3>${purchasesHtml}
      <h3>Mis ventas</h3>${salesHtml}`;
  } catch (e) { el.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
}

// Marcar como vendido: solo el vendedor, con confirmación explícita.
// buyer: { id } cuando se llama desde el chat (ahí ya se sabe quién es
// el comprador), o se pide el alias cuando se llama desde Mi cuenta.
async function markSold(listingId, buyer) {
  let body = { listing_id: listingId, confirm: true };
  if (buyer && buyer.id) {
    body.buyer_id = buyer.id;
  } else {
    const alias = prompt('¿Con qué comprador cerraste el trato en el chat? Escribe su alias:');
    if (!alias) return;
    body.buyer_alias = alias.trim();
  }
  if (!confirm('¿Marcar este anuncio como vendido? El pago en BTC quedará retenido en custodia hasta que el comprador confirme que recibió el producto.')) return;
  try {
    const data = await api.call('/api/orders/mark-sold', { method: 'POST', body: JSON.stringify(body) });
    alert(`Anuncio marcado como vendido. Pago retenido en custodia: ${data.order.price_display}. Se libera cuando el comprador confirme que recibió el producto.`);
    loadAccount(); loadListings(); if (currentConv) loadMessages(currentConv);
  } catch (e) { alert(e.message); }
}

// Confirmar recepción: solo el comprador. Libera el pago retenido.
async function confirmReceipt(orderId) {
  if (!confirm('¿Confirmas que recibiste el producto? Al confirmar, el pago retenido en BTC se libera al vendedor.')) return;
  try {
    const data = await api.call(`/api/orders/${orderId}/confirm-receipt`, { method: 'POST', body: JSON.stringify({}) });
    alert(`Pago liberado al vendedor: ${data.order.price_display}.`);
    loadAccount(); if (currentConv) loadMessages(currentConv);
  } catch (e) { alert(e.message); }
}

$('#account-content').addEventListener('click', (ev) => {
  const sold = ev.target.closest('.mark-sold-btn');
  if (sold) return markSold(Number(sold.dataset.id));
  const conf = ev.target.closest('.confirm-receipt-btn');
  if (conf) return confirmReceipt(Number(conf.dataset.id));
});

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
    // Custodia en el chat: se ve el estado del trato y quién puede actuar.
    const escrowEl = $('#chat-escrow');
    const actionsEl = $('#chat-actions');
    const soldBtn = $('#mark-sold-chat-btn');
    const confBtn = $('#confirm-chat-btn');
    soldBtn.hidden = true; confBtn.hidden = true; actionsEl.hidden = true;
    if (d.order) {
      const label = d.order.status === 'retenido'
        ? 'Pago retenido en custodia — el comprador aún no confirma que recibió el producto.'
        : d.order.status === 'liberado'
          ? 'Pago liberado al vendedor — el comprador confirmó que recibió el producto.'
          : `Pedido: ${d.order.status}`;
      escrowEl.textContent = `Custodia BTC: ${label}`;
      escrowEl.hidden = false;
      if (d.order.status === 'retenido' && d.order.buyer_id === api.user.id) {
        confBtn.hidden = false; actionsEl.hidden = false;
        confBtn.onclick = () => confirmReceipt(d.order.id);
      }
    } else {
      escrowEl.hidden = true;
      // Sin pedido aún: solo el vendedor puede marcarlo como vendido
      // cuando cierre el trato en este chat.
      if (d.listing && d.listing.status === 'disponible' && d.conversation.seller_id === api.user.id) {
        soldBtn.hidden = false; actionsEl.hidden = false;
        soldBtn.onclick = () => markSold(d.listing.id, { id: d.conversation.buyer_id });
      }
    }
    $('#chat-messages').innerHTML = d.messages.map((m) => `
      <div class="bubble ${m.sender_id === api.user.id ? 'mine' : ''}">
        <strong>${esc(m.sender_alias)}</strong><br>${esc(m.body)}</div>`).join('') || '<p class="muted">Sin mensajes todavía. Habla aquí para negociar el trato: enviar un mensaje no compra nada.</p>';
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
