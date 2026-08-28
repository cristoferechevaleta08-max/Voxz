/**
 * VOXZ by LORD — server.js
 * ------------------------------------------------------------
 * Backend único y modular:
 *  1. Sirve el frontend estático (index.html, style.css, script.js, /sounds)
 *  2. Recibe eventos reales de TikTok LIVE con "tiktok-live-connector"
 *  3. Reenvía esos eventos por WebSocket al Dashboard y al Overlay
 *  4. Permite subir sonidos/GIFs propios con Multer (sin límite de cantidad)
 *
 * Sin base de datos: todo el estado "persistente" vive en el navegador
 * (LocalStorage). El servidor solo enruta eventos en tiempo real.
 * ------------------------------------------------------------
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ------------------------------------------------------------
// 1. APP EXPRESS
// ------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname))); // sirve index.html, style.css, script.js, /sounds
app.use('/uploads', express.static(UPLOADS_DIR)); // sonidos/gifs subidos por el usuario

// Subida de archivos (mp3, wav, gif, png, jpg) — SIN límite de cantidad
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB por archivo, ajustable
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|wav|ogg|gif|png|jpg|jpeg|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Tipo de archivo no permitido'), ok);
  }
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });
  res.json({ ok: true, url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// ------------------------------------------------------------
// 2. GESTOR DE SESIONES DE TIKTOK LIVE (una por @usuario)
// ------------------------------------------------------------
/** @type {Map<string, WebcastPushConnection>} */
const liveSessions = new Map();

function normalizeEvent(type, data) {
  // Traduce los eventos crudos de tiktok-live-connector a un formato
  // simple y estable que el frontend siempre puede leer igual.
  const base = {
    type,
    user: data?.nickname || data?.uniqueId || 'Alguien',
    avatar: data?.profilePictureUrl || '',
    comment: data?.comment || '',
    coins: 0,
    giftName: '',
    ts: Date.now()
  };

  if (type === 'gift') {
    // repeatEnd indica que terminó una racha de regalos combo
    base.coins = (data.diamondCount || 0) * (data.repeatCount || 1);
    base.giftName = data.giftName || 'Regalo';
    base.repeatEnd = data.repeatEnd !== false;
  }
  if (type === 'like') base.coins = data.likeCount || 1;
  if (type === 'follow') base.coins = 0;
  if (type === 'share') base.coins = 0;
  if (type === 'subscribe') base.coins = data.subMonth || 1;

  return base;
}

function startLiveSession(username, broadcast) {
  if (liveSessions.has(username)) return liveSessions.get(username);

  const connection = new WebcastPushConnection(username, {
    enableExtendedGiftInfo: true
  });

  connection.connect()
    .then(state => {
      broadcast({ type: 'status', status: 'connected', username, roomId: state.roomId });
    })
    .catch(err => {
      broadcast({ type: 'status', status: 'error', username, error: err?.message || 'No se pudo conectar' });
      liveSessions.delete(username);
    });

  // Eventos en vivo → normalizados → WebSocket
  connection.on('chat', d => broadcast(normalizeEvent('comment', d)));
  connection.on('gift', d => broadcast(normalizeEvent('gift', d)));
  connection.on('like', d => broadcast(normalizeEvent('like', d)));
  connection.on('social', d => {
    // 'social' cubre follow y share según displayType
    const isShare = (d.label || '').toLowerCase().includes('share');
    broadcast(normalizeEvent(isShare ? 'share' : 'follow', d));
  });
  connection.on('subscribe', d => broadcast(normalizeEvent('subscribe', d)));
  connection.on('roomUser', d => broadcast({ type: 'viewers', count: d.viewerCount || 0 }));
  connection.on('streamEnd', () => {
    broadcast({ type: 'status', status: 'ended', username });
    liveSessions.delete(username);
  });

  // AUTO-RECONEXIÓN: si se cae, reintenta cada 5s hasta 12 veces (~1 min)
  connection.on('disconnected', () => {
    broadcast({ type: 'status', status: 'reconnecting', username });
    let attempts = 0;
    const retry = setInterval(() => {
      attempts++;
      connection.connect()
        .then(() => { broadcast({ type: 'status', status: 'connected', username }); clearInterval(retry); })
        .catch(() => {
          if (attempts >= 12) {
            clearInterval(retry);
            broadcast({ type: 'status', status: 'error', username, error: 'No se pudo reconectar' });
            liveSessions.delete(username);
          }
        });
    }, 5000);
  });

  liveSessions.set(username, connection);
  return connection;
}

function stopLiveSession(username) {
  const conn = liveSessions.get(username);
  if (conn) {
    conn.disconnect();
    liveSessions.delete(username);
  }
}

// ------------------------------------------------------------
// 3. SERVIDOR HTTP + WEBSOCKET
// ------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`✅ VOXZ by LORD escuchando en http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Cada cliente (dashboard u overlay) se "suscribe" a un @usuario.
// Todos los clientes suscritos al mismo usuario reciben los mismos eventos.
const rooms = new Map(); // username -> Set<ws>

// Caché EN MEMORIA (no es base de datos, se pierde al reiniciar) de la
// configuración de cada usuario. Existe solo para que el Overlay, que
// corre en un navegador aparte dentro de OBS y no comparte LocalStorage
// con el Dashboard, pueda recibir temas/voces/alertas configuradas.
const configCache = new Map(); // username -> config object

function broadcastTo(username, payload) {
  const set = rooms.get(username);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const client of set) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', ws => {
  ws.username = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.action === 'subscribe' && msg.username) {
      const username = msg.username.replace('@', '').trim().toLowerCase();
      ws.username = username;
      if (!rooms.has(username)) rooms.set(username, new Set());
      rooms.get(username).add(ws);
      startLiveSession(username, payload => broadcastTo(username, payload));

      // Si ya hay una configuración cacheada para este usuario (el Dashboard
      // la mandó antes), se la mandamos de una al que se acaba de conectar
      // (típicamente el Overlay dentro de OBS).
      if (configCache.has(username)) {
        ws.send(JSON.stringify({ type: 'config', config: configCache.get(username) }));
      }
    }

    if (msg.action === 'save-config' && msg.username && msg.config) {
      const username = msg.username.replace('@', '').trim().toLowerCase();
      configCache.set(username, msg.config);
      // Reenvía la config actualizada a todos los clientes de esa sala
      // (así el Overlay se actualiza al instante si cambiás un tema en vivo).
      broadcastTo(username, { type: 'config', config: msg.config });
    }

    if (msg.action === 'unsubscribe' && ws.username) {
      stopLiveSession(ws.username);
      rooms.get(ws.username)?.delete(ws);
    }

    if (msg.action === 'test-event' && ws.username) {
      // Permite simular eventos desde el editor de alertas sin estar en vivo
      broadcastTo(ws.username, { ...msg.payload, ts: Date.now(), simulated: true });
    }
  });

  ws.on('close', () => {
    if (ws.username && rooms.has(ws.username)) {
      rooms.get(ws.username).delete(ws);
      if (rooms.get(ws.username).size === 0) {
        stopLiveSession(ws.username);
        rooms.delete(ws.username);
      }
    }
  });
});
