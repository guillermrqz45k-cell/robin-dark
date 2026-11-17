# Robin Dark — Aquí puedes vender de todo

Mercado abierto para vender de todo, en JavaScript (Node.js + Express), con base de datos real. No es un archivo HTML suelto: es un proyecto estructurado, listo para publicar en Railway.

## Qué hace

- **Registro e inicio de sesión anónimos:** solo alias + contraseña. Sin correo, sin teléfono y sin ubicación. Las contraseñas se guardan cifradas con bcrypt. No se guarda ni se muestra la ubicación de nadie.
- **Tienda con buscador:** la búsqueda es la forma de encontrar artículos. No hay filtros ni botones de categorías en ningún lado.
- **Publicar anuncios:** título, descripción, precio en BTC y **cantidad en stock** (por defecto 1). Un anuncio NO es de una sola unidad: se vende unidad a unidad hasta agotar el stock.
- **Chat privado:** solo entre comprador y vendedor, por anuncio. El chat es solo para contactar y negociar: enviar un mensaje nunca crea un pedido, nunca marca el anuncio como vendido y nunca muestra "compra exitosa". Un artículo agotado no admite tratos nuevos.
- **Marcar como vendido (solo el vendedor):** cuando el trato se cierra en el chat, el vendedor marca su anuncio como vendido (en Mi cuenta o en el chat). Eso crea el pedido y **descuenta 1 unidad del stock**. El anuncio sigue en la tienda mientras queden unidades y solo se agota cuando el stock llega a 0. La única otra forma de que se acabe es que el vendedor lo dé por agotado, con el botón "Marcar como agotado" en Mi cuenta; con "Reponer stock" vuelve a estar disponible con la cantidad que indique.
- **Custodia (escrow) en BTC:** al marcar como vendido, el pago queda RETENIDO en custodia (estado: `retenido`). Solo el COMPRADOR puede liberarlo, con el botón "Confirmar que recibí el producto" (en Mi cuenta o en el chat), y solo entonces el pago pasa a `liberado` para el vendedor. El vendedor NO puede liberar el pago él mismo. El estado de custodia se ve en el pedido, en Mi cuenta (comprador y vendedor) y en el chat.
- **Estadísticas públicas:** en la portada se ven los conteos en vivo de la base de datos — usuarios registrados, anuncios publicados, tratos cerrados y mensajes enviados — desde el endpoint público `GET /api/stats`, que devuelve solo números, ningún dato personal.
- **Panel de administrador:** botón "Admin" en la barra superior. Entra solo el dueño del sitio, con alias y contraseña aparte de los usuarios anónimos (variables `ADMIN_ALIAS` y `ADMIN_PASSWORD`); sin esas variables, el login de admin no funciona, porque no hay ninguna contraseña por defecto en el código. El panel muestra los conteos, todos los usuarios (alias y fecha, nunca contraseñas), todos los anuncios (con su stock), todos los pedidos y todas las custodias con su estado. El admin puede borrar un anuncio sin pedidos y cancelar una custodia retenida (el pedido pasa a cancelado y la unidad vuelve al stock, con el anuncio disponible). Los usuarios normales reciben 403 en `/api/admin/*`.
- **Mi cuenta:** mis anuncios, mis compras y mis ventas, cada pedido con su estado de custodia.
- **Pagos solo en BTC:** los precios se escriben en BTC, se guardan en la base de datos como satoshis y se muestran con el símbolo ₿. No hay USD en ningún lado.
- **Monedero recargable con tarjeta (solo usuarios aprobados por el admin):** el admin aprueba por usuario el uso de tarjeta (panel → Usuarios → "Aprobar tarjeta"). Solo un usuario aprobado puede pedir una recarga (de $5 a $500, en USD) desde "Mi saldo" en Mi cuenta; la recarga queda "pendiente" y se paga con tarjeta en Stripe Checkout (la tarjeta nunca pasa por este servidor ni se guarda aquí). Al completarse el pago, Stripe avisa por webhook y el saldo se acredita una sola vez. Sin claves de Stripe, el pago con tarjeta responde 503 y el admin puede completar (acredita el saldo) o rechazar la recarga pendiente desde el panel (pestaña "Recargas"). El saldo se ve en "Mi saldo" y en el historial de recargas. **Nota: pagar anuncios con el saldo es el siguiente paso y aún no está hecho** — los anuncios siguen costando solo en BTC y la custodia (retenido → liberado) no cambia; para pagarlo con saldo falta decidir la conversión BTC/USD.
- **Descripción principal:** solo bienvenida y propósito del mercado. No enumera ejemplos de artículos.

## Estructura

```
robin-dark-js/
├── package.json            # dependencias y scripts (start: node server.js)
├── server.js               # entrada: Express, rutas, archivos públicos
├── railway.json            # configuración de despliegue en Railway
├── .env.example            # variables que hay que configurar
├── .gitignore
├── db/
│   └── schema.sql          # esquema Postgres (referencia; la app crea las tablas sola)
├── src/
│   ├── db.js               # Postgres (DATABASE_URL) o SQLite local (node:sqlite)
│   ├── auth.js             # hash bcrypt + JWT
│   ├── walletService.js    # monedero: acreditar recargas (una sola vez), saldo
│   ├── middleware/
│   │   └── auth.js         # requireAuth (Bearer JWT) y requireAdmin (JWT con role: 'admin')
│   └── routes/
│       ├── admin.js        # POST /api/admin/login · GET /api/admin/stats|users|listings|orders|escrows|topups · POST /api/admin/users/:id/approve-card|revoke-card · POST /api/admin/topups/:id/complete|reject · DELETE /api/admin/listings/:id · POST /api/admin/escrows/:id/cancel
│       ├── wallet.js       # GET /api/wallet/balance|topups · POST /api/wallet/topup/request|/topup/:id/checkout · POST /api/wallet/stripe-webhook
│       ├── auth.js         # POST /api/auth/register, /login · GET /api/auth/me
│       ├── listings.js     # GET/POST /api/listings (búsqueda, publicar con stock) · POST /api/listings/:id/mark-out-of-stock · POST /api/listings/:id/restock
│       ├── orders.js       # POST /api/orders/mark-sold (solo vendedor, con confirmación; descuenta 1 de stock) · POST /api/orders/:id/confirm-receipt (solo comprador, libera la custodia) · GET /api/orders/account
│       ├── stats.js        # GET /api/stats (conteos públicos: usuarios, anuncios, tratos cerrados, mensajes)
│       └── chat.js         # GET/POST /api/chat y /api/chat/:id/messages (enviar un mensaje nunca vende)
└── public/
    ├── index.html          # interfaz
    ├── app.js              # lógica del navegador (fetch a la API)
    └── styles.css          # diseño negro + dorado 3D
```

### Tablas (base de datos)

| Tabla | Guarda |
|---|---|
| `users` | alias, contraseña cifrada, `card_approved` (tarjeta aprobada por el admin), fecha de creación |
| `wallets` | saldo por usuario en centavos de USD (`balance_usd_cents` >= 0) |
| `topups` | recargas: usuario, `amount_usd_cents` ($5–$500), estado (`pendiente`/`completado`/`rechazado`), método `tarjeta`, `stripe_session_id` |
| `listings` | vendedor, título, descripción, `price_sats`, `stock` (unidades que quedan, por defecto 1), estado (disponible/agotado; `vendido` es antiguo) |
| `orders` | anuncio, comprador, vendedor, `price_sats`, estado de custodia (`retenido` → `liberado`; `pagado_btc`/`completado` son estados antiguos) |
| `conversations` | anuncio, comprador, vendedor (única por los tres) |
| `messages` | conversación, remitente, texto |

1 BTC = 100.000.000 satoshis. Ejemplo: 0,015 BTC = 1.500.000 sats.

## Correr en local

```bash
cd robin-dark-js
cp .env.example .env
npm install
npm start
# Abre http://localhost:3000
```

Sin `DATABASE_URL`, usa SQLite en `data/robin-dark.db` (se crea sola). Para probar con Postgres en local, pon `DATABASE_URL=postgres://usuario:clave@localhost:5432/robin_dark` en `.env`.

### Probar la API con curl

```bash
# Salud
curl http://localhost:3000/api/health

# Registrar (vendedor)
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"alias":"vendedor1","password":"secreto123"}'

# Entrar y guardar el token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"alias":"vendedor1","password":"secreto123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

# Publicar (precio en BTC, se guarda en satoshis)
curl -s -X POST http://localhost:3000/api/listings \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Artículo de prueba","description":"Descripción de prueba","price_btc":0.015}'

# Buscar
curl 'http://localhost:3000/api/listings?search=prueba'
```

## Publicar en Railway (recomendado)

Railway corre la app y la base de datos juntas, sin que la página se duerma. Prueba de 30 días con $5 de crédito; luego el plan Hobby es $5/mes e incluye $5 de uso (precios de 2026, verificar en railway.com/pricing).

1. **Sube el proyecto a GitHub:** crea un repositorio (por ejemplo `robin-dark`) y sube esta carpeta.
2. **En Railway (railway.app), crea un proyecto** → *Deploy from GitHub repo* → elige el repositorio `robin-dark`.
3. **Añade Postgres:** en el lienzo del proyecto, *New → Database → Add PostgreSQL*. Railway crea `DATABASE_URL` automáticamente y se la pasa a la app.
4. **Variables:** en el servicio web, *Variables*, añade:
   - `JWT_SECRET` = una cadena larga y secreta (cámbiala, no uses la de ejemplo)
   - `ADMIN_ALIAS` = tu alias de administrador (por ejemplo `admin`)
   - `ADMIN_PASSWORD` = una contraseña larga y secreta, solo para el panel de administrador. Sin estas dos variables, el panel no deja entrar a nadie.
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` y `STRIPE_WEBHOOK_SECRET` (opcional, solo para cobrar recargas con tarjeta; sin ellas, el pago con tarjeta no funciona y el admin revisa las recargas a mano). En el panel de Stripe, crea un webhook que apunte a `https://tu-dominio/api/wallet/stripe-webhook` con el evento `checkout.session.completed` y copia su secreto en `STRIPE_WEBHOOK_SECRET`.
   - `APP_URL` (opcional): la URL pública de la app, para volver tras pagar en Stripe; si no se pone, se usa el host de la petición.
   - `DATABASE_URL` ya la pone Railway al añadir Postgres; si no aparece, usa *Reference* → la variable `DATABASE_URL` del servicio Postgres.
   - Opcional: `PGSSL=false` solo si tu Postgres no usa SSL (en Railway no hace falta).
5. **Despliega:** Railway detecta `railway.json` y arranca con `node server.js`. El healthcheck es `GET /api/health`.
6. **Abre el enlace:** en el servicio web, *Settings → Networking → Generate Domain*. Ese es el enlace público de Robin Dark. Las tablas se crean solas al arrancar; si prefieres crearlas a mano, ejecuta `db/schema.sql` contra esa base de datos.

> Nota: no subas `.env` ni la carpeta `data/` a GitHub (ya están en `.gitignore`). En Railway las variables van en el panel, no en el código.

## Seguridad y privacidad

### Probar el panel de administrador en local

```bash
# En .env (nunca se sube a GitHub), añade:
ADMIN_ALIAS=admin
ADMIN_PASSWORD=una-contrasena-larga-y-secreta
JWT_SECRET=otra-clave-larga-y-secreta
npm start
# Abre http://localhost:3000, pulsa "Admin" y entra con ese alias y contraseña.
# Sin ADMIN_ALIAS y ADMIN_PASSWORD, el login de admin responde 503.
```

- Contraseñas con bcrypt (hash + sal, 12 rondas); nunca se guardan en claro. Máximo 72 bytes: bcrypt trunca en silencio más allá de esa longitud.
- Sesión con JWT (30 días) en el encabezado `Authorization: Bearer`, algoritmo fijado a HS256.
- **JWT_SECRET obligatorio en producción:** si `DATABASE_URL` está puesto (Railway) y `JWT_SECRET` falta o tiene menos de 32 caracteres, el servidor NO arranca. Ya no hay secreto por defecto en el código.
- **Límites de velocidad:** login/registro 10 intentos por IP cada 15 min; login de admin 5 intentos por IP cada 15 min; API en general 300 peticiones por IP cada 15 min. El login con alias inexistente tarda lo mismo que con alias existente (comparación bcrypt falsa) para no filtrar qué alias existen.
- **Cabeceras de seguridad (helmet):** Content-Security-Policy estricta (solo recursos del propio sitio), no se puede meter la tienda en un iframe de otra web, nosniff y HSTS.
- **Escrow sin carreras:** marcar como vendido y liberar/cancelar la custodia usan actualizaciones atómicas (`UPDATE ... WHERE status=...`). Al vender, el stock se descuenta de forma atómica (`UPDATE ... SET stock = stock - 1 WHERE status='disponible' AND stock > 0`): dos ventas a la vez de la última unidad no pueden crear dos pedidos ni dejar el stock en negativo. Un mismo anuncio puede tener muchos pedidos, uno por unidad vendida; por eso se eliminó el índice único de un pedido por anuncio. Para cerrar un trato tiene que haber al menos un mensaje en el chat.
- **Validación de entradas:** IDs numéricos, cuerpos JSON que sean objetos, búsqueda limitada a 100 caracteres con comodines `%`/`_` escapados, precio máximo de 21.000.000 BTC y satoshis como entero seguro, stock entero entre 1 y 10.000.
- **Sin inyección SQL:** todas las consultas usan parámetros (`$1`, `$2`…); la búsqueda usa `LIKE` parametrizado con `ESCAPE`.
- **Sin XSS en la interfaz:** todos los datos de usuarios (alias, títulos, descripciones, mensajes) se escapan antes de insertarlos en el HTML.
- **Autorización:** cada chat, pedido y anuncio se comprueba contra el usuario del token (nadie ve el chat de otro, nadie marca vendido el anuncio de otro, solo el comprador libera su custodia, solo el vendedor la marca). El panel de admin exige JWT con `role: 'admin'`; un usuario normal recibe 403. El admin nunca se hace pasar por un usuario en el chat.
- El panel de admin usa un JWT aparte con `role: 'admin'`; las credenciales de admin viven solo en variables de entorno y no hay ninguna contraseña por defecto en el código.
- No hay geolocalización, ni correo, ni teléfono, ni IP guardada en la base de datos.
- En producción, pon un `JWT_SECRET` largo y distinto, y usa HTTPS (Railway lo da con su dominio).

### Riesgos que quedan (conocidos, no corregidos aquí)
- El token JWT se guarda en `localStorage` del navegador: si un día hubiera un XSS, el token podría robarse. La CSP estricta y el escapado de todo el contenido lo hacen muy difícil, pero no imposible. La alternativa (cookies httpOnly) exigiría cambiar toda la autenticación.
- No hay revocación de sesiones en el servidor: "Salir" solo borra el token del navegador; un token robado vale hasta que caduque (30 días). No hay restablecimiento de contraseña (no hay correo: es anónimo por diseño).
- Los límites de velocidad viven en la memoria del proceso: si Railway reinicia el servicio, los contadores se reinician. Para un ataque distribuido desde muchas IPs haría falta un límite por cuenta o un WAF.
