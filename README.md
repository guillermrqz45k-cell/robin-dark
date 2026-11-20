# Robin Dark — Tu mundo, tu gente, tu red

Red social en JavaScript (Node.js + Express), con base de datos real. No es un archivo HTML suelto: es un proyecto estructurado, listo para publicar en Railway.

> Robin Dark ya NO tiene tienda (decisión del dueño, 2026-11-20): no se compra ni se vende nada, no hay anuncios, precios, BTC ni custodia. Las tablas viejas (`listings`, `orders`, `conversations`, `messages`) quedan en la base de datos, intactas, sin usarse: no se borra ningún dato en vivo existente.

## Qué hace

- **Registro e inicio de sesión:** solo con **nombre real + correo + contraseña**. Al registrarse llega un código de verificación de 6 dígitos al correo (Resend) y el perfil muestra el nombre real; el alias queda como @usuario. **El registro NO devuelve token de sesión:** quien se acaba de registrar no queda dentro; solo se muestra el paso de verificación (poner el código o reenviarlo) y «Lo haré después» vuelve al inicio de sesión sin sesión. El inicio de sesión es solo con correo y contraseña: no hay login por alias ni cuentas viejas que mantener. **La entrada queda bloqueada hasta confirmar el correo:** sin verificar, el login responde 403 (`email_verification_required`) y la página muestra el paso de verificación (poner el código o reenviarlo) para confirmarlo ahí mismo. Las contraseñas se guardan cifradas con bcrypt. Sin teléfono ni ubicación. No se guarda ni se muestra la ubicación de nadie.
- **Verificación y recuperación por correo (Resend):** «¿Olvidaste tu contraseña?» manda un código de 6 dígitos al correo (hash SHA-256, caduca en 15 minutos, un solo uso). El código de verificación al registrarse usa el mismo sistema, en su propia tabla (`email_verification_codes`): un código de verificación no sirve para cambiar la contraseña ni al revés. Sin `RESEND_API_KEY` no se manda nada y la respuesta es siempre la misma, exista o no el correo. `GET /api/auth/config` dice si el correo está disponible.
- **Perfil estilo Facebook:** portada, foto de perfil, biografía y publicaciones. Desde «Editar perfil» se suben la portada y la foto (JPG/PNG, hasta 5 MB) y se cambia la bio (300 caracteres). Las fotos persisten.
- **Feed con pestañas:** Para ti (todo, lo más reciente), Siguiendo (solo la gente que sigues) y Tendencias (lo más gustado de la última semana).
- **Publicaciones:** texto (hasta 2.000 caracteres) con foto opcional (JPG/PNG, 5 MB) y sentimiento/actividad opcional (hasta 60 caracteres, se muestra bajo el autor: «😊 se siente feliz»). Reacciones múltiples: 👍 Me gusta, ❤️ Me encanta y 😮 Me asombra — la misma reacción dos veces la quita, otra distinta cambia el tipo. **Compartir** con contador guardado (cada Compartir cuenta) y menú para compartir la publicación: a tu historia, a un grupo, enviar a un amigo por mensaje, copiar enlace (enlace directo `#post-<id>`) o compartir fuera de la app. Comentarios y borrar la propia. La tarjeta del autor lleva su insignia (Admin si es el dueño), verificación y avatar.
- **Historias y reels con foto y vídeo:** las historias duran 24 horas, los reels se quedan. Se suben con texto, foto o vídeo corto (MP4/WebM, hasta 20 MB). Un reel sin medio no es un reel: exige foto o vídeo. Los vídeos se sirven con Range, así el reproductor puede adelantar. Me gusta en historias y reels.
- **Seguir y amigos:** seguir/dejar de seguir desde el perfil o desde Explorar. Listas públicas de seguidores y seguidos, y lista de amigos (seguimiento mutuo) con los amigos en común visibles en el perfil.
- **Explorar y Tendencias:** publicaciones para descubrir, hashtags y personas sugeridas (con seguidores en común).
- **Grupos:** crear un grupo (nombre + descripción) o unirse a los que hay. El número de miembros es real: cuenta a todos los que se unieron. Detalle con la lista de miembros y **muro del grupo**: solo los miembros publican y leen el muro (texto y foto), y solo el autor o el creador del grupo borran una publicación del muro.
- **Mensajes directos:** hilos privados entre dos usuarios (uno por pareja). Al abrir un hilo, los mensajes que te mandaron se marcan como leídos; el globo de Mensajes muestra los que quedan sin leer (por hilo y en total). El chat se refresca solo cada 5 s y no roba el foco ni reinicia el scroll mientras se escribe. Desde el perfil de cualquier persona se abre su hilo con el botón «Mensaje», y en Mensajes hay «Nuevo mensaje» para elegir a quién escribir.
- **Campana de notificaciones:** las últimas 30, derivadas de la actividad real — reacciones y comentarios en tus publicaciones y nuevos seguidores —, con el número de no vistas. Al abrir la campana se marcan como vistas.
- **IA propia (por reglas, sin llave externa):** la asistente responde dudas con las reglas reales de la plataforma (publicar, historias y reels con foto y vídeo, seguir, grupos, mensajes, Explorar, perfil, contraseña, verificación, antigüedad). Si le preguntan por comprar, vender o pagar, dice claro que Robin Dark ya no tiene tienda. Recomienda reels y publicaciones de la gente a la que sigues (con su motivo); sin actividad, la lista viene vacía.
- **Moderación automática:** el spam de promesas de dinero y los insultos se rechazan al publicar (422 con el motivo). Los enlaces, teléfonos y WhatsApp/Telegram se publican pero quedan marcados (tabla `moderation_flags`); no hay cola de revisión ni panel: el contenido marcado queda visible.
- **Sin rangos ni panel de admin:** no hay rangos con letras (A/M/V/N), ni rol de moderador, ni panel de administrador. La columna vieja `users.rank` queda en la base sin usarse, para no borrar datos.
- **El dueño (Admin especial):** la cuenta cuyo alias es `ADMIN_ALIAS` lleva la insignia especial dorada «Admin» y el ✓ Verificado azul, solo ella. Entra como un usuario más, sin login aparte ni contraseña de admin. Es la única que aprueba las solicitudes de verificación, desde su propio perfil.
- **Nuevo y Antiguo:** el perfil nuevo muestra la insignia «Nuevo» los primeros 30 días; a partir de los 90 días el perfil lleva un marco dorado especial de «Antiguo». Ambos salen de la fecha de creación de la cuenta.
- **Verificación de usuarios:** para pedir la verificación hay que tener **500 o más amigos o 500 o más seguidores**. El usuario la pide desde su Perfil con su nombre real y una foto de su documento (JPG/PNG, 5 MB); el dueño la aprueba o la rechaza desde su propio perfil, en su lista pequeña de solicitudes (`GET /api/users/me/verification-requests`). Solo los aprobados muestran la insignia ✓ Verificado. El nombre de tu documento nunca se muestra en público: el documento solo lo abre el propio solicitante o el dueño. (El nombre real del perfil sí se muestra: es el que se pone al registrarse.)
- **Valoraciones con estrellas:** de 1 a 5, una por usuario (se puede cambiar). La media sale en el perfil público; no toca la reputación calculada.
- **Perfil público y reputación:** el alias de cualquier usuario es clicable y abre su perfil público (`GET /api/users/:alias/profile`, sin token, sin `password_hash` ni datos privados): nombre real (el que se muestra en el perfil), miembro desde, bio, publicaciones, seguidores, seguidos, amigos y amigos en común, tiempo medio de respuesta en mensajes y puntuación de reputación 0–100. El tiempo de respuesta es la **mediana** del tiempo entre un mensaje recibido y la respuesta de ese usuario en el mismo hilo; si no hay ningún par mensaje/respuesta, muestra «Sin datos».
- **Reputación (0–100), solo con datos reales:** antigüedad `min(días, 90) / 90 × 20` (hasta 20 puntos) + actividad `min(posts, 10) / 10 × 40` (hasta 40 puntos) + comunidad `min(seguidores, 10) / 10 × 20` (hasta 20 puntos) + fiabilidad `20` si ningún contenido suyo fue quitado por moderación, `10` menos por cada contenido quitado, hasta `0`. Ejemplos: usuario nuevo (0 días, 0 posts, 0 seguidores, 0 quitados) = 20; 10 posts, 10 seguidores, 90 días y 0 quitados = 100; 5 posts, 5 seguidores, 45 días y 1 quitado = 50.
- **Insignias (la primera que se cumpla, en este orden):** `Admin` (dorada, solo el alias de `ADMIN_ALIAS`, el dueño del sitio) · `Nuevo` (menos de 30 días) · `Top` (10 o más posts y 90 o más días) · `Confiable` (3 o más posts y 0 contenidos quitados) · `Miembro` (todo lo demás). La insignia se calcula en el servidor (`src/reputation.js`) y viaja con el perfil; el cliente solo la muestra, nunca la calcula, así no hay dos versiones distintas de los umbrales. La antigüedad (`seniority`: `nuevo` < 30 días, `antiguo` ≥ 90 días) también viaja con el perfil y es la que pinta el marco dorado de «Antiguo».
- **Sin JS viejo en el teléfono tras cada despliegue:** `index.html` nunca se guarda en caché (`no-store`) y `app.js`/`styles.css` se sirven con versión (`?v=` según la fecha de los archivos), así que tras un despliegue el navegador pide el JS nuevo.
- **Fotos y vídeos:** avatar, portada, documento, fotos de posts y medio de historias/reels. Por defecto los bytes van a la tabla `photos` (funciona sin crear ninguna cuenta ni poner ninguna llave). Con `PHOTO_STORAGE=r2` van a Cloudflare R2 (variables `R2_*`); si falta alguna, se avisa por consola y se usa la base de datos. Ver `.env.example`.

## Estructura

```
robin-dark-js/
├── package.json            # dependencias y scripts (start: node server.js; test: 5 suites)
├── server.js               # entrada: Express, rutas, archivos públicos
├── railway.json            # configuración de despliegue en Railway
├── .env.example            # variables que hay que configurar
├── .gitignore
├── db/
│   └── schema.sql          # esquema Postgres (referencia; la app crea las tablas sola)
├── src/
│   ├── db.js               # Postgres (DATABASE_URL) o SQLite local (node:sqlite)
│   ├── auth.js             # hash bcrypt + JWT (+ hash de códigos de recuperación)
│   ├── reputation.js       # reputación 0–100, insignias (Nuevo/Antiguo/Admin) y antigüedad (solo datos reales)
│   ├── photos.js           # fotos y vídeos: validación, guardado (db o R2), URLs
│   ├── r2.js               # cliente Cloudflare R2 (opcional)
│   ├── mail.js             # Resend (códigos por correo: verificación y recuperación)
│   ├── moderation.js       # moderación automática por reglas (block/flag/ok)
│   ├── ai.js               # IA propia por reglas (asistente + recomendaciones)
│   ├── present.js          # tarjetas de autor (is_admin, verificación, avatar)
│   ├── middleware/
│   │   ├── auth.js         # requireAuth y optionalAuth (Bearer); el dueño se reconoce por alias (ADMIN_ALIAS)
│   │   ├── rateLimit.js    # límites por IP (API, auth, recuperación, IA)
│   │   └── validate.js     # validación de cuerpo e IDs
│   └── routes/
│       ├── auth.js         # POST /api/auth/register, /login, /verify-email, /resend-verification ·
│       │                   #   GET /api/auth/me|config · POST /api/auth/forgot|reset (código por correo)
│       ├── users.js        # GET /api/users/me · PATCH /api/users/me/profile ·
│       │                   #   GET /api/users/:alias/profile|posts|followers|following|friends ·
│       │                   #   POST /api/users/:alias/rate · verificación con documento
│       │                   #   (puerta de 500; el dueño aprueba desde su perfil)
│       ├── social.js       # feed, posts, reacciones, compartir, likes, comentarios, historias/reels,
│       │                   #   seguir, tendencias, explorar, notificaciones
│       ├── groups.js       # GET/POST /api/social/groups · join/leave · detalle · muro
│       ├── chat.js         # mensajes directos: hilos, enviar, no leídos
│       ├── ai.js           # POST /api/ai/ask · GET /api/ai/recommendations
│       ├── photos.js       # GET/DELETE /api/photos/:id (con Range para vídeo)
│       └── stats.js        # GET /api/stats (conteos públicos)
└── public/
    ├── index.html          # interfaz (diseño oscuro estilo GM Social)
    ├── app.js              # lógica del navegador (fetch a la API)
    └── styles.css          # diseño oscuro morado/azul con fantasma
```

### Tablas (base de datos)

| Tabla | Guarda |
|---|---|
| `users` | nombre real, alias, contraseña cifrada, correo (obligatorio al registrarse) y si está verificado, bio, avatar/cover, verificación, `notif_seen_at` (hasta cuándo vio su campana), fecha (la columna vieja `rank` queda sin uso) |
| `photos` | dueño, tipo (avatar/cover/document/post), mime, tamaño, dónde viven los bytes (db o R2) |
| `password_resets` | usuario, hash del código, caducidad (ms), usado |
| `email_verification_codes` | usuario, hash del código de verificación del correo, caducidad (ms), usado |
| `verification_requests` | usuario, nombre real, foto del documento, estado (pending/approved/rejected) |
| `posts` | autor, texto, sentimiento, foto, borrado suave |
| `post_likes` / `post_comments` | Reacciones (like/love/wow) y comentarios de posts |
| `post_shares` | Cada Compartir de un post (el contador es el nº de filas) |
| `stories` | autor, tipo (story 24h / reel), texto, estilo, foto/vídeo, caducidad (ms) |
| `story_likes` | Me gusta de historias y reels |
| `follows` | seguidor → seguido (único, sin seguirse a uno mismo) |
| `ratings` | valoraciones con estrellas (1–5, una por usuario) |
| `moderation_flags` | contenido marcado, motivo (sin cola de revisión) |
| `groups` / `group_members` | grupos y sus miembros |
| `group_posts` | muro del grupo: autor, texto, foto, borrado suave |
| `dm_threads` / `dm_messages` | hilos de mensajes directos y mensajes (con `read_at`) |
| `listings`, `orders`, `conversations`, `messages` | **Sin uso** (tienda retirada 2026-11-20; datos viejos intactos) |

## Correr en local

```bash
cd robin-dark-js
cp .env.example .env
npm install
npm start
# Abre http://localhost:3000
```

Sin `DATABASE_URL`, usa SQLite en `data/robin-dark.db` (se crea sola). Para probar con Postgres en local, pon `DATABASE_URL=<redacted>

### Probar la API con curl

```bash
# Perfil público (sin token)
curl http://localhost:3000/api/users/ana/profile
# {"alias":"ana","real_name":"Ana María","member_since":"...","member_days":0,"is_admin":false,
#  "badge":{"key":"nuevo","label":"Nuevo"},"reputation":20,
#  "posts_count":0,"followers_count":0,"removed_by_moderation":0,
#  "response_minutes":null,"response_time":"Sin datos"}

# Salud
curl http://localhost:3000/api/health

# Registrar (nombre real + correo + contraseña; llega un código
# de verificación de 6 dígitos al correo. No devuelve token: hay
# que verificar el correo y luego entrar)
curl -s -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"real_name":"Ana María","alias":"ana","password":"secreto123","email":"ana@example.com"}'

# Verificar el correo con el código que llegó
curl -s -X POST http://localhost:3000/api/auth/verify-email \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","code":"123456"}'

# Entrar y guardar el token (solo con correo y contraseña)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ana@example.com","password":"secreto123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

# Publicar
curl -s -X POST http://localhost:3000/api/social/posts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"Hola, este es mi primer post."}'

# Feed
curl 'http://localhost:3000/api/social/feed?tab=para_ti'

# Preguntar a la IA
curl -s -X POST http://localhost:3000/api/ai/ask \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"question":"¿Cómo subo un vídeo a mi historia?"}'
```

### Pruebas locales

```bash
npm test
# 5 suites, cada una con su base SQLite nueva y vacía (la borra al
# terminar); no tocan el sitio público:
# - test-auth-realname.js (49): registro solo con nombre real +
#   correo + contraseña, SIN token (sin sesión hasta verificar el
#   correo), envío del código de verificación con un
#   Resend falso en local, verificación (un solo uso, caducidad,
#   reenvío que anula el anterior), login solo por correo y
#   contraseña (sin login por alias) BLOQUEADO con 403 hasta
#   confirmar el correo y funcionando después de verificarlo,
#   perfil con nombre real.
# - test-badges.js (45): insignia Nuevo (< 30 días) y marco Antiguo
#   (>= 90 días), insignia Admin + verificado solo para el dueño,
#   sin rutas /api/admin (404), verificación con puerta de 500
#   (409 si no llega, aprobación del dueño desde su perfil),
#   amigos y amigos en común, muro del grupo, Compartir, y tarjetas
#   de autor sin rangos.
# - test-profile.js (97): perfil público, reputación social, insignias
#   (Nuevo/Top/Confiable/Admin), antigüedad, tiempo de respuesta en
#   mensajes directos, seguir y amigos, moderación (fórmula unitaria),
#   y cliente sin tienda (sin /api/listings, /api/orders, BTC ni
#   escrow; con badgeHtml, antigüedad, menú de compartir y amigos).
# - test-social.js (80): registro con nombre real + correo (sin token
#   hasta verificar) y login solo por correo (sin login por alias)
#   bloqueado con 403 antes de confirmar el correo, recuperación genérica,
#   avatar, posts con moderación, feed,
#   likes, comentarios, seguir, historias, reels, tendencias, IA,
#   valoraciones, verificación con documento (privado, puerta de 500,
#   aprobación del dueño) y sin panel de admin, reacciones 👍/❤️/😮
#   (quitar y cambiar de tipo), Compartir con contador, sentimiento
#   del compositor y notificaciones.
# - test-groups-dm.js (46): grupos (crear/unirse/salir/conteo real),
#   muro del grupo, mensajes directos (hilo, no leídos, marcar leído,
#   403 a terceros), historias con foto y reels con vídeo (Range 206),
#   IA sin comercio y stats sin tienda ni panel de admin.
```

## Publicar en Railway (recomendado)

Railway corre la app y la base de datos juntas, sin que la página se duerma. Prueba de 30 días con $5 de crédito; luego el plan Hobby es $5/mes e incluye $5 de uso (precios de 2026, verificar en railway.com/pricing).

1. **Sube el proyecto a GitHub:** crea un repositorio (por ejemplo `robin-dark`) y sube esta carpeta.
2. **En Railway (railway.app), crea un proyecto** → *Deploy from GitHub repo* → elige el repositorio `robin-dark`.
3. **Añade Postgres:** en el lienzo del proyecto, *New → Database → Add PostgreSQL*. Railway crea `DATABASE_URL` automáticamente y se la pasa a la app.
4. **Variables:** en el servicio web, *Variables*, añade:
   - `JWT_SECRET` = una cadena larga y secreta (cámbiala, no uses la de ejemplo)
   - `ADMIN_ALIAS` = el alias de tu cuenta de dueño (por ejemplo `admin`): esa cuenta lleva la insignia especial «Admin» y el ✓ Verificado, y aprueba las verificaciones desde su perfil. No hay contraseña de admin ni panel.
   - `DATABASE_URL` ya la pone Railway al añadir Postgres; si no aparece, usa *Reference* → la variable `DATABASE_URL` del servicio Postgres.
   - `RESEND_API_KEY` = la llave de Resend (solo envío) para que los códigos de verificación y de recuperación lleguen de verdad. **Obligatoria en producción:** sin ella no se envía ningún código y, como el login queda bloqueado hasta confirmar el correo, nadie podría entrar. Sin ella, el registro funciona igual pero el código no se envía, y la recuperación responde siempre lo mismo sin mandar nada. No pongas nunca `RESEND_API_URL` en Railway: esa variable solo existe para las pruebas locales (servidor falso de Resend).
   - Opcional: `PHOTO_STORAGE=r2` + `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (y `R2_PUBLIC_URL` si se quiere servir las fotos directas desde R2). Sin estas, las fotos van a la base de datos (el disco de Railway es efímero: con muchos usuarios conviene R2).
   - Opcional: `PGSSL=false` solo si tu Postgres no usa SSL (en Railway no hace falta).
5. **Despliega:** Railway detecta `railway.json` y arranca con `node server.js`. El healthcheck es `GET /api/health`.
6. **Abre el enlace:** en el servicio web, *Settings → Networking → Generate Domain*. Ese es el enlace público de Robin Dark. Las tablas se crean solas al arrancar (migraciones aditivas, sin borrar nada); si prefieres crearlas a mano, ejecuta `db/schema.sql` contra esa base de datos.

> Nota: no subas `.env` ni la carpeta `data/` a GitHub (ya están en `.gitignore`). En Railway las variables van en el panel, no en el código.

> **Antes de tocar la base en vivo: respaldo.** Las migraciones son aditivas (solo añaden columnas y tablas), pero un respaldo de la base de Railway antes de desplegar es lo que permite volver atrás si algo sale mal.

## Seguridad y privacidad

### El dueño en local

```bash
# En .env (nunca se sube a GitHub), añade:
ADMIN_ALIAS=admin

# Registra en http://localhost:3000 una cuenta con ese alias
# (nombre real, correo y contraseña; alias: admin) y entra normal
# con tu correo: verás la insignia «Admin» y el
# ✓ Verificado en tu perfil, y en tu propio perfil aparecerá la
# lista de solicitudes de verificación para aprobarlas. No hay
# botón «Admin» ni login aparte.
```

### Qué protege la app

- **Contraseñas con bcrypt** (coste 12) y **JWT** con secreto fuerte obligatorio en producción (sin `JWT_SECRET` fuerte, el servidor no arranca con Postgres).
- **Límites de velocidad por IP:** 300 peticiones / 15 min en la API, 10 intentos de login/registro, 5 de recuperación y verificación y 60 preguntas a la IA. El login con correo inexistente tarda lo mismo que con correo existente (comparación bcrypt falsa), para no filtrar qué correos están registrados.
- **Cabeceras de seguridad** (helmet): CSP estricta (solo recursos propios), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y HSTS.
- **Nunca se devuelve `password_hash`**, ni el correo en el perfil público, ni el nombre real ni el documento de la solicitud de verificación (el documento solo lo abre el propio solicitante o el dueño). El nombre real del perfil sí se muestra: es el nombre que se pone al registrarse.
- **Códigos de verificación y de recuperación** con hash SHA-256, 15 minutos y un solo uso; la respuesta de `/forgot` y de `/resend-verification` es siempre la misma, exista o no el correo.
- **Moderación:** el spam y los insultos se rechazan al publicar (422); el contenido marcado se publica y queda registrado, sin cola de revisión.
- **Fotos privadas:** el documento de identidad es privado por tipo (`document`); avatar, portada, posts e historias son públicos.
