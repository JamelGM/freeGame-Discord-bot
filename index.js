// Steam Free / 90%+ deals bot for Discord
// Requirements: npm install discord.js node-cron node-fetch
// Node.js 18+ recommended (node-fetch built-in)

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || "YOUR_BOT_TOKEN_HERE",
  CHANNEL_ID: process.env.CHANNEL_ID || "YOUR_CHANNEL_ID_HERE",
  MIN_DISCOUNT: 90,           // anunciar si descuento >= este valor (usa 100 para solo gratis)
  CHECK_INTERVAL: "0 */12 * * *", // cada 12 horas
  MAX_GAMES_PER_CHECK: 30,    // máximo de juegos a anunciar por ciclo
};
// ───────────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── PERSISTENCIA ──────────────────────────────────────────────────────────
const ANNOUNCED_FILE = path.join("/app/data", "announced.json");
const REANNOUNCE_DAYS = 30; // días antes de permitir re-anunciar el mismo juego

function loadAnnounced() {
  try {
    if (fs.existsSync(ANNOUNCED_FILE)) {
      return JSON.parse(fs.readFileSync(ANNOUNCED_FILE, "utf8"));
    }
  } catch (err) {
    console.error("Error cargando announced.json:", err.message);
  }
  return {};
}

function saveAnnounced(obj) {
  try {
    fs.writeFileSync(ANNOUNCED_FILE, JSON.stringify(obj), "utf8");
  } catch (err) {
    console.error("Error guardando announced.json:", err.message);
  }
}

function wasRecentlyAnnounced(appId) {
  const entry = announced[appId];
  if (!entry) return false;
  const daysSince = (Date.now() - entry) / (1000 * 60 * 60 * 24);
  return daysSince < REANNOUNCE_DAYS;
}

function markAnnounced(appId) {
  announced[appId] = Date.now();
  saveAnnounced(announced);
}

// Cargamos el historial (objeto { appId: timestamp })
const announced = loadAnnounced();
console.log(`📂 Juegos en historial: ${Object.keys(announced).length}`);

// ─── STEAM API ─────────────────────────────────────────────────────────────

/**
 * Obtiene detalles de un app de Steam
 * Retorna null si falla o no tiene precio
 */
async function getAppDetails(appId) {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data[appId]?.success) return null;
    return data[appId].data;
  } catch {
    return null;
  }
}

/**
 * Busca en la página de ofertas de Steam juegos con gran descuento
 * Usa el endpoint de búsqueda de ofertas ordenado por descuento
 */
async function fetchSteamDeals() {
  const deals = [];

  // Endpoint: ofertas de Steam (descuento máximo, juegos solamente)
  const url =
    "https://store.steampowered.com/search/results?" +
    new URLSearchParams({
      specials: 1,
      sort_by: "Price_ASC",
      maxprice: "free",   // incluye juegos con precio final = $0
      json: 1,
      count: 50,
    });

  // También buscamos por descuento alto
  const url2 =
    "https://store.steampowered.com/search/results?" +
    new URLSearchParams({
      specials: 1,
      sort_by: "Reviews_DESC",
      json: 1,
      count: 100,
    });

  const fetchJSON = async (u) => {
    try {
      const r = await fetch(u, { headers: { "Accept-Language": "en-US" } });
      return await r.json();
    } catch {
      return null;
    }
  };

  const [freeData, dealsData] = await Promise.all([
    fetchJSON(url),
    fetchJSON(url2),
  ]);

  // Juntamos los IDs únicos de ambas búsquedas
  const appIds = new Set();
  for (const d of [freeData, dealsData]) {
    if (d?.items) {
      for (const item of d.items) {
        const id = item.logo?.match(/\/(\d+)\//)?.[1] || item.id?.toString();
        if (id) appIds.add(id);
      }
    }
  }

  // Verificamos cada juego con detalles reales
  const checks = [...appIds].slice(0, 60); // limitamos peticiones
  for (const appId of checks) {
    if (announced.has(appId)) continue;

    const details = await getAppDetails(appId);
    if (!details) continue;

    // Solo juegos (no DLC, ni apps, ni música)
    if (details.type !== "game") continue;

    const priceInfo = details.price_overview;
    if (!priceInfo) continue; // juego base gratis (F2P sin precio)

    const discount = priceInfo.discount_percent ?? 0;
    if (discount < CONFIG.MIN_DISCOUNT) continue;

    const releaseDate = details.release_date;
    const endDate = priceInfo.discount_end_date
      ? new Date(priceInfo.discount_end_date * 1000).toLocaleDateString("es-CR", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      : "No especificada";

    deals.push({
      appId,
      name: details.name,
      originalPrice: (priceInfo.initial / 100).toFixed(2),   // en USD
      finalPrice: (priceInfo.final / 100).toFixed(2),
      discount,
      genres: details.genres?.map((g) => g.description).join(", ") || "N/A",
      platform: "Steam",
      thumbnail: details.header_image,
      storeUrl: `https://store.steampowered.com/app/${appId}`,
      endDate,
      releaseDate: releaseDate?.date || "N/A",
      shortDesc: details.short_description?.slice(0, 150) + "...",
    });

    // Pequeña pausa para no saturar la API de Steam
    await sleep(300);
  }

  return deals.slice(0, CONFIG.MAX_GAMES_PER_CHECK);
}

// ─── DISCORD EMBED ─────────────────────────────────────────────────────────

function buildEmbed(game) {
  const isFree = parseFloat(game.finalPrice) === 0;
  const color = isFree ? 0x57f287 : 0xffa500; // verde = gratis, naranja = oferta

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(
      isFree
        ? `🎮 ¡Juego GRATIS en Steam! → ${game.name}`
        : `🔥 ${game.discount}% de descuento → ${game.name}`
    )
    .setURL(game.storeUrl)
    .setThumbnail(game.thumbnail)
    .setDescription(game.shortDesc)
    .addFields(
      {
        name: "💰 Precio original",
        value: `$${game.originalPrice} USD`,
        inline: true,
      },
      {
        name: "🏷️ Precio actual",
        value: isFree ? "**GRATIS**" : `~~$${game.originalPrice}~~ → $${game.finalPrice} USD`,
        inline: true,
      },
      {
        name: "📉 Descuento",
        value: `**${game.discount}%**`,
        inline: true,
      },
      {
        name: "🎯 Plataforma",
        value: game.platform,
        inline: true,
      },
      {
        name: "🎭 Géneros",
        value: game.genres,
        inline: true,
      },
      {
        name: "⏰ Oferta válida hasta",
        value: game.endDate,
        inline: true,
      }
    )
    .setFooter({ text: "Steam Deals Bot • Reclamalo antes de que expire" })
    .setTimestamp();

  return embed;
}

// ─── LÓGICA PRINCIPAL ──────────────────────────────────────────────────────

async function checkAndAnnounce() {
  console.log(`[${new Date().toISOString()}] Revisando ofertas en Steam...`);

  const channel = await client.channels.fetch(CONFIG.CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error("No se encontró el canal. Verifica CHANNEL_ID.");
    return;
  }

  let deals;
  try {
    deals = await fetchSteamDeals();
  } catch (err) {
    console.error("Error al obtener ofertas de Steam:", err.message);
    return;
  }

  if (deals.length === 0) {
    console.log("Sin nuevas ofertas >= " + CONFIG.MIN_DISCOUNT + "% en este ciclo.");
    return;
  }

  for (const game of deals) {
    try {
      const embed = buildEmbed(game);
      await channel.send({ embeds: [embed] });
      announced.add(game.appId);
      saveAnnounced(announced);
      console.log(`✓ Anunciado: ${game.name} (${game.discount}% off)`);
      await sleep(1000); // pausa entre mensajes
    } catch (err) {
      console.error(`Error enviando embed para ${game.name}:`, err.message);
    }
  }
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── INICIO ────────────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`📡 Revisando cada hora (MIN_DISCOUNT = ${CONFIG.MIN_DISCOUNT}%)`);

  // Primera ejecución inmediata al arrancar
  checkAndAnnounce();

  // Luego sigue el cron (cada hora por defecto)
  cron.schedule(CONFIG.CHECK_INTERVAL, checkAndAnnounce);
});

client.login(CONFIG.DISCORD_TOKEN);
