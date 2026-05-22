const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error("Dependencia ausente: rode npm i antes de executar.");
  process.exit(1);
}

const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || "outputs");
const PROFILE_DIR = path.resolve(
  process.cwd(),
  process.env.TIKTOK_PROFILE_DIR || ".playwright-tiktok-profile",
);
const DEFAULT_SEARCH_TERMS = [
  "achadinhos amazon casa",
  "achadinhos tiktok casa",
  "utilidades domesticas viral",
  "organizador cozinha viral",
  "organizador geladeira viral",
  "produto viral tiktok brasil",
  "testei produto viral",
  "comprinhas amazon brasil",
  "achadinhos beleza",
  "skincare achadinhos brasil",
  "maquiagem achadinhos",
  "antes e depois organizacao casa",
  "utilidades para banheiro",
  "cozinha organizada tiktok",
  "casa organizada achadinhos",
];
const DEFAULT_MAX_AGE_DAYS = parsePositiveInt(process.env.TIKTOK_MAX_AGE_DAYS, 120);
const DEFAULT_MIN_VIDEOS_PER_PRODUCT = parsePositiveInt(process.env.TIKTOK_MIN_VIDEOS_PER_PRODUCT, 2);

const PRODUCT_HINTS = [
  "acessorio",
  "adesivo",
  "air fryer",
  "almofada",
  "aspirador",
  "banheiro",
  "bolsa",
  "cabo",
  "caixa",
  "capa",
  "carregador",
  "cesto",
  "cortador",
  "cortina",
  "cozinha",
  "descascador",
  "dispensador",
  "escova",
  "espelho",
  "esfregao",
  "fatiador",
  "garrafa",
  "geladeira",
  "graos",
  "impressora",
  "kit",
  "lampada",
  "led",
  "limpador",
  "lixeira",
  "luminaria",
  "manta",
  "maquiagem",
  "mop",
  "necessaire",
  "organizador",
  "pano",
  "porta",
  "pote",
  "prateleira",
  "ralador",
  "rodo",
  "secadora",
  "serum",
  "skincare",
  "suporte",
  "tapete",
  "termica",
  "toalha",
  "utensilio",
];

const NOISE_WORDS = new Set([
  "achadinho",
  "achadinhos",
  "amazon",
  "barato",
  "brasil",
  "compra",
  "comprar",
  "comprinhas",
  "dica",
  "favorito",
  "fyp",
  "link",
  "lojinha",
  "melhor",
  "parte",
  "mais",
  "curtidos",
  "produto",
  "produtos",
  "promo",
  "promocao",
  "shopee",
  "shop",
  "tiktokshop",
  "maio",
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
  "tem",
  "sua",
  "seus",
  "suas",
  "tiktok",
  "viral",
  "virais",
  "2025",
  "2026",
]);

function parseArgs(argv) {
  const options = {
    queries: [],
    output: "",
    limit: parsePositiveInt(process.env.TIKTOK_LIMIT_PER_QUERY, 20),
    scrolls: parsePositiveInt(process.env.TIKTOK_SCROLLS_PER_QUERY, 4),
    delayMs: parsePositiveInt(process.env.TIKTOK_DELAY_MS, 2500),
    details: parseBoolean(process.env.TIKTOK_FETCH_VIDEO_DETAILS, true),
    maxAgeDays: DEFAULT_MAX_AGE_DAYS,
    minVideosPerProduct: DEFAULT_MIN_VIDEOS_PER_PRODUCT,
    headless: parseBoolean(process.env.TIKTOK_HEADLESS || process.env.HEADLESS_MODE, false),
    keepOpen: parseBoolean(process.env.TIKTOK_KEEP_OPEN, false),
    help: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--visible") {
      options.headless = false;
    } else if (arg === "--keep-open") {
      options.keepOpen = true;
    } else if (arg === "--no-details") {
      options.details = false;
    } else if (arg === "--all-dates") {
      options.maxAgeDays = 0;
    } else if (arg.startsWith("--query=")) {
      options.queries.push(...splitList(arg.slice("--query=".length)));
    } else if (arg.startsWith("--queries=")) {
      options.queries.push(...splitList(arg.slice("--queries=".length)));
    } else if (arg.startsWith("--input=")) {
      options.queries.push(...readQueriesFromFile(arg.slice("--input=".length)));
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length).trim();
    } else if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInt(arg.slice("--limit=".length), options.limit);
    } else if (arg.startsWith("--scrolls=")) {
      options.scrolls = parsePositiveInt(arg.slice("--scrolls=".length), options.scrolls);
    } else if (arg.startsWith("--delay-ms=")) {
      options.delayMs = parsePositiveInt(arg.slice("--delay-ms=".length), options.delayMs);
    } else if (arg.startsWith("--max-age-days=")) {
      options.maxAgeDays = parsePositiveInt(arg.slice("--max-age-days=".length), options.maxAgeDays);
    } else if (arg.startsWith("--min-videos=")) {
      options.minVideosPerProduct = parsePositiveInt(
        arg.slice("--min-videos=".length),
        options.minVideosPerProduct,
      );
    }
  }

  if (!options.queries.length) {
    options.queries = DEFAULT_SEARCH_TERMS;
  }

  options.queries = unique(options.queries.map(cleanText).filter(Boolean));

  if (!options.output) {
    options.output = path.join(OUTPUT_DIR, `tiktok_product_trends_${timestamp()}.csv`);
  } else {
    options.output = path.resolve(process.cwd(), options.output);
  }

  return options;
}

function printHelp() {
  console.log(`Uso:
  node scripts\\search-tiktok-products.js
  node scripts\\search-tiktok-products.js --query="achadinhos amazon casa|organizador cozinha viral" --limit=15
  node scripts\\search-tiktok-products.js --query="mop limpeza|escova limpeza eletrica" --max-age-days=60 --min-videos=3
  node scripts\\search-tiktok-products.js --input=keywords_tiktok.txt --output=outputs\\tiktok_trends.csv

O script abre o TikTok, pesquisa termos de produto, coleta videos publicos e gera CSV com:
  produto_candidato, termo_busca, score, link_video, criador, data, legenda, hashtags, metricas

Tambem gera *_produtos.csv, ranqueando por quantidade de videos recentes por produto.`);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: options.headless,
    viewport: { width: 1366, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Manaus",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-position=80,80",
      "--window-size=1366,900",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  const allRows = [];

  try {
    for (const query of options.queries) {
      console.log(`[TikTok] Buscando: ${query}`);
      const rows = await searchTikTok(page, query, options);
      console.log(`[TikTok] ${query}: ${rows.length} video(s) coletado(s)`);
      allRows.push(...rows);
      await wait(options.delayMs);
    }

    const allRanked = rankAndDedupeRows(allRows);
    const recentRanked = filterRecentRows(allRanked, options.maxAgeDays);
    const productRanked = rankProductsByFrequency(recentRanked, options.minVideosPerProduct);

    writeCsv(options.output, recentRanked);
    writeCsv(detailsOutputPath(options.output), allRanked);
    writeProductCsv(productsOutputPath(options.output), productRanked);
    writeSummary(options.output, recentRanked, productRanked, options);
    console.log(`[TikTok] Planilha salva em ${options.output}`);
    console.log(`[TikTok] Ranking por produto salvo em ${productsOutputPath(options.output)}`);
    console.log(`[TikTok] Videos brutos salvos em ${detailsOutputPath(options.output)}`);

    const top = productRanked.slice(0, 12);
    if (top.length) {
      console.log("[TikTok] Top produtos por frequencia recente:");
      top.forEach((row, index) => {
        console.log(
          `${index + 1}. ${row.produto_candidato} | videos=${row.videos_recentes} | criadores=${row.criadores_unicos} | score=${row.score_frequencia} | ${row.video_exemplo}`,
        );
      });
    } else {
      console.log(
        `[TikTok] Nenhum produto passou no corte de frequencia recente (${options.maxAgeDays || "sem limite"} dias, min ${options.minVideosPerProduct} videos). Veja os videos brutos para ajustar termos.`,
      );
    }
  } finally {
    if (options.keepOpen) {
      console.log("[TikTok] Navegador mantido aberto por --keep-open.");
    } else {
      await context.close();
    }
  }
}

async function searchTikTok(page, query, options) {
  const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await wait(options.delayMs);

  for (let index = 0; index < options.scrolls; index += 1) {
    await page.mouse.wheel(0, 1800);
    await wait(options.delayMs);
  }

  const checkpoint = await detectCheckpoint(page);
  if (checkpoint) {
    await saveDebugPage(page, `tiktok_checkpoint_${slugify(query)}`);
    console.log(`[TikTok] Bloqueio detectado em "${query}": ${checkpoint}`);
    return [];
  }

  const videos = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
    return anchors
      .map((anchor) => {
        const card =
          anchor.closest('[data-e2e*="search"], [data-e2e*="video"], div[class*="DivItemContainer"], div') ||
          anchor.parentElement;
        const rawText = (card?.innerText || anchor.innerText || "").trim();
        const href = anchor.href;
        const creatorMatch = href.match(/tiktok\.com\/@([^/]+)/i);
        const hashtags = Array.from((card || document).querySelectorAll('a[href*="/tag/"]'))
          .map((tag) => (tag.textContent || "").trim())
          .filter(Boolean);

        return {
          href,
          creator: creatorMatch ? `@${decodeURIComponent(creatorMatch[1])}` : "",
          rawText,
          hashtags,
        };
      })
      .filter((item) => item.href && item.rawText)
      .slice(0, 80);
  });

  const uniqueVideos = uniqueBy(videos, (video) => video.href).slice(0, options.limit);
  const rows = [];

  for (const video of uniqueVideos) {
    const details = options.details ? await fetchVideoDetails(page.context(), video.href, options.delayMs) : {};
    rows.push(buildTrendRow(query, { ...video, details }));
  }

  return rows;
}

async function fetchVideoDetails(context, href, delayMs) {
  const oembed = await fetchOembedDetails(context, href);
  const page = await context.newPage();
  try {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45000 });
    await wait(Math.min(Math.max(delayMs, 1000), 3000));

    const checkpoint = await detectCheckpoint(page);
    if (checkpoint) {
      return { blocked: checkpoint };
    }

    const browserData = await page.evaluate(() => {
      const meta = (selector) => document.querySelector(selector)?.getAttribute("content") || "";
      const scripts = Array.from(document.scripts)
        .map((script) => script.textContent || "")
        .filter((text) => text.includes('"desc"') || text.includes("diggCount") || text.includes("playCount"))
        .slice(0, 4)
        .join("\n");

      return {
        title: document.title || "",
        metaDescription: meta('meta[name="description"]'),
        ogTitle: meta('meta[property="og:title"]'),
        ogDescription: meta('meta[property="og:description"]'),
        bodyText: (document.body?.innerText || "").slice(0, 3000),
        scripts,
      };
    });

    const scriptText = browserData.scripts || "";
    const description =
      decodeJsonString(extractJsonString(scriptText, "desc")) ||
      browserData.ogDescription ||
      browserData.metaDescription ||
      browserData.ogTitle ||
      browserData.title ||
      "";

    return {
      description: cleanText(oembed.description || description),
      title: cleanText(oembed.title || browserData.ogTitle || browserData.title || ""),
      creator:
        normalizeCreator(oembed.creator) ||
        decodeJsonString(extractJsonString(scriptText, "uniqueId")) ||
        decodeJsonString(extractJsonString(scriptText, "nickname")) ||
        "",
      metrics: {
        views: extractJsonNumber(scriptText, "playCount"),
        likes: extractJsonNumber(scriptText, "diggCount"),
        comments: extractJsonNumber(scriptText, "commentCount"),
        shares: extractJsonNumber(scriptText, "shareCount"),
      },
      bodyText: cleanText(browserData.bodyText || ""),
    };
  } catch (error) {
    return { ...oembed, error: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchOembedDetails(context, href) {
  try {
    const url = `https://www.tiktok.com/oembed?url=${encodeURIComponent(href)}`;
    const headers = {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      accept: "application/json,text/plain,*/*",
    };

    if (context?.request) {
      const response = await context.request.get(url, { headers });
      if (!response.ok()) return {};
      const data = await response.json();
      return normalizeOembed(data);
    }

    if (typeof fetch !== "function") return {};
    const response = await fetch(url, {
      headers: {
        ...headers,
      },
    });

    if (!response.ok) return {};
    const data = await response.json();
    return normalizeOembed(data);
  } catch (error) {
    return {};
  }
}

function normalizeOembed(data) {
  return {
    description: cleanText(data?.title || ""),
    title: cleanText(data?.title || ""),
    creator: normalizeCreator(data?.author_unique_id || data?.author_name || ""),
  };
}

async function detectCheckpoint(page) {
  const body = normalizeText(await page.locator("body").innerText({ timeout: 5000 }).catch(() => ""));
  if (/captcha|verifique|verificacao|verification|login|entrar/.test(body) && !/video/.test(body)) {
    return body.slice(0, 180);
  }
  return "";
}

async function saveDebugPage(page, prefix) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const base = path.join(OUTPUT_DIR, `${prefix}_${timestamp()}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => "");
  if (html) fs.writeFileSync(`${base}.html`, html, "utf8");
}

function buildTrendRow(query, video) {
  const detailText = [video.details?.description, video.details?.title, video.details?.bodyText]
    .filter(Boolean)
    .join("\n");
  const sourceText = detailText || video.rawText;
  const caption = extractCaption(sourceText);
  const hashtags = normalizeHashtags([...video.hashtags, ...extractHashtags(sourceText)]);
  const productCandidate = extractProductCandidate([caption, hashtags.join(" "), query].join(" "));
  const metrics = {
    ...extractMetrics(sourceText),
    ...compactMetrics(video.details?.metrics || {}),
  };
  const videoId = extractTikTokVideoId(video.href);
  const publishedAt = decodeTikTokVideoDate(videoId);
  const daysOld = calculateDaysOld(publishedAt);
  const score = calculateScore({ query, caption, hashtags, productCandidate, metrics });

  return {
    produto_candidato: productCandidate || query,
    termo_busca: query,
    score,
    link_video: video.href,
    video_id: videoId,
    publicado_em: publishedAt ? publishedAt.toISOString().slice(0, 10) : "",
    dias_desde_publicacao: Number.isFinite(daysOld) ? daysOld : "",
    criador: video.creator || normalizeCreator(video.details?.creator),
    legenda: caption,
    hashtags: hashtags.join(" "),
    views: metrics.views || "",
    likes: metrics.likes || "",
    comentarios: metrics.comments || "",
    compartilhamentos: metrics.shares || "",
    coletado_em: new Date().toISOString(),
  };
}

function extractTikTokVideoId(href) {
  const match = String(href || "").match(/\/video\/(\d+)/i);
  return match ? match[1] : "";
}

function decodeTikTokVideoDate(videoId) {
  if (!/^\d{16,20}$/.test(String(videoId || ""))) return null;
  try {
    const timestampSeconds = Number(BigInt(videoId) >> 32n);
    if (!Number.isFinite(timestampSeconds) || timestampSeconds < 1500000000) return null;
    return new Date(timestampSeconds * 1000);
  } catch (error) {
    return null;
  }
}

function calculateDaysOld(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return Number.NaN;
  const diffMs = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

function compactMetrics(metrics) {
  const result = {};
  for (const [key, value] of Object.entries(metrics || {})) {
    if (Number.isFinite(value) && value > 0) result[key] = value;
  }
  return result;
}

function normalizeCreator(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return clean.startsWith("@") ? clean : `@${clean}`;
}

function extractCaption(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(curtir|comentar|compartilhar|seguir|sponsored|patrocinado)$/i.test(line));

  const useful = lines.find((line) => line.length >= 20 && /#|produto|achad|viral|casa|cozinha|beleza|organizador/i.test(line));
  return cleanText(useful || lines[0] || rawText).slice(0, 500);
}

function extractHashtags(text) {
  return Array.from(String(text || "").matchAll(/#[\p{L}\p{N}_]+/gu)).map((match) => match[0]);
}

function normalizeHashtags(values) {
  return unique(
    values
      .flatMap((value) => String(value || "").split(/\s+/))
      .map((tag) => tag.trim())
      .filter((tag) => tag.startsWith("#"))
      .map((tag) => normalizeText(tag).replace(/[^\w#]+/g, "")),
  );
}

function extractProductCandidate(text) {
  const normalized = normalizeText(text).replace(/[#@]/g, " ");
  const words = normalized
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !NOISE_WORDS.has(word));

  const windows = [];
  for (let size = 4; size >= 2; size -= 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      const phrase = words.slice(index, index + size).join(" ");
      if (PRODUCT_HINTS.some((hint) => phrase.includes(hint))) {
        windows.push(phrase);
      }
    }
  }

  const candidate = windows
    .sort((a, b) => scorePhrase(b) - scorePhrase(a) || a.length - b.length)[0];

  return candidate || words.slice(0, 4).join(" ");
}

function scorePhrase(phrase) {
  let score = 0;
  for (const hint of PRODUCT_HINTS) {
    if (phrase.includes(hint)) score += 5;
  }
  if (/fatiador|ralador|cortador|descascador|dispensador|mop|organizador|suporte|pote|escova|manta|capa|kit|porta|limpador|secadora|pano|carregador/.test(phrase)) score += 18;
  if (/cozinha|casa|beleza|banheiro|geladeira/.test(phrase) && !hasProductSignal(phrase)) {
    score -= 4;
  }
  return score;
}

function extractMetrics(rawText) {
  const text = normalizeText(rawText);
  const metrics = {};
  const patterns = [
    ["likes", /([\d,.]+)\s*([km]?)\s*(curtidas|likes?)/i],
    ["comments", /([\d,.]+)\s*([km]?)\s*(comentarios|comments?)/i],
    ["shares", /([\d,.]+)\s*([km]?)\s*(compartilhamentos|shares?)/i],
    ["views", /([\d,.]+)\s*([km]?)\s*(visualizacoes|views?)/i],
  ];

  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) metrics[key] = parseMetric(match[1], match[2]);
  }

  if (!metrics.likes) {
    const compactNumbers = Array.from(text.matchAll(/\b(\d+(?:[,.]\d+)?)\s*([km])\b/g)).map((match) =>
      parseMetric(match[1], match[2]),
    );
    if (compactNumbers.length) metrics.likes = Math.max(...compactNumbers);
  }

  return metrics;
}

function extractJsonString(text, key) {
  const re = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = String(text || "").match(re);
  return match ? match[1] : "";
}

function extractJsonNumber(text, key) {
  const re = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"?([0-9]+)"?`, "i");
  const match = String(text || "").match(re);
  if (!match) return "";
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : "";
}

function decodeJsonString(value) {
  if (!value) return "";
  try {
    return JSON.parse(`"${value}"`);
  } catch (error) {
    return String(value).replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function calculateScore({ query, caption, hashtags, productCandidate, metrics }) {
  let score = 0;
  const text = normalizeText([query, caption, hashtags.join(" "), productCandidate].join(" "));

  if (productCandidate) score += 20;
  if (/achad|viral|testei|vale a pena|antes depois|organiz/.test(text)) score += 20;
  if (/casa|cozinha|banheiro|beleza|skincare|maquiagem|limpeza/.test(text)) score += 15;
  if (hashtags.some((tag) => /achad|tiktokshop|amazon|casa|beleza|viral/.test(tag))) score += 15;
  if (Number.isFinite(metrics.likes)) score += Math.min(30, Math.round(Math.log10(metrics.likes + 1) * 8));
  if (Number.isFinite(metrics.views)) score += Math.min(30, Math.round(Math.log10(metrics.views + 1) * 8));

  return score;
}

function rankAndDedupeRows(rows) {
  return uniqueBy(rows, (row) => `${row.produto_candidato}|${row.link_video}`)
    .sort((a, b) => b.score - a.score)
    .map((row, index) => ({ ranking: index + 1, ...row }));
}

function filterRecentRows(rows, maxAgeDays) {
  if (!maxAgeDays) return rows;
  return rows.filter((row) => {
    const days = Number(row.dias_desde_publicacao);
    return Number.isFinite(days) && days <= maxAgeDays;
  });
}

function rankProductsByFrequency(rows, minVideosPerProduct) {
  const groups = new Map();

  for (const row of rows) {
    const key = normalizeProductKey(row.produto_candidato);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        produto_candidato: canonicalProductName(row.produto_candidato),
        videos: [],
        creators: new Set(),
        queries: new Set(),
        totalViews: 0,
        totalLikes: 0,
        totalShares: 0,
        newestDaysOld: Number.POSITIVE_INFINITY,
        example: row,
      });
    }

    const group = groups.get(key);
    group.videos.push(row);
    if (row.criador) group.creators.add(row.criador);
    if (row.termo_busca) group.queries.add(row.termo_busca);
    group.totalViews += Number(row.views) || 0;
    group.totalLikes += Number(row.likes) || 0;
    group.totalShares += Number(row.compartilhamentos) || 0;

    const days = Number(row.dias_desde_publicacao);
    if (Number.isFinite(days) && days < group.newestDaysOld) {
      group.newestDaysOld = days;
    }

    if ((Number(row.score) || 0) > (Number(group.example.score) || 0)) {
      group.example = row;
    }
  }

  return Array.from(groups.values())
    .filter((group) => group.videos.length >= minVideosPerProduct)
    .map((group) => {
      const score =
        group.videos.length * 35 +
        group.creators.size * 20 +
        Math.min(60, Math.round(Math.log10(group.totalViews + 1) * 10)) +
        Math.min(50, Math.round(Math.log10(group.totalLikes + 1) * 10)) +
        Math.min(30, Math.round(Math.log10(group.totalShares + 1) * 8));

      return {
        produto_candidato: group.produto_candidato,
        videos_recentes: group.videos.length,
        criadores_unicos: group.creators.size,
        termos_busca: Array.from(group.queries).join(" | "),
        score_frequencia: score,
        views_total: group.totalViews || "",
        likes_total: group.totalLikes || "",
        compartilhamentos_total: group.totalShares || "",
        video_mais_recente_dias: Number.isFinite(group.newestDaysOld) ? group.newestDaysOld : "",
        video_exemplo: group.example.link_video,
        legenda_exemplo: group.example.legenda,
      };
    })
    .sort(
      (a, b) =>
        b.score_frequencia - a.score_frequencia ||
        b.videos_recentes - a.videos_recentes ||
        b.criadores_unicos - a.criadores_unicos,
    )
    .map((row, index) => ({ ranking: index + 1, ...row }));
}

function normalizeProductKey(value) {
  const words = normalizeText(value)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !NOISE_WORDS.has(word));

  if (!words.length) return "";

  const compact = words.join(" ");
  if (!hasProductSignal(compact)) return "";

  if (/escova/.test(compact) && /limpeza|eletrica/.test(compact)) return "escova limpeza eletrica";
  if (/fatiador|ralador|cortador/.test(compact) && /cozinha|legume|vegetal|fruta/.test(compact)) {
    return "fatiador cozinha";
  }
  if (/dispensador/.test(compact) && /grao|cereal|arroz|cozinha|casa/.test(compact)) return "dispensador graos";
  if (/descascador|utensilio/.test(compact) && /ovo|cozinha/.test(compact)) return "descascador ovo";
  if (/impressora|impressoratermica|termica/.test(compact)) return "mini impressora termica";
  if (/aquecedor/.test(compact) && /torneira|eletrico|pia/.test(compact)) return "aquecedor torneira";
  if (/secadora/.test(compact) && /portatil|roupa/.test(compact)) return "secadora portatil roupa";
  if (/limpador/.test(compact) && /vidro|giratorio/.test(compact)) return "limpador vidro";
  if (/limpador/.test(compact)) return "limpador vidro";
  if (/pano/.test(compact) && /multiuso|rolo|limpeza/.test(compact)) return "pano multiuso descartavel";
  if (/pano/.test(compact)) return "pano multiuso descartavel";
  if (/carregador/.test(compact) && /wireless|sem fio|suporte/.test(compact)) return "carregador wireless suporte";
  if (/mop/.test(compact)) return "mop limpeza";
  if (/organizador|kit/.test(compact) && /geladeira/.test(compact)) return "organizador geladeira";
  if (/suporte|prateleira|porta/.test(compact) && /banheiro|shampoo/.test(compact)) {
    return "suporte banheiro adesivo";
  }

  return words.slice(0, 3).join(" ");
}

function hasProductSignal(value) {
  const compact = normalizeText(value);
  return PRODUCT_HINTS.some((hint) => compact.includes(hint)) || /impressora|impressoratermica|termica|aquecedor|botafeminina|botas|chinelo|vestido/.test(compact);
}

function canonicalProductName(value) {
  const key = normalizeProductKey(value);
  return key || cleanText(value);
}

function writeCsv(filePath, rows) {
  const columns = [
    "ranking",
    "produto_candidato",
    "termo_busca",
    "score",
    "link_video",
    "video_id",
    "publicado_em",
    "dias_desde_publicacao",
    "criador",
    "legenda",
    "hashtags",
    "views",
    "likes",
    "comentarios",
    "compartilhamentos",
    "coletado_em",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `\ufeff${lines.join("\n")}\n`, "utf8");
}

function writeProductCsv(filePath, rows) {
  const columns = [
    "ranking",
    "produto_candidato",
    "videos_recentes",
    "criadores_unicos",
    "score_frequencia",
    "views_total",
    "likes_total",
    "compartilhamentos_total",
    "video_mais_recente_dias",
    "termos_busca",
    "video_exemplo",
    "legenda_exemplo",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `\ufeff${lines.join("\n")}\n`, "utf8");
}

function writeSummary(csvPath, rows, productRows, options) {
  const summaryPath = csvPath.replace(/\.csv$/i, "_resumo.txt");
  const lines = [
    `Corte: ${options.maxAgeDays || "todos"} dias | minimo por produto: ${options.minVideosPerProduct} videos`,
    "",
    "Produtos por frequencia recente:",
    ...productRows.slice(0, 25).map((row) => {
      return `${row.ranking}. ${row.produto_candidato} | videos=${row.videos_recentes} | criadores=${row.criadores_unicos} | score=${row.score_frequencia} | ${row.video_exemplo}`;
    }),
    "",
    "Videos recentes coletados:",
    ...rows.slice(0, 25).map((row) => {
      return `${row.ranking}. ${row.produto_candidato} | ${row.publicado_em || "sem data"} | score=${row.score} | busca=${row.termo_busca} | ${row.link_video}`;
    }),
  ];
  fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8");
}

function productsOutputPath(csvPath) {
  return csvPath.replace(/\.csv$/i, "_produtos.csv");
}

function detailsOutputPath(csvPath) {
  return csvPath.replace(/\.csv$/i, "_todos_videos.csv");
}

function readQueriesFromFile(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  return fs
    .readFileSync(resolved, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function splitList(value) {
  return String(value || "")
    .split(/[|;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "sim", "s", "on"].includes(String(value).trim().toLowerCase());
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMetric(value, suffix) {
  const parsed = Number(String(value || "").replace(".", "").replace(",", "."));
  if (!Number.isFinite(parsed)) return "";
  const normalizedSuffix = String(suffix || "").toLowerCase();
  if (normalizedSuffix === "m") return Math.round(parsed * 1000000);
  if (normalizedSuffix === "k") return Math.round(parsed * 1000);
  return Math.round(parsed);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugify(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function csvEscape(value) {
  const text = String(value === undefined || value === null ? "" : value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function unique(values) {
  return uniqueBy(values, (value) => value);
}

function uniqueBy(values, getKey) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = getKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exit(1);
});
