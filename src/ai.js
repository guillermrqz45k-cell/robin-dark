// src/ai.js — la IA propia de Robin Dark.
//
// No es un modelo externo ni necesita ninguna llave: es un motor
// de reglas sobre las normas de la plataforma.
// - Asistente: responde dudas con las reglas reales de Robin Dark
//   (publicar, historias y reels con foto y vídeo, seguir, grupos,
//   mensajes, Explorar, perfil, recuperación, verificación,
//   antigüedad). Si no entiende la pregunta, dice con qué puede
//   ayudar, sin inventar nada.
// - Robin Dark ya NO tiene tienda (decisión de AMO, 2026-11-20):
//   no se compra ni se vende nada, no hay BTC ni custodia. Si
//   alguien pregunta por comprar, vender o pagar, la asistente
//   lo dice claro en vez de explicar cómo era antes.
// - Recomendaciones ("Para ti"): reels y publicaciones de la
//   gente a la que sigues (con su motivo) y, si no sigues a
//   nadie, de autores cuyos posts te gustaron. Un usuario sin
//   actividad no recibe recomendaciones (lista vacía), igual
//   que en la vista previa.
// - La moderación vive en src/moderation.js, no aquí.
const db = require('./db');

const KNOWLEDGE = [
  {
    keys: ['vender', 'comprar', 'tienda', 'btc', 'bitcoin', 'escrow', 'custodia', 'precio', 'pago', 'pagar', 'producto'],
    answer: 'Robin Dark ya no tiene tienda: no se compra ni se vende nada aquí, y no hay pagos ni BTC. Es una red social para compartir historias, reels y publicaciones, seguir gente, unirte a grupos y hablar por mensajes.',
  },
  {
    keys: ['publicar', 'publicación', 'publicacion', 'post', 'escribir'],
    answer: 'Para publicar, escribe en el compositor de Inicio: puedes poner texto y una foto. Tu publicación sale en el feed y la gente puede darle Me gusta y comentarla.',
  },
  {
    keys: ['historia', 'historias', 'estado', 'estados', 'reel', 'reels'],
    answer: 'Las historias (estados) duran 24 horas y los reels se quedan visibles. Puedes subirlos con texto, con foto o con un vídeo corto (MP4 o WebM, hasta 20 MB) desde el botón +. Dale Me gusta y comenta en los que te gusten.',
  },
  {
    keys: ['seguir', 'seguidores', 'siguiendo', 'amigos'],
    answer: 'Puedes seguir a otros usuarios desde su perfil o desde Explorar. En Siguiendo solo ves publicaciones de la gente que sigues, y en Para ti te recomendamos cosas según a quién sigues y qué te gusta.',
  },
  {
    keys: ['grupo', 'grupos'],
    answer: 'En Grupos puedes unirte a los grupos que hay o crear el tuyo: ponle un nombre y una descripción. El número de miembros es real: cuenta a todos los que se unieron.',
  },
  {
    keys: ['mensaje', 'mensajes', 'chat', 'hablar', 'escribirle'],
    answer: 'En Mensajes puedes hablar por privado con otros usuarios: abre una conversación con alguien y escríbele. El globo de Mensajes te avisa con un número cuando te llega algo nuevo sin leer.',
  },
  {
    keys: ['explorar', 'tendencias', 'descubrir', 'buscar'],
    answer: 'En Explorar ves publicaciones y personas que te pueden gustar, y en Tendencias lo que más se está comentando y a quién seguir.',
  },
  {
    keys: ['perfil', 'portada', 'avatar', 'foto de perfil', 'biografía', 'bio'],
    answer: 'Tu Perfil es tu página: ahí sale tu portada, tu foto, tu biografía y tus publicaciones. Desde Editar perfil puedes cambiar la biografía y subir tu foto de portada y de perfil (JPG o PNG, hasta 5 MB).',
  },
  {
    keys: ['recuperar', 'contraseña', 'olvide', 'olvidé', 'código', 'codigo'],
    answer: 'Si olvidaste tu contraseña, pulsa ¿Olvidaste tu contraseña? en el inicio de sesión y escribe tu correo. Te llega un código de 6 dígitos que caduca en 15 minutos; con ese código pones una contraseña nueva.',
  },
  {
    keys: ['verificar', 'verificación', 'verificacion', 'documento', 'insignia'],
    answer: 'Para verificarte necesitas tener 500 o más amigos o seguidores. Si los tienes, pide la verificación desde tu Perfil con tu nombre real y una foto de tu documento. El dueño la revisa y, si la aprueba, te sale la insignia ✓ Verificado. El nombre de tu documento nunca se muestra en público (tu nombre de perfil sí se ve: es el que pusiste al registrarte).',
  },
  {
    keys: ['admin', 'dueño', 'dueno', 'antiguo', 'nuevo'],
    answer: 'El dueño de Robin Dark es el único Admin: su perfil lleva la insignia especial «Admin» y el ✓ Verificado. Los perfiles nuevos muestran la insignia «Nuevo» los primeros 30 días, y a partir de los 90 días el perfil lleva un marco dorado de «Antiguo».',
  },
  {
    keys: ['registro', 'registrar', 'cuenta', 'crear cuenta', 'correo', 'email'],
    answer: 'Para crear tu cuenta necesitas tu nombre real, tu correo y una contraseña. Te enviamos un código de 6 dígitos a tu correo para verificarlo. Entras con tu correo y tu contraseña. Tu alias (@usuario) es tu nombre corto en Robin Dark y tu nombre real es el que se muestra en tu perfil.',
  },
  {
    keys: ['ganar', 'dinero', 'monetiz', 'cobrar', 'recompensa'],
    answer: 'Robin Dark no paga a los creadores por los reels ni por las visitas: es una red social para compartir, no una tienda ni una plataforma de pagos.',
  },
  {
    keys: ['premium', 'plan', 'planes'],
    answer: 'Por ahora no hay planes Premium activos en Robin Dark: la tarjeta de Premium es solo un aviso, no cobra nada ni desbloquea nada.',
  },
  {
    keys: ['hola', 'buenas', 'qué tal', 'que tal', 'ayuda', 'ayúdame', 'ayudame'],
    answer: '¡Buuu! Soy la asistente de Robin Dark. Puedo ayudarte con cómo publicar, las historias y los reels con foto y vídeo, seguir gente, los grupos, los mensajes, Explorar, tu perfil, recuperar tu contraseña y verificarte. Pregúntame por uno de esos temas.',
  },
];

const FALLBACK = 'Puedo ayudarte con Robin Dark: cómo publicar, las historias y los reels con foto y vídeo, seguir gente, los grupos, los mensajes, Explorar, tu perfil, recuperar tu contraseña y verificarte. Pregúntame por uno de esos temas.';

function answer(question) {
  const q = String(question || '').toLowerCase();
  for (const entry of KNOWLEDGE) {
    if (entry.keys.some((k) => q.includes(k))) return { answer: entry.answer, topic: entry.keys[0] };
  }
  return { answer: FALLBACK, topic: null };
}

function inList(ids, offset = 0) {
  // Construye ($N, $N+1, ...) para una lista de IDs ya validada.
  // offset: cuántos parámetros van antes en la consulta.
  return `(${ids.map((_, i) => `$${offset + i + 1}`).join(', ')})`;
}

async function recommendations(userId) {
  const followed = await db.query('SELECT followed_id FROM follows WHERE follower_id = $1', [userId]);
  const followedIds = followed.rows.map((r) => Number(r.followed_id));
  let sources = []; // { ids, reason }
  if (followedIds.length) {
    sources.push({ ids: followedIds, reasonKind: 'follow' });
  } else {
    const liked = await db.query(
      `SELECT DISTINCT p.author_id FROM post_likes pl
       JOIN posts p ON p.id = pl.post_id
       WHERE pl.user_id = $1 AND p.deleted = $2`,
      [userId, false],
    );
    const likedIds = liked.rows.map((r) => Number(r.author_id)).filter((id) => id !== userId);
    if (likedIds.length) sources.push({ ids: likedIds, reasonKind: 'liked' });
  }
  if (!sources.length) return [];

  const out = [];
  for (const source of sources) {
    const ids = source.ids;
    // Reels primero (con su medio), luego publicaciones.
    const reels = await db.query(
      `SELECT s.id, s.text, s.style_key, s.photo_id, s.created_at,
              u.id AS author_id, u.alias AS author_alias, u.verified AS author_verified,
              u.avatar_photo_id AS author_avatar_photo_id
       FROM stories s JOIN users u ON u.id = s.author_id
       WHERE s.kind = 'reel' AND s.deleted = $1 AND s.author_id IN ${inList(ids, 1)}
       ORDER BY s.created_at DESC LIMIT 5`,
      [false, ...ids],
    );
    for (const s of reels.rows) {
      out.push({
        type: 'reel',
        reel_id: s.id,
        text: s.text,
        style_key: s.style_key,
        photo_id: s.photo_id || null,
        author_alias: s.author_alias,
        author_id: s.author_id,
        author_avatar_photo_id: s.author_avatar_photo_id || null,
        reason: source.reasonKind === 'follow'
          ? `De @${s.author_alias}, a quien sigues`
          : `Te gustó algo de @${s.author_alias}`,
      });
    }
    const posts = await db.query(
      `SELECT p.id, p.text, p.photo_id, p.created_at,
              u.id AS author_id, u.alias AS author_alias, u.verified AS author_verified,
              u.avatar_photo_id AS author_avatar_photo_id
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.deleted = $1 AND p.author_id IN ${inList(ids, 1)}
       ORDER BY p.created_at DESC LIMIT 5`,
      [false, ...ids],
    );
    for (const p of posts.rows) {
      out.push({
        type: 'post',
        post_id: p.id,
        text: p.text,
        photo_id: p.photo_id || null,
        author_alias: p.author_alias,
        author_id: p.author_id,
        author_avatar_photo_id: p.author_avatar_photo_id || null,
        reason: source.reasonKind === 'follow'
          ? `De @${p.author_alias}, a quien sigues`
          : `Te gustó algo de @${p.author_alias}`,
      });
    }
  }
  return out;
}

module.exports = { answer, recommendations, KNOWLEDGE };
