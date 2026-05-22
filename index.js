const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");
const dotenv = require("dotenv");

dotenv.config();

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error(
    "Dependencia ausente: instale 'playwright' e 'dotenv' antes de executar. Ex.: npm i playwright dotenv",
  );
  process.exit(1);
}

const AMAZON_BASE_URL = "https://www.amazon.com.br";
const SELLER_CENTRAL_BASE_URL = "https://sellercentral.amazon.com.br";
const GOOGLE_LENS_BASE_URL = "https://lens.google.com/uploadbyurl?url=";
const DEFAULT_OUTPUT_CSV = path.join(process.cwd(), "oportunidades_cnpj.csv");
let OUTPUT_CSV = path.resolve(process.cwd(), process.env.OUTPUT_CSV || DEFAULT_OUTPUT_CSV);
const DISCOVERY_STATE_FILE = path.resolve(
  process.cwd(),
  process.env.DISCOVERY_STATE_FILE || ".discovery-state.json",
);
const LOG_FILE = process.env.LOG_FILE ? path.resolve(process.cwd(), process.env.LOG_FILE) : "";
const RUNTIME_LOCK_FILE = path.resolve(process.cwd(), process.env.RUNTIME_LOCK_FILE || ".bot-runtime.lock");
const PROFILE_DIR = path.resolve(process.cwd(), process.env.PROFILE_DIR || ".playwright-amazon-profile");
const AMAZON_FEE_RATE = parsePositiveNumber(process.env.AMAZON_FEE_RATE, 0.12);
const FREIGHT_AND_OPERATIONAL_COST = 20;
const RUN_PROFILE = normalizeRunProfile(process.env.RUN_PROFILE);
const DISCOVERY_MODE = normalizeDiscoveryMode(process.env.DISCOVERY_MODE || process.env.SOURCE_MODE);
const SELLER_CENTRAL_BOOTSTRAP_QUERY = process.env.SELLER_CENTRAL_BOOTSTRAP_QUERY || "B000000000";
const DEFAULT_MAX_RESULTS = resolveMaxResults();
const MAX_SUPPLIER_QUERIES = resolveMaxSupplierQueries();
const BROWSER_WORKERS = resolveBrowserWorkers();
const ALLOW_RISKY_PARALLEL = parseBoolean(process.env.ALLOW_RISKY_PARALLEL, false);
const AUTO_SEARCH_SUPPLIERS = parseBoolean(
  process.env.AUTO_SEARCH_SUPPLIERS || process.env.SEARCH_SUPPLIERS_AUTOMATICALLY,
  true,
);
const KEEP_INVENTORY_PAGES_OPEN = parseBoolean(
  process.env.KEEP_INVENTORY_PAGES_OPEN,
  !AUTO_SEARCH_SUPPLIERS,
);
const CSV_ONLY_APPROVED_PRODUCTS = parseBoolean(process.env.CSV_ONLY_APPROVED_PRODUCTS, true);
const INTERMITTENT_MODE = parseBoolean(
  process.env.INTERMITTENT_MODE || process.env.RUN_INTERMITTENTLY,
  false,
);
const INTERMITTENT_INTERVAL_MS = resolveIntermittentIntervalMs();
const INTERMITTENT_MAX_CYCLES = resolveIntermittentMaxCycles();
const SELLER_LOGIN_WAIT_MS = Number(process.env.SELLER_LOGIN_WAIT_MS || 600000);
const LENS_TIMEOUT_MS = Number(process.env.LENS_TIMEOUT_MS || 12000);
const DEFAULT_DISCOVERY_TERMS = [
  "suporte monitor articulado",
  "cadeira escritorio ergonomica",
  "mesa lateral com rodinhas",
  "ventilador de torre",
  "luminaria de mesa led premium",
  "forno eletrico de bancada",
  "aspirador vertical",
  "parafusadeira furadeira",
  "cafeteira eletrica",
  "organizador de ferramentas",
  "suporte notebook aluminio",
  "mesa para notebook ajustavel",
];
const DEFAULT_CONTROLLED_DISCOVERY_TERMS = [
  "suporte monitor",
  "cadeira escritorio",
  "ventilador torre",
  "parafusadeira",
  "cafeteira eletrica",
  "mesa notebook ajustavel",
];
const DEFAULT_PUBLIC_FEED_VARIANTS = [
  "bestsellers",
  "new-releases",
  "movers-and-shakers",
];
const HEADLESS_MODE = parseBoolean(process.env.HEADLESS_MODE, true);
const KEEP_BROWSER_OPEN = parseBoolean(process.env.KEEP_BROWSER_OPEN, false);
const CHROMIUM_WINDOW_MODE = normalizeChromiumWindowMode(
  process.env.CHROMIUM_WINDOW_MODE || process.env.BROWSER_WINDOW_MODE,
);
const SUPPRESS_BROWSER_FOCUS = parseBoolean(
  process.env.SUPPRESS_BROWSER_FOCUS,
  CHROMIUM_WINDOW_MODE === "background" || CHROMIUM_WINDOW_MODE === "minimized",
);
const MIN_MARGIN = Number(process.env.MIN_MARGIN || 25);
const MIN_AMAZON_PRICE = parsePositiveNumber(process.env.MIN_AMAZON_PRICE, 0);
const MAX_AMAZON_PRICE = parsePositiveNumber(process.env.MAX_AMAZON_PRICE, Number.POSITIVE_INFINITY);
const AUTO_REGISTER_OPEN_ASINS = parseBoolean(process.env.AUTO_REGISTER_OPEN_ASINS, false);
const LISTING_PRICE_FACTOR = parseFiniteNumber(process.env.LISTING_PRICE_FACTOR, 1);
const LISTING_PRICE_OFFSET = parseFiniteNumber(process.env.LISTING_PRICE_OFFSET, 0);
const SELLER_SKU_PREFIX = String(process.env.SELLER_SKU_PREFIX || "AUTO").trim() || "AUTO";
const MAX_SELLER_SKU_LENGTH = 40;
const PUBLIC_FEED_MAX_PAGES = parsePositiveInt(process.env.PUBLIC_FEED_MAX_PAGES, 10);
const PUBLIC_FEED_VARIANTS = resolvePublicFeedVariants();
const KEYWORD_SORTS = resolveKeywordSorts();
const KEYWORD_SORT = KEYWORD_SORTS[0] || "date-desc-rank";
const KEYWORD_PAGE_MIN = parsePositiveInt(process.env.KEYWORD_PAGE_MIN, 4);
const KEYWORD_PAGE_MAX = parsePositiveInt(
  process.env.KEYWORD_PAGE_MAX,
  Math.max(KEYWORD_PAGE_MIN, 10),
);
const DISCOVERY_CANDIDATE_POOL_SIZE = parsePositiveInt(
  process.env.DISCOVERY_CANDIDATE_POOL_SIZE,
  Math.max(DEFAULT_MAX_RESULTS * 4, DEFAULT_MAX_RESULTS),
);
const RECENT_ASIN_TTL_HOURS = parsePositiveInt(process.env.RECENT_ASIN_TTL_HOURS, 720);
const RECENT_ASIN_MEMORY_LIMIT = parsePositiveInt(process.env.RECENT_ASIN_MEMORY_LIMIT, 20000);
const MAX_INTERNATIONAL_SKIPS_PER_SOURCE = parsePositiveInt(process.env.MAX_INTERNATIONAL_SKIPS_PER_SOURCE, 4);
const AMAZON_NAVIGATION_DELAY_MIN_MS = parsePositiveInt(process.env.AMAZON_NAVIGATION_DELAY_MIN_MS, 1800);
const AMAZON_NAVIGATION_DELAY_MAX_MS = parsePositiveInt(process.env.AMAZON_NAVIGATION_DELAY_MAX_MS, 4200);
const AMAZON_CAPTCHA_BACKOFF_BASE_MS = parsePositiveInt(process.env.AMAZON_CAPTCHA_BACKOFF_BASE_MS, 20000);
const AMAZON_CAPTCHA_BACKOFF_MAX_MS = parsePositiveInt(process.env.AMAZON_CAPTCHA_BACKOFF_MAX_MS, 180000);
const AMAZON_CAPTCHA_MAX_RETRIES = parsePositiveInt(process.env.AMAZON_CAPTCHA_MAX_RETRIES, 1);
const KEYWORDS = parseList(process.env.KEYWORDS);
const DISCOVERY_TERMS = parseList(process.env.DISCOVERY_TERMS);
const DISCOVERY_URLS = parseList(process.env.DISCOVERY_URLS);
const CONTROLLED_DISCOVERY_TERMS = parseList(process.env.CONTROLLED_DISCOVERY_TERMS);
const ASIN_SEEDS = parseList(process.env.ASIN_SEEDS)
  .map((value) => normalizeAsin(value))
  .filter(Boolean);
const discoveryState = loadDiscoveryState();

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

const STOPWORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "no",
  "nos",
  "na",
  "nas",
  "o",
  "os",
  "para",
  "por",
  "pra",
  "pro",
  "sem",
  "um",
  "uma",
  "uns",
  "umas",
]);

if (LOG_FILE) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
}

let logFileWritable = true;
const workerLogScope = new AsyncLocalStorage();
const retainedBrowserResources = [];
let runtimeLockAcquired = false;
const amazonThrottleState = {
  consecutiveCaptchas: 0,
  cooldownUntil: 0,
};

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "sim", "on"].includes(normalized);
}

function parseList(rawValue) {
  return String(rawValue || "")
    .split(/[\n,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function parseFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parsePositiveNumber(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const numeric = Number(String(value).replace(",", "."));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeRunProfile(value) {
  return normalizeText(value) === "controlled" ? "controlled" : "default";
}

function normalizeDiscoveryMode(value) {
  const normalized = normalizeText(value);

  if (["public feed", "public-feed", "feed", "url", "urls", "vitrine", "vitrines"].includes(normalized)) {
    return "public-feed";
  }

  if (["keyword", "keywords", "term", "terms", "termo", "termos"].includes(normalized)) {
    return "keyword";
  }

  if (["asin", "asins", "asin-list", "lista asin", "lista de asin", "seed asin"].includes(normalized)) {
    return "asin";
  }

  return "auto";
}

function normalizeChromiumWindowMode(value) {
  const normalized = normalizeText(value);
  if (["background", "segundo plano", "segundo-plano"].includes(normalized)) {
    return "background";
  }
  if (["minimized", "minimizado", "minimize"].includes(normalized)) {
    return "minimized";
  }
  return "normal";
}

function normalizePublicFeedVariant(value) {
  const normalized = normalizeText(value);

  if (["bestsellers", "bestsellers", "best-sellers", "mais vendidos"].includes(normalized)) {
    return "bestsellers";
  }

  if (["new releases", "new-releases", "lancamentos", "lançamentos"].includes(normalized)) {
    return "new-releases";
  }

  if (["movers and shakers", "movers-and-shakers", "em alta"].includes(normalized)) {
    return "movers-and-shakers";
  }

  if (["most wished for", "most-wished-for", "mais desejados"].includes(normalized)) {
    return "most-wished-for";
  }

  return "";
}

function normalizeKeywordSort(value) {
  const normalized = normalizeText(value);

  if (
    [
      "date-desc-rank",
      "newest",
      "newest-arrivals",
      "lancamentos mais novos",
      "lancamentos",
      "mais novos",
    ].includes(normalized)
  ) {
    return "date-desc-rank";
  }

  if (["price-asc-rank", "menor preco", "preco menor", "mais barato"].includes(normalized)) {
    return "price-asc-rank";
  }

  if (["price-desc-rank", "maior preco", "preco maior", "mais caro"].includes(normalized)) {
    return "price-desc-rank";
  }

  if (["review-rank", "avaliacoes", "avaliações", "mais avaliados", "melhores avaliacoes", "melhores avaliações"].includes(normalized)) {
    return "review-rank";
  }

  if (["relevanceblender", "relevance", "relevancia", "relevância", "mais relevantes"].includes(normalized)) {
    return "relevanceblender";
  }

  return "date-desc-rank";
}

function resolveKeywordSorts() {
  const configuredSorts = parseList(process.env.KEYWORD_SORTS)
    .concat(parseList(process.env.KEYWORD_SORT))
    .map((value) => normalizeKeywordSort(value))
    .filter(Boolean);

  return Array.from(new Set(configuredSorts.length ? configuredSorts : ["date-desc-rank"]));
}

function resolvePublicFeedVariants() {
  const configuredVariants = parseList(process.env.PUBLIC_FEED_VARIANTS)
    .map((value) => normalizePublicFeedVariant(value))
    .filter(Boolean);

  return Array.from(new Set(configuredVariants.length ? configuredVariants : DEFAULT_PUBLIC_FEED_VARIANTS));
}

function resolveMaxResults() {
  const defaultValue = parsePositiveInt(
    process.env.MAX_RESULTS || process.env.MAX_RESULTS_PER_KEYWORD,
    10,
  );

  if (RUN_PROFILE !== "controlled") {
    return defaultValue;
  }

  return parsePositiveInt(process.env.CONTROLLED_MAX_RESULTS, Math.min(defaultValue, 4));
}

function resolveMaxSupplierQueries() {
  const defaultValue = parsePositiveInt(process.env.MAX_SUPPLIER_QUERIES, 3);
  if (RUN_PROFILE !== "controlled") {
    return defaultValue;
  }

  return parsePositiveInt(process.env.CONTROLLED_MAX_SUPPLIER_QUERIES, Math.min(defaultValue, 2));
}

function resolveBrowserWorkers() {
  return parsePositiveInt(process.env.BROWSER_WORKERS || process.env.WORKER_COUNT, 1);
}

function resolveIntermittentIntervalMs() {
  const rawMs = Number(process.env.INTERMITTENT_INTERVAL_MS);
  if (Number.isFinite(rawMs) && rawMs > 0) {
    return Math.floor(rawMs);
  }

  const rawMinutes = Number(process.env.INTERMITTENT_INTERVAL_MINUTES || 30);
  if (Number.isFinite(rawMinutes) && rawMinutes > 0) {
    return Math.floor(rawMinutes * 60 * 1000);
  }

  return 30 * 60 * 1000;
}

function resolveIntermittentMaxCycles() {
  const rawValue = Number(process.env.INTERMITTENT_MAX_CYCLES || process.env.MAX_CYCLES);
  if (Number.isFinite(rawValue) && rawValue > 0) {
    return Math.floor(rawValue);
  }

  return Number.POSITIVE_INFINITY;
}

function loadDiscoveryState() {
  try {
    if (!fs.existsSync(DISCOVERY_STATE_FILE)) {
      return { publicFeed: {}, blockedSellerSignals: {}, recentAsins: {}, discoveryCursor: {}, processedSources: {} };
    }

    const raw = fs.readFileSync(DISCOVERY_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      publicFeed: parsed?.publicFeed && typeof parsed.publicFeed === "object" ? parsed.publicFeed : {},
      blockedSellerSignals:
        parsed?.blockedSellerSignals && typeof parsed.blockedSellerSignals === "object"
          ? parsed.blockedSellerSignals
          : {},
      recentAsins:
        parsed?.recentAsins && typeof parsed.recentAsins === "object" ? parsed.recentAsins : {},
      discoveryCursor:
        parsed?.discoveryCursor && typeof parsed.discoveryCursor === "object"
          ? parsed.discoveryCursor
          : {},
      processedSources:
        parsed?.processedSources && typeof parsed.processedSources === "object"
          ? parsed.processedSources
          : {},
    };
  } catch (error) {
    return { publicFeed: {}, blockedSellerSignals: {}, recentAsins: {}, discoveryCursor: {}, processedSources: {} };
  }
}

function saveDiscoveryState() {
  try {
    pruneDiscoveryState();
    fs.mkdirSync(path.dirname(DISCOVERY_STATE_FILE), { recursive: true });
    fs.writeFileSync(DISCOVERY_STATE_FILE, JSON.stringify(discoveryState, null, 2), "utf8");
  } catch (error) {
    log("warn", `Nao foi possivel salvar o estado dinamico da descoberta: ${error.message}`);
  }
}

function pruneDiscoveryState() {
  if (!discoveryState.recentAsins || typeof discoveryState.recentAsins !== "object") {
    discoveryState.recentAsins = {};
  }

  if (!discoveryState.discoveryCursor || typeof discoveryState.discoveryCursor !== "object") {
    discoveryState.discoveryCursor = {};
  }

  if (!discoveryState.processedSources || typeof discoveryState.processedSources !== "object") {
    discoveryState.processedSources = {};
  }

  const ttlMs = Math.max(1, RECENT_ASIN_TTL_HOURS) * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  const recentEntries = Object.entries(discoveryState.recentAsins)
    .map(([asin, record]) => {
      const updatedAtMs = Date.parse(record?.updatedAt || "");
      return {
        asin: normalizeAsin(asin),
        updatedAtMs,
        title: String(record?.title || "").trim(),
      };
    })
    .filter((entry) => entry.asin && Number.isFinite(entry.updatedAtMs) && entry.updatedAtMs >= cutoff)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, RECENT_ASIN_MEMORY_LIMIT);

  discoveryState.recentAsins = Object.fromEntries(
    recentEntries.map((entry) => [
      entry.asin,
      {
        title: entry.title.slice(0, 240),
        updatedAt: new Date(entry.updatedAtMs).toISOString(),
      },
    ]),
  );

  // Prune processed sources older than 30 days
  const sourceCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  if (discoveryState.processedSources) {
    for (const [key, value] of Object.entries(discoveryState.processedSources)) {
      if (Date.parse(value) < sourceCutoff) {
        delete discoveryState.processedSources[key];
      }
    }
  }
}

function buildPublicFeedVariantUrl(entryUrl, variant) {
  try {
    const url = new URL(entryUrl);
    url.pathname = url.pathname.replace(
      /\/gp\/(bestsellers|new-releases|movers-and-shakers|most-wished-for)\//i,
      `/gp/${variant}/`,
    );
    return url.toString();
  } catch (error) {
    return entryUrl;
  }
}

function buildPublicFeedPageUrl(entryUrl, variant, pageNumber) {
  try {
    const url = new URL(buildPublicFeedVariantUrl(entryUrl, variant));
    if (pageNumber > 1) {
      url.searchParams.set("pg", String(pageNumber));
    } else {
      url.searchParams.delete("pg");
    }
    return url.toString();
  } catch (error) {
    return entryUrl;
  }
}

function getNextPublicFeedTarget(entryUrl) {
  const currentState = discoveryState.publicFeed[entryUrl] || { nextPage: 1 };
  const pageNumber = Math.max(1, Number(currentState.nextPage) || 1);
  const effectiveMaxPages = Math.max(1, PUBLIC_FEED_MAX_PAGES);
  const effectiveVariants = PUBLIC_FEED_VARIANTS.length
    ? PUBLIC_FEED_VARIANTS
    : DEFAULT_PUBLIC_FEED_VARIANTS;
  const defaultVariantIndex = effectiveVariants.length > 1 ? 1 : 0;
  const variantIndexRaw = Number(currentState.nextVariantIndex);
  const variantIndex =
    Number.isFinite(variantIndexRaw) && variantIndexRaw >= 0
      ? Math.floor(variantIndexRaw) % effectiveVariants.length
      : defaultVariantIndex;
  const variant = effectiveVariants[variantIndex] || effectiveVariants[0];

  let nextPage = pageNumber;
  let nextVariantIndex = variantIndex + 1;
  if (nextVariantIndex >= effectiveVariants.length) {
    nextVariantIndex = 0;
    nextPage = pageNumber >= effectiveMaxPages ? 1 : pageNumber + 1;
  }

  discoveryState.publicFeed[entryUrl] = { nextPage, nextVariantIndex };
  saveDiscoveryState();

  return {
    pageNumber,
    variant,
    url: buildPublicFeedPageUrl(entryUrl, variant, pageNumber),
  };
}

function rotateList(items, offset) {
  if (!items.length) {
    return [];
  }

  const safeOffset = ((offset % items.length) + items.length) % items.length;
  return items.slice(safeOffset).concat(items.slice(0, safeOffset));
}

function shuffleArray(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomBetween(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function markSourceAsProcessed(mode, source) {
  if (!discoveryState.processedSources) {
    discoveryState.processedSources = {};
  }
  const key = `${mode}:${source}`;
  discoveryState.processedSources[key] = new Date().toISOString();
  saveDiscoveryState();
}

function isSourceProcessed(mode, source) {
  if (!discoveryState.processedSources) {
    return false;
  }
  const key = `${mode}:${source}`;
  return Boolean(discoveryState.processedSources[key]);
}

function orderDiscoverySources(sources, mode) {
  const uniqueSources = Array.from(new Set(sources));
  if (!uniqueSources.length) {
    return [];
  }

  if (mode === "public-feed") {
    if (uniqueSources.length <= 1) {
      return uniqueSources;
    }

    const cursorRaw = Number(discoveryState.discoveryCursor?.nextSourceIndex);
    const defaultIndex = randomBetween(0, uniqueSources.length - 1);
    const startIndex =
      Number.isFinite(cursorRaw) && cursorRaw >= 0 ? Math.floor(cursorRaw) % uniqueSources.length : defaultIndex;
    const rotatedSources = rotateList(uniqueSources, startIndex);
    const leadSize = Math.min(4, rotatedSources.length);
    const orderedSources = shuffleArray(rotatedSources.slice(0, leadSize)).concat(
      shuffleArray(rotatedSources.slice(leadSize)),
    );
    const step = uniqueSources.length > 1 ? randomBetween(1, uniqueSources.length - 1) : 0;

    discoveryState.discoveryCursor = {
      nextSourceIndex: (startIndex + step) % uniqueSources.length,
      updatedAt: new Date().toISOString(),
    };
    saveDiscoveryState();

    return orderedSources;
  }

  // Logic for keyword/asin: filter out already processed ones
  let pendingSources = uniqueSources.filter((s) => !isSourceProcessed(mode, s));

  if (!pendingSources.length) {
    log("info", `Todas as origens para o modo "${mode}" ja foram processadas recentemente. Reiniciando o ciclo.`);
    for (const source of uniqueSources) {
      const key = `${mode}:${source}`;
      delete discoveryState.processedSources[key];
    }
    saveDiscoveryState();
    pendingSources = uniqueSources;
  }

  return shuffleArray(pendingSources);
}

function resolveDiscoveryConfig() {
  if (DISCOVERY_MODE === "asin") {
    if (!ASIN_SEEDS.length) {
      throw new Error("DISCOVERY_MODE=asin requer ASIN_SEEDS preenchido.");
    }

    return { sources: ASIN_SEEDS, mode: "asin" };
  }

  if (DISCOVERY_MODE === "public-feed") {
    if (!DISCOVERY_URLS.length) {
      throw new Error("DISCOVERY_MODE=public-feed requer DISCOVERY_URLS preenchido.");
    }

    return { sources: DISCOVERY_URLS, mode: "public-feed" };
  }

  if (DISCOVERY_MODE === "keyword") {
    if (KEYWORDS.length) {
      return { sources: KEYWORDS, mode: "keyword" };
    }

    if (DISCOVERY_TERMS.length) {
      return { sources: DISCOVERY_TERMS, mode: "keyword" };
    }

    if (RUN_PROFILE === "controlled") {
      return {
        sources: CONTROLLED_DISCOVERY_TERMS.length
          ? CONTROLLED_DISCOVERY_TERMS
          : DEFAULT_CONTROLLED_DISCOVERY_TERMS,
        mode: "keyword",
      };
    }

    return { sources: DEFAULT_DISCOVERY_TERMS, mode: "keyword" };
  }

  if (KEYWORDS.length) {
    return { sources: KEYWORDS, mode: "keyword" };
  }

  if (DISCOVERY_TERMS.length) {
    return { sources: DISCOVERY_TERMS, mode: "keyword" };
  }

  if (ASIN_SEEDS.length) {
    return { sources: ASIN_SEEDS, mode: "asin" };
  }

  if (DISCOVERY_URLS.length) {
    return { sources: DISCOVERY_URLS, mode: "public-feed" };
  }

  if (RUN_PROFILE === "controlled") {
    return {
      sources: CONTROLLED_DISCOVERY_TERMS.length
        ? CONTROLLED_DISCOVERY_TERMS
        : DEFAULT_CONTROLLED_DISCOVERY_TERMS,
      mode: "keyword",
    };
  }

  return { sources: DEFAULT_DISCOVERY_TERMS, mode: "keyword" };
}

const OUTPUTS_DIR = path.join(process.cwd(), "outputs");
const IGNORE_BRAND_FILTER = parseBoolean(process.env.IGNORE_BRAND_FILTER, true);

if (IGNORE_BRAND_FILTER) {
  log("info", "Filtro de marca desabilitado (IGNORE_BRAND_FILTER=true): ASINs com marca forte tambem serao testados no Seller Central.");
}

function manausTimestamp() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Manaus",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function manausTimestampFile() {
  return new Date()
    .toLocaleString("pt-BR", { timeZone: "America/Manaus" })
    .replace(/[-:.TZ]/g, "")
    .replace(/[\/\s,]/g, "_")
    .slice(0, 15);
}

async function savePageArchive(page, prefix, asin) {
  try {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    const timestamp = manausTimestampFile();
    const baseName = `${prefix}_${asin}_${timestamp}`;
    
    const screenshotPath = path.join(OUTPUTS_DIR, `${baseName}.png`);
    const htmlPath = path.join(OUTPUTS_DIR, `${baseName}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const content = await page.content().catch(() => "");
    if (content) {
      fs.writeFileSync(htmlPath, content, "utf8");
    }

    log("success", `Pagina salva para revisao: ${baseName}.png e .html em /outputs`);
    return { screenshotPath, htmlPath };
  } catch (error) {
    log("warn", `Nao foi possivel salvar a pagina: ${error.message}`);
    return null;
  }
}

async function savePageArchive(page, prefix, asin) {
  try {
    fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
    const timestamp = manausTimestampFile();
    const baseName = `${prefix}_${asin}_${timestamp}`;
    
    const screenshotPath = path.join(OUTPUTS_DIR, `${baseName}.png`);
    const htmlPath = path.join(OUTPUTS_DIR, `${baseName}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const content = await page.content().catch(() => "");
    if (content) {
      fs.writeFileSync(htmlPath, content, "utf8");
    }

    log("success", `Pagina salva para revisao: ${baseName}.png e .html em /outputs`);
    return { screenshotPath, htmlPath };
  } catch (error) {
    log("warn", `Nao foi possivel salvar a pagina: ${error.message}`);
    return null;
  }
}

function appendLogLine(line) {
  if (!LOG_FILE || !logFileWritable) {
    return;
  }

  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
  } catch (error) {
    logFileWritable = false;
    console.error(`Falha ao escrever log dedicado em ${LOG_FILE}: ${error.message}`);
  }
}

function getCurrentLogScopePrefix() {
  const scope = workerLogScope.getStore();
  return scope ? `[${scope}] ` : "";
}

function log(level, message) {
  const palette = {
    info: ANSI.cyan,
    step: ANSI.blue,
    success: ANSI.green,
    warn: ANSI.yellow,
    error: ANSI.red,
  };

  const color = palette[level] || ANSI.cyan;
  const label = level.toUpperCase().padEnd(7, " ");
  const scopedMessage = `${getCurrentLogScopePrefix()}${message}`;
  const plainLine = `[Manaus ${manausTimestamp()}] ${label.trimEnd()} ${scopedMessage}`;
  appendLogLine(plainLine);
  console.log(
    `${ANSI.dim}[Manaus ${manausTimestamp()}]${ANSI.reset} ${color}${label}${ANSI.reset} ${scopedMessage}`,
  );
}

function distributeSourcesAcrossWorkers(sources, requestedWorkers) {
  const workerCount = Math.max(1, Math.min(requestedWorkers, sources.length || 1));
  const buckets = Array.from({ length: workerCount }, () => []);

  sources.forEach((source, index) => {
    buckets[index % workerCount].push(source);
  });

  return buckets.filter((bucket) => bucket.length);
}

function describeWorkerSources(sources) {
  return sources.join(" | ");
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes) {
    parts.push(`${minutes}min`);
  }

  if (seconds && !hours) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

function resolveEffectiveWorkerCount(discoveryMode, sourceCount) {
  const requested = Math.max(1, BROWSER_WORKERS);
  const boundedBySources = Math.max(1, Math.min(requested, sourceCount || 1));

  if (boundedBySources <= 1) {
    return { requested, effective: 1, reason: "" };
  }

  if (!ALLOW_RISKY_PARALLEL && discoveryMode === "public-feed") {
    return {
      requested,
      effective: 1,
      reason:
        "Paralelismo reduzido para 1 worker no modo public-feed para diminuir captcha e instabilidade no Seller Central.",
    };
  }

  if (!ALLOW_RISKY_PARALLEL && !HEADLESS_MODE) {
    return {
      requested,
      effective: 1,
      reason:
        "Paralelismo reduzido para 1 worker com navegador visivel para preservar a sessao autenticada e evitar bloqueios.",
    };
  }

  return { requested, effective: boundedBySources, reason: "" };
}

function shouldKeepBrowsersOpen() {
  return KEEP_BROWSER_OPEN && !HEADLESS_MODE && !INTERMITTENT_MODE;
}

function retainBrowserResource(resource) {
  retainedBrowserResources.push(resource);
}

async function closeBrowserResource(resource) {
  if (resource.context) {
    await closeContextPages(resource.context);
    await resource.context.close().catch(() => {});
  }

  if (resource.browser) {
    await resource.browser.close().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAsin(value) {
  const match = String(value || "")
    .toUpperCase()
    .match(/[A-Z0-9]{10}/);
  return match ? match[0] : "";
}

function readRuntimeLock() {
  try {
    if (!fs.existsSync(RUNTIME_LOCK_FILE)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(RUNTIME_LOCK_FILE, "utf8"));
  } catch (error) {
    return null;
  }
}

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function acquireRuntimeLock() {
  const existingLock = readRuntimeLock();
  if (existingLock?.pid && existingLock.pid !== process.pid && isProcessRunning(Number(existingLock.pid))) {
    throw new Error(`Ja existe outra instancia rodando neste workspace no PID ${existingLock.pid}.`);
  }

  fs.writeFileSync(
    RUNTIME_LOCK_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        profileDir: PROFILE_DIR,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  runtimeLockAcquired = true;
}

function releaseRuntimeLock() {
  if (!runtimeLockAcquired) {
    return;
  }

  const existingLock = readRuntimeLock();
  if (!existingLock || Number(existingLock.pid) === process.pid) {
    fs.rmSync(RUNTIME_LOCK_FILE, { force: true });
  }

  runtimeLockAcquired = false;
}

function rememberRecentAsin(asin, title = "") {
  const normalizedAsin = normalizeAsin(asin);
  if (!normalizedAsin) {
    return;
  }

  discoveryState.recentAsins[normalizedAsin] = {
    title: String(title || "").trim().slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
  saveDiscoveryState();
}

function wasRecentlySeenAsin(asin) {
  const normalizedAsin = normalizeAsin(asin);
  if (!normalizedAsin) {
    return false;
  }

  pruneDiscoveryState();
  return Boolean(discoveryState.recentAsins?.[normalizedAsin]);
}

function isApprovalRequiredStatus(status) {
  const normalized = normalizeText(status);
  return /requer autorizacao|solicitar aprovacao|request approval|apply to sell|approval required/.test(
    normalized,
  );
}

function isPermanentSellerBlockStatus(status) {
  const normalized = normalizeText(status);
  return (
    isApprovalRequiredStatus(status) ||
    /erro 56|erro 86|erro 5886|asin nao aberto para cadastro|condicao novo nao encontrada/.test(
      normalized,
    )
  );
}

function isManualReviewCandidateStatus(status) {
  const normalized = normalizeText(status);
  if (isPermanentSellerBlockStatus(status)) {
    return false;
  }

  return /nova guia aberta|mesma aba navegou|mesma aba trocou de superficie|asin aberto para cadastro/.test(
    normalized,
  );
}

function isClosedTargetError(error) {
  const normalized = normalizeText(error?.message || error);
  return /target page context or browser has been closed|browser has been closed|context has been closed|page has been closed/.test(
    normalized,
  );
}

function normalizeSellerBlockSignal(value) {
  return normalizeText(value).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function buildSellerBlockSignals(product) {
  const signals = [];
  const exactAsin = normalizeSellerBlockSignal(product?.asin);
  if (exactAsin) {
    signals.push(`asin:${exactAsin}`);
  }

  for (const candidate of [product?.brandRaw, product?.bylineText]) {
    const normalized = normalizeSellerBlockSignal(candidate);
    if (hasMeaningfulBrand(normalized)) {
      signals.push(`brand:${normalized}`);
    }
  }

  return Array.from(new Set(signals));
}

function rememberSellerBlock(product, status) {
  if (!isPermanentSellerBlockStatus(status)) {
    return;
  }

  for (const signal of buildSellerBlockSignals(product)) {
    discoveryState.blockedSellerSignals[signal] = {
      status,
      updatedAt: new Date().toISOString(),
    };
  }

  saveDiscoveryState();
}

function getRememberedSellerBlock(product) {
  for (const signal of buildSellerBlockSignals(product)) {
    const match = discoveryState.blockedSellerSignals?.[signal];
    if (match?.status) {
      return match.status;
    }
  }

  return "";
}

async function applyAmazonNavigationPacing(label) {
  const now = Date.now();
  if (amazonThrottleState.cooldownUntil > now) {
    const waitMs = amazonThrottleState.cooldownUntil - now;
    log("warn", `Backoff anti-captcha ativo antes de ${label}: aguardando ${formatDuration(waitMs)}.`);
    await sleep(waitMs);
  }

  const minDelay = Math.max(250, AMAZON_NAVIGATION_DELAY_MIN_MS);
  const maxDelay = Math.max(minDelay, AMAZON_NAVIGATION_DELAY_MAX_MS);
  await sleep(randomBetween(minDelay, maxDelay));
}

function registerAmazonCaptcha(label) {
  amazonThrottleState.consecutiveCaptchas += 1;
  const multiplier = Math.max(1, amazonThrottleState.consecutiveCaptchas);
  const backoffMs = Math.min(
    AMAZON_CAPTCHA_BACKOFF_MAX_MS,
    AMAZON_CAPTCHA_BACKOFF_BASE_MS * multiplier + randomBetween(3000, 9000),
  );
  amazonThrottleState.cooldownUntil = Date.now() + backoffMs;
  log("warn", `Captcha detectado em ${label}. Backoff de ${formatDuration(backoffMs)} antes de novas navegacoes.`);
}

function registerAmazonNavigationSuccess() {
  amazonThrottleState.consecutiveCaptchas = 0;
  if (amazonThrottleState.cooldownUntil < Date.now()) {
    amazonThrottleState.cooldownUntil = 0;
  }
}

async function gotoAmazonPageWithRetry({
  page,
  url,
  label,
  waitSelector,
  waitForNetworkIdle = false,
  captchaErrorMessage,
}) {
  const maxAttempts = Math.max(1, AMAZON_CAPTCHA_MAX_RETRIES + 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await applyAmazonNavigationPacing(label);
    await page.goto(url, { waitUntil: "domcontentloaded" });

    if (waitSelector) {
      await maybeWaitForResults(page, waitSelector);
    }

    if (waitForNetworkIdle) {
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    }

    if (await isAmazonCaptcha(page)) {
      registerAmazonCaptcha(label);
      lastError = new Error(captchaErrorMessage);
      if (attempt < maxAttempts) {
        continue;
      }
      throw lastError;
    }

    registerAmazonNavigationSuccess();
    return;
  }

  throw lastError || new Error(captchaErrorMessage);
}

function parseCurrency(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (!value) {
    return null;
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  const matches = text.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:,\d{2})?/g);
  if (!matches || !matches.length) {
    return null;
  }

  const normalized = matches[0].replace(/\./g, "").replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatMargin(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return `${value.toFixed(2)}%`;
}

function isWithinAmazonPriceRange(price) {
  if (!Number.isFinite(price)) {
    return false;
  }

  if (price < MIN_AMAZON_PRICE) {
    return false;
  }

  if (Number.isFinite(MAX_AMAZON_PRICE) && price > MAX_AMAZON_PRICE) {
    return false;
  }

  return true;
}

function describeAmazonPriceRange() {
  if (Number.isFinite(MAX_AMAZON_PRICE)) {
    return `${formatCurrency(MIN_AMAZON_PRICE)} a ${formatCurrency(MAX_AMAZON_PRICE)}`;
  }

  return `a partir de ${formatCurrency(MIN_AMAZON_PRICE)}`;
}

function filterSeedsByAmazonPrice(results, sourceLabel) {
  if (!Array.isArray(results) || !results.length) {
    return [];
  }

  const filtered = results.filter((item) => {
    const seedPrice = parseCurrency(item?.priceText);
    return !Number.isFinite(seedPrice) || isWithinAmazonPriceRange(seedPrice);
  });

  const removedCount = results.length - filtered.length;
  if (removedCount > 0) {
    log(
      "info",
      `${sourceLabel}: ${removedCount} candidato(s) removido(s) pelo filtro de ticket ${describeAmazonPriceRange()}`,
    );
  }

  return filtered;
}

function formatSellerPrice(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  return value.toFixed(2);
}

function sanitizeSellerSkuPart(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSellerSku(product) {
  const uniqueSuffix = Date.now().toString(36).toUpperCase();
  const rawSku = [SELLER_SKU_PREFIX, product.asin || "ASIN", uniqueSuffix].join("-");
  const normalizedSku = sanitizeSellerSkuPart(rawSku) || `AUTO-${uniqueSuffix}`;
  return normalizedSku.slice(0, MAX_SELLER_SKU_LENGTH);
}

function calculateTargetListingPrice(amazonPrice) {
  const adjustedPrice = amazonPrice * LISTING_PRICE_FACTOR + LISTING_PRICE_OFFSET;
  if (!Number.isFinite(adjustedPrice) || adjustedPrice <= 0) {
    return null;
  }

  return Math.round(adjustedPrice * 100) / 100;
}

function csvEscape(value) {
  const stringified = value === undefined || value === null ? "" : String(value);
  if (/[,"\n]/.test(stringified)) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return stringified;
}

function isCsvLockError(error) {
  const code = String(error?.code || "").toUpperCase();
  return ["EBUSY", "EPERM", "EACCES"].includes(code);
}

function buildFallbackOutputCsvPath(currentPath) {
  const parsed = path.parse(currentPath);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return path.join(parsed.dir, `${parsed.name}_${timestamp}${parsed.ext || ".csv"}`);
}

function switchToFallbackOutputCsv(error) {
  if (!isCsvLockError(error)) {
    return false;
  }

  const previousPath = OUTPUT_CSV;
  const nextPath = buildFallbackOutputCsvPath(previousPath);
  if (normalizeText(previousPath) === normalizeText(nextPath)) {
    return false;
  }

  OUTPUT_CSV = nextPath;
  log("warn", `CSV bloqueado em ${previousPath}. Esta execucao vai continuar gravando em ${OUTPUT_CSV}.`);
  return true;
}

function ensureCsvHeader() {
  const bom = "\uFEFF";
  fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });

  if (fs.existsSync(OUTPUT_CSV)) {
    const currentContent = fs.readFileSync(OUTPUT_CSV, "utf8");
    if (!currentContent.startsWith(bom)) {
      fs.writeFileSync(OUTPUT_CSV, `${bom}${currentContent}`, "utf8");
    }
    return;
  }

  const header = [
    "ASIN",
    "Título",
    "Preço Amazon",
    "Menor Custo",
    "Margem %",
    "Status Cadastro",
  ].join(",");

  fs.writeFileSync(OUTPUT_CSV, `${bom}${header}\n`, "utf8");
}

function appendCsvRow(row) {
  const line = [
    row.asin,
    row.title,
    row.amazonPrice,
    row.lowestCost,
    row.marginPct,
    row.status,
  ]
    .map(csvEscape)
    .join(",");

  fs.appendFileSync(OUTPUT_CSV, `${line}\n`, "utf8");
}

function ensureCsvHeader() {
  const writeHeader = () => {
    const bom = "\uFEFF";
    fs.mkdirSync(path.dirname(OUTPUT_CSV), { recursive: true });

    if (fs.existsSync(OUTPUT_CSV)) {
      const currentContent = fs.readFileSync(OUTPUT_CSV, "utf8");
      if (!currentContent.startsWith(bom)) {
        fs.writeFileSync(OUTPUT_CSV, `${bom}${currentContent}`, "utf8");
      }
      return;
    }

    const header = [
      "ASIN",
      "TÃ­tulo",
      "PreÃ§o Amazon",
      "Menor Custo",
      "Margem %",
      "Status Cadastro",
    ].join(",");

    fs.writeFileSync(OUTPUT_CSV, `${bom}${header}\n`, "utf8");
  };

  try {
    writeHeader();
  } catch (error) {
    if (!switchToFallbackOutputCsv(error)) {
      throw error;
    }
    writeHeader();
  }
}

function appendCsvRow(row) {
  if (CSV_ONLY_APPROVED_PRODUCTS && !row?.approved) {
    return;
  }

  const writeRow = () => {
    const line = [
      row.asin,
      row.title,
      row.amazonPrice,
      row.lowestCost,
      row.marginPct,
      row.status,
    ]
      .map(csvEscape)
      .join(",");

    fs.appendFileSync(OUTPUT_CSV, `${line}\n`, "utf8");
  };

  try {
    writeRow();
  } catch (error) {
    if (!switchToFallbackOutputCsv(error)) {
      throw error;
    }
    ensureCsvHeader();
    writeRow();
  }
}

function extractAsinFromUrl(url) {
  const match = String(url || "").match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : "";
}

function isGenericBrand(brand) {
  const normalized = normalizeText(brand);
  return /\b(generic|generico)\b/.test(normalized);
}

function hasMeaningfulBrand(brand) {
  const normalized = normalizeText(brand);
  if (!normalized || normalized.length < 3) {
    return false;
  }

  if (isGenericBrand(normalized) || isOfficialStoreByline(normalized)) {
    return false;
  }

  return true;
}

function isOfficialStoreByline(byline) {
  return /visite a loja|visit the /i.test(String(byline || ""));
}

function buildSupplierQuery(title) {
  const cleanedTokens = normalizeText(title)
    .replace(/\b(original|oficial|amazon|mercado livre|shopee|frete gratis|frete gratis prime)\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));

  const uniqueTokens = [];
  for (const token of cleanedTokens) {
    if (!uniqueTokens.includes(token)) {
      uniqueTokens.push(token);
    }
  }

  return uniqueTokens.slice(0, 10).join(" ");
}

function tokenizeMeaningfulText(text) {
  return normalizeText(text)
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function scoreTitleSimilarity(baseTitle, candidateTitle) {
  const baseTokens = tokenizeMeaningfulText(baseTitle);
  const candidateTokens = tokenizeMeaningfulText(candidateTitle);

  if (!baseTokens.length || !candidateTokens.length) {
    return 0;
  }

  const baseSet = new Set(baseTokens);
  const shared = candidateTokens.filter((token) => baseSet.has(token));
  return shared.length / Math.max(baseSet.size, 1);
}

function buildSupplierQueriesFromLens(fallbackTitle, lensCandidates) {
  const queries = [];
  const seen = new Set();
  const pushQuery = (rawTitle) => {
    const query = buildSupplierQuery(rawTitle);
    if (!query || seen.has(query)) {
      return;
    }

    seen.add(query);
    queries.push(query);
  };

  lensCandidates
    .sort((left, right) => right.score - left.score)
    .forEach((candidate) => pushQuery(candidate.title));

  pushQuery(fallbackTitle);

  return queries.slice(0, MAX_SUPPLIER_QUERIES);
}

function extractMarketplaceCandidatesFromLens(lensCandidates) {
  return lensCandidates.filter((candidate) =>
    /shopee\.com\.br|mercadolivre\.com\.br/.test(candidate.domain || ""),
  );
}

function calculateMargin(amazonPrice, lowestCost) {
  if (!Number.isFinite(amazonPrice) || !Number.isFinite(lowestCost)) {
    return { profit: null, marginPct: null };
  }

  const profit =
    amazonPrice -
    lowestCost -
    amazonPrice * AMAZON_FEE_RATE -
    FREIGHT_AND_OPERATIONAL_COST;
  const marginPct = (profit / amazonPrice) * 100;

  return { profit, marginPct };
}

function withTimeout(promise, timeoutMs, errorMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(errorMessage)),
      timeoutMs,
    );

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function createFastPage(context) {
  const page = await context.newPage();
  await page.route("**/*", (route) => {
    const resourceType = route.request().resourceType();
    if (["font", "media"].includes(resourceType)) {
      return route.abort();
    }

    return route.continue();
  });
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  return page;
}

async function createInteractivePage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(60000);
  return page;
}

async function maybeWaitForResults(page, selector) {
  try {
    await page.waitForSelector(selector, { timeout: 15000 });
  } catch (error) {
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  }
}

async function isAmazonCaptcha(page) {
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  return /captcha|digite os caracteres|robo|robot check|continue comprando/.test(bodyText);
}

async function isAmazonUnavailableFeedPage(page) {
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  return /nao ha nenhum mais desejado|nao ha nenhum mais desejados|consulte novamente mais tarde|itens disponiveis nesta categoria/.test(
    bodyText,
  );
}

function dedupeSeeds(results, limit = Number.POSITIVE_INFINITY) {
  const uniqueResults = [];
  const seen = new Set();
  const maxItems = Number.isFinite(limit) ? Math.max(0, limit) : Number.POSITIVE_INFINITY;

  for (const item of results) {
    const key = item.asin || item.url;
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueResults.push(item);

    if (uniqueResults.length >= maxItems) {
      break;
    }
  }

  return uniqueResults;
}

async function searchAmazonByKeyword(page, keyword) {
  const pageNumber = randomBetween(Math.max(1, KEYWORD_PAGE_MIN), Math.max(Math.max(1, KEYWORD_PAGE_MIN), KEYWORD_PAGE_MAX));
  const keywordSort = KEYWORD_SORTS[randomBetween(0, KEYWORD_SORTS.length - 1)] || KEYWORD_SORT;
  const searchUrl = `${AMAZON_BASE_URL}/s?k=${encodeURIComponent(keyword)}&language=pt_BR&s=${encodeURIComponent(keywordSort)}&page=${pageNumber}`;
  log("step", `Minerando Amazon publica para a keyword "${keyword}" na pagina ${pageNumber} | ordenacao=${keywordSort}`);

  await gotoAmazonPageWithRetry({
    page,
    url: searchUrl,
    label: `busca publica keyword ${keyword}`,
    waitSelector: '[data-component-type="s-search-result"]',
    captchaErrorMessage: "Amazon retornou captcha na busca publica.",
  });

  const results = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const cards = Array.from(
      document.querySelectorAll('[data-component-type="s-search-result"]'),
    );

    return cards
      .map((card) => {
        const asin = clean(card.getAttribute("data-asin"));
        const link =
          card.querySelector("h2 a[href], a.a-link-normal.s-no-outline[href]")?.href || "";
        const title = clean(card.querySelector("h2 span")?.textContent);
        const cardText = clean(card.textContent);
        const priceText = clean(
          card.querySelector(".a-price .a-offscreen, .a-price-range .a-offscreen, .a-price-whole")
            ?.textContent,
        );

        return {
          asin,
          title,
          cardText,
          priceText,
          url: link ? new URL(link, location.origin).href : "",
        };
      })
      .filter((item) => item.asin && item.title && item.url);
  });

  const domesticResults = results.filter((item) => {
    const normalizedCard = normalizeText(`${item.title} ${item.cardText}`);
    return !/compra internacional|produto internacional|tributos de importacao|taxas de importacao|amazon global|global store|importacao|importado/.test(
      normalizedCard,
    );
  });
  const removedInternational = results.length - domesticResults.length;
  if (removedInternational > 0) {
    log("info", `keyword "${keyword}": ${removedInternational} candidato(s) removido(s) por sinal internacional na busca`);
  }

  const filteredResults = filterSeedsByAmazonPrice(domesticResults, `keyword "${keyword}"`);
  return dedupeSeeds(shuffleArray(filteredResults), DISCOVERY_CANDIDATE_POOL_SIZE);
}

function searchAmazonByAsin(asin) {
  const normalizedAsin = normalizeAsin(asin);
  if (!normalizedAsin) {
    return [];
  }

  return [
    {
      asin: normalizedAsin,
      title: "",
      priceText: "",
      url: `${AMAZON_BASE_URL}/dp/${normalizedAsin}?language=pt_BR`,
    },
  ];
}

async function searchAmazonPublicFeed(page, entryUrl) {
  const maxVariantAttempts = Math.max(1, PUBLIC_FEED_VARIANTS.length || DEFAULT_PUBLIC_FEED_VARIANTS.length);

  for (let attempt = 1; attempt <= maxVariantAttempts; attempt += 1) {
    const discoveryTarget = getNextPublicFeedTarget(entryUrl);
    log(
      "step",
      `Minerando Amazon publica pela vitrine ${entryUrl} | conteudo ${discoveryTarget.variant} | pagina dinamica ${discoveryTarget.pageNumber}/${PUBLIC_FEED_MAX_PAGES}`,
    );

    await gotoAmazonPageWithRetry({
      page,
      url: discoveryTarget.url,
      label: `vitrine publica ${discoveryTarget.variant} pagina ${discoveryTarget.pageNumber}`,
      waitSelector: "[data-asin], a[href*='/dp/'], a[href*='/gp/product/']",
      captchaErrorMessage: "Amazon retornou captcha na vitrine publica.",
    });

    const results = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const anchors = Array.from(
        document.querySelectorAll("a[href*='/dp/'], a[href*='/gp/product/']"),
      );

      return anchors
        .map((anchor) => {
          const href = anchor.href ? new URL(anchor.href, location.origin).href : "";
          const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
          const asin = asinMatch ? asinMatch[1].toUpperCase() : "";
          const card =
            anchor.closest(
              "[data-asin], .zg-grid-general-faceout, .DealGridItem-module__dealItemDisplayGrid_e7RQVFWSOrwXBX4i24Tqg, .a-carousel-card, .octopus-pc-item-hue-shield",
            ) || anchor.parentElement;

          const title = clean(
            card?.querySelector("h1, h2, h3, h4, ._cDEzb_p13n-sc-css-line-clamp-3_g3dy1, img[alt]")
              ?.textContent ||
              card?.querySelector("img[alt]")?.getAttribute("alt") ||
              anchor.getAttribute("aria-label") ||
              anchor.textContent,
          );

          const priceText = clean(
            card?.querySelector(
              ".a-price .a-offscreen, .a-offscreen, .dealPriceText, [class*='price']",
            )?.textContent,
          );

          return {
            asin,
            title,
            priceText,
            url: href,
          };
        })
        .filter((item) => item.asin && item.title && item.url);
    });

    const filteredResults = filterSeedsByAmazonPrice(
      results,
      `vitrine ${discoveryTarget.variant} pagina ${discoveryTarget.pageNumber}`,
    );
    const dedupedResults = dedupeSeeds(shuffleArray(filteredResults), DISCOVERY_CANDIDATE_POOL_SIZE);
    if (dedupedResults.length) {
      return dedupedResults;
    }

    if (await isAmazonUnavailableFeedPage(page)) {
      log(
        "warn",
        `Vitrine ${discoveryTarget.variant} sem itens disponiveis para ${entryUrl}. Pulando para a proxima variante.`,
      );
      continue;
    }

    return [];
  }

  return [];
}

async function inspectAmazonProduct(page, seed) {
  const productUrl = seed.url;
  await gotoAmazonPageWithRetry({
    page,
    url: productUrl,
    label: `pagina do produto ${seed.asin || seed.url}`,
    waitForNetworkIdle: true,
    captchaErrorMessage: "Amazon retornou captcha na pagina do produto.",
  });

  const data = await page.evaluate((fallback) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const bulletLines = Array.from(
      document.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li"),
    ).map((item) => clean(item.innerText));
    const tableRows = Array.from(
      document.querySelectorAll("#productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr"),
    ).map((row) => ({
      label: clean(row.querySelector("th")?.textContent),
      value: clean(row.querySelector("td")?.textContent),
    }));

    const bylineText = clean(
      document.querySelector("#bylineInfo, #brand, a#bylineInfo")?.textContent,
    );

    const findFromBullets = (labelRegex) => {
      const line = bulletLines.find((entry) => labelRegex.test(entry));
      if (!line) {
        return "";
      }

      const [, value = ""] = line.split(":");
      return clean(value);
    };

    const findFromTable = (labelRegex) => {
      const row = tableRows.find((entry) => labelRegex.test(entry.label));
      return row ? row.value : "";
    };

    const priceCandidates = [
      ...Array.from(
        document.querySelectorAll(
          "#corePriceDisplay_desktop_feature_div .a-offscreen, #corePrice_feature_div .a-offscreen, #apex_desktop .a-offscreen, .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice",
        ),
      ).map((item) => clean(item.textContent)),
      fallback.priceText || "",
    ].filter(Boolean);

    const allLinks = Array.from(document.querySelectorAll("a[href]"));
    const hasMultiSellerLink = allLinks.some((link) => {
      const text = clean(link.textContent);
      const href = link.getAttribute("href") || "";
      return /ofertas|novos|outros vendedores/i.test(text) || /aod|olp/.test(href);
    });

    const bodyText = clean(document.body.textContent || "");
    const internationalSignals = [
      /compra internacional/i.test(bodyText) ? "Compra Internacional" : "",
      /produto internacional/i.test(bodyText) ? "Produto internacional" : "",
      /tributos? de importa/i.test(bodyText) ? "Tributos de importacao" : "",
      /taxas? de importa/i.test(bodyText) ? "Taxas de importacao" : "",
      /import fees deposit|import charges|ships from amazon export sales|amazon export sales/i.test(bodyText)
        ? "Amazon Export/import fees"
        : "",
      /enviado de fora do brasil|envio internacional|vendedor internacional/i.test(bodyText)
        ? "Envio internacional"
        : "",
      document.querySelector("#importDisclaimer_feature_div") ? "#importDisclaimer_feature_div" : "",
      document.querySelector("#exports_desktop_qualifiedBuybox_deliveryAndImportText_feature_div")
        ? "#exports_desktop_qualifiedBuybox_deliveryAndImportText_feature_div"
        : "",
      document.querySelector("[id*='import']:not([id*='important']), [id*='Import']:not([id*='Important']), [data-feature-name*='import']:not([data-feature-name*='important'])")
        ? "Elemento de importacao"
        : "",
    ].filter(Boolean);

    return {
      asin:
        clean(document.querySelector("#ASIN, input[name='ASIN']")?.value) ||
        findFromBullets(/asin/i) ||
        findFromTable(/asin/i) ||
        fallback.asin ||
        "",
      title:
        clean(document.querySelector("#productTitle")?.textContent) ||
        fallback.title ||
        "",
      bylineText,
      brandRaw:
        findFromBullets(/marca|fabricante/i) ||
        findFromTable(/marca|fabricante/i) ||
        bylineText,
      priceText: priceCandidates[0] || "",
      mainImageUrl:
        document.querySelector("#landingImage")?.getAttribute("src") ||
        document.querySelector("#landingImage")?.getAttribute("data-old-hires") ||
        document.querySelector("#imgTagWrapperId img")?.getAttribute("src") ||
        document.querySelector("#main-image-container img")?.getAttribute("src") ||
        "",
      hasMultipleSellers: Boolean(
        document.querySelector("#aod-ingress-link") ||
          document.querySelector(".olp-text-box") ||
          hasMultiSellerLink,
      ),
      isInternational: internationalSignals.length > 0,
      internationalSignals,
      url: location.href,
    };
  }, seed);

  const asin = data.asin || extractAsinFromUrl(data.url) || seed.asin;
  const amazonPrice = parseCurrency(data.priceText);
  const genericBrand = isGenericBrand(data.brandRaw);
  const officialStoreByline = isOfficialStoreByline(data.bylineText);
  const meaningfulBrandRisk = hasMeaningfulBrand(data.brandRaw) || hasMeaningfulBrand(data.bylineText);
  const potentiallyOpen =
    !data.isInternational &&
    !officialStoreByline &&
    data.hasMultipleSellers &&
    (IGNORE_BRAND_FILTER || !meaningfulBrandRisk);

  return {
    asin,
    title: data.title || seed.title,
    amazonPrice,
    bylineText: data.bylineText,
    brandRaw: data.brandRaw,
    mainImageUrl: data.mainImageUrl,
    hasMultipleSellers: data.hasMultipleSellers,
    genericBrand,
    isInternational: data.isInternational,
    internationalSignals: data.internationalSignals || [],
    officialStoreByline,
    meaningfulBrandRisk,
    potentiallyOpen,
    url: data.url,
  };
}

async function searchGoogleLensCandidates(imageUrl, fallbackTitle, context) {
  if (!imageUrl) {
    return [];
  }

  const page = await createInteractivePage(context);
  try {
    const lensUrl = `${GOOGLE_LENS_BASE_URL}${encodeURIComponent(imageUrl)}`;
    log("step", "Consultando Google Lens pela imagem principal do produto");

    await withTimeout(
      page.goto(lensUrl, { waitUntil: "domcontentloaded" }),
      LENS_TIMEOUT_MS,
      "Google Lens excedeu o timeout inicial.",
    );
    await page.waitForTimeout(2500);

    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    if (/captcha|unusual traffic|consent|verifique se voce e humano/.test(bodyText)) {
      throw new Error("Google Lens bloqueou ou exigiu validacao manual.");
    }

    const rawCandidates = await withTimeout(
      page.evaluate(() => {
        const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const anchors = Array.from(document.querySelectorAll("a[href]"));

        return anchors
          .map((anchor) => {
            const title = clean(anchor.textContent);
            const href = anchor.href || "";
            let domain = "";

            try {
              domain = new URL(href).hostname.replace(/^www\./, "");
            } catch (error) {
              domain = "";
            }

            return {
              title,
              url: href,
              domain,
            };
          })
          .filter((item) => item.title.length >= 20 && item.title.length <= 180)
          .filter((item) => item.url.startsWith("http"))
          .filter((item) => !/google|accounts|policies|support/.test(item.domain))
          .slice(0, 80);
      }),
      LENS_TIMEOUT_MS,
      "Google Lens excedeu o timeout ao extrair resultados.",
    );

    const deduped = [];
    const seen = new Set();
    for (const item of rawCandidates) {
      const key = `${item.domain}|${normalizeText(item.title)}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push({
        ...item,
        score: scoreTitleSimilarity(fallbackTitle, item.title),
      });
    }

    const ranked = deduped
      .filter((item) => item.score >= 0.2)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);

    if (ranked.length) {
      log(
        "info",
        `Google Lens sugeriu ${ranked.length} candidatos visuais: ${ranked
          .map((item) => `${item.domain || "sem-dominio"} (${(item.score * 100).toFixed(0)}%)`)
          .join(", ")}`,
      );
    } else {
      log("warn", "Google Lens nao retornou candidatos visuais com similaridade suficiente.");
    }

    return ranked;
  } finally {
    await page.close().catch(() => {});
  }
}

async function dismissShopeeLoginWall(page) {
  const closeTargets = [
    page.locator(".shopee-popup__close-btn"),
    page.locator("[class*='shopee-popup__close-btn']"),
    page.locator("[aria-label='close']"),
    page.locator("button").filter({ hasText: /fechar|close|agora nao|mais tarde/i }),
  ];

  await page.keyboard.press("Escape").catch(() => {});
  for (const locator of closeTargets) {
    if (await locatorVisible(locator)) {
      await locator.first().click({ timeout: 2000 }).catch(() => {});
    }
  }
}

async function isShopeeLoginWall(page) {
  const url = normalizeText(page.url());
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));

  return (
    /shopee\.com\.br\/buyer\/login|shopee\.com\.br\/login/.test(url) ||
    /faca login|faça login|entre para continuar|cadastre se|sign up|log in|entrar|continuar com google/.test(
      bodyText,
    )
  );
}

async function searchMercadoLivreProductPage(url, context) {
  const page = await createFastPage(context);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const title =
        clean(document.querySelector("h1")?.textContent) ||
        clean(document.querySelector("meta[property='og:title']")?.getAttribute("content"));
      const fraction = clean(
        document.querySelector(
          ".andes-money-amount__fraction, .price-tag-fraction, .ui-pdp-price__second-line .andes-money-amount__fraction",
        )?.textContent,
      );
      const cents = clean(
        document.querySelector(".andes-money-amount__cents")?.textContent,
      );
      const priceText = fraction ? (cents ? `${fraction},${cents}` : fraction) : "";

      return {
        source: "Mercado Livre",
        title,
        priceText,
        url: location.href,
      };
    });

    const price = parseCurrency(data.priceText);
    if (!Number.isFinite(price)) {
      throw new Error("Preço não identificado na página direta do Mercado Livre.");
    }

    return { ...data, price };
  } finally {
    await page.close().catch(() => {});
  }
}

async function searchShopeeProductPage(url, context) {
  const page = await createInteractivePage(context);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await dismissShopeeLoginWall(page);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    if (await isShopeeLoginWall(page)) {
      throw new Error("Shopee exibiu login wall na página direta do produto.");
    }

    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    if (/captcha|cloudflare|verifique se voce e humano/.test(bodyText)) {
      throw new Error("Shopee bloqueou a página direta com Cloudflare/captcha.");
    }

    const data = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const metaTitle = clean(document.querySelector("meta[property='og:title']")?.getAttribute("content"));
      const metaPrice = clean(document.querySelector("meta[property='product:price:amount']")?.getAttribute("content"));
      const h1Title = clean(document.querySelector("h1")?.textContent);
      const bodyPriceMatch = clean(document.body.innerText).match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/);

      return {
        source: "Shopee",
        title: h1Title || metaTitle,
        priceText: metaPrice || (bodyPriceMatch ? bodyPriceMatch[0] : ""),
        url: location.href,
      };
    });

    const price = parseCurrency(data.priceText);
    if (!Number.isFinite(price)) {
      throw new Error("Preço não identificado na página direta da Shopee.");
    }

    return { ...data, price };
  } finally {
    await page.close().catch(() => {});
  }
}

async function searchSupplierByLensCandidate(candidate, context) {
  if (/mercadolivre\.com\.br/.test(candidate.domain || "")) {
    return searchMercadoLivreProductPage(candidate.url, context);
  }

  if (/shopee\.com\.br/.test(candidate.domain || "")) {
    return searchShopeeProductPage(candidate.url, context);
  }

  throw new Error("Marketplace do candidato do Lens não suportado.");
}

async function searchMercadoLivre(query, context) {
  const page = await createFastPage(context);
  try {
    const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await maybeWaitForResults(page, ".ui-search-result, .poly-card");

    const results = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const cards = Array.from(document.querySelectorAll(".ui-search-result, .poly-card")).slice(0, 10);

      return cards.map((card) => {
        const priceText = clean(
          card.querySelector(
            ".ui-search-price__second-line .andes-money-amount__fraction, .andes-money-amount__fraction, .price-tag-fraction, .poly-price__current .andes-money-amount__fraction",
          )?.textContent,
        );
        const cents = clean(
          card.querySelector(
            ".ui-search-price__second-line .andes-money-amount__cents, .andes-money-amount__cents",
          )?.textContent,
        );
        const price = cents ? `${priceText},${cents}` : priceText;
        const title = clean(
          card.querySelector("h2, .poly-component__title, .ui-search-item__title")?.textContent,
        );
        const href = card.querySelector("a[href]")?.href || "";

        return {
          source: "Mercado Livre",
          title,
          priceText: price,
          url: href ? new URL(href, location.origin).href : "",
        };
      });
    });

    const parsed = results
      .map((item) => ({ ...item, price: parseCurrency(item.priceText) }))
      .filter((item) => Number.isFinite(item.price));

    if (!parsed.length) {
      throw new Error("Nenhum preco valido encontrado no Mercado Livre.");
    }

    return parsed.sort((left, right) => left.price - right.price)[0];
  } finally {
    await page.close().catch(() => {});
  }
}

async function searchShopee(query, context) {
  const page = await createFastPage(context);
  try {
    const url = `https://shopee.com.br/search?keyword=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    await dismissShopeeLoginWall(page);
    await maybeWaitForResults(page, "[data-sqe='item'], .shopee-search-item-result__item");

    if (await isShopeeLoginWall(page)) {
      throw new Error("Shopee abriu apenas a tela de login.");
    }

    const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
    if (/captcha|cloudflare|verifique se voce e humano/.test(bodyText)) {
      throw new Error("Shopee bloqueou a busca com Cloudflare/captcha.");
    }

    const results = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const cards = Array.from(
        document.querySelectorAll("[data-sqe='item'], .shopee-search-item-result__item"),
      ).slice(0, 10);

      return cards.map((card) => {
        const rawText = clean(card.innerText);
        const priceMatch = rawText.match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/g);
        const title = clean(
          card.querySelector("[data-sqe='name'], [data-sqe='name'] *")?.textContent || rawText,
        );
        const href = card.querySelector("a[href]")?.href || "";

        return {
          source: "Shopee",
          title,
          priceText: priceMatch ? priceMatch[0] : "",
          url: href ? new URL(href, location.origin).href : "",
        };
      });
    });

    const parsed = results
      .map((item) => ({ ...item, price: parseCurrency(item.priceText) }))
      .filter((item) => Number.isFinite(item.price));

    if (!parsed.length) {
      throw new Error("Nenhum preco valido encontrado na Shopee.");
    }

    return parsed.sort((left, right) => left.price - right.price)[0];
  } finally {
    await page.close().catch(() => {});
  }
}

async function searchSuppliers(product, context) {
  const lensCandidates = await searchGoogleLensCandidates(
    product.mainImageUrl,
    product.title,
    context,
  ).catch((error) => {
    log("warn", `Google Lens indisponivel: ${error.message}`);
    return [];
  });

  const marketplaceCandidates = extractMarketplaceCandidatesFromLens(lensCandidates).slice(0, 4);
  if (marketplaceCandidates.length) {
    log(
      "step",
      `Validando ${marketplaceCandidates.length} links diretos de marketplace retornados pelo Google Lens`,
    );

    const directSettled = await Promise.allSettled(
      marketplaceCandidates.map((candidate) => searchSupplierByLensCandidate(candidate, context)),
    );
    const directResults = [];

    directSettled.forEach((result, index) => {
      const candidate = marketplaceCandidates[index];
      if (result.status === "fulfilled" && result.value?.price) {
        directResults.push({
          ...result.value,
          query: candidate.title,
          origin: "lens-direct",
        });
        log(
          "info",
          `${result.value.source} retornou ${formatCurrency(result.value.price)} via link direto do Lens`,
        );
        return;
      }

      const reason = result.status === "rejected" ? result.reason?.message : "Falha desconhecida";
      log("warn", `Link direto do Lens falhou para ${candidate.domain}: ${reason}`);
    });

    if (directResults.length) {
      const supplier = directResults.sort((left, right) => left.price - right.price)[0];
      log("success", `Menor custo direto via Lens: ${supplier.source} por ${formatCurrency(supplier.price)}`);
      return {
        lowestCost: supplier.price,
        supplier,
        results: directResults,
      };
    }
  }

  const queries = buildSupplierQueriesFromLens(product.title, lensCandidates);
  if (!queries.length) {
    return { lowestCost: null, supplier: null, results: [] };
  }

  const supplierResults = [];
  for (const query of queries) {
    log("step", `Buscando fornecedor em tempo real para "${query}"`);

    const providers = [
      {
        name: "Mercado Livre",
        task: searchMercadoLivre(query, context),
      },
    ];

    const settled = await Promise.allSettled(providers.map((provider) => provider.task));
    settled.forEach((result, index) => {
      const providerName = providers[index].name;
      if (result.status === "fulfilled" && result.value?.price) {
        supplierResults.push({ ...result.value, query });
        log("info", `${providerName} retornou ${formatCurrency(result.value.price)} via "${query}"`);
        return;
      }

      const reason = result.status === "rejected" ? result.reason?.message : "Falha desconhecida";
      log("warn", `${providerName} indisponivel em "${query}": ${reason}`);
    });

    if (supplierResults.length) {
      break;
    }
  }

  if (!supplierResults.length) {
    return { lowestCost: null, supplier: null, results: [] };
  }

  const supplier = supplierResults.sort((left, right) => left.price - right.price)[0];
  log("success", `Menor custo encontrado: ${supplier.source} por ${formatCurrency(supplier.price)}`);

  return {
    lowestCost: supplier.price,
    supplier,
    results: supplierResults,
  };
}

async function locatorExists(locator) {
  return (await locator.count().catch(() => 0)) > 0;
}

async function locatorVisible(locator) {
  if (!(await locatorExists(locator))) {
    return false;
  }
  return locator.first().isVisible().catch(() => false);
}

async function hasApprovalRequest(page) {
  const approvalText = page.getByText(/Solicitar Aprovação|Request Approval/i).first();
  return locatorVisible(approvalText);
}

async function hasApprovalRequest(page) {
  const approvalText = page
    .getByText(
      /Solicitar AprovaÃ§Ã£o|Solicitar Aprovação|Request Approval|Apply to sell|AprovaÃ§Ã£o necessÃ¡ria|Aprovação necessária|precisa de aprovaÃ§Ã£o|precisa de aprovação/i,
    )
    .first();
  return locatorVisible(approvalText);
}

async function hasApprovalRequest(page) {
  const currentUrl = normalizeText(page.url());
  if (/approvalrequest\/restrictions\/approve/.test(currentUrl)) {
    return true;
  }

  const approvalText = page
    .getByText(
      /Solicitar AprovaÃƒÂ§ÃƒÂ£o|Solicitar AprovaÃ§Ã£o|Request Approval|Apply to sell|AprovaÃƒÂ§ÃƒÂ£o necessÃƒÂ¡ria|AprovaÃ§Ã£o necessÃ¡ria|precisa de aprovaÃƒÂ§ÃƒÂ£o|precisa de aprovaÃ§Ã£o/i,
    )
    .first();
  return locatorVisible(approvalText);
}

async function hasApprovalRequest(page) {
  const currentUrl = normalizeText(page.url());
  if (/approvalrequest\/restrictions\/approve/.test(currentUrl)) {
    return true;
  }

  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  if (
    /solicitar aprovacao|request approval|apply to sell|aprovacao necessaria|precisa de aprovacao|restricoes de venda|requer aprovacao/.test(
      bodyText,
    )
  ) {
    return true;
  }

  const approvalText = page
    .getByText(
      /Solicitar AprovaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o|Solicitar AprovaÃƒÂ§ÃƒÂ£o|Solicitar AprovaÃ§Ã£o|Request Approval|Apply to sell|AprovaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o necessÃƒÆ’Ã‚Â¡ria|AprovaÃƒÂ§ÃƒÂ£o necessÃƒÂ¡ria|AprovaÃ§Ã£o necessÃ¡ria|precisa de aprovaÃƒÆ’Ã‚Â§ÃƒÆ’Ã‚Â£o|precisa de aprovaÃƒÂ§ÃƒÂ£o|precisa de aprovacao/i,
    )
    .first();
  return locatorVisible(approvalText);
}

async function isSellerCentralLoginPage(page) {
  const loginLocators = [
    page.locator("#ap_email"),
    page.locator("input[name='email']"),
    page.locator("input[type='password']"),
    page.locator("#signInSubmit"),
    page.locator("#auth-mfa-otpcode"),
    page.locator("input[name='otpCode']"),
    page.locator("input[name='code']"),
    page.locator("input[autocomplete='one-time-code']"),
    page.locator("input[inputmode='numeric']"),
  ];

  for (const locator of loginLocators) {
    if (await locatorVisible(locator)) {
      return true;
    }
  }

  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  return (
    /signin|login|ap\/signin/.test(page.url()) ||
    /authentication code|authenticator|two-step verification|verificacao em duas etapas|verificação em duas etapas|codigo de seguranca|código de segurança|codigo de autenticacao|código de autenticação|insira o codigo|insira o código/.test(
      bodyText,
    )
  );
}

async function waitForManualSellerCentralLogin(page, timeoutMs = SELLER_LOGIN_WAIT_MS) {
  if (HEADLESS_MODE) {
    return false;
  }

  log(
    "warn",
    `Seller Central exige login manual. Faça o login na janela aberta em até ${Math.round(
      timeoutMs / 1000,
    )}s.`,
  );

  const deadline = Date.now() + timeoutMs;
  let stableChecks = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});

    if (!(await isSellerCentralLoginPage(page))) {
      stableChecks += 1;
      if (stableChecks < 3) {
        continue;
      }

      log("success", "Sessão do Seller Central detectada no perfil persistente.");
      return true;
    }

    stableChecks = 0;
  }

  return false;
}

async function prepareSellerCentralSession(page) {
  log("step", "Preparando a sessão do Seller Central antes de iniciar a esteira");
  const bootstrapUrl = `${SELLER_CENTRAL_BASE_URL}/product-search/keywords/search?q=${encodeURIComponent(
    SELLER_CENTRAL_BOOTSTRAP_QUERY,
  )}`;
  await page.goto(bootstrapUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  if (!(await isSellerCentralLoginPage(page))) {
    log("success", "Seller Central já estava autenticado no perfil persistente.");
    return true;
  }

  const deadline = Date.now() + SELLER_LOGIN_WAIT_MS;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const authenticated = await waitForManualSellerCentralLogin(page, remainingMs);
    if (!authenticated) {
      log("error", "Não foi possível autenticar o Seller Central antes de iniciar a esteira.");
      return false;
    }

    await page.goto(bootstrapUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    if (!(await isSellerCentralLoginPage(page))) {
      log("success", "Sessão do Seller Central consolidada no product-search.");
      return true;
    }

    log(
      "warn",
      "O login ainda não consolidou no product-search. Termine o authenticator e qualquer etapa extra na mesma aba.",
    );
  }

  log("error", "A sessão do Seller Central não consolidou dentro do tempo configurado.");
  return false;
}

async function clickFirstVisibleLocator(locators) {
  for (const locator of locators) {
    if (await locatorVisible(locator)) {
      await locator.first().click({ timeout: 10000 });
      return true;
    }
  }

  return false;
}

function getSellButtonLocators(page) {
  return [
    page.locator("#sell-this-product"),
    page.locator("[data-testid='sell-this-product']"),
    page.locator("[data-test-id='sell-this-product']"),
    page.getByRole("button", { name: /vender este produto|sell this product/i }),
    page.locator("kat-button[id='sell-this-product']"),
  ];
}

async function hasSellButton(page) {
  const sellButtonCandidates = getSellButtonLocators(page);
  return Promise.all(sellButtonCandidates.map((locator) => locatorVisible(locator))).then((results) =>
    results.some(Boolean),
  );
}

async function getPageBodySnapshot(page) {
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));
  return bodyText.slice(0, 4000);
}

async function detectPostClickListingSurface(page, beforeUrl, beforeBodySnapshot, beforePageCount) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const contextPages = page.context().pages();
  const latestPage = contextPages[contextPages.length - 1];

  if (contextPages.length > beforePageCount && latestPage && latestPage !== page) {
    await latestPage.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await latestPage.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    return {
      opened: true,
      targetPage: latestPage,
      reason: "Nova guia aberta após clicar em vender produto",
    };
  }

  if (normalizeText(page.url()) !== normalizeText(beforeUrl)) {
    return {
      opened: true,
      targetPage: page,
      reason: "A mesma aba navegou para outra URL após clicar em vender produto",
    };
  }

  const afterBodySnapshot = await getPageBodySnapshot(page);
  const sellButtonStillVisible = await hasSellButton(page);
  if (!sellButtonStillVisible && afterBodySnapshot !== beforeBodySnapshot) {
    return {
      opened: true,
      targetPage: page,
      reason: "A mesma aba trocou de superfície após clicar em vender produto",
    };
  }

  return {
    opened: false,
    targetPage: page,
    reason: "Clique em vender produto não abriu nova página",
  };
}

async function closeExtraSellerPage(basePage, candidatePage) {
  if (!candidatePage || candidatePage.isClosed()) {
    return;
  }

  if (candidatePage === basePage) {
    await openSellerCentralProductSearch(basePage, SELLER_CENTRAL_BOOTSTRAP_QUERY).catch(() => {});
    return;
  }

  await candidatePage.close().catch(() => {});
  if (!SUPPRESS_BROWSER_FOCUS) {
    await basePage?.bringToFront().catch(() => {});
  }
}

function hasStatusCodeEndingWith86(status) {
  const codes = String(status || "").match(/\d+/g) || [];
  return codes.some((code) => code.endsWith("86"));
}

function shouldKeepInventoryPageOpen(status) {
  return KEEP_INVENTORY_PAGES_OPEN && !hasStatusCodeEndingWith86(status) && isManualReviewCandidateStatus(status);
}

async function retainListingPageForManualReview({ sellerState, context, listingPage, product, status }) {
  if (!listingPage || listingPage.isClosed() || !shouldKeepInventoryPageOpen(status)) {
    return false;
  }

  sellerState.hasRetainedListingPages = true;

  if (sellerState.page === listingPage) {
    sellerState.page = await createInteractivePage(context);
    log(
      "info",
      `Nova aba do Seller Central criada para continuar a mineracao enquanto o cadastro de ${product.asin} permanece aberto.`,
    );
  }

  log("warn", `Pagina de cadastro mantida aberta para revisao manual do ASIN ${product.asin}: ${status}`);
  return true;
}

function shouldRetainBrowserForManualReview(sellerState) {
  return !HEADLESS_MODE && Boolean(sellerState?.hasRetainedListingPages);
}

async function ensureActiveSellerPage(sellerState, context) {
  if (sellerState?.page && !sellerState.page.isClosed()) {
    return sellerState.page;
  }

  sellerState.page = await createInteractivePage(context);
  log("warn", "A aba principal do Seller Central foi recriada para continuar a mineracao.");
  return sellerState.page;
}

async function openSellerCentralProductSearch(page, asin) {
  const url = `${SELLER_CENTRAL_BASE_URL}/product-search/keywords/search?q=${encodeURIComponent(asin)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

  if (await isSellerCentralLoginPage(page)) {
    const authenticated = await waitForManualSellerCentralLogin(page);
    if (!authenticated) {
      return {
        ok: false,
        status: HEADLESS_MODE
          ? "Seller Central sem login"
          : "Login manual expirado no Seller Central",
      };
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  }

  return { ok: true, status: "Sessão autenticada no Seller Central" };
}

async function selectNewCondition(page) {
  const dropdown = page.locator("kat-dropdown").first();
  if (!(await locatorExists(dropdown))) {
    return false;
  }

  await dropdown.click({ timeout: 10000 });
  await page.waitForTimeout(800);

  const targetedSelectors = ["new", "new_new", "11"].map((value) =>
    page.locator(`kat-option[value="${value}"]`).first(),
  );

  if (await clickFirstVisibleLocator(targetedSelectors)) {
    return true;
  }

  const fallbackOption = page.locator("kat-option").filter({ hasText: /novo|new/i }).first();
  if (await locatorVisible(fallbackOption)) {
    await fallbackOption.click({ timeout: 5000 });
    return true;
  }

  return false;
}

async function canSellThisAsin(page) {
  if (await hasApprovalRequest(page)) {
    log("info", "ASIN requer autorizacao de marca (detectado antes da condicao)");
    return {
      isOpen: false,
      status: "Requer Autorização de Marca",
    };
  }

  const newConditionSelected = await selectNewCondition(page);
  if (!newConditionSelected) {
    log("info", "Condicao 'Novo' nao encontrada ou dropdown kat-dropdown indisponivel");
    return {
      isOpen: false,
      status: "Condição Novo não encontrada",
    };
  }

  await page.waitForTimeout(1200);

  if (await hasApprovalRequest(page)) {
    log("info", "ASIN requer autorizacao de marca (detectado apos selecionar Novo)");
    return {
      isOpen: false,
      status: "Requer Autorização de Marca",
    };
  }

  if (!(await hasSellButton(page))) {
    log("info", "Botao 'Vender este produto' nao encontrado apos selecionar condicao Novo");
    return {
      isOpen: false,
      status: "ASIN não aberto para cadastro",
    };
  }

  return {
    isOpen: true,
    status: "ASIN aberto para cadastro",
  };
}

async function detectSellerCentralBlockingError(page) {
  const currentUrl = normalizeText(page.url());
  const bodyText = normalizeText(await page.locator("body").innerText().catch(() => ""));

  if (/\b56\b/.test(currentUrl) || /\b56\b/.test(bodyText)) {
    return "Erro 56 no Seller Central";
  }

  if (/\b86\b/.test(currentUrl) || /\b86\b/.test(bodyText)) {
    return "Erro 86 no Seller Central";
  }

  if (
    /\b5886\b/.test(currentUrl) ||
    /\b5886\b/.test(bodyText) ||
    /codigo asin generico restrito|código asin genérico restrito|criar novo produto|genericos restritos|genéricos restritos/.test(
      bodyText,
    )
  ) {
    return "Erro 5886 no Seller Central";
  }

  return null;
}

async function detectSellerCentralBlockingErrorWithRetry(page) {
  const immediateError = await detectSellerCentralBlockingError(page);
  if (immediateError) {
    return immediateError;
  }

  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500).catch(() => {});
  return detectSellerCentralBlockingError(page);
}

async function setKatInputValue(page, hostId, value) {
  const field = page.locator(`[id="${hostId}"]`).first();
  if (!(await locatorExists(field))) {
    return false;
  }

  await field.evaluate((host, inputValue) => {
    const input = host.shadowRoot?.querySelector("input, textarea");
    if (!input) {
      throw new Error(`Campo ${host.id || "sem-id"} sem input interno.`);
    }

    input.value = String(inputValue);
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    host.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    host.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }, String(value));

  return true;
}

async function ensureMerchantFulfilledChannel(page) {
  const channelInput = page
    .locator("input[name='medeaForm-fulfillment_availability-0-fulfillment_channel_code'][value='DEFAULT']")
    .first();

  if (!(await locatorExists(channelInput))) {
    return true;
  }

  await channelInput.evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  });

  return true;
}

async function getSellerOfferMessages(page) {
  return page.evaluate(() => {
    const selectors = [
      "[role='alert']",
      "kat-alert",
      "kat-toast",
      "kat-toast-group",
      "[data-testid*='error']",
      "[data-testid*='Error']",
      "[data-testid*='alert']",
      "[data-testid*='Alert']",
      "[data-testid*='toast']",
      "[data-testid*='Toast']",
      "[aria-invalid='true']",
    ];

    const values = [];
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        if (text) {
          values.push(text);
        }
      }
    }

    return Array.from(new Set(values)).slice(0, 8);
  });
}

function extractSellerOfferIssue(bodyText, messages) {
  const combinedText = normalizeText([bodyText, ...(messages || [])].join(" | "));
  const knownIssues = [
    [/sku.+(ja existe|já existe|duplicad)/, "SKU ja existe no Seller Central"],
    [/ja possui uma oferta|já possui uma oferta|already selling|already have an offer/, "Oferta ja existe para este ASIN"],
    [/corrija os erros|corrija os campos|fix the errors|required field|campo obrigatorio|campo obrigatório/, "Seller Central recusou o formulario por validacao"],
    [/nao foi possivel enviar|não foi possível enviar|erro ao enviar|submission failed|unexpected error/, "Seller Central rejeitou o envio da oferta"],
    [/preco padrao.+(obrigatorio|required)|price.+(required|mandatory)/, "Preco padrao obrigatorio"],
    [/sku.+(obrigatorio|required)/, "SKU obrigatorio"],
    [/codigo do canal de processamento.+(obrigatorio|required)/, "Canal de processamento obrigatorio"],
    [/faca login|faça login|authenticator|verificacao em duas etapas|verificação em duas etapas/, "Sessao do Seller Central expirou"],
  ];

  for (const [pattern, message] of knownIssues) {
    if (pattern.test(combinedText)) {
      return message;
    }
  }

  return null;
}

function hasSellerOfferSuccessSignal(url, bodyText, messages) {
  const normalizedUrl = normalizeText(url);
  const normalizedText = normalizeText([bodyText, ...(messages || [])].join(" | "));

  if (!/interactive\/listing\/workflow\/offer\/offer/.test(normalizedUrl)) {
    return true;
  }

  return /oferta enviada|oferta criada|oferta salva|oferta publicada|cadastro concluido|cadastro concluído|gerenciar estoque|manage inventory|editar oferta|edit listing/.test(
    normalizedText,
  );
}

async function attemptSellerCentralOfferSubmission(page, product) {
  const listingPrice = calculateTargetListingPrice(product.amazonPrice);
  if (!Number.isFinite(listingPrice)) {
    return {
      ok: false,
      sku: "",
      listingPrice: null,
      status: "Preco de cadastro invalido",
    };
  }

  const sku = buildSellerSku(product);
  try {
    // await page.bringToFront().catch(() => {});
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    if (await isSellerCentralLoginPage(page)) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: "Sessao do Seller Central expirou",
      };
    }

    if (await hasApprovalRequest(page)) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: "Requer Autorizacao de Marca",
      };
    }

    const blockingError = await detectSellerCentralBlockingError(page);
    if (blockingError) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: blockingError,
      };
    }

    const skuFilled = await setKatInputValue(page, "contribution_sku-0-value", sku);
    if (!skuFilled) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: "Campo SKU nao encontrado",
      };
    }

    const priceFilled = await setKatInputValue(
      page,
      "purchasable_offer[audience=ALL]-0-our_price-0-schedule-0-value_with_tax",
      formatSellerPrice(listingPrice),
    );
    if (!priceFilled) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: "Campo de preco nao encontrado",
      };
    }

    await ensureMerchantFulfilledChannel(page);
    await page.waitForTimeout(800);

    const submitButton = page.locator("#form-submit-button").first();
    if (!(await locatorVisible(submitButton))) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: "Botao Enviar nao encontrado na tela de oferta",
      };
    }

    const beforeUrl = page.url();
    const responsePromise = page
      .waitForResponse(
        (response) => {
          const request = response.request();
          const postData = request.postData() || "";
          return (
            request.method() !== "GET" &&
            /sellercentral\.amazon\.com\.br/i.test(response.url()) &&
            !/metrics|telemetry|analytics|batched\/get/i.test(response.url()) &&
            (/offer|listing|submission|save/i.test(response.url()) ||
              /contribution_sku-0-value|our_price-0-schedule-0-value_with_tax/i.test(postData))
          );
        },
        { timeout: 15000 },
      )
      .catch(() => null);
    const urlChangePromise = page
      .waitForURL((url) => normalizeText(url.toString()) !== normalizeText(beforeUrl), { timeout: 15000 })
      .catch(() => null);

    await submitButton.click({ timeout: 10000 });
    const [submissionResponse] = await Promise.all([responsePromise, urlChangePromise]);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1800);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const messages = await getSellerOfferMessages(page);
    const issue = extractSellerOfferIssue(bodyText, messages);
    if (issue) {
      return {
        ok: false,
        sku,
        listingPrice,
        status: issue,
      };
    }

    if (hasSellerOfferSuccessSignal(page.url(), bodyText, messages)) {
      const responseSuffix = submissionResponse ? ` | HTTP ${submissionResponse.status()}` : "";
      return {
        ok: true,
        sku,
        listingPrice,
        status: `Cadastro enviado${responseSuffix}`,
      };
    }

    if (submissionResponse?.ok()) {
      return {
        ok: true,
        sku,
        listingPrice,
        status: `Cadastro submetido sem confirmacao explicita | HTTP ${submissionResponse.status()}`,
      };
    }

    return {
      ok: false,
      sku,
      listingPrice,
      status: "Seller Central nao confirmou o cadastro",
    };
  } catch (error) {
    return {
      ok: false,
      sku,
      listingPrice,
      status: `Falha no cadastro: ${error.message}`,
    };
  }
}

async function attemptSellerCentralListingGate(page, asin) {
  try {
    log("step", `Tentando adicionar o ASIN ${asin} no Seller Central antes de pesquisar fornecedor`);
    const opened = await openSellerCentralProductSearch(page, asin);
    if (!opened.ok) {
      return {
        canSource: false,
        status: opened.status,
        listingPage: null,
        keepPageOpen: false,
      };
    }

    const eligibility = await canSellThisAsin(page);
    if (!eligibility.isOpen) {
      return {
        canSource: false,
        status: eligibility.status,
        listingPage: null,
        keepPageOpen: false,
      };
    }

    const beforeUrl = page.url();
    const beforeBodySnapshot = await getPageBodySnapshot(page);
    const beforePageCount = page.context().pages().length;
    const clicked = await clickFirstVisibleLocator(getSellButtonLocators(page));
    if (!clicked) {
      return {
        canSource: false,
        status: "Botão sell-this-product não encontrado",
        listingPage: null,
        keepPageOpen: false,
      };
    }

    const transition = await detectPostClickListingSurface(
      page,
      beforeUrl,
      beforeBodySnapshot,
      beforePageCount,
    );
    const targetPage = transition.targetPage;

    if (await hasApprovalRequest(targetPage)) {
      const status = "Requer Autorização de Marca";
      const keepPageOpen = shouldKeepInventoryPageOpen(status);
      if (!keepPageOpen) {
        await closeExtraSellerPage(page, targetPage);
      }
      return {
        canSource: false,
        status,
        listingPage: keepPageOpen ? targetPage : null,
        keepPageOpen,
      };
    }

    const blockingError = await detectSellerCentralBlockingErrorWithRetry(targetPage);
    if (blockingError) {
      const keepPageOpen = shouldKeepInventoryPageOpen(blockingError);
      if (!keepPageOpen) {
        await closeExtraSellerPage(page, targetPage);
      }
      return {
        canSource: false,
        status: blockingError,
        listingPage: keepPageOpen ? targetPage : null,
        keepPageOpen,
      };
    }

    if (!transition.opened) {
      return {
        canSource: false,
        status: transition.reason,
        listingPage: null,
        keepPageOpen: false,
      };
    }

    await savePageArchive(targetPage, "OPEN_ASIN", asin);

    return {
      canSource: true,
      status: transition.reason,
      listingPage: targetPage,
      keepPageOpen: shouldKeepInventoryPageOpen(transition.reason),
    };
  } catch (error) {
    return {
      canSource: false,
      status: `Falha ao acionar vender produto: ${error.message}`,
      listingPage: null,
      keepPageOpen: false,
    };
  }
}

function getBrowserLaunchOptions() {
  const args = ["--disable-blink-features=AutomationControlled"];

  if (!HEADLESS_MODE) {
    if (CHROMIUM_WINDOW_MODE === "minimized") {
      args.push("--start-minimized");
    } else if (CHROMIUM_WINDOW_MODE === "background") {
      args.push("--window-size=1280,900", "--window-position=80,80");
    }
  }

  return {
    headless: HEADLESS_MODE,
    args,
  };
}

function getBrowserContextOptions(storageState) {
  const options = {
    locale: "pt-BR",
    timezoneId: "America/Manaus",
    viewport: { width: 1440, height: 960 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };

  if (storageState) {
    options.storageState = storageState;
  }

  return options;
}

function clearPersistentProfileLocks() {
  const candidateFiles = ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"];
  let removed = 0;

  for (const fileName of candidateFiles) {
    const filePath = path.join(PROFILE_DIR, fileName);
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        removed += 1;
      }
    } catch (error) {
      continue;
    }
  }

  return removed;
}

function archivePersistentProfileDir() {
  if (!fs.existsSync(PROFILE_DIR)) {
    return "";
  }

  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${PROFILE_DIR}-backup-${suffix}`;
  fs.renameSync(PROFILE_DIR, backupDir);
  return backupDir;
}

async function buildBrowserContext() {
  const launchOptions = {
    ...getBrowserLaunchOptions(),
    ...getBrowserContextOptions(),
  };

  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
  } catch (error) {
    const removedLocks = clearPersistentProfileLocks();
    if (!removedLocks) {
      throw error;
    }

    log(
      "warn",
      "Falha ao abrir o perfil persistente. Locks antigos foram removidos e a abertura sera tentada novamente.",
    );
    await sleep(1200);
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
    } catch (retryError) {
      const backupDir = archivePersistentProfileDir();
      if (!backupDir) {
        throw retryError;
      }

      log(
        "warn",
        `O perfil persistente anterior foi arquivado em ${backupDir}. Uma nova sessao do Seller Central sera criada neste ciclo.`,
      );
      return chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
    }
  }
}

async function buildWorkerBrowser(storageState) {
  const browser = await chromium.launch(getBrowserLaunchOptions());
  const context = await browser.newContext(getBrowserContextOptions(storageState));
  return { browser, context };
}

async function closeContextPages(context) {
  for (const page of context.pages()) {
    await page.close().catch(() => {});
  }
}

async function getReusableInspectionPage(context, inspectionPageRef) {
  if (!inspectionPageRef.page || inspectionPageRef.page.isClosed()) {
    inspectionPageRef.page = await createFastPage(context);
  }

  return inspectionPageRef.page;
}

async function processDiscoverySource({ source, mode, searchPage, inspectionPageRef, sellerState, context, seenAsins }) {
  let seeds = [];
  const sourceLabel =
    mode === "keyword"
      ? `keyword "${source}"`
      : mode === "asin"
        ? `asin "${source}"`
        : `origem "${source}"`;

  try {
    seeds =
      mode === "asin"
        ? searchAmazonByAsin(source)
        : mode === "keyword"
        ? await searchAmazonByKeyword(searchPage, source)
        : await searchAmazonPublicFeed(searchPage, source);
    log("info", `${sourceLabel} retornou ${seeds.length} candidatos iniciais`);
  } catch (error) {
    log("error", `Falha na mineracao da ${sourceLabel}: ${error.message}`);
    return;
  }

  let internationalSkips = 0;
  for (const seed of seeds) {
    if (internationalSkips >= MAX_INTERNATIONAL_SKIPS_PER_SOURCE) {
      log(
        "warn",
        `${sourceLabel} interrompida: ${internationalSkips} produto(s) internacional(is) detectado(s). Pulando para outra origem.`,
      );
      return;
    }

    try {
      const asinKey = normalizeAsin(seed.asin) || seed.url;
    if (seenAsins.has(asinKey)) {
      log("warn", `ASIN repetido ignorado: ${seed.asin || seed.url}`);
      continue;
    }
    seenAsins.add(asinKey);

    if (seed.asin && wasRecentlySeenAsin(seed.asin)) {
      log("warn", `ASIN recente ignorado para evitar repetir produto ja minerado: ${seed.asin}`);
      continue;
    }

    let product;
    const inspectionPage = await getReusableInspectionPage(context, inspectionPageRef);
    try {
      product = await inspectAmazonProduct(inspectionPage, seed);
    } catch (error) {
      log("error", `Falha ao abrir produto ${seed.asin || seed.url}: ${error.message}`);
      appendCsvRow({
        asin: seed.asin || "",
        title: seed.title || "",
        amazonPrice: formatCurrency(parseCurrency(seed.priceText)),
        lowestCost: "",
        marginPct: "",
        status: "Falha na Amazon pública",
      });
      if (isClosedTargetError(error)) {
        inspectionPageRef.page = null;
        log("warn", `Aba de inspecao foi recriada apos fechamento durante o ASIN ${seed.asin || seed.url}.`);
        continue;
      }
      continue;
    }

    rememberRecentAsin(product.asin, product.title);

    const rememberedSellerBlock = getRememberedSellerBlock(product);
    if (rememberedSellerBlock) {
      log(
        "warn",
        `ASIN ${product.asin} ignorado por historico de bloqueio no Seller Central: ${rememberedSellerBlock}`,
      );
      await sleep(randomBetween(600, 1200));
      continue;
    }

    if (!Number.isFinite(product.amazonPrice)) {
      log("warn", `ASIN ${product.asin} ignorado por preco Amazon indisponivel`);
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: "",
        lowestCost: "",
        marginPct: "",
        status: "Preço Amazon indisponível",
      });
      continue;
    }

    if (!isWithinAmazonPriceRange(product.amazonPrice)) {
      const skipReason = `Preco Amazon fora da faixa configurada (${describeAmazonPriceRange()})`;
      log(
        "warn",
        `ASIN ${product.asin} ignorado por ticket fora da faixa: ${formatCurrency(product.amazonPrice)} | ${describeAmazonPriceRange()}`,
      );
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: "",
        marginPct: "",
        status: skipReason,
      });
      continue;
    }

    if (product.isInternational) {
      internationalSkips += 1;
      const skipReason = `Ignorado por compra internacional/importacao${
        product.internationalSignals?.length ? ` (${product.internationalSignals.join(", ")})` : ""
      }`;
      log("warn", `ASIN ${product.asin} ignorado: ${skipReason}`);
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: "",
        marginPct: "",
        status: skipReason,
      });
      continue;
    }

    if (!product.potentiallyOpen) {
      const skipReason = product.officialStoreByline
        ? `Ignorado por loja oficial / marca forte (${product.bylineText || product.brandRaw || "sem marca"})`
        : "Ignorado por possível Private Label / vendedor único";
      log(
        "warn",
        `ASIN ${product.asin} ignorado: ${skipReason}`,
      );
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: "",
        marginPct: "",
        status: skipReason,
      });
      continue;
    }

    log(
      "success",
      `ASIN potencialmente aberto: ${product.asin} | ${product.title} | Amazon ${formatCurrency(product.amazonPrice)}`,
    );

    const activeSellerPage = await ensureActiveSellerPage(sellerState, context);
    const sellerGate = await attemptSellerCentralListingGate(activeSellerPage, product.asin);
    log("info", `Seller Central respondeu para ${product.asin}: ${sellerGate.status}`);

    if (!sellerGate.canSource) {
      rememberSellerBlock(product, sellerGate.status);
      if (sellerGate.keepPageOpen) {
        await retainListingPageForManualReview({
          sellerState,
          context,
          listingPage: sellerGate.listingPage,
          product,
          status: sellerGate.status,
        });
      }

      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: "",
        marginPct: "",
        status: sellerGate.status,
      });
      await sleep(randomBetween(800, 1600));
      continue;
    }

    const picPage = await createFastPage(context);
    try {
      await picPage.goto(product.url || `https://www.amazon.com.br/dp/${product.asin}`, { waitUntil: "domcontentloaded" });
      await savePageArchive(picPage, "OPEN_ASIN_AMZ_PRODUCT", product.asin);
    } catch (e) {
      log("warn", `Nao foi possivel salvar print do produto aberto: ${e.message}`);
    }
    await picPage.close().catch(() => {});

    if (!AUTO_SEARCH_SUPPLIERS) {
      const keptOpen = await retainListingPageForManualReview({
        sellerState,
        context,
        listingPage: sellerGate.listingPage,
        product,
        status: sellerGate.status,
      });
      if (!keptOpen) {
        await closeExtraSellerPage(sellerState.page, sellerGate.listingPage);
      }
      log(
        "success",
        keptOpen
          ? `ASIN ${product.asin} liberado no Seller Central; pagina de cadastro mantida aberta para sua revisao`
          : `ASIN ${product.asin} liberado no Seller Central; busca de fornecedor ficou para validacao manual`,
      );
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: "",
        marginPct: "",
        status: keptOpen
          ? `${sellerGate.status} / Pagina mantida aberta para busca manual`
          : `${sellerGate.status} / Buscar fornecedor manualmente`,
        approved: true,
      });
      await sleep(randomBetween(1200, 2200));
      continue;
    }

    log("step", `ASIN ${product.asin} liberado no Seller Central; iniciando busca de fornecedor`);
    const supplierSearch = await searchSuppliers(product, context);
    const { lowestCost } = supplierSearch;
    const { marginPct } = calculateMargin(product.amazonPrice, lowestCost);

    if (!Number.isFinite(lowestCost) || !Number.isFinite(marginPct) || marginPct < MIN_MARGIN) {
      await closeExtraSellerPage(sellerState.page, sellerGate.listingPage);
      log(
        "warn",
        `ASIN ${product.asin} reprovado por margem | custo ${formatCurrency(lowestCost)} | margem ${formatMargin(marginPct)}`,
      );
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: formatCurrency(lowestCost),
        marginPct: formatMargin(marginPct),
        status: `${sellerGate.status} / Reprovado por Margem`,
      });
      await sleep(randomBetween(1200, 2200));
      continue;
    }

    log(
      "success",
      `ASIN ${product.asin} aprovado | menor custo ${formatCurrency(lowestCost)} | margem ${formatMargin(marginPct)}`,
    );

    if (!AUTO_REGISTER_OPEN_ASINS) {
      await closeExtraSellerPage(sellerState.page, sellerGate.listingPage);
      appendCsvRow({
        asin: product.asin,
        title: product.title,
        amazonPrice: formatCurrency(product.amazonPrice),
        lowestCost: formatCurrency(lowestCost),
        marginPct: formatMargin(marginPct),
        status: `${sellerGate.status} / Cadastro automatico desabilitado`,
        approved: true,
      });
      await sleep(randomBetween(1200, 2500));
      continue;
    }

    log("step", `Tentando cadastrar ASIN ${product.asin} no Seller Central`);
    const registration = await attemptSellerCentralOfferSubmission(
      sellerGate.listingPage || sellerState.page,
      product,
    );
    await closeExtraSellerPage(sellerState.page, sellerGate.listingPage);

    appendCsvRow({
      asin: product.asin,
      title: product.title,
      amazonPrice: formatCurrency(product.amazonPrice),
      lowestCost: formatCurrency(lowestCost),
      marginPct: formatMargin(marginPct),
      status: registration.ok
        ? `${registration.status} | SKU ${registration.sku} | Preco ${formatCurrency(registration.listingPrice)}`
        : registration.status,
      approved: registration.ok,
    });

    if (registration.ok) {
      log(
        "success",
        `Cadastro enviado para ${product.asin} | SKU ${registration.sku} | Preco ${formatCurrency(registration.listingPrice)}`,
      );
    } else {
      rememberSellerBlock(product, registration.status);
      log("error", `Cadastro falhou para ${product.asin}: ${registration.status}`);
    }
      await sleep(randomBetween(1200, 2500));
    } catch (error) {
      log("error", `Falha ao processar ASIN ${seed.asin || seed.url}: ${error.message}`);
      if (isClosedTargetError(error)) {
        log("error", `Encerrando ${sourceLabel} porque o contexto do navegador foi fechado.`);
        return;
      }
    }
  }
}

async function bootstrapSellerCentralStorageState() {
  const context = await buildBrowserContext();

  try {
    const sellerPage = await createInteractivePage(context);
    const sellerCentralReady = await prepareSellerCentralSession(sellerPage);
    if (!sellerCentralReady) {
      throw new Error("Seller Central nao autenticado. Reexecute e conclua o login antes de fechar a janela.");
    }

    return await context.storageState();
  } finally {
    await closeContextPages(context);
    await context.close().catch(() => {});
  }
}

async function runWorker({ workerId, sources, mode, storageState, seenAsins }) {
  return workerLogScope.run(`W${workerId}`, async () => {
    log("info", `Worker iniciado com ${sources.length} origem(ns): ${describeWorkerSources(sources)}`);
    const { browser, context } = await buildWorkerBrowser(storageState);
    let sellerState = null;

    try {
      const sellerPage = await createInteractivePage(context);
      sellerState = { page: sellerPage, hasRetainedListingPages: false };
      const sellerCentralReady = await prepareSellerCentralSession(sellerPage);
      if (!sellerCentralReady) {
        throw new Error("Worker sem sessao autenticada no Seller Central.");
      }

      const searchPage = await createFastPage(context);
      const inspectionPageRef = { page: await createFastPage(context) };

      for (const source of sources) {
        await processDiscoverySource({
          source,
          mode,
          searchPage,
          inspectionPageRef,
          sellerState,
          context,
          seenAsins,
        });
        markSourceAsProcessed(mode, source);
      }

      log("success", `Worker finalizado com ${sources.length} origem(ns) processadas.`);
    } finally {
      if (shouldKeepBrowsersOpen() || shouldRetainBrowserForManualReview(sellerState)) {
        retainBrowserResource({ browser, context });
        log(
          "warn",
          shouldRetainBrowserForManualReview(sellerState)
            ? "Browser mantido aberto para preservar paginas de cadastro em revisao."
            : "Browser mantido aberto apos a execucao do worker.",
        );
      } else {
        await closeBrowserResource({ browser, context });
      }
    }
  });
}

async function runSequentialFlow({ discoverySources, discoveryMode }) {
  const context = await buildBrowserContext();
  let sellerState = null;

  try {
    const sellerPage = await createInteractivePage(context);
    sellerState = { page: sellerPage, hasRetainedListingPages: false };
    const sellerCentralReady = await prepareSellerCentralSession(sellerPage);
    if (!sellerCentralReady) {
      throw new Error("Seller Central nao autenticado. Reexecute e conclua o login antes de fechar a janela.");
    }

    const searchPage = await createFastPage(context);
    const inspectionPageRef = { page: await createFastPage(context) };
    const seenAsins = new Set();

    for (const source of discoverySources) {
      await processDiscoverySource({
        source,
        mode: discoveryMode,
        searchPage,
        inspectionPageRef,
        sellerState,
        context,
        seenAsins,
      });
      markSourceAsProcessed(discoveryMode, source);
    }
  } finally {
    if (shouldKeepBrowsersOpen() || shouldRetainBrowserForManualReview(sellerState)) {
      retainBrowserResource({ context });
      log(
        "warn",
        shouldRetainBrowserForManualReview(sellerState)
          ? "Browser persistente mantido aberto para preservar paginas de cadastro em revisao."
          : "Browser persistente mantido aberto apos a execucao.",
      );
    } else {
      await closeBrowserResource({ context });
    }
  }
}

async function runParallelFlow({ discoverySources, discoveryMode, workerCount }) {
  const workerBuckets = distributeSourcesAcrossWorkers(discoverySources, workerCount);
  log("info", `Paralelismo habilitado com ${workerBuckets.length} worker(s).`);

  const storageState = await bootstrapSellerCentralStorageState();
  const seenAsins = new Set();

  const results = await Promise.allSettled(
    workerBuckets.map((sources, index) =>
      runWorker({
        workerId: index + 1,
        sources,
        mode: discoveryMode,
        storageState,
        seenAsins,
      }),
    ),
  );

  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message || "Falha desconhecida");

  if (failures.length) {
    throw new Error(`${failures.length} worker(s) falharam: ${failures.join(" | ")}`);
  }
}

async function runPipelineOnce() {
  ensureCsvHeader();
  const { sources, mode: discoveryMode } = resolveDiscoveryConfig();
  const discoverySources = orderDiscoverySources(sources, discoveryMode);
  const workerPlan = resolveEffectiveWorkerCount(discoveryMode, discoverySources.length);

  log(
    "info",
    `Esteira iniciada em Manaus | perfil=${RUN_PROFILE} | headless=${HEADLESS_MODE} | margem minima=${MIN_MARGIN}% | faixaAmazon=${describeAmazonPriceRange()} | modo=${discoveryMode} | origens=${discoverySources.length} | resultados/termo=${DEFAULT_MAX_RESULTS} | buscaFornecedorAuto=${AUTO_SEARCH_SUPPLIERS} | manterPaginasInventario=${KEEP_INVENTORY_PAGES_OPEN} | csvSoAprovados=${CSV_ONLY_APPROVED_PRODUCTS} | maxPaginasFeed=${PUBLIC_FEED_MAX_PAGES} | variantesFeed=${PUBLIC_FEED_VARIANTS.join("+")} | consultas fornecedor=${MAX_SUPPLIER_QUERIES} | cadastroAuto=${AUTO_REGISTER_OPEN_ASINS} | fatorPreco=${LISTING_PRICE_FACTOR} | ajustePreco=${LISTING_PRICE_OFFSET}`,
  );
  log("info", `Janela Chromium: modo=${CHROMIUM_WINDOW_MODE} | evitarFoco=${SUPPRESS_BROWSER_FOCUS}`);
  log("info", `CSV desta execucao: ${OUTPUT_CSV}`);
  if (LOG_FILE) {
    log("info", `Log dedicado: ${LOG_FILE}`);
  }
  log("info", `Pool de candidatos por pagina: ${DISCOVERY_CANDIDATE_POOL_SIZE} | janela anti-repeticao: ${RECENT_ASIN_TTL_HOURS}h`);

  log("info", `Workers configurados: ${workerPlan.requested}`);
  if (workerPlan.reason) {
    log("warn", workerPlan.reason);
  }

  if (workerPlan.effective <= 1 || discoverySources.length <= 1) {
    await runSequentialFlow({ discoverySources, discoveryMode });
    log("success", `Esteira finalizada. CSV salvo em ${OUTPUT_CSV}`);
    if (shouldKeepBrowsersOpen() && retainedBrowserResources.length) {
      log("warn", "Browsers mantidos abertos. Encerre o processo manualmente quando terminar.");
      await new Promise(() => {});
    }
    return;
  }

  await runParallelFlow({
    discoverySources,
    discoveryMode,
    workerCount: workerPlan.effective,
  });
  log("success", `Esteira finalizada. CSV salvo em ${OUTPUT_CSV}`);
  if (shouldKeepBrowsersOpen() && retainedBrowserResources.length) {
    log("warn", "Browsers mantidos abertos. Encerre o processo manualmente quando terminar.");
    await new Promise(() => {});
  }
  return;
}

async function runIntermittentLoop() {
  const maxCyclesLabel = Number.isFinite(INTERMITTENT_MAX_CYCLES)
    ? String(INTERMITTENT_MAX_CYCLES)
    : "infinito";
  log(
    "warn",
    `Modo intermitente ativo | intervalo=${formatDuration(INTERMITTENT_INTERVAL_MS)} | maxCiclos=${maxCyclesLabel}`,
  );

  if (KEEP_BROWSER_OPEN && !HEADLESS_MODE) {
    log(
      "warn",
      "KEEP_BROWSER_OPEN foi ignorado no modo intermitente para permitir novos ciclos automaticamente.",
    );
  }

  let cycle = 0;
  while (cycle < INTERMITTENT_MAX_CYCLES) {
    cycle += 1;
    log("info", `Iniciando ciclo ${cycle}`);

    try {
      await runPipelineOnce();
      log("success", `Ciclo ${cycle} concluido.`);
    } catch (error) {
      log("error", `Ciclo ${cycle} falhou: ${error.message}`);
    }

    if (cycle >= INTERMITTENT_MAX_CYCLES) {
      break;
    }

    log("info", `Aguardando ${formatDuration(INTERMITTENT_INTERVAL_MS)} antes do proximo ciclo.`);
    await sleep(INTERMITTENT_INTERVAL_MS);
  }
}

async function main() {
  acquireRuntimeLock();

  if (INTERMITTENT_MODE) {
    await runIntermittentLoop();
    return;
  }

  await runPipelineOnce();
}

process.once("exit", releaseRuntimeLock);
process.once("SIGINT", () => {
  releaseRuntimeLock();
  process.exit(130);
});
process.once("SIGTERM", () => {
  releaseRuntimeLock();
  process.exit(143);
});

main().catch((error) => {
  log("error", error.message);
  process.exitCode = 1;
});
