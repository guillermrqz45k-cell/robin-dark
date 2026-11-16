# Robin Dark — Aquí puedes vender de todo

Mercado abierto para vender de todo, en JavaScript (Node.js + Express), con base de datos real. No es un archivo HTML suelto: es un proyecto estructurado, listo para publicar en Railway.

## Qué hace

- **Registro e inicio de sesión anónimos:** solo alias + contraseña. Sin correo, sin teléfono y sin ubicación. Las contraseñas se guardan cifradas con bcrypt. No se guarda ni se muestra la ubicación de nadie.
- **Tienda con buscador:** la búsqueda es la forma de encontrar artículos. No hay filtros ni botones de categorías en ningún lado.
- **Publicar anuncios:** título, descripción y precio en BTC.
- **Compra directa:** al comprar, el anuncio pasa a vendido, se crea el pedido y se abre el chat con el vendedor.
- **Mi cuenta:** mis anuncios, mis compras y mis ventas.
- **Chat privado:** solo entre comprador y vendedor, por anuncio.
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
│   ├── middleware/
│   │   └── auth.js         # requireAuth (Bearer JWT)
│   └── routes/
│       ├── auth.js         # POST /api/auth/register, /login · GET /api/auth/me
│       ├── listings.js     # GET/POST /api/listings (búsqueda, publicar)
│       ├── orders.js       # POST /api/orders (Comprar con BTC) · GET /api/orders/account
│       └── chat.js         # GET/POST /api/chat y /api/chat/:id/messages
└── public/
    ├── index.html          # interfaz
    ├── app.js              # lógica del navegador (fetch a la API)
    └── styles.css          # diseño negro + verde esmeralda + dorado
```

### Tablas (base de datos)

| Tabla | Guarda |
|---|---|
| `users` | alias, contraseña cifrada, fecha de creación |
| `listings` | vendedor, título, descripción, `price_sats`, estado (disponible/vendido) |
| `orders` | anuncio, comprador, vendedor, `price_sats`, estado (`pagado_btc`, …) |
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
   - `DATABASE_URL` ya la pone Railway al añadir Postgres; si no aparece, usa *Reference* → la variable `DATABASE_URL` del servicio Postgres.
   - Opcional: `PGSSL=false` solo si tu Postgres no usa SSL (en Railway no hace falta).
5. **Despliega:** Railway detecta `railway.json` y arranca con `node server.js`. El healthcheck es `GET /api/health`.
6. **Abre el enlace:** en el servicio web, *Settings → Networking → Generate Domain*. Ese es el enlace público de Robin Dark. Las tablas se crean solas al arrancar; si prefieres crearlas a mano, ejecuta `db/schema.sql` contra esa base de datos.

> Nota: no subas `.env` ni la carpeta `data/` a GitHub (ya están en `.gitignore`). En Railway las variables van en el panel, no en el código.

## Seguridad y privacidad

- Contraseñas con bcrypt (hash + sal, 12 rondas); nunca se guardan en claro.
- Sesión con JWT (30 días) en el encabezado `Authorization: Bearer`.
- No hay geolocalización, ni correo, ni teléfono, ni IP guardada en la base de datos.
- En producción, pon un `JWT_SECRET` largo y distinto, y usa HTTPS (Railway lo da con su dominio).
