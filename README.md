# VOXZ
**Tu chat, tu voz, tus reglas.**

Web app para streamers de TikTok: lee tu chat en 50+ idiomas con voces personalizadas
(navegador o IA realista vía ElevenLabs), dispara alertas de regalos/seguidores/suscripciones
con animaciones, sonidos y GIFs, y todo se controla con botones — sin tutoriales, sin instalar nada.

---

## 🚀 LOS 3 PASOS PARA ESTAR EN VIVO

1. **Abrí el Dashboard**, pegá tu `@usuario` de TikTok en la pestaña **Conectar** y tocá **INICIAR VOXZ**.
2. Tocá **📋 Copiar link de overlay** y pegalo en OBS: `+ Fuente → Navegador → pegá el link → 1280x720`.
3. Andá a la pestaña **Alertas**, elegí un evento, tocá **▶ Simular** para probarlo... ¡y salí en vivo!

Eso es todo. Todo lo demás (voces, sonidos, temas) son extras que podés tocar cuando quieras,
nunca son obligatorios para arrancar.

---

## 🖥️ Instalación (una sola vez)

Necesitás tener [Node.js](https://nodejs.org) 18 o más nuevo instalado.

```bash
npm install
npm start
```

Abrí `http://localhost:3000` — ese es tu Dashboard.

---

## 🎙️ Voz IA (ElevenLabs) — opcional, pero recomendado para que suene profesional

Por defecto VOXZ lee el chat con la **Web Speech API del navegador** (gratis, sin configuración,
pero la calidad depende de tu sistema operativo). Si querés voces realistas de verdad, podés
conectar **ElevenLabs**:

1. Creá una cuenta en [elevenlabs.io](https://elevenlabs.io) (tiene plan gratis limitado y planes pagos).
2. Andá a tu perfil → **API Keys** y copiá tu key.
3. En tu proyecto, copiá `.env.example` a un archivo nuevo llamado `.env` y pegá tu key:
   ```
   ELEVENLABS_API_KEY=tu_key_aca
   ```
   *(En Render: no uses `.env` — cargá la misma variable en Settings → Environment.)*
4. Reiniciá el servidor (`npm start`). En la pestaña **Voces** de VOXZ vas a ver la tarjeta
   **Voz IA** activa, con tus voces de ElevenLabs listas para elegir.

**Importante sobre seguridad:** tu API key vive solo en el servidor. El navegador nunca la ve;
le pide el audio a VOXZ, y VOXZ se lo pide a ElevenLabs por vos. Nunca compartas tu `.env` ni lo
subas a GitHub (ya está en `.gitignore`).

**Sobre el costo:** ElevenLabs cobra por caracteres generados. Por eso la Voz IA trae un selector
"¿Dónde se usa?" — dejalo en **"Solo en alertas"** para gastar mucho menos (regalos, subs,
seguidores) y usar la voz gratis del navegador para el resto del chat. Si preferís voz IA en
todo el chat, cambialo a "En todo el chat leído".

Si no configurás ninguna key, VOXZ sigue funcionando exactamente igual, solo que con la voz del
navegador — nunca vas a quedar sin voz.

---

## ☁️ Ponerlo en internet (para usarlo desde cualquier PC)

**Opción recomendada — un solo servicio en Render (más simple):**

1. Subí esta carpeta a un repositorio de GitHub.
2. En [Render](https://render.com) → **New → Web Service** → conectá el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. (Opcional) En **Environment**, agregá `ELEVENLABS_API_KEY` con tu key si querés Voz IA.
5. Listo: Render te da una URL tipo `https://voxz-tuusuario.onrender.com`. Ese es tu Dashboard
   y también el link que vas a pegar en OBS.

**Opción avanzada — Netlify (frontend) + Render (backend) separados:**
Si preferís separar el sitio estático del servidor de WebSocket/TikTok (por ejemplo para
usar el CDN de Netlify), subí `index.html`, `style.css`, `script.js` y `/sounds` a Netlify,
y el resto (`server.js`, `package.json`) a Render. Vas a tener que cambiar en `script.js`,
función `connectWS`, la URL del WebSocket para que apunte al dominio de Render en vez de
`location.host` (queda comentado en el código dónde hacerlo). Para empezar, la opción de
un solo servicio es más simple y 100% suficiente.

---

## 📁 Estructura de archivos

```
/index.html      → Dashboard + vista Overlay (se abre con ?view=overlay)
/style.css        → Todos los estilos: dashboard, 11 temas y animaciones
/script.js        → Toda la lógica: TTS (navegador + IA), sonidos, WebSocket, editor de alertas
/server.js        → Backend: conexión real a TikTok LIVE + WebSocket + voz IA + subida de archivos
/package.json     → Dependencias de Node
/.env.example     → Plantilla para tus variables de entorno (API keys)
/sounds/          → 50 sonidos base + manifest.json
```

---

## 🔊 Sobre los 50 sonidos incluidos

Los 50 archivos de `/sounds/` vienen como **tonos de referencia** (beeps cortos, generados
para que la app funcione de una sin tener que subir nada). Están organizados y nombrados
por categoría (`seguidores_campana.mp3`, `regalos_corona.mp3`, `meme_wasted.mp3`, etc.)
exactamente como los pide el editor de alertas.

**Para que suenen "profesionales"**, reemplazá cada archivo en `/sounds/` por el sonido real
que quieras (mismo nombre de archivo) — o simplemente subí los tuyos con el botón
**⬆ Subir sonido** de la pestaña Sonidos, sin límite de cantidad. VOXZ no necesita que
edites código para esto.

---

## 🚨 Sobre los eventos de alertas (qué es automático y qué no)

| Evento | ¿Lo dispara TikTok solo? |
|---|---|
| Seguidor, Regalo, Like, Compartir, Suscripción | ✅ Sí, en tiempo real |
| Donación | Usa el mismo sistema de monedas que Regalo (TikTok no tiene un evento de "donación" separado) |
| Meta | ✅ Se activa sola cuando la suma de monedas del live llega al objetivo que configures |
| Raid | ⚠️ TikTok LIVE no tiene "raids" como Twitch — se dispara manual con **Simular** o a mano |

Esto está aclarado también dentro del propio editor de alertas, al lado de cada evento.

---

## 🧩 Umbrales y niveles ilimitados

En Regalo, Suscripción, Donación y Like podés tocar **+ Agregar nivel** todas las veces que
quieras. Cada nivel tiene su propio umbral de monedas, texto, voz, sonido, GIF y animación.
VOXZ elige automáticamente el nivel más alto que el regalo alcance — así un regalo chico
puede sonar simple y uno gigante puede activar la alerta full pantalla.

---

## 🗺️ Roadmap

- [ ] Sección de pago/planes (Pro, suscripciones) — pendiente, se agrega más adelante.

---

Hecho con VOXZ. Sin tutoriales. Solo botones.
