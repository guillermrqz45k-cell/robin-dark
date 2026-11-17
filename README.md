# Robin Dark — Aquí puedes vender de todo

Mercado abierto para vender de todo, en JavaScript (Node.js + Express), con base de datos real. No es un archivo HTML suelto: es un proyecto estructurado, listo para publicar en Railway.

## Qué hace

- **Registro e inicio de sesión anónimos:** solo alias + contraseña. Sin correo, sin teléfono y sin ubicación. Las contraseñas se guardan cifradas con bcrypt. No se guarda ni se muestra la ubicación de nadie.
- **Tienda con buscador:** la búsqueda es la forma de encontrar artículos. No hay filtros ni botones de categorías en ningún lado.
- **Publicaciones (todas las de todos los usuarios):** pestaña «Publicaciones» en la navegación, con TODAS las publicaciones reales de la base de datos, disponibles y agotadas, desde el endpoint público `GET /api/listings/all` (sin token, sin `password_hash` ni datos privados). Contadores en vivo — total, disponibles, agotadas y nº de vendedores publicando — y filtro por estado Todas / Disponibles / Agotadas (los contadores siempre son los de todo, el filtro solo cambia la lista). Reutiliza las mismas tarjetas que la Tienda: alias del vendedor clicable con perfil e insignia, precio en BTC y stock; al tocar una disponible se abre su detalle/contacto por chat como en la Tienda, y una agotada muestra «Agotado» sin botón de contacto. La Tienda sigue siendo el escaparate con buscador y solo muestra lo disponible.
- **Publicar anuncios:** título, descripción, precio en BTC y **cantidad en stock** (por defecto 1). Un anuncio NO es de una sola unidad: se vende unidad a unidad hasta agotar el stock.
- **Chat privado:** solo entre comprador y vendedor, por anuncio. El chat es solo para contactar y negociar: enviar un mensaje nunca crea un pedido, nunca marca el anuncio como vendido y nunca muestra "compra exitosa". Un artículo agotado no admite tratos nuevos.
- **Marcar como vendido (solo el vendedor):** cuando el trato se cierra en el chat, el vendedor marca su anuncio como vendido (en Mi cuenta o en el chat). Eso crea el pedido y **descuenta 1 unidad del stock**. El anuncio sigue en la tienda mientras queden unidades y solo se agota cuando el stock llega a 0. La única otra forma de que se acabe es que el vendedor lo dé por agotado, con el botón "Marcar como agotado" en Mi cuenta; con "Reponer stock" vuelve a estar disponible con la cantidad que indique.
- **Custodia (escrow) en BTC:** al marcar como vendido, el pago queda RETENIDO en custodia (estado: `retenido`). Solo el COMPRADOR puede liberarlo, con el botón "Confirmar que recibí el producto" (en Mi cuenta o en el chat), y solo entonces el pago pasa a `liberado` para el vendedor. El vendedor NO puede liberar el pago él mismo. El estado de custodia se ve en el pedido, en Mi cuenta (comprador y vendedor) y en el chat.
- **Estadísticas públicas:** en la portada se ven los conteos en vivo de la base de datos — usuarios registrados, anuncios publicados, tratos cerrados y mensajes enviados — desde el endpoint público `GET /api/stats`, que devuelve solo números, ningún dato personal.
- **Panel de administrador:** botón "Admin" en la barra superior. Entra solo el dueño del sitio, con alias y contraseña aparte de los usuarios anónimos (variables `ADMIN_ALIAS` y `ADMIN_PASSWORD`); sin esas variables, el login de admin no funciona, porque no hay ninguna contraseña por defecto en el código. El panel muestra los conteos, todos los usuarios (alias y fecha, nunca contraseñas), todos los anuncios (con su stock), todos los pedidos y todas las custodias con su estado. El admin puede borrar un anuncio sin pedidos y cancelar una custodia retenida (el pedido pasa a cancelado y la unidad vuelve al stock, con el anuncio disponible). Los usuarios normales reciben 403 en `/api/admin/*`.
- **Perfil público y reputación:** el alias de cualquier vendedor es clicable en la tienda y en el chat, y abre su perfil público (`GET /api/users/:alias/profile`, sin token, sin `password_hash` ni datos privados): miembro desde, anuncios activos (clicables), tratos cerrados como vendedor y como comprador, tratos cancelados, tiempo medio de respuesta y puntuación de reputación 0–100. El tiempo de respuesta es la **mediana** del tiempo entre un mensaje recibido y la respuesta de ese usuario en el mismo chat; si no hay ningún par mensaje/respuesta, muestra "Sin datos". No hay estrellas ni valoraciones inventadas: todo sale de la base de datos.
- **Reputación (0–100), solo con datos reales:** antigüedad `min(días, 90) / 90 × 20` (hasta 20 puntos) + tratos cerrados `min(cerrados, 10) / 10 × 60` (hasta 60 puntos) + fiabilidad `20` si no hay tratos cancelados, `10` menos por cada cancelado, hasta `0`. Ejemplos: usuario nuevo (0 días, 0 tratos, 0 cancelados) = 20; 10 tratos, 90 días y 0 cancelados = 100; 5 tratos, 45 días y 1 cancelado = 50.
- **Insignias (la primera que se cumpla, en este orden):** `✓ Verificado` (dorado, solo el alias de `ADMIN_ALIAS`, el dueño del sitio) · `Top` (10 o más tratos cerrados y 90 o más días) · `Confiable` (3 o más tratos cerrados y 0 tratos cancelados) · `Nuevo` (todo lo demás). La insignia se calcula en el servidor (`src/reputation.js`) y viaja con el perfil y con cada anuncio (`seller_badge`); el cliente solo la muestra, nunca la calcula, así no hay dos versiones distintas de los umbrales.
- **Contactar al vendedor sí abre el chat para preguntar:** sin sesión, el botón avisa en la página "Entra con tu alias para preguntar al vendedor" y lleva al registro (antes saltaba al registro sin decir nada y parecía no hacer nada); con sesión, abre la conversación, la deja seleccionada, muestra el formulario con "Pregunta por el producto, el precio, el envío…" y pone el foco en el input. Los errores al abrir el chat se ven en la página, no con `alert()`. La causa no era el servidor (POST /api/chat sí creaba la conversación): era el cliente, que disparaba dos cargas de conversaciones en paralelo sin esperar a ninguna.
- **Error "Anuncio no válido" al contactar (corregido):** la causa real era el botón, no el servidor. En `listingCardHtml` (`public/app.js`) el botón se construía con comillas simples y `data-id="${l.id}"` quedaba en literal, sin interpolar: cada clic mandaba `listing_id: null` y el servidor devolvía 400 "Anuncio no válido". Ahora el botón usa backticks y el id llega numérico. Además `openChatForListing` valida el id en el cliente antes de llamar a la API (si no es un entero positivo, avisa en la página y no llama al servidor), y el servidor devuelve un mensaje claro y registra el cuerpo recibido si llega un id malo. Las pruebas de API no lo cazaron porque llamaban a `POST /api/chat` directamente con un id numérico; por eso existe `scripts/test-contact-click.js`, que pulsa el botón de verdad con un navegador sin interfaz (jsdom).
- **Contacto pendiente tras entrar:** si se pulsa "Contactar al vendedor" sin haber entrado, la intención se guarda (`rd_pending_contact` en sessionStorage) y al entrar con éxito (registro o inicio de sesión) se abre automáticamente ese chat, en vez de dejar al usuario en la tienda.
- **Chat en vivo:** el chat se refresca solo cada 5 s (lista de conversaciones y mensajes del chat abierto) y el botón Mensajes muestra un badge con el nº de conversaciones con mensajes nuevos sin leer (`GET /api/chat` trae el último mensaje de cada conversación). El refresco no roba el foco ni reinicia el scroll mientras se escribe: si no hay nada nuevo no se toca el DOM; si lo hay y se estaba abajo del todo, baja solo.
- **Sin JS viejo en el teléfono tras cada despliegue:** `index.html` nunca se guarda en caché (`no-store`) y `app.js`/`styles.css` se sirven con versión (`?v=` según la fecha de los archivos), así que tras un despliegue el navegador pide el JS nuevo.
- **Mi cuenta:** mis anuncios, mis compras y mis ventas, cada pedido con su estado de custodia.
- **Pagos solo en BTC:** los precios se escriben en BTC, se guardan en la base de datos como satoshis y se muestran con el símbolo ₿. No hay USD en ningún lado.
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
│   ├── reputation.js       # reputación 0–100 e insignias (solo datos reales)
│   ├── middleware/
│   │   └── auth.js         # requireAuth (Bearer JWT) y requireAdmin (JWT con role: 'admin')
│   └── routes/
│       ├── admin.js        # POST /api/admin/login · GET /api/admin/stats|users|listings|orders|escrows · DELETE /api/admin/listings/:id · POST /api/admin/escrows/:id/cancel
│       ├── auth.js         # POST /api/auth/register, /login · GET /api/auth/me
│       ├── users.js        # GET /api/users/:alias/profile (público: perfil, reputación, insignia, tiempo de respuesta)
│       ├── listings.js     # GET/POST /api/listings (búsqueda, publicar con stock) · GET /api/listings/all (todas las publicaciones, contadores y filtro por estado) · POST /api/listings/:id/mark-out-of-stock · POST /api/listings/:id/restock
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
| `users` | alias, contraseña cifrada, fecha de creación |
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
# Perfil público de un vendedor (sin token)
curl http://localhost:3000/api/users/vendedor1/profile
# {"alias":"vendedor1","member_since":"...","member_days":0,"is_admin":false,
#  "badge":{"key":"nuevo","label":"Nuevo"},"reputation":20,
#  "active_listings_count":1,"active_listings":[...],
#  "closed_as_seller":0,"closed_as_buyer":0,"closed_total":0,"cancelled":0,
#  "response_minutes":null,"response_time":"Sin datos"}
```

### Pruebas locales (perfil, reputación, insignias y contacto)

```bash
node scripts/test-profile.js
# 60 pruebas: perfil público, reputación, insignias (Nuevo/Confiable/
# Top/Verificado), tiempo de respuesta, contacto y chat, venta con
# custodia y cancelación. Usa una base SQLite nueva y vacía y la
# borra al terminar; no toca el sitio público.
```

### Pruebas locales (apartado Publicaciones)

```bash
node scripts/test-publicaciones.js
# 28 pruebas: publica 2 anuncios con stock, marca uno agotado y
# verifica que GET /api/listings/all muestra ambos con contadores
# correctos (total 2, disponibles 1, agotadas 1, vendedores 1), que
# el filtro Todas/Disponibles/Agotadas funciona, que la Tienda sigue
# mostrando solo el disponible y que contactar por el agotado da
# 409. Usa una base SQLite nueva y vacía y la borra al terminar;
# no toca el sitio público.
```

### Pruebas locales (clic real en "Contactar al vendedor")

```bash
node scripts/test-contact-click.js
# Reproduce el flujo del cliente con un navegador sin interfaz
# (jsdom, dependencia de desarrollo): pulsa de verdad el botón
# "Contactar al vendedor" en la Tienda y verifica que el POST
# /api/chat lleva el id numérico del anuncio; que un id perdido
# (NaN/undefined) se bloquea en el cliente sin llamar a la API;
# que contactar sin sesión y luego entrar abre ese chat
# automáticamente; que el JS se sirve versionado y el HTML sin
# caché; y que el chat se actualiza en vivo con el badge de
# mensajes nuevos. Usa una base SQLite nueva y vacía y la borra
# al terminar; no toca el sitio público.
```

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
- **Marcadores repetidos en SQLite:** un mismo `$N` usado dos veces en una consulta (por ejemplo `WHERE buyer_id = $1 OR seller_id = $1`) se convierte en dos `?` y `node:sqlite` pone el segundo en `NULL` sin avisar: el vendedor no veía sus conversaciones, la búsqueda por descripción no encontraba nada y el tiempo de respuesta del vendedor salía vacío en local. En `src/db.js` cada aparición del marcador recibe ahora su propio valor duplicado. En Postgres no hacía falta (reutiliza el parámetro), pero la corrección vale para los dos motores.
- **Sin XSS en la interfaz:** todos los datos de usuarios (alias, títulos, descripciones, mensajes) se escapan antes de insertarlos en el HTML.
- **Autorización:** cada chat, pedido y anuncio se comprueba contra el usuario del token (nadie ve el chat de otro, nadie marca vendido el anuncio de otro, solo el comprador libera su custodia, solo el vendedor la marca). El panel de admin exige JWT con `role: 'admin'`; un usuario normal recibe 403. El admin nunca se hace pasar por un usuario en el chat.
- El panel de admin usa un JWT aparte con `role: 'admin'`; las credenciales de admin viven solo en variables de entorno y no hay ninguna contraseña por defecto en el código.
- No hay geolocalización, ni correo, ni teléfono, ni IP guardada en la base de datos.
- En producción, pon un `JWT_SECRET` largo y distinto, y usa HTTPS (Railway lo da con su dominio).

### Riesgos que quedan (conocidos, no corregidos aquí)
- El token JWT se guarda en `localStorage` del navegador: si un día hubiera un XSS, el token podría robarse. La CSP estricta y el escapado de todo el contenido lo hacen muy difícil, pero no imposible. La alternativa (cookies httpOnly) exigiría cambiar toda la autenticación.
- No hay revocación de sesiones en el servidor: "Salir" solo borra el token del navegador; un token robado vale hasta que caduque (30 días). No hay restablecimiento de contraseña (no hay correo: es anónimo por diseño).
- Los límites de velocidad viven en la memoria del proceso: si Railway reinicia el servicio, los contadores se reinician. Para un ataque distribuido desde muchas IPs haría falta un límite por cuenta o un WAF.
