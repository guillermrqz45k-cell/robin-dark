// src/routes/photos.js — servir y borrar fotos y vídeos de Robin Dark.
//
// GET /api/photos/:id — sirve los bytes.
//   - avatar, cover y post son PÚBLICAS: cualquiera las ve.
//   - document es PRIVADA: solo el dueño de la foto o el dueño
//     del sitio (alias de ADMIN_ALIAS, que revisa las solicitudes
//     de verificación). El documento de identidad nunca es público.
//   - Los vídeos (MP4/WebM) aceptan Range: el navegador pide
//     trozos para reproducir y adelantar sin descargar todo el
//     archivo. Sin esto, el <video> no puede buscar (seek).
// DELETE /api/photos/:id — borra el archivo (solo el dueño o el
//   dueño del sitio). Las referencias (avatar, portada, foto de post o de
//   historia, documento de verificación) se limpian para no dejar
//   referencias a archivos borrados.
const express = require('express');
const db = require('../db');
const photos = require('../photos');
const { optionalAuth } = require('../middleware/auth');
const { requireIdParam } = require('../middleware/validate');
const { isAdminUser } = require('../reputation');

const router = express.Router();

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const photo = await photos.getPhoto(id);
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada.' });
    if (photos.isPrivateKind(photo.kind)) {
      const user = req.user;
      const allowed = user && (isAdminUser(user) || user.id === photo.owner_id);
      if (!allowed) return res.status(403).json({ error: 'Esa foto es privada.' });
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
    res.setHeader('Content-Type', photo.mime);
    // Vídeo: aceptar Range (bytes=...) para que el reproductor
    // pueda pedir trozos y adelantar. Un solo rango, suficiente
    // para <video>. Sin Range se sirve el archivo entero (200).
    const range = req.headers.range;
    if (photo.mime.startsWith('video/') && range) {
      const m = range.match(/^bytes=(\d*)-(\d*)$/);
      if (m) {
        const total = photo.buffer.length;
        let start = m[1] === '' ? 0 : Number(m[1]);
        let end = m[2] === '' ? total - 1 : Number(m[2]);
        if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && start < total) {
          end = Math.min(end, total - 1);
          const chunk = photo.buffer.subarray(start, end + 1);
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Length', chunk.length);
          return res.send(chunk);
        }
        res.status(416);
        res.setHeader('Content-Range', `bytes */${total}`);
        return res.end();
      }
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', photo.buffer.length);
    return res.send(photo.buffer);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo cargar la foto.' });
  }
});

router.delete('/:id', optionalAuth, async (req, res) => {
  try {
    const id = requireIdParam(req, res);
    if (id === null) return;
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Necesitas iniciar sesión.' });
    const row = await db.get('SELECT id, owner_id FROM photos WHERE id = $1', [id]);
    if (!row) return res.status(404).json({ error: 'Foto no encontrada.' });
    const isOwner = isAdminUser(user);
    if (!isOwner && row.owner_id !== user.id) {
      return res.status(403).json({ error: 'Solo el dueño de la foto (o el dueño del sitio) puede borrarla.' });
    }
    await photos.deletePhoto(id);
    // Limpia las referencias para no dejar avatares, portadas o
    // documentos apuntando a un archivo que ya no existe.
    await db.query('UPDATE users SET avatar_photo_id = NULL WHERE avatar_photo_id = $1', [id]);
    await db.query('UPDATE users SET cover_photo_id = NULL WHERE cover_photo_id = $1', [id]);
    await db.query('UPDATE posts SET photo_id = NULL WHERE photo_id = $1', [id]);
    await db.query('UPDATE stories SET photo_id = NULL WHERE photo_id = $1', [id]);
    await db.query('UPDATE group_posts SET photo_id = NULL WHERE photo_id = $1', [id]);
    await db.query('UPDATE verification_requests SET document_photo_id = NULL WHERE document_photo_id = $1', [id]);
    return res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'No se pudo borrar la foto.' });
  }
});

module.exports = router;
