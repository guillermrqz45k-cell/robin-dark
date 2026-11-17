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
  if (name === 'admin') loadAdmin();
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

// ---- Estadísticas públicas ----
// Solo números desde /api/stats: cuántos usuarios se registraron,
// cuántos anuncios se publicaron, cuántos tratos se cerraron y
// cuántos mensajes se enviaron. Ningún dato personal.
async function loadStats() {
  try {
    const s = await api.call('/api/stats');
    const set = (id, v) => { const el = $(id); if (el) el.textContent = Number(v ?? 0).toLocaleString('es'); };
    set('#stat-users', s.users);
    set('#stat-listings', s.listings);
    set('#stat-deals', s.tratos_cerrados);
    set('#stat-messages', s.messages);
  } catch (e) { /* las estadísticas no bloquean la tienda */ }
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
        <p class="muted small">Stock: <strong>${esc(l.stock_label || (l.stock ?? 1) + ' unidades')}</strong> · Vendedor: ${esc(l.seller_alias)} · Pagos solo en BTC</p>
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
      body: JSON.stringify({ title: fd.get('title'), description: fd.get('description'), price_btc: fd.get('price_btc'), stock: fd.get('stock') }),
    });
    msg.textContent = `Publicado: ${data.listing.title} por ${data.listing.price_display} · Stock: ${data.listing.stock_label}.`;
    msg.className = 'msg ok';
    ev.target.reset(); loadListings(); loadStats();
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
      <span class="price">${esc(o.price_display)}</span> · ${esc(o.status)} · Stock: <strong>${esc(o.stock_label || (o.stock ?? 1) + ' unidades')}</strong><br>
      ${o.status === 'disponible'
        ? `<button class="cta mark-sold-btn" data-id="${o.id}">Marcar como vendido</button>
           <button class="ghost mark-out-btn" data-id="${o.id}">Marcar como agotado</button>
           <button class="ghost restock-btn" data-id="${o.id}">Reponer stock</button>
           <p class="muted small">Solo tú, el vendedor, puedes marcarlo, cuando cierres el trato en el chat. Cada venta descuenta 1 unidad: el anuncio sigue en la tienda hasta que se agote el stock o tú lo des por agotado.</p>`
        : o.status === 'agotado'
          ? `<button class="cta restock-btn" data-id="${o.id}">Reponer stock</button>
             <p class="muted small">Agotado. Nadie puede contactarte por este anuncio hasta que repongas stock.</p>`
          : `<button class="cta restock-btn" data-id="${o.id}">Reponer stock</button>
             <p class="muted small">Vendido (anuncio antiguo). Repón el stock para volver a venderlo.</p>`}
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
    const left = data.listing
      ? (data.listing.status === 'agotado'
        ? ' Era la última unidad: el artículo se agotó.'
        : ` Quedan ${data.listing.stock} ${data.listing.stock === 1 ? 'unidad' : 'unidades'} de este artículo.`)
      : '';
    alert(`Anuncio marcado como vendido. Pago retenido en custodia: ${data.order.price_display}.${left} Se libera cuando el comprador confirme que recibió el producto.`);
    loadAccount(); loadListings(); loadStats(); if (currentConv) loadMessages(currentConv);
  } catch (e) { alert(e.message); }
}

// Marcar como agotado: solo el vendedor. Es, junto con que el
// stock llegue a 0, la única forma de que se acabe un artículo.
async function markOutOfStock(listingId) {
  if (!confirm('¿Dar este artículo por agotado? Dejará de verse en la tienda y nadie nuevo podrá contactarte por él. Puedes reponer el stock cuando quieras.')) return;
  try {
    await api.call(`/api/listings/${listingId}/mark-out-of-stock`, { method: 'POST', body: JSON.stringify({}) });
    alert('Anuncio marcado como agotado.');
    loadAccount(); loadListings(); loadStats();
  } catch (e) { alert(e.message); }
}

// Reponer stock: solo el vendedor. Vuelve a poner en venta un
// anuncio agotado con la cantidad que indique.
async function restock(listingId) {
  const qty = prompt('¿Cuántas unidades quieres poner en stock?');
  if (qty === null) return;
  const stock = Number(qty);
  if (!Number.isInteger(stock) || stock < 1) { alert('La cantidad tiene que ser un número entero mayor que 0.'); return; }
  try {
    const data = await api.call(`/api/listings/${listingId}/restock`, { method: 'POST', body: JSON.stringify({ stock }) });
    alert(`Stock repuesto: ${data.listing.stock_label}. El anuncio vuelve a estar disponible.`);
    loadAccount(); loadListings(); loadStats();
  } catch (e) { alert(e.message); }
}

// Confirmar recepción: solo el comprador. Libera el pago retenido.
async function confirmReceipt(orderId) {
  if (!confirm('¿Confirmas que recibiste el producto? Al confirmar, el pago retenido en BTC se libera al vendedor.')) return;
  try {
    const data = await api.call(`/api/orders/${orderId}/confirm-receipt`, { method: 'POST', body: JSON.stringify({}) });
    alert(`Pago liberado al vendedor: ${data.order.price_display}.`);
    loadAccount(); loadStats(); if (currentConv) loadMessages(currentConv);
  } catch (e) { alert(e.message); }
}

$('#account-content').addEventListener('click', (ev) => {
  const sold = ev.target.closest('.mark-sold-btn');
  if (sold) return markSold(Number(sold.dataset.id));
  const out = ev.target.closest('.mark-out-btn');
  if (out) return markOutOfStock(Number(out.dataset.id));
  const restockBtn = ev.target.closest('.restock-btn');
  if (restockBtn) return restock(Number(restockBtn.dataset.id));
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
    }
    // El vendedor puede marcarlo como vendido en este chat aunque
    // ya haya un pedido con este comprador: con stock, el mismo
    // comprador puede comprar otra unidad. Solo vale si el anuncio
    // sigue disponible (con stock).
    if (d.listing && d.listing.status === 'disponible' && d.conversation.seller_id === api.user.id) {
      soldBtn.hidden = false; actionsEl.hidden = false;
      soldBtn.onclick = () => markSold(d.listing.id, { id: d.conversation.buyer_id });
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
    loadStats();
    showView('shop'); loadListings();
  } catch (e) { msgEl.textContent = e.message; msgEl.className = 'msg error'; }
}
$('#register-form').addEventListener('submit', (ev) => { ev.preventDefault(); authSubmit(ev.target, '/api/auth/register', ev.target.querySelector('[data-msg]')); });
$('#login-form').addEventListener('submit', (ev) => { ev.preventDefault(); authSubmit(ev.target, '/api/auth/login', ev.target.querySelector('[data-msg]')); });

// ---- Panel de administrador ----
// Sesión de admin SEPARADA de la del usuario normal: se guarda en
// rd_admin_token y usa /api/admin/* con JWT role: 'admin'. Las
// credenciales son ADMIN_ALIAS / ADMIN_PASSWORD de las variables
// de entorno; no hay contraseña por defecto en el código.
const adminApi = {
  token: localStorage.getItem('rd_admin_token') || null,
  user: JSON.parse(localStorage.getItem('rd_admin_user') || 'null'),
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
    localStorage.setItem('rd_admin_token', token);
    localStorage.setItem('rd_admin_user', JSON.stringify(user));
  },
  logout() {
    this.token = null; this.user = null;
    localStorage.removeItem('rd_admin_token');
    localStorage.removeItem('rd_admin_user');
  },
};

let adminTab = 'resumen';

function adminLoginHtml(msg = '') {
  return `<form id="admin-login-form" class="card form">
    <h3>Entrar como administrador</h3>
    <p class="muted small">Solo el dueño del sitio. Usa el alias y la contraseña de ADMIN_ALIAS y ADMIN_PASSWORD de las variables de entorno.</p>
    <label>Alias de admin <input name="alias" required placeholder="admin"></label>
    <label>Contraseña de admin <input name="password" type="password" required></label>
    <button type="submit">Entrar al panel</button>
    <p class="msg ${msg ? 'error' : ''}">${esc(msg)}</p>
  </form>`;
}

function adminTabsHtml() {
  const tabs = [['resumen', 'Resumen'], ['usuarios', 'Usuarios'], ['anuncios', 'Anuncios'], ['pedidos', 'Pedidos'], ['custodia', 'Custodia']];
  return `<div class="row">
    <span class="who">◆ Admin: ${esc(adminApi.user?.alias || '')}</span>
    <button id="admin-logout-btn" class="ghost">Salir del panel</button>
  </div>
  <div class="row" style="margin-top:16px">
    ${tabs.map(([k, label]) => `<button class="nav-btn admin-tab ${adminTab === k ? 'active' : ''}" data-tab="${k}">${label}</button>`).join('')}
  </div>
  <div id="admin-tab-content" style="margin-top:16px"><p class="muted">Cargando…</p></div>`;
}

function adminTable(headers, rows) {
  if (!rows.length) return '<p class="muted">No hay registros todavía.</p>';
  return `<div class="table-wrap"><table class="admin-table">
    <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

async function loadAdmin(msg = '') {
  const el = $('#admin-content');
  if (!el) return;
  if (!adminApi.token) {
    el.innerHTML = adminLoginHtml(msg);
    $('#admin-login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        const data = await adminApi.call('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ alias: fd.get('alias'), password: fd.get('password') }),
        });
        adminApi.saveAuth(data);
        adminTab = 'resumen';
        loadAdmin();
      } catch (e) { loadAdmin(e.message); }
    });
    return;
  }
  el.innerHTML = adminTabsHtml();
  $('#admin-logout-btn').addEventListener('click', () => { adminApi.logout(); loadAdmin(); });
  el.querySelectorAll('.admin-tab').forEach((b) => b.addEventListener('click', () => {
    adminTab = b.dataset.tab;
    loadAdminTab();
  }));
  await loadAdminTab();
}

async function loadAdminTab() {
  const content = $('#admin-tab-content');
  if (!content) return;
  content.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    if (adminTab === 'resumen') {
      const s = await adminApi.call('/api/admin/stats');
      content.innerHTML = `
        <div class="stats">
          <div class="stat"><strong>${Number(s.users).toLocaleString('es')}</strong><span>usuarios registrados</span></div>
          <div class="stat"><strong>${Number(s.listings).toLocaleString('es')}</strong><span>anuncios publicados</span></div>
          <div class="stat"><strong>${Number(s.orders).toLocaleString('es')}</strong><span>pedidos</span></div>
          <div class="stat"><strong>${Number(s.tratos_cerrados).toLocaleString('es')}</strong><span>tratos cerrados</span></div>
          <div class="stat"><strong>${Number(s.messages).toLocaleString('es')}</strong><span>mensajes enviados</span></div>
          <div class="stat"><strong>${Number(s.conversations).toLocaleString('es')}</strong><span>conversaciones</span></div>
        </div>
        <div class="card small" style="margin-top:16px">
          <h3>Custodia (escrow) en BTC</h3>
          <p>Retenido: <strong class="price">${Number(s.escrows.retenido)} pedido(s) · ₿ ${esc(s.escrows.retenido_btc)}</strong></p>
          <p>Liberado: <strong>${Number(s.escrows.liberado)} pedido(s) · ₿ ${esc(s.escrows.liberado_btc)}</strong></p>
          <p>Cancelado: <strong>${Number(s.escrows.cancelado)} pedido(s)</strong></p>
          <p class="muted small">Anuncios disponibles: ${Number(s.listings_disponible)} · Agotados: ${Number(s.listings_agotado ?? 0)} · Vendidos: ${Number(s.listings_vendido)}</p>
        </div>`;
    } else if (adminTab === 'usuarios') {
      const d = await adminApi.call('/api/admin/users');
      content.innerHTML = adminTable(
        ['#', 'Alias', 'Registrado', 'Anuncios', 'Pedidos'],
        d.users.map((u) => [u.id, `<strong>${esc(u.alias)}</strong>`, esc(u.created_at), u.listings_count, u.orders_count]),
      );
    } else if (adminTab === 'anuncios') {
      const d = await adminApi.call('/api/admin/listings');
      content.innerHTML = adminTable(
        ['#', 'Título', 'Vendedor', 'Precio', 'Stock', 'Estado', 'Publicado', 'Acción'],
        d.listings.map((l) => [
          l.id, `<strong>${esc(l.title)}</strong><br><span class="muted small">${esc(l.description || '')}</span>`,
          esc(l.seller_alias), esc(l.price_display), Number(l.stock ?? 1), esc(l.status), esc(l.created_at),
          `<button class="ghost admin-delete-listing" data-id="${l.id}">Borrar</button>`,
        ]),
      );
    } else if (adminTab === 'pedidos') {
      const d = await adminApi.call('/api/admin/orders');
      content.innerHTML = adminTable(
        ['#', 'Anuncio', 'Comprador', 'Vendedor', 'Precio', 'Estado', 'Fecha'],
        d.orders.map((o) => [
          o.id, `<strong>${esc(o.listing_title)}</strong>`, esc(o.buyer_alias), esc(o.seller_alias),
          esc(o.price_display), esc(o.status), esc(o.created_at),
        ]),
      );
    } else if (adminTab === 'custodia') {
      const d = await adminApi.call('/api/admin/escrows');
      content.innerHTML = adminTable(
        ['#', 'Anuncio', 'Comprador → Vendedor', 'Importe', 'Custodia', 'Acción'],
        d.escrows.map((o) => [
          o.id, `<strong>${esc(o.listing_title)}</strong>`, `${esc(o.buyer_alias)} → ${esc(o.seller_alias)}`,
          esc(o.price_display), `<span class="muted small">${esc(o.escrow_label)}</span>`,
          o.status === 'retenido'
            ? `<button class="ghost admin-cancel-escrow" data-id="${o.id}">Cancelar custodia</button>`
            : '<span class="muted small">—</span>',
        ]),
      ) + '<p class="muted small">Cancelar una custodia retenida devuelve la unidad al stock y el anuncio vuelve a estar disponible. Una custodia liberada ya no se puede cancelar.</p>';
    }
  } catch (e) {
    if (/401|403|Sesión/.test(e.message) || e.message.includes('administrador')) {
      adminApi.logout();
      loadAdmin(e.message);
      return;
    }
    content.innerHTML = `<p class="msg error">${esc(e.message)}</p>`;
  }
}

$('#admin-content').addEventListener('click', async (ev) => {
  const del = ev.target.closest('.admin-delete-listing');
  if (del) {
    if (!confirm('¿Borrar este anuncio? Solo se puede si no tiene pedidos.')) return;
    try {
      await adminApi.call(`/api/admin/listings/${del.dataset.id}`, { method: 'DELETE' });
      loadAdminTab(); loadStats(); loadListings();
    } catch (e) { alert(e.message); }
    return;
  }
  const cancel = ev.target.closest('.admin-cancel-escrow');
  if (cancel) {
    if (!confirm('¿Cancelar esta custodia retenida? El anuncio vuelve a estar disponible.')) return;
    try {
      await adminApi.call(`/api/admin/escrows/${cancel.dataset.id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      loadAdminTab(); loadStats(); loadListings();
    } catch (e) { alert(e.message); }
  }
});

// Modal (detalle rápido, sin categorías)
$('#modal-close').addEventListener('click', () => { $('#modal').hidden = true; });
$('#modal').addEventListener('click', (ev) => { if (ev.target.id === 'modal') $('#modal').hidden = true; });

renderAuthArea();
loadStats();
loadListings();
