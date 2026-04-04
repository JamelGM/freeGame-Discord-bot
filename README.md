# 🎮 Steam Deals Bot para Discord

Anuncia automáticamente en Discord cuando Steam tiene juegos gratis (100% de rebaja) o con 90%+ de descuento.

---

## ✅ Requisitos

- Node.js 18 o superior
- Una cuenta de Discord con permisos para crear bots

---

## 🔧 Configuración paso a paso

### 1. Crear el bot en Discord

1. Ve a https://discord.com/developers/applications
2. Clic en **New Application** → ponle un nombre
3. Menú izquierdo → **Bot** → clic en **Add Bot**
4. En **Token** → clic en **Reset Token** → copia el token
5. En **Privileged Gateway Intents** activa **Server Members Intent** (por si acaso)
6. Menú izquierdo → **OAuth2 → URL Generator**
   - Scopes: `bot`
   - Bot permissions: `Send Messages`, `Embed Links`, `View Channels`
7. Copia la URL generada, pégala en el navegador e invita el bot a tu servidor

### 2. Obtener el ID del canal

1. En Discord, activa **Modo desarrollador** (Configuración → Avanzado → Modo desarrollador)
2. Clic derecho en el canal donde quieres los anuncios → **Copiar ID**

### 3. Configurar el archivo

Abre `index.js` y edita el bloque CONFIG:

```js
const CONFIG = {
  DISCORD_TOKEN: "TU_TOKEN_AQUI",
  CHANNEL_ID: "ID_DEL_CANAL_AQUI",
  MIN_DISCOUNT: 90,      // cambia a 100 si solo quieres juegos 100% gratis
  CHECK_INTERVAL: "0 */1 * * *", // cada hora
};
```

### 4. Instalar dependencias y correr

```bash
npm install
npm start
```

---

## 📋 Qué anuncia el bot

Cada mensaje en Discord incluye:
- 🎮 Nombre del juego
- 💰 Precio original en USD
- 🏷️ Precio actual (o "GRATIS")
- 📉 Porcentaje de descuento
- 🎯 Plataforma (Steam)
- 🎭 Géneros del juego
- ⏰ Fecha límite para reclamar la oferta
- 🔗 Link directo a la tienda

---

## 🚀 Mantenerlo activo 24/7

Para que corra constantemente podés usar:

(recomendado, recuerda la DB(volume))
- **Railway.app** (gratis, fácil) — sube los archivos y conecta con GitHub
- **Render.com** — similar, gratis con limitaciones
- **Un VPS** (DigitalOcean, Linode) — más control
- **Tu propia PC/servidor** con `pm2`:
  ```bash
  npm install -g pm2
  pm2 start index.js --name steam-bot
  pm2 save
  ```

---

## ⚙️ Ajustes opcionales

| Variable | Default | Descripción |
|---|---|---|
| `MIN_DISCOUNT` | `90` | Descuento mínimo para anunciar (pon `100` para solo gratis) |
| `CHECK_INTERVAL` | `0 */1 * * *` | Cada cuánto revisa (formato cron) |
| `MAX_GAMES_PER_CHECK` | `10` | Máximo de juegos por ciclo |

---

## ⚠️ Notas

- La API pública de Steam no requiere API key
- Steam a veces limita requests, el bot incluye pausas para evitar bloqueos
- Los juegos ya anunciados se guardan en memoria (se reinician al reiniciar el bot)
- Para persistencia entre reinicios, podrías guardar `announced` en un archivo JSON
