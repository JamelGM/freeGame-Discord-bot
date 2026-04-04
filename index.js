// Free Games Bot para Discord — Steam + Epic Games
// Requirements: npm install discord.js node-cron
// Node.js 18+ recommended

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || "YOUR_BOT_TOKEN_HERE",
  CHANNEL_ID: process.env.CHANNEL_ID || "YOUR_CHANNEL_ID_HERE",
  ROLE_ID: process.env.ROLE_ID ||"YOUR_ROLE_ID_HERE",
  MIN_DISCOUNT: 90,
  CHECK_INTERVAL: "0 */24 * * *",
  MAX_GAMES_PER_CHECK: 30,
  REANNOUNCE_DAYS: 30,
};
// ───────────────────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── PERSISTENCIA ──────────────────────────────────────────────────────────
const ANNOUNCED_FILE = path.join("/app/data", "announced.json");

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
  if (!entry) {
    console.log(`🆕 [${appId}] → nunca anunciado, evaluando...`);
    return false;
  }
  const timestamp = entry.date || entry;
  const name = entry.name || "?";
  const daysSince = ((Date.now() - timestamp) / (1000 * 60 * 60 * 24)).toFixed(1);
  const date = new Date(timestamp).toLocaleDateString("es-CR", { day: "2-digit", month: "long", year: "numeric" });
  if (daysSince < CONFIG.REANNOUNCE_DAYS) {
    console.log(`⏭️  [${appId}] ${name} → anunciado hace ${daysSince} días (${date}), saltando...`);
    return true;
  }
  console.log(`♻️  [${appId}] ${name} → anunciado hace ${daysSince} días, elegible para re-anunciar`);
  return false;
}

function markAnnounced(appId, name = "") {
  announced[appId] = { date: Date.now(), name };
  saveAnnounced(announced);
}

const announced = loadAnnounced();
console.log(`📂 Juegos en historial: ${Object.keys(announced).length}`);

// ─── STEAM API ─────────────────────────────────────────────────────────────

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

async function getDiscountEndDate(appId) {
  try {
    const url = `https://store.steampowered.com/app/${appId}/`;
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en-US",
        "Cookie": "birthtime=0; lastagecheckage=1-0-1990"
      }
    });
    const html = await res.text();

    const tsMatch = html.match(/discount_end_date["']?\s*:\s*(\d+)/) ||
                    html.match(/sale_end_time["']?\s*:\s*(\d+)/) ||
                    html.match(/free_weekend_expires["']?\s*:\s*(\d+)/);
    if (tsMatch) {
      return new Date(parseInt(tsMatch[1]) * 1000).toLocaleDateString("es-CR", {
        day: "2-digit", month: "long", year: "numeric"
      });
    }

    const match = html.match(/Offer ends ([^<"]+)/i) ||
                  html.match(/sale ends ([^<"]+)/i) ||
                  html.match(/free to keep when you get it before ([^<"]+)/i);
    if (match) return match[1].replace(/@.*$/i, "").replace(/\.\s*Some limitations apply\.?/i, "").trim();

    return "No especificada";
  } catch {
    return "No especificada";
  }
}

async function getGenresFromSteam(gameName) {
  try {
    const searchUrl = `https://store.steampowered.com/search/results?` +
      new URLSearchParams({ term: gameName, json: 1, count: 1 });
    const res = await fetch(searchUrl, { headers: { "Accept-Language": "en-US" } });
    const data = await res.json();

    const item = data?.items?.[0];
    if (!item) return "N/A";

    const appId = item.logo?.match(/\/(\d+)\//)?.[1];
    if (!appId) return "N/A";

    const details = await getAppDetails(appId);
    return details?.genres?.map((g) => g.description).join(", ") || "N/A";
  } catch {
    return "N/A";
  }
}

async function fetchSteamDeals() {
  const deals = [];

  const url =
    "https://store.steampowered.com/search/results?" +
    new URLSearchParams({ specials: 1, sort_by: "Price_ASC", maxprice: "free", json: 1, count: 50 });

  const url2 =
    "https://store.steampowered.com/search/results?" +
    new URLSearchParams({ specials: 1, sort_by: "Reviews_DESC", json: 1, count: 100 });

  const fetchJSON = async (u) => {
    try {
      const r = await fetch(u, { headers: { "Accept-Language": "en-US" } });
      return await r.json();
    } catch {
      return null;
    }
  };

  const [freeData, dealsData] = await Promise.all([fetchJSON(url), fetchJSON(url2)]);

  const appIds = new Set();
  for (const d of [freeData, dealsData]) {
    if (d?.items) {
      for (const item of d.items) {
        const id = item.logo?.match(/\/(\d+)\//)?.[1] || item.id?.toString();
        if (id) appIds.add(id);
      }
    }
  }

  const checks = [...appIds].slice(0, 60);
  for (const appId of checks) {
    if (wasRecentlyAnnounced(appId)) continue;

    const details = await getAppDetails(appId);
    if (!details) continue;
    if (details.type !== "game") continue;

    const priceInfo = details.price_overview;
    if (!priceInfo) continue;

    const discount = priceInfo.discount_percent ?? 0;
    if (discount < CONFIG.MIN_DISCOUNT) continue;

    const endDate = priceInfo.discount_end_date
      ? new Date(priceInfo.discount_end_date * 1000).toLocaleDateString("es-CR", {
          day: "2-digit", month: "long", year: "numeric",
        })
      : await getDiscountEndDate(appId);

    deals.push({
      appId,
      name: details.name,
      originalPrice: (priceInfo.initial / 100).toFixed(2),
      finalPrice: (priceInfo.final / 100).toFixed(2),
      discount,
      genres: details.genres?.map((g) => g.description).join(", ") || "N/A",
      platform: "Steam",
      thumbnail: details.header_image,
      storeUrl: `https://store.steampowered.com/app/${appId}`,
      endDate,
      shortDesc: details.short_description?.slice(0, 150) + "...",
    });

    await sleep(300);
  }

  return deals.slice(0, CONFIG.MAX_GAMES_PER_CHECK);
}

// ─── EPIC GAMES API ────────────────────────────────────────────────────────

async function fetchEpicDeals() {
  const deals = [];

  try {
    const url = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US";
    const res = await fetch(url, { headers: { "Accept-Language": "en-US" } });
    const data = await res.json();

    const elements = data?.data?.Catalog?.searchStore?.elements || [];

    for (const game of elements) {

        console.log(`🆕 [epic_${game.id}] → evaluando ${game.title}...`);
        console.log(`🔗 Epic [${game.title}] productSlug:`, game.productSlug, `urlSlug:`, game.urlSlug, `mappings:`, JSON.stringify(game.catalogNs?.mappings));

      const promotions = game.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
      const upcomingPromos = game.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers || [];

      // Solo juegos con oferta activa ahora
      const activePromo = promotions[0];
      if (!activePromo) continue;

      const discount = activePromo.discountSetting?.discountPercentage ?? 0;
      // Epic usa 0 para indicar 100% de descuento (gratis)
      const isFree = discount === 0;
      if (!isFree && discount < CONFIG.MIN_DISCOUNT) continue;

      const appId = `epic_${game.id}`;
      if (wasRecentlyAnnounced(appId)) continue;

      const originalPrice = (game.price?.totalPrice?.originalPrice ?? 0) / 100;
      const finalPrice = (game.price?.totalPrice?.discountPrice ?? 0) / 100;
      const discountPercent = originalPrice > 0
        ? Math.round(((originalPrice - finalPrice) / originalPrice) * 100)
        : 100;

      const endDate = activePromo.endDate
        ? new Date(activePromo.endDate).toLocaleDateString("es-CR", {
            day: "2-digit", month: "long", year: "numeric"
          })
        : "No especificada";

      const thumbnail =
        game.keyImages?.find((i) => i.type === "OfferImageWide")?.url ||
        game.keyImages?.find((i) => i.type === "Thumbnail")?.url ||
        game.keyImages?.[0]?.url || "";

      const genres = await getGenresFromSteam(game.title);

      const storeUrl = game.catalogNs?.mappings?.[0]?.pageSlug
        ? `https://store.epicgames.com/p/${game.catalogNs.mappings[0].pageSlug}`
        : game.productSlug
        ? `https://store.epicgames.com/p/${game.productSlug}`
        : "https://store.epicgames.com/free-games";


      deals.push({
        appId,
        name: game.title,
        originalPrice: originalPrice.toFixed(2),
        finalPrice: finalPrice.toFixed(2),
        discount: discountPercent,
        genres,
        platform: "Epic Games",
        thumbnail,
        storeUrl,
        endDate,
        shortDesc: (game.description || game.title).slice(0, 150) + "...",
      });
    }
  } catch (err) {
    console.error("Error obteniendo ofertas de Epic:", err.message);
  }

  return deals;
}

// ─── DISCORD EMBED ─────────────────────────────────────────────────────────

function buildEmbed(game) {
  const isFree = parseFloat(game.finalPrice) === 0 || game.discount === 100;
  const isEpic = game.platform === "Epic Games";

  // Verde = gratis, Naranja = descuento, Morado = Epic
  const color = isFree
    ? (isEpic ? 0x2f2f2f : 0x57f287)
    : 0xffa500;

  const platformIcon = isEpic ? "🟣" : "🎮";
  const storeLabel = isEpic ? "Epic Games Store" : "Steam Deals Bot";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(
      isFree
        ? `${platformIcon} ¡Juego GRATIS en ${game.platform}! → ${game.name}`
        : `🔥 ${game.discount}% de descuento → ${game.name}`
    )
    .setURL(game.storeUrl)
    .setThumbnail(game.thumbnail)
    .setDescription(game.shortDesc)
    .addFields(
      { name: "💰 Precio original", value: originalPrice(game), inline: true },
      {
        name: "🏷️ Precio actual",
        value: isFree ? "**GRATIS**" : `~~$${game.originalPrice}~~ → $${game.finalPrice} USD`,
        inline: true,
      },
      { name: "📉 Descuento", value: `**${game.discount}%**`, inline: true },
      { name: "🎯 Plataforma", value: game.platform, inline: true },
      { name: "🎭 Géneros", value: game.genres, inline: true },
      { name: "⏰ Oferta válida hasta", value: game.endDate, inline: true }
    )
    .setFooter({ text: `${storeLabel} • Reclamalo antes de que expire` })
    .setTimestamp();
}

function originalPrice(game) {
  if (parseFloat(game.originalPrice) === 0) return "F2P";
  return `$${game.originalPrice} USD`;
}

// ─── LÓGICA PRINCIPAL ──────────────────────────────────────────────────────

async function checkAndAnnounce() {
  console.log(`[${new Date().toISOString()}] Revisando ofertas en Steam y Epic...`);

  const channel = await client.channels.fetch(CONFIG.CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error("No se encontró el canal. Verifica CHANNEL_ID.");
    return;
  }

  let steamDeals = [];
  let epicDeals = [];

  try {
    steamDeals = await fetchSteamDeals();
  } catch (err) {
    console.error("Error Steam:", err.message);
  }

  try {
    epicDeals = await fetchEpicDeals();
  } catch (err) {
    console.error("Error Epic:", err.message);
  }

  const allDeals = [...steamDeals, ...epicDeals];

  if (allDeals.length === 0) {
    console.log(`Sin nuevas ofertas en este ciclo.`);
    return;
  }

  // Mencionar el rol una sola vez antes de los embeds
  await channel.send(`<@&${CONFIG.ROLE_ID}> 🎮 ¡Nuevas ofertas detectadas!`);
  await sleep(500);

  for (const game of allDeals) {
    try {
      const embed = buildEmbed(game);
      await channel.send({ embeds: [embed] });
      markAnnounced(game.appId, game.name);
      console.log(`✓ Anunciado [${game.platform}]: ${game.name} (${game.discount}% off)`);
      await sleep(1000);
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

client.once("clientReady", () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  console.log(`📡 Revisando cada 24 horas (MIN_DISCOUNT = ${CONFIG.MIN_DISCOUNT}%)`);
  checkAndAnnounce();
  cron.schedule(CONFIG.CHECK_INTERVAL, checkAndAnnounce);
});

client.login(CONFIG.DISCORD_TOKEN);