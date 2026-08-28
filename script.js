'use strict';
/**
 * VOXZ by LORD — script.js
 * ------------------------------------------------------------
 * Un solo archivo que maneja DOS vistas de la misma página:
 *   - Dashboard (panel de control)     → index.html normal
 *   - Overlay   (lo que va en OBS)     → index.html?view=overlay&u=usuario
 *
 * Todo el "estado" vive en LocalStorage del navegador del Dashboard.
 * Como OBS corre su propio navegador (no comparte LocalStorage), el
 * Dashboard le manda su configuración al servidor por WebSocket y el
 * servidor se la reenvía al Overlay apenas se conecta. El servidor NO
 * guarda nada en disco: es solo un mensajero en memoria.
 * ------------------------------------------------------------ */

// ============================================================
// 0. CONSTANTES Y DATOS BASE
// ============================================================

const STORAGE_KEY = 'voxz_config_v1';

const LANGUAGES = [
  ['es-ES','Español (España)'],['es-MX','Español (México)'],['es-AR','Español (Argentina)'],
  ['en-US','Inglés (EE.UU.)'],['en-GB','Inglés (Reino Unido)'],['pt-BR','Portugués (Brasil)'],
  ['fr-FR','Francés'],['de-DE','Alemán'],['it-IT','Italiano'],['ru-RU','Ruso'],
  ['ja-JP','Japonés'],['ko-KR','Coreano'],['zh-CN','Chino'],['ar-SA','Árabe'],['hi-IN','Hindi'],
  ['tr-TR','Turco'],['nl-NL','Holandés'],['sv-SE','Sueco'],['pl-PL','Polaco'],['id-ID','Indonesio'],
  ['vi-VN','Vietnamita'],['th-TH','Tailandés'],['el-GR','Griego'],['he-IL','Hebreo'],['uk-UA','Ucraniano'],
  ['ro-RO','Rumano'],['cs-CZ','Checo'],['hu-HU','Húngaro'],['fi-FI','Finlandés'],['no-NO','Noruego'],
  ['da-DK','Danés'],['sk-SK','Eslovaco'],['hr-HR','Croata'],['sr-RS','Serbio'],['bg-BG','Búlgaro'],
  ['ca-ES','Catalán'],['eu-ES','Vasco'],['gl-ES','Gallego'],['cy-GB','Galés'],['is-IS','Islandés'],
  ['lv-LV','Letón'],['lt-LT','Lituano'],['et-EE','Estonio'],['sl-SI','Esloveno'],['mk-MK','Macedonio'],
  ['sq-AL','Albanés'],['ka-GE','Georgiano'],['hy-AM','Armenio'],['az-AZ','Azerí'],['kk-KZ','Kazajo'],
  ['ky-KG','Kirguís'],['ur-PK','Urdu'],['fa-IR','Persa']
];

// Palabras "ancla" para detectar idioma en textos con alfabeto latino.
// No es un modelo de IA: es un heurístico liviano, 100% en el navegador.
const LATIN_HINTS = {
  'es-ES':['que','de','la','el','por','gracias','hola','como','muy','para'],
  'en-US':['the','you','is','and','thanks','hello','what','this','good'],
  'pt-BR':['que','voce','obrigado','nao','muito','para','isso'],
  'fr-FR':['le','la','les','merci','bonjour','pas','avec','tres'],
  'de-DE':['der','die','und','danke','hallo','nicht','sehr'],
  'it-IT':['che','grazie','ciao','molto','per','sono'],
  'nl-NL':['de','het','dank','hallo','niet','zeer'],
  'tr-TR':['bir','çok','teşekkür','merhaba','değil'],
  'id-ID':['yang','terima','kasih','tidak','sangat'],
  'vi-VN':['la','cam','on','khong','rat'],
  'ro-RO':['multumesc','buna','foarte','pentru'],
  'pl-PL':['dziekuje','czesc','bardzo','nie']
};

const VOICE_TYPE_PRESETS = {
  normal:{rate:1,pitch:1,volume:1},
  hombre:{rate:0.95,pitch:0.75,volume:1},
  mujer:{rate:1,pitch:1.3,volume:1},
  robot:{rate:0.9,pitch:0.35,volume:1},
  nino:{rate:1.18,pitch:1.6,volume:1},
  anciano:{rate:0.8,pitch:0.6,volume:1},
  demonio:{rate:0.75,pitch:0.15,volume:1},
  asmr:{rate:0.78,pitch:0.9,volume:0.7},
  locutor:{rate:0.95,pitch:0.85,volume:1},
  eco:{rate:1,pitch:1,volume:1,forceEcho:true}
};

const ANIMATIONS = ['pop','slide','fuego','rayo','fullscreen','bounce','zoom','flip','glitch','confetti'];
const ANIM_LABELS = {pop:'Pop',slide:'Slide',fuego:'🔥 Fuego',rayo:'⚡ Rayo',fullscreen:'Pantalla completa',
  bounce:'Rebote',zoom:'Zoom',flip:'Flip 3D',glitch:'Glitch',confetti:'🎉 Confetti'};

const THEMES = [
  ['neon-cyber','Neón Cyber'],['minimal','Minimal'],['gamer-rgb','Gamer RGB'],['samurai','Samurái'],
  ['matrix','Matrix'],['fuego','Fuego'],['hielo','Hielo'],['pro-dark','Pro Dark'],
  ['transparente','Transparente'],['pastel','Pastel']
];

// Eventos disponibles en el editor de alertas.
// automatico:true  -> lo dispara TikTok LIVE de verdad a través del backend.
// automatico:false -> no existe como evento nativo de TikTok; se dispara
//                      manualmente con el botón "Simular" o con metas locales.
const EVENTS = [
  {id:'follow', label:'Seguidor', icon:'➕', hasLevels:false, automatico:true,  defaultText:'¡Gracias por seguirme, {usuario}!'},
  {id:'gift', label:'Regalo', icon:'🎁', hasLevels:true, automatico:true, defaultText:'{usuario} envió {regalo} — ¡{monedas} monedas!'},
  {id:'subscribe', label:'Suscripción', icon:'⭐', hasLevels:true, automatico:true, defaultText:'¡{usuario} se suscribió!'},
  {id:'donation', label:'Donación', icon:'💰', hasLevels:true, automatico:true, defaultText:'¡{usuario} donó {monedas} monedas!', note:'Usa el mismo sistema de monedas que Regalo.'},
  {id:'like', label:'Like', icon:'❤️', hasLevels:true, automatico:true, defaultText:'¡Llegamos a los likes, gracias {usuario}!'},
  {id:'share', label:'Compartir', icon:'📤', hasLevels:false, automatico:true, defaultText:'¡{usuario} compartió el live!'},
  {id:'raid', label:'Raid', icon:'🚀', hasLevels:false, automatico:false, defaultText:'¡{usuario} trajo su raid!', note:'TikTok no tiene raids nativos: se dispara manual o simulado.'},
  {id:'meta', label:'Meta', icon:'🏆', hasLevels:false, automatico:false, defaultText:'¡Meta alcanzada!', note:'Se activa sola cuando la suma de monedas del live llega a tu objetivo.'}
];

// ============================================================
// 1. CONFIGURACIÓN (LocalStorage)
// ============================================================

function defaultConfig(){
  const alerts = {};
  EVENTS.forEach(ev=>{
    if(ev.hasLevels){
      alerts[ev.id] = { enabled:true, levels:[
        { id:cryptoId(), from:0, text:ev.defaultText, animation:'pop', voiceType:'normal', voiceLang:'auto', soundId:null, image:null }
      ]};
    } else {
      alerts[ev.id] = { enabled:true, text:ev.defaultText, animation:'pop', voiceType:'normal', voiceLang:'auto', soundId:null, image:null };
    }
  });
  return {
    username:'',
    theme:'neon-cyber',
    voice:{ defaultLang:'es-ES', voiceType:'normal', rate:1, pitch:1, echo:0, robot:0, readComments:true },
    sounds:{ custom:[] }, // {id,url,name,category}
    overlay:{ subtitlePos:{x:50,y:88}, alertPos:{x:50,y:22} },
    metaGoal: 5000,
    alerts
  };
}

function cryptoId(){ return Math.random().toString(36).slice(2,9); }

function loadConfig(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultConfig();
    const parsed = JSON.parse(raw);
    // merge superficial por si se agregan campos nuevos en el futuro
    return Object.assign(defaultConfig(), parsed, {
      voice:Object.assign(defaultConfig().voice, parsed.voice||{}),
      overlay:Object.assign(defaultConfig().overlay, parsed.overlay||{}),
      alerts:Object.assign(defaultConfig().alerts, parsed.alerts||{})
    });
  }catch(e){ return defaultConfig(); }
}

function saveConfig(cfg){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  // Si hay conexión activa, le mandamos la config al servidor para que
  // el Overlay (que puede estar corriendo en OBS, sin este LocalStorage)
  // se entere del cambio al instante.
  if (APP.ws && APP.ws.readyState === 1 && cfg.username) {
    APP.ws.send(JSON.stringify({ action:'save-config', username:cfg.username, config:cfg }));
  }
}

// ============================================================
// 2. ESTADO GLOBAL DE LA APP
// ============================================================
const APP = {
  config: loadConfig(),
  ws: null,
  soundManifest: [],
  currentEvent: 'gift',
  speakingIndicator: 0,
  metaCoinsAcc: 0,
  antispam: new Map() // texto normalizado -> {count, timer}
};

const params = new URLSearchParams(location.search);
const IS_OVERLAY = params.get('view') === 'overlay';
const EDIT_MODE = params.get('edit') === '1';

// ============================================================
// 3. UTILIDADES
// ============================================================
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const clamp = (v,min,max) => Math.min(max, Math.max(min, v));

function fillTemplate(tpl, data){
  return (tpl||'').replace(/\{(\w+)\}/g, (_,k)=> (data[k] ?? ''));
}

function normalizeText(t){ return (t||'').trim().toLowerCase().replace(/\s+/g,' '); }

// ============================================================
// 4. DETECCIÓN DE IDIOMA (heurístico, 100% en el navegador)
// ============================================================
function detectLanguage(text){
  if(!text) return null;
  const t = text.trim();
  if(/[\u3040-\u30ff]/.test(t)) return 'ja-JP';                 // hiragana/katakana
  if(/[\uac00-\ud7af]/.test(t)) return 'ko-KR';                 // hangul
  if(/[\u4e00-\u9fff]/.test(t)) return 'zh-CN';                 // ideogramas chinos
  if(/[\u0600-\u06ff]/.test(t)) return 'ar-SA';                 // árabe/urdu/persa comparten bloque
  if(/[\u0900-\u097f]/.test(t)) return 'hi-IN';                 // devanagari
  if(/[\u0e00-\u0e7f]/.test(t)) return 'th-TH';                 // tailandés
  if(/[\u0370-\u03ff]/.test(t)) return 'el-GR';                 // griego
  if(/[\u0590-\u05ff]/.test(t)) return 'he-IL';                 // hebreo
  if(/[\u10a0-\u10ff]/.test(t)) return 'ka-GE';                 // georgiano
  if(/[\u0530-\u058f]/.test(t)) return 'hy-AM';                 // armenio
  if(/[\u0400-\u04ff]/.test(t)) return 'ru-RU';                 // cirílico (ru/uk/bg/sr — aprox.)

  // Latino: puntaje por palabras ancla
  const words = t.toLowerCase().replace(/[^\p{L}\s]/gu,'').split(/\s+/);
  let best = null, bestScore = 0;
  for(const [lang, hints] of Object.entries(LATIN_HINTS)){
    const score = words.filter(w=>hints.includes(w)).length;
    if(score > bestScore){ bestScore = score; best = lang; }
  }
  return bestScore > 0 ? best : null; // null = usar idioma por defecto del usuario
}

// ============================================================
// 5. TEXT-TO-SPEECH
// ============================================================
let cachedVoices = [];
function refreshVoices(){ cachedVoices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : []; }
if('speechSynthesis' in window){
  refreshVoices();
  speechSynthesis.onvoiceschanged = refreshVoices;
}

function pickVoice(langCode){
  if(!cachedVoices.length) return null;
  const short = (langCode||'').split('-')[0];
  return cachedVoices.find(v=>v.lang===langCode) ||
         cachedVoices.find(v=>v.lang && v.lang.startsWith(short)) || null;
}

function setSpeaking(on){
  APP.speakingIndicator = on ? 1 : 0;
}

/**
 * Lee un texto en voz alta.
 * opts: {lang, type, rate, pitch, echoPct, robotPct}
 * Nota honesta: Web Speech API no permite procesar la señal de audio,
 * así que "Robot" y "Eco" son APROXIMACIONES logradas con tono/velocidad
 * y repetición del texto — no un efecto DSP real.
 */
function speakText(text, opts={}){
  if(!text || !('speechSynthesis' in window)) return;
  const v = APP.config.voice;
  const lang = opts.lang && opts.lang!=='auto' ? opts.lang : (detectLanguage(text) || v.defaultLang);
  const type = opts.type || v.voiceType;
  const preset = VOICE_TYPE_PRESETS[type] || VOICE_TYPE_PRESETS.normal;
  const robotPct = (opts.robotPct ?? v.robot) / 100;
  const echoPct = (opts.echoPct ?? v.echo) / 100 + (preset.forceEcho ? 0.6 : 0);

  const baseRate = clamp((opts.rate ?? v.rate) * preset.rate, 0.4, 3);
  const basePitch = clamp(((opts.pitch ?? v.pitch) * preset.pitch) - robotPct*0.6, 0, 2);

  const speak1 = (volume, delayMs) => {
    setTimeout(()=>{
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(lang);
      if(voice) u.voice = voice;
      u.lang = lang; u.rate = baseRate; u.pitch = basePitch;
      u.volume = clamp((preset.volume ?? 1) * volume, 0, 1);
      if(volume === 1){ u.onstart = ()=>setSpeaking(true); u.onend = ()=>setSpeaking(false); }
      speechSynthesis.speak(u);
    }, delayMs);
  };

  speak1(1, 0);
  const echoRepeats = Math.round(echoPct*3); // 0 a 3 ecos
  for(let i=1;i<=echoRepeats;i++){
    speak1(Math.max(0.15, 1 - i*0.3), i*180);
  }
}

// ============================================================
// 6. SONIDOS
// ============================================================
async function loadSoundManifest(){
  try{
    const res = await fetch('sounds/manifest.json');
    APP.soundManifest = await res.json();
  }catch(e){ APP.soundManifest = []; }
}

function allSounds(){
  return [...APP.soundManifest, ...(APP.config.sounds.custom||[])];
}

function playSoundById(id){
  const s = allSounds().find(s=>s.id===id);
  if(!s) return;
  const url = s.category==='custom' ? s.file : `sounds/${s.file}`;
  const audio = new Audio(url);
  audio.volume = 0.8;
  audio.play().catch(()=>{});
}

async function uploadFile(file){
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method:'POST', body:fd });
  if(!res.ok) throw new Error('No se pudo subir el archivo');
  return res.json();
}

// ============================================================
// 7. WEBSOCKET (tiempo real con el servidor)
// ============================================================
function connectWS(username, onEvent){
  if(APP.ws) { try{ APP.ws.close(); }catch(e){} }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  APP.ws = ws;

  ws.onopen = () => {
    ws.send(JSON.stringify({ action:'subscribe', username }));
    if(!IS_OVERLAY) ws.send(JSON.stringify({ action:'save-config', username, config: APP.config }));
  };
  ws.onmessage = (e) => {
    let msg; try{ msg = JSON.parse(e.data); }catch(err){ return; }
    onEvent(msg);
  };
  ws.onclose = () => onEvent({ type:'status', status:'closed' });
  return ws;
}

function sendTestEvent(payload){
  if(APP.ws && APP.ws.readyState===1){
    APP.ws.send(JSON.stringify({ action:'test-event', payload }));
  }
}

// ============================================================
// 8. LÓGICA DE ALERTAS (compartida por Dashboard-preview y Overlay real)
// ============================================================
function pickLevel(levels, coins){
  const sorted = [...levels].sort((a,b)=>a.from-b.from);
  let match = null;
  for(const lvl of sorted){ if(coins >= lvl.from) match = lvl; }
  return match;
}

function resolveAlert(ev){
  const cfg = APP.config.alerts[ev.type];
  if(!cfg || cfg.enabled===false) return null;
  if(cfg.levels){
    const level = pickLevel(cfg.levels, ev.coins||0);
    return level ? { ...level } : null;
  }
  return { ...cfg };
}

const alertQueue = [];
let alertPlaying = false;

function queueAlert(ev){
  const design = resolveAlert(ev);
  if(!design) return;
  alertQueue.push({ ev, design });
  processQueue();
}

async function processQueue(){
  if(alertPlaying) return;
  alertPlaying = true;
  while(alertQueue.length){
    const { ev, design } = alertQueue.shift();
    await playAlert(ev, design);
  }
  alertPlaying = false;
}

function playAlert(ev, design){
  return new Promise(resolve=>{
    const text = fillTemplate(design.text, { usuario:ev.user, monedas:ev.coins, regalo:ev.giftName });
    const box = $('#overlay-alert');
    const img = $('#ov-alert-img');
    const txt = $('#ov-alert-text');
    if(!box) return resolve();

    txt.textContent = text;
    if(design.image){ img.src = design.image; img.classList.add('show'); } else { img.classList.remove('show'); }

    box.className = 'ov-el ov-alert show anim-' + (design.animation||'pop');
    box.style.opacity = '1';

    if(design.soundId) playSoundById(design.soundId);
    speakText(text, { lang:design.voiceLang, type:design.voiceType });

    setTimeout(()=>{
      box.style.opacity = '0';
      setTimeout(resolve, 300);
    }, 3600);
  });
}

function showSubtitle(text){
  const el = $('#overlay-subtitles');
  if(!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(()=>el.classList.remove('show'), 2600);
}

function handleComment(ev){
  const key = normalizeText(ev.comment);
  if(!key) return;
  const entry = APP.antispam.get(key) || { count:0 };
  entry.count++;
  APP.antispam.set(key, entry);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(()=>APP.antispam.delete(key), 4000);

  const label = entry.count > 1 ? `x${entry.count} dicen: ${ev.comment}` : `${ev.user}: ${ev.comment}`;
  showSubtitle(label);

  if(APP.config.voice.readComments && entry.count === 1){
    speakText(ev.comment, {});
  }
  logFeed(`💬 ${ev.user}`, ev.comment);
}

function handleLiveEvent(ev){
  if(ev.type === 'comment') return handleComment(ev);
  if(ev.type === 'viewers' || ev.type === 'status' || ev.type === 'config') return;

  // Meta local: suma monedas de regalos/donaciones y dispara sola al llegar al objetivo
  if(ev.type === 'gift' && !ev.simulated){
    APP.metaCoinsAcc += (ev.coins||0);
    if(APP.metaCoinsAcc >= (APP.config.metaGoal||Infinity)){
      queueAlert({ type:'meta', user:ev.user, coins:APP.metaCoinsAcc, giftName:'' });
      APP.metaCoinsAcc = 0;
    }
  }

  if(EVENTS.some(e=>e.id===ev.type)) queueAlert(ev);
  logFeed(eventEmoji(ev.type) + ' ' + ev.user, ev.giftName || '', ev.coins);
}

function eventEmoji(type){
  return { follow:'➕', gift:'🎁', like:'❤️', share:'📤', subscribe:'⭐', raid:'🚀', meta:'🏆', donation:'💰' }[type] || '✨';
}

function logFeed(who, extra, coins){
  const feed = $('#live-feed');
  if(!feed) return;
  const row = document.createElement('div');
  row.className = 'feed-item';
  row.innerHTML = `<b>${who}</b> <span>${extra||''}</span> ${coins?`<span class="coins">+${coins}</span>`:''}`;
  feed.appendChild(row);
  while(feed.children.length > 40) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
}

// ============================================================
// 9. OVERLAY — inicialización (vista para OBS)
// ============================================================
function initOverlay(){
  $('#dashboard-root').classList.add('hidden');
  const root = $('#overlay-root');
  root.classList.remove('hidden');
  root.classList.add('theme-' + APP.config.theme);

  applyOverlayPositions();

  if(EDIT_MODE){
    $('#overlay-edit-badge').classList.remove('hidden');
    makeDraggable($('#overlay-subtitles'), 'subtitlePos');
    makeDraggable($('#overlay-alert'), 'alertPos');
  }

  const usernameFromUrl = params.get('u');
  const username = (usernameFromUrl || APP.config.username || '').replace('@','').trim().toLowerCase();
  if(!username) return; // overlay sin usuario: queda transparente esperando config

  connectWS(username, (msg)=>{
    if(msg.type === 'config' && msg.config){
      APP.config = Object.assign(APP.config, msg.config);
      $('#overlay-root').className = 'theme-' + APP.config.theme;
      applyOverlayPositions();
      return;
    }
    handleLiveEvent(msg);
  });
}

function applyOverlayPositions(){
  const { subtitlePos, alertPos } = APP.config.overlay;
  const sub = $('#overlay-subtitles'), alert = $('#overlay-alert');
  if(sub){ sub.style.left = subtitlePos.x+'%'; sub.style.bottom = ''; sub.style.top = subtitlePos.y+'%'; sub.style.transform='translate(-50%,-50%)'; }
  if(alert){ alert.style.left = alertPos.x+'%'; alert.style.top = alertPos.y+'%'; }
}

function makeDraggable(el, key){
  if(!el) return;
  el.classList.add('editing');
  let dragging = false;
  el.addEventListener('pointerdown', e=>{ dragging = true; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', e=>{
    if(!dragging) return;
    const xPct = clamp((e.clientX / window.innerWidth) * 100, 2, 98);
    const yPct = clamp((e.clientY / window.innerHeight) * 100, 4, 96);
    el.style.left = xPct+'%'; el.style.top = yPct+'%';
    APP.config.overlay[key] = { x:xPct, y:yPct };
  });
  el.addEventListener('pointerup', ()=>{ dragging = false; saveConfig(APP.config); });
}

// ============================================================
// 10. DASHBOARD — inicialización
// ============================================================
function initDashboard(){
  $('#overlay-root').classList.add('hidden');
  setupTabs();
  setupConnect();
  setupVoices();
  setupSounds();
  setupAlertsEditor();
  setupThemes();
  animateWaveform();

  // Feed en vivo usa la misma conexión si ya había un usuario guardado
  if(APP.config.username){
    $('#input-username').value = APP.config.username;
    connectWS(APP.config.username, onDashboardEvent);
    setStatus('connecting');
    $('#btn-stop').classList.remove('hidden');
    // BUGFIX: la vista previa (iframe) también necesita reconectarse con el
    // usuario guardado al recargar la página — si no, "Simular" queda mudo
    // porque el iframe nunca se suscribió a nada.
    $('#overlay-preview').src = `?view=overlay&edit=1&u=${APP.config.username}`;
  }
}

/**
 * BUGFIX audio: los navegadores bloquean la voz automática (TTS) hasta que
 * haya al menos un click real del usuario en la página. Como "INICIAR VOXZ"
 * SÍ es un click real, aprovechamos ese momento para "destrabar" el motor
 * de voz con una lectura silenciosa. Después de esto, la lectura automática
 * de comentarios que llegan solos por WebSocket ya no queda muda.
 */
function unlockAudio(){
  if(!('speechSynthesis' in window)) return;
  try{
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }catch(e){}
}

function onDashboardEvent(msg){
  if(msg.type === 'status'){
    if(msg.status==='connected') setStatus('live');
    if(msg.status==='reconnecting'){ setStatus('connecting'); $('#reconnect-hint').textContent = '🔁 Se cortó la conexión, reintentando solo...'; }
    if(msg.status==='error'){ setStatus('error'); $('#reconnect-hint').textContent = '⚠️ ' + (msg.error||'No se pudo conectar. Revisá el @usuario.'); }
    if(msg.status==='ended'){ setStatus('idle'); $('#reconnect-hint').textContent = 'El LIVE terminó.'; }
    return;
  }
  if(msg.type === 'config') return;
  handleLiveEvent(msg);
}

function setStatus(state){
  const pill = $('#status-pill');
  pill.className = 'status-pill' + (state!=='idle' ? ' '+state : '');
  const labels = { idle:'Desconectado', connecting:'Conectando…', live:'🔴 En vivo', error:'Error' };
  $('#status-label').textContent = labels[state] || 'Desconectado';
}

// ---------- Tabs ----------
function setupTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      $$('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      $('#panel-'+btn.dataset.tab).classList.add('active');
    });
  });
}

// ---------- Tab Conectar ----------
function setupConnect(){
  $('#btn-start').addEventListener('click', ()=>{
    const username = $('#input-username').value.replace('@','').trim().toLowerCase();
    if(!username){ $('#reconnect-hint').textContent = 'Escribí tu @usuario de TikTok primero.'; return; }
    unlockAudio(); // desbloquea la voz automática usando este click como permiso
    APP.config.username = username;
    saveConfig(APP.config);
    setStatus('connecting');
    $('#reconnect-hint').textContent = '';
    $('#btn-stop').classList.remove('hidden');
    connectWS(username, onDashboardEvent);
    $('#overlay-preview').src = `?view=overlay&edit=1&u=${username}`;
  });

  $('#btn-stop').addEventListener('click', ()=>{
    if(APP.ws){ APP.ws.send(JSON.stringify({action:'unsubscribe'})); APP.ws.close(); }
    setStatus('idle');
    $('#btn-stop').classList.add('hidden');
  });

  $('#btn-copy-overlay').addEventListener('click', async ()=>{
    const username = APP.config.username || $('#input-username').value.replace('@','').trim();
    if(!username){ $('#reconnect-hint').textContent = 'Primero escribí tu @usuario e iniciá VOXZ.'; return; }
    const link = `${location.origin}${location.pathname}?view=overlay&u=${username}`;
    try{
      await navigator.clipboard.writeText(link);
      $('#reconnect-hint').textContent = '✅ Link copiado. Pegalo en OBS → Fuente → Navegador.';
    }catch(e){
      $('#reconnect-hint').textContent = link;
    }
  });
}

// ---------- Tab Voces ----------
function setupVoices(){
  const sel = $('#sel-default-lang');
  sel.innerHTML = LANGUAGES.map(([code,name])=>`<option value="${code}">${name}</option>`).join('');
  sel.value = APP.config.voice.defaultLang;
  $('#sel-voice-type').value = APP.config.voice.voiceType;
  $('#sl-rate').value = APP.config.voice.rate;
  $('#sl-pitch').value = APP.config.voice.pitch;
  $('#sl-echo').value = APP.config.voice.echo;
  $('#sl-robot').value = APP.config.voice.robot;
  updateSliderLabels();

  sel.addEventListener('change', ()=>{ APP.config.voice.defaultLang = sel.value; saveConfig(APP.config); });
  $('#sel-voice-type').addEventListener('change', e=>{ APP.config.voice.voiceType = e.target.value; saveConfig(APP.config); });
  ['rate','pitch','echo','robot'].forEach(k=>{
    $(`#sl-${k}`).addEventListener('input', e=>{
      APP.config.voice[k] = Number(e.target.value);
      updateSliderLabels();
      saveConfig(APP.config);
    });
  });

  $('#btn-test-voice').addEventListener('click', ()=>{
    const text = $('#input-test-tts').value || 'Hola, esto es una prueba de VOXZ';
    speakText(text, {});
  });

  const updateHint = ()=>{
    const n = cachedVoices.length;
    $('#voice-count-hint').textContent = n
      ? `Tu navegador tiene ${n} voces instaladas — VOXZ elige la más cercana al idioma detectado.`
      : 'Cargando voces del navegador...';
  };
  updateHint();
  if('speechSynthesis' in window) speechSynthesis.onvoiceschanged = ()=>{ refreshVoices(); updateHint(); };
}

function updateSliderLabels(){
  $('#val-rate').textContent = Number(APP.config.voice.rate).toFixed(2)+'x';
  $('#val-pitch').textContent = Number(APP.config.voice.pitch).toFixed(2);
  $('#val-echo').textContent = APP.config.voice.echo+'%';
  $('#val-robot').textContent = APP.config.voice.robot+'%';
}

// ---------- Tab Sonidos ----------
async function setupSounds(){
  await loadSoundManifest();
  renderSoundCategories();

  $('#input-upload-sound').addEventListener('change', async e=>{
    const file = e.target.files[0];
    if(!file) return;
    $('#upload-hint').textContent = 'Subiendo...';
    try{
      const res = await uploadFile(file);
      APP.config.sounds.custom.push({ id:'custom_'+cryptoId(), file:res.url, name:file.name, category:'custom' });
      saveConfig(APP.config);
      renderSoundCategories();
      $('#upload-hint').textContent = '✅ ' + file.name + ' agregado. Sin límite, subí todos los que quieras.';
    }catch(err){
      $('#upload-hint').textContent = '❌ ' + err.message;
    }
    e.target.value = '';
  });
}

function renderSoundCategories(){
  const cats = {};
  allSounds().forEach(s=>{ (cats[s.category] = cats[s.category]||[]).push(s); });
  const catNames = { seguidores:'Seguidores', regalos:'Regalos', suscripcion:'Suscripción / Donación',
    comentarios:'Comentarios', alertas:'Alertas', meme:'Meme', custom:'🎵 Tus sonidos subidos' };

  $('#sound-categories').innerHTML = Object.entries(cats).map(([cat, items])=>`
    <div class="sound-category">
      <h4>${catNames[cat]||cat}</h4>
      <div class="sound-grid">
        ${items.map(s=>`
          <div class="sound-chip ${cat==='custom'?'custom':''}">
            <span>${s.label || s.name}</span>
            <button data-play="${s.id}" title="Reproducir">▶</button>
          </div>`).join('')}
      </div>
    </div>`).join('');

  $$('button[data-play]').forEach(btn=>{
    btn.addEventListener('click', ()=>playSoundById(btn.dataset.play));
  });
}

// ---------- Tab Alertas ----------
function setupAlertsEditor(){
  $('#event-selector').innerHTML = EVENTS.map(ev=>`
    <button class="event-btn ${ev.id===APP.currentEvent?'active':''}" data-ev="${ev.id}">
      ${ev.icon} ${ev.label}${ev.automatico?'':' ·  manual'}
    </button>`).join('');

  $$('.event-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.event-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      APP.currentEvent = btn.dataset.ev;
      renderAlertEditor();
    });
  });

  renderAlertEditor();
}

function soundOptions(selected){
  return `<option value="">— sin sonido —</option>` + allSounds().map(s=>
    `<option value="${s.id}" ${s.id===selected?'selected':''}>${s.label||s.name}</option>`).join('');
}
function voiceTypeOptions(selected){
  const types = ['normal','hombre','mujer','robot','nino','anciano','demonio','asmr','locutor','eco'];
  const labels = {normal:'Normal',hombre:'Hombre',mujer:'Mujer',robot:'Robot',nino:'Niño',anciano:'Anciano',demonio:'Demonio',asmr:'ASMR',locutor:'Locutor',eco:'Eco'};
  return types.map(t=>`<option value="${t}" ${t===selected?'selected':''}>${labels[t]}</option>`).join('');
}
function langOptions(selected){
  return `<option value="auto" ${selected==='auto'?'selected':''}>🌐 Auto-detectar</option>` +
    LANGUAGES.map(([c,n])=>`<option value="${c}" ${c===selected?'selected':''}>${n}</option>`).join('');
}
function animOptions(selected){
  return ANIMATIONS.map(a=>`<button type="button" class="anim-chip ${a===selected?'active':''}" data-anim="${a}">${ANIM_LABELS[a]}</button>`).join('');
}

function renderAlertEditor(){
  const ev = EVENTS.find(e=>e.id===APP.currentEvent);
  const cfg = APP.config.alerts[ev.id];
  const card = $('#alert-editor-card');

  const levelBlock = (level, idx, isOnly) => `
    <div class="level-row" data-idx="${idx}">
      <span class="level-tag">${idx===0?'Nivel base':'Nivel '+(idx+1)}</span>
      <div class="level-fields">
        <label>Desde (monedas)
          <input type="number" min="0" class="f-from" value="${level.from}" ${idx===0?'disabled title="El nivel base siempre arranca en 0"':''}>
        </label>
        <label>Texto
          <input type="text" class="f-text" value="${level.text}">
        </label>
        <label>Voz
          <select class="f-voicetype">${voiceTypeOptions(level.voiceType)}</select>
        </label>
        <label>Idioma
          <select class="f-lang">${langOptions(level.voiceLang)}</select>
        </label>
        <label>Sonido
          <select class="f-sound">${soundOptions(level.soundId)}</select>
        </label>
        <label>GIF / Imagen
          <input type="file" class="f-image" accept="image/*,.gif">
        </label>
      </div>
      <div class="anim-grid">${animOptions(level.animation)}</div>
      ${isOnly ? '' : `<button class="btn btn-sm btn-danger-ghost btn-remove-level">🗑 Quitar nivel</button>`}
    </div>`;

  let body = '';
  if(ev.hasLevels){
    body = `
      <div class="field" style="margin-top:0; flex-direction:row; align-items:center; justify-content:space-between;">
        <span style="font-size:1rem; color:var(--text); font-weight:600;">${ev.icon} ${ev.label}</span>
        <label style="display:flex; align-items:center; gap:8px; color:var(--muted);">
          <input type="checkbox" id="f-enabled" ${cfg.enabled?'checked':''}> Activada
        </label>
      </div>
      ${ev.note?`<p class="hint">${ev.note}</p>`:''}
      <div id="levels-container">
        ${cfg.levels.map((l,i)=>levelBlock(l,i, cfg.levels.length===1)).join('')}
      </div>
      <button id="btn-add-level" class="btn btn-ghost btn-sm" style="margin-top:14px;">+ Agregar nivel</button>
      <div class="connect-row" style="margin-top:18px;">
        <input type="number" id="simulate-coins" placeholder="Monedas a simular" value="100" style="max-width:160px;">
        <button id="btn-simulate" class="btn btn-primary">▶ Simular</button>
      </div>`;
  } else {
    body = `
      <div class="field" style="margin-top:0; flex-direction:row; align-items:center; justify-content:space-between;">
        <span style="font-size:1rem; color:var(--text); font-weight:600;">${ev.icon} ${ev.label}</span>
        <label style="display:flex; align-items:center; gap:8px; color:var(--muted);">
          <input type="checkbox" id="f-enabled" ${cfg.enabled?'checked':''}> Activada
        </label>
      </div>
      ${ev.note?`<p class="hint">${ev.note}</p>`:''}
      <div class="level-row" data-idx="0">
        <span class="level-tag">Config.</span>
        <div class="level-fields">
          <label>Texto<input type="text" class="f-text" value="${cfg.text}"></label>
          <label>Voz<select class="f-voicetype">${voiceTypeOptions(cfg.voiceType)}</select></label>
          <label>Idioma<select class="f-lang">${langOptions(cfg.voiceLang)}</select></label>
          <label>Sonido<select class="f-sound">${soundOptions(cfg.soundId)}</select></label>
          <label>GIF / Imagen<input type="file" class="f-image" accept="image/*,.gif"></label>
        </div>
        <div class="anim-grid">${animOptions(cfg.animation)}</div>
      </div>
      <div class="connect-row" style="margin-top:18px;">
        <button id="btn-simulate" class="btn btn-primary">▶ Simular ${ev.label.toLowerCase()}</button>
      </div>`;
  }

  card.innerHTML = body;
  wireAlertEditorEvents(ev, cfg);
}

function wireAlertEditorEvents(ev, cfg){
  $('#f-enabled').addEventListener('change', e=>{ cfg.enabled = e.target.checked; saveConfig(APP.config); });

  const rows = () => $$('.level-row');
  const readRowIntoModel = (row) => {
    const idx = Number(row.dataset.idx);
    const target = ev.hasLevels ? cfg.levels[idx] : cfg;
    const fFrom = row.querySelector('.f-from');
    if(fFrom && !fFrom.disabled) target.from = Number(fFrom.value)||0;
    target.text = row.querySelector('.f-text').value;
    target.voiceType = row.querySelector('.f-voicetype').value;
    target.voiceLang = row.querySelector('.f-lang').value;
    target.soundId = row.querySelector('.f-sound').value || null;
  };

  rows().forEach(row=>{
    row.querySelectorAll('input, select').forEach(input=>{
      if(input.type==='file') return;
      input.addEventListener('input', ()=>{ readRowIntoModel(row); saveConfig(APP.config); });
    });
    row.querySelectorAll('.anim-chip').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        row.querySelectorAll('.anim-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
        const idx = Number(row.dataset.idx);
        const target = ev.hasLevels ? cfg.levels[idx] : cfg;
        target.animation = chip.dataset.anim;
        saveConfig(APP.config);
      });
    });
    const fileInput = row.querySelector('.f-image');
    if(fileInput){
      fileInput.addEventListener('change', async ()=>{
        const file = fileInput.files[0];
        if(!file) return;
        const res = await uploadFile(file);
        const idx = Number(row.dataset.idx);
        const target = ev.hasLevels ? cfg.levels[idx] : cfg;
        target.image = res.url;
        saveConfig(APP.config);
      });
    }
    const removeBtn = row.querySelector('.btn-remove-level');
    if(removeBtn){
      removeBtn.addEventListener('click', ()=>{
        const idx = Number(row.dataset.idx);
        cfg.levels.splice(idx,1);
        saveConfig(APP.config);
        renderAlertEditor();
      });
    }
  });

  const addLevelBtn = $('#btn-add-level');
  if(addLevelBtn){
    addLevelBtn.addEventListener('click', ()=>{
      const lastFrom = cfg.levels[cfg.levels.length-1]?.from || 0;
      cfg.levels.push({ id:cryptoId(), from:lastFrom+500, text:ev.defaultText, animation:'pop', voiceType:'normal', voiceLang:'auto', soundId:null, image:null });
      saveConfig(APP.config);
      renderAlertEditor();
    });
  }

  $('#btn-simulate').addEventListener('click', ()=>{
    const coins = ev.hasLevels ? Number($('#simulate-coins')?.value || 0) : 0;
    const fakeEvent = { type: ev.id, user:'LORD_test', coins, giftName:'Corona', comment:'', simulated:true };
    handleLiveEvent(fakeEvent); // se ve en el preview del propio dashboard (mismo storage)
    // y además lo mandamos al overlay real si está conectado
    sendTestEvent(fakeEvent);
  });
}

// ---------- Tab Alertas: Temas ----------
function setupThemes(){
  $('#theme-grid').innerHTML = THEMES.map(([id,name])=>`
    <button class="theme-chip ${id===APP.config.theme?'active':''}" data-theme="${id}">${name}</button>`).join('');
  $$('.theme-chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.theme-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      APP.config.theme = btn.dataset.theme;
      saveConfig(APP.config);
    });
  });
}

// ---------- Firma visual: mini onda de voz en el header ----------
function animateWaveform(){
  const canvas = $('#wave-signature');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const bars = 5;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const active = APP.speakingIndicator || (window.speechSynthesis && speechSynthesis.speaking);
    for(let i=0;i<bars;i++){
      const h = active ? 6 + Math.random()*20 : 4 + Math.sin(Date.now()/400 + i)*2 + 4;
      ctx.fillStyle = active ? '#00E5FF' : 'rgba(255,255,255,.5)';
      ctx.fillRect(i*8+2, (canvas.height-h)/2, 5, h);
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ============================================================
// 11. ARRANQUE
// ============================================================
document.addEventListener('DOMContentLoaded', ()=>{
  if(IS_OVERLAY) initOverlay(); else initDashboard();
});
