/**
 * VOXZ — server.js
 * ------------------------------------------------------------
 * Backend único y modular:
 *  1. Sirve el frontend estático (index.html, style.css, script.js, /sounds)
 *  2. Recibe eventos reales de TikTok LIVE con "tiktok-live-connector" v2
 *  3. Reenvía esos eventos por WebSocket al Dashboard y al Overlay
 *  4. Permite subir sonidos/GIFs propios con Multer (sin límite de cantidad)
 *  5. Actúa como proxy de voz IA (ElevenLabs) — la API key vive SOLO acá,
 *     nunca se manda al navegador. Si no hay key configurada, VOXZ sigue
 *     funcionando 100% con la voz del navegador (Web Speech API).
 *
 * Sin base de datos: todo el estado "persistente" vive en el navegador
 * (LocalStorage). El servidor solo enruta eventos en tiempo real.
 *
 * NOTA IMPORTANTE (léela si algo deja de andar en el futuro):
 * "tiktok-live-connector" es una librería NO oficial (ingeniería inversa
 * del chat de TikTok). Cada tanto TikTok cambia cosas internamente y la
 * librería saca una versión nueva para adaptarse — a veces cambiando
 * nombres de clases o eventos. Si en el futuro ves errores al conectar,
 * lo primero es correr `npm update tiktok-live-connector` y revisar
 * su changelog en https://github.com/zerodytrash/TikTok-Live-Connector
 * ------------------------------------------------------------
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
// 1b. VOZ IA — proxy a ElevenLabs
// ------------------------------------------------------------
// La key nunca se expone al navegador. Se configura como variable de
// entorno ELEVENLABS_API_KEY (local: archivo .env — ver .env.example;
// en Render: Settings → Environment). Sin key, estos endpoints avisan
// que la función está apagada y el frontend usa la voz del navegador.
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';

app.get('/api/tts/status', (req, res) => {
  res.json({ enabled: !!ELEVEN_KEY });
});

// Cachea la lista de voces 10 minutos para no golpear la cuota de ElevenLabs
// en cada carga del dashboard.
let voicesCache = { at: 0, data: [] };
app.get('/api/tts/voices', async (req, res) => {
  if (!ELEVEN_KEY) return res.status(400).json({ ok: false, error: 'Voz IA no configurada' });
  if (Date.now() - voicesCache.at < 10 * 60 * 1000 && voicesCache.data.length) {
    return res.json({ ok: true, voices: voicesCache.data });
  }
  try {
    const r = await fetch(`${ELEVEN_BASE}/voices`, { headers: { 'xi-api-key': ELEVEN_KEY } });
    if (!r.ok) throw new Error(`ElevenLabs respondió ${r.status}`);
    const data = await r.json();
    const voices = (data.voices || []).map(v => ({ voice_id: v.voice_id, name: v.name }));
    voicesCache = { at: Date.now(), data: voices };
    res.json({ ok: true, voices });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'No se pudo consultar ElevenLabs' });
  }
});

app.post('/api/tts', async (req, res) => {
  if (!ELEVEN_KEY) return res.status(400).json({ ok: false, error: 'Voz IA no configurada' });
  const { text, voiceId } = req.body || {};
  if (!text || !voiceId) return res.status(400).json({ ok: false, error: 'Falta texto o voz' });
  // Recorte de seguridad: un comentario de chat no debería superar esto,
  // y evita gastar cuota de golpe con un texto gigante.
  const safeText = String(text).slice(0, 500);
  try {
    const r = await fetch(`${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: safeText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`ElevenLabs respondió ${r.status}: ${errText.slice(0, 200)}`);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    const buffer = Buffer.from(await r.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Fallo al generar audio' });
  }
});

// ------------------------------------------------------------
// 2. GESTOR DE SESIONES DE TIKTOK LIVE (una por @usuario)
// ------------------------------------------------------------
/** @type {Map<string, TikTokLiveConnection>} */
const liveSessions = new Map();

// Saca datos de forma segura sin importar si vienen "planos" (data.nickname)
// o anidados en data.user.nickname (la librería cambia esto entre versiones).
function pick(data, ...paths) {
  for (const p of paths) {
    const val = p.split('.').reduce((o, k) => (o ? o[k] : undefined), data);
    if (val !== undefined && val !== null) return val;
  }
  return undefined;
}

function normalizeEvent(type, data) {
  const base = {
    type,
    user: pick(data, 'user.nickname', 'nickname', 'user.uniqueId', 'uniqueId') || 'Alguien',
    avatar: pick(data, 'user.profilePictureUrl', 'profilePictureUrl') || '',
    comment: pick(data, 'comment') || '',
    coins: 0,
    giftName: '',
    ts: Date.now()
  };

  if (type === 'gift') {
    const diamonds = pick(data, 'diamondCount', 'gift.diamond_count', 'giftDetails.diamondCount') || 0;
    const repeat = pick(data, 'repeatCount', 'gift.repeat_count') || 1;
    base.coins = diamonds * repeat;
    base.giftName = pick(data, 'giftName', 'gift.name', 'giftDetails.giftName') || 'Regalo';
    base.repeatEnd = pick(data, 'repeatEnd') !== false;
  }
  if (type === 'like') base.coins = pick(data, 'likeCount') || 1;

  return base;
}

function startLiveSession(username, broadcast) {
  if (liveSessions.has(username)) return liveSessions.get(username);

  // Si en tu Web Service de Render agregás la variable de entorno
  // EULER_API_KEY (gratis en https://www.eulerstream.com), la librería
  // conecta con límites más altos. Sin ella, igual funciona con el
  // límite gratuito compartido — suficiente para un canal personal.
  const options = process.env.EULER_API_KEY ? { signApiKey: process.env.EULER_API_KEY } : {};
  const connection = new TikTokLiveConnection(username, options);

  connection.connect()
    .then(state => {
      broadcast({ type: 'status', status: 'connected', username, roomId: state.roomId });
    })
    .catch(err => {
      broadcast({ type: 'status', status: 'error', username, error: err?.message || 'No se pudo conectar' });
      liveSessions.delete(username);
    });

  // Eventos en vivo → normalizados → WebSocket
  const safeOn = (event, handler) => connection.on(event, (...args) => {
    try { handler(...args); } catch (e) { console.error(`Error procesando evento ${event}:`, e.message); }
  });

  safeOn(WebcastEvent.CHAT, d => broadcast(normalizeEvent('comment', d)));
  safeOn(WebcastEvent.GIFT, d => broadcast(normalizeEvent('gift', d)));
  safeOn(WebcastEvent.LIKE, d => broadcast(normalizeEvent('like', d)));
  safeOn(WebcastEvent.FOLLOW, d => broadcast(normalizeEvent('follow', d)));
  safeOn(WebcastEvent.SHARE, d => broadcast(normalizeEvent('share', d)));
  safeOn(WebcastEvent.ROOM_USER, d => broadcast({ type: 'viewers', count: pick(d, 'viewerCount') || 0 }));
  safeOn(WebcastEvent.STREAM_END, () => {
    broadcast({ type: 'status', status: 'ended', username });
    liveSessions.delete(username);
  });

  // AUTO-RECONEXIÓN: si se cae, reintenta cada 5s hasta 12 veces (~1 min)
  safeOn(ControlEvent.DISCONNECTED, () => {
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
  console.log(`✅ VOXZ escuchando en http://localhost:${PORT}`);
  console.log(ELEVEN_KEY ? '🎙️  Voz IA (ElevenLabs): activada' : '🎙️  Voz IA (ElevenLabs): apagada (sin ELEVENLABS_API_KEY) — usando voz del navegador');
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
