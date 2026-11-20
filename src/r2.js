// src/r2.js — Cloudflare R2 (compatible con S3) para Robin Dark.
//
// R2 es OPCIONAL: si no están las variables, el módulo reporta que
// no está configurado y las fotos se guardan en la base de datos
// (src/photos.js). Nada se rompe por no tener R2.
//
// Variables (en Railway, en Variables del servicio):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   R2_PUBLIC_URL (opcional): dominio público del bucket para las
//   fotos públicas (avatar, portada, posts). Sin él, las fotos se
//   sirven desde la propia app (/api/photos/:id).
// Para crear el token: Cloudflare → R2 → Administrar tokens de API
// (permiso de lectura/escritura solo en ese bucket). El documento
// de identidad NUNCA va a un bucket público: siempre se sirve
// desde la app, solo al dueño o al admin.
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function isConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID
    && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY
    && process.env.R2_BUCKET,
  );
}

function client() {
  if (!isConfigured()) throw new Error('R2 no está configurado (faltan variables R2_*).');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function bucket() {
  return process.env.R2_BUCKET;
}

function publicUrl(key) {
  const base = String(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/${key}`;
}

async function put(key, buffer, mime) {
  const res = await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: buffer,
    ContentType: mime,
  }));
  return res;
}

async function get(key) {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  // El SDK v3 devuelve un stream: se convierte a Buffer.
  const bytes = await res.Body.transformToByteArray();
  return { buffer: Buffer.from(bytes), mime: res.ContentType || 'application/octet-stream' };
}

async function remove(key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

module.exports = { isConfigured, publicUrl, put, get, remove };
