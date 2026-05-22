const fs = require("fs");
const path = require("path");
const readline = require("readline");
const dotenv = require("dotenv");

dotenv.config();

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error("Dependencia ausente: rode npm i antes de executar.");
  process.exit(1);
}

const SELLER_CENTRAL_BASE_URL =
  process.env.SELLER_CENTRAL_BASE_URL || "https://sellercentral.amazon.com.br";
const DEFAULT_ORDERS_URL =
  process.env.AMAZON_ORDERS_URL || `${SELLER_CENTRAL_BASE_URL}/orders-v3/mfn/shipped`;
const PROFILE_DIR = path.resolve(
  process.cwd(),
  process.env.PROFILE_DIR || ".playwright-amazon-profile",
);
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || "outputs");
const HEADLESS_MODE = parseBoolean(process.env.HEADLESS_MODE, false);
const KEEP_BROWSER_OPEN = parseBoolean(process.env.KEEP_BROWSER_OPEN, true);
const CHROMIUM_WINDOW_MODE = normalizeWindowMode(
  process.env.CHROMIUM_WINDOW_MODE || process.env.BROWSER_WINDOW_MODE || "background",
);

const ORDER_ID_RE = /\b\d{3}-\d{7}-\d{7}\b/g;
const ORDER_ID_EXACT_RE = /^\d{3}-\d{7}-\d{7}$/;
const DEFAULT_LIMIT = parsePositiveInt(process.env.AMAZON_ORDERS_LIMIT, 200);
const DEFAULT_PAGES = parsePositiveInt(process.env.AMAZON_ORDERS_PAGES, 10);
const ORDER_COLUMNS = [
  { key: "pedido", label: "Pedido", width: 135 },
  { key: "data_pedido", label: "Data pedido", width: 95 },
  { key: "status", label: "Status", width: 120 },
  { key: "cliente", label: "Cliente", width: 190 },
  { key: "telefone", label: "Telefone", width: 115 },
  { key: "email", label: "Email", width: 180 },
  { key: "endereco_envio", label: "Endereco envio", width: 360 },
  { key: "valor", label: "Valor", width: 85 },
  { key: "itens", label: "Itens", width: 420 },
  { key: "url", label: "Link Amazon", width: 260 },
  { key: "erro", label: "Erro", width: 260 },
];

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "sim", "s", "on"].includes(String(value).trim().toLowerCase());
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeWindowMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["background", "minimized", "normal"].includes(normalized)) return normalized;
  return "background";
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

function parseArgs(argv) {
  const options = {
    url: DEFAULT_ORDERS_URL,
    limit: DEFAULT_LIMIT,
    pages: DEFAULT_PAGES,
    output: "",
    manual: false,
    keepOpen: KEEP_BROWSER_OPEN,
    waitMs: parsePositiveInt(process.env.AMAZON_ORDERS_WAIT_MS, 0),
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--manual") {
      options.manual = true;
    } else if (arg === "--no-keep-open") {
      options.keepOpen = false;
    } else if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length).trim() || options.url;
    } else if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInt(arg.slice("--limit=".length), options.limit);
    } else if (arg.startsWith("--pages=")) {
      options.pages = parsePositiveInt(arg.slice("--pages=".length), options.pages);
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length).trim();
    } else if (arg.startsWith("--wait-ms=")) {
      options.waitMs = parsePositiveInt(arg.slice("--wait-ms=".length), options.waitMs);
    }
  }

  if (!options.output) {
    options.output = path.join(OUTPUT_DIR, `amazon_pedidos_enviados_${timestamp()}.csv`);
  } else {
    options.output = path.resolve(process.cwd(), options.output);
  }

  return options;
}

function printHelp() {
  console.log(`Uso:
  npm run export:amazon-orders
  npm run export:amazon-orders -- --limit=200 --pages=10
  npm run export:amazon-orders -- --manual
  npm run export:amazon-orders -- --wait-ms=180000
  npm run export:amazon-orders -- --url=https://sellercentral.amazon.com.br/orders-v3/mfn/shipped

Variaveis uteis no .env:
  AMAZON_ORDERS_URL       URL inicial do painel de pedidos enviados
  AMAZON_ORDERS_LIMIT     Maximo de pedidos por execucao
  AMAZON_ORDERS_PAGES     Maximo de paginas do painel
  AMAZON_ORDERS_WAIT_MS   Tempo fixo para aguardar login/filtros antes de exportar
  PROFILE_DIR             Perfil persistente do Chromium
  HEADLESS_MODE=false     Deixe false para login manual quando precisar
`);
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
    locale: "pt-BR",
    timezoneId: "America/Manaus",
    viewport: { width: 1440, height: 960 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
}

function clearPersistentProfileLocks() {
  const candidates = ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"];
  let removed = 0;

  for (const name of candidates) {
    const filePath = path.join(PROFILE_DIR, name);
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        removed += 1;
      }
    } catch (error) {
      // Chromium lock cleanup is best-effort.
    }
  }

  return removed;
}

async function buildBrowserContext() {
  const options = getBrowserLaunchOptions();

  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, options);
  } catch (error) {
    const removed = clearPersistentProfileLocks();
    if (!removed) throw error;
    console.log(`Locks antigos do perfil removidos: ${removed}. Tentando abrir novamente...`);
    await sleep(1000);
    return chromium.launchPersistentContext(PROFILE_DIR, options);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter(message) {
  if (!process.stdin.isTTY) return Promise.resolve();

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function settlePage(page, timeout = 15000) {
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  await sleep(1200);
}

async function waitForSellerCentralReady(page, options) {
  await settlePage(page, 20000);

  let loginDetected = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : "";
    return /sign in|entrar|fazer login|senha|password|two-step|verificacao|verificacao|verification|autenticacao|authentication|codigo|code/i.test(text);
  }).catch(() => false);

  if (loginDetected) {
    console.log("Login detectado. Complete o login/MFA na janela do Chromium.");
    const startedAt = Date.now();
    const maxWaitMs = parsePositiveInt(process.env.SELLER_LOGIN_WAIT_MS, 15 * 60 * 1000);

    while (Date.now() - startedAt < maxWaitMs) {
      await settlePage(page, 5000);
      const state = await page.evaluate(() => {
        const text = document.body ? document.body.innerText : "";
        return {
          hasLoginText: /sign in|entrar|fazer login|senha|password|two-step|verificacao|verificacao|verification|autenticacao|authentication|codigo|code/i.test(text),
          hasOrderId: /\b\d{3}-\d{7}-\d{7}\b/.test(text),
          hasOrdersUrl: /orders-v3/i.test(location.href),
        };
      }).catch(() => false);
      if (state && state.hasOrdersUrl && (state.hasOrderId || !state.hasLoginText)) break;
      await sleep(3000);
    }
  }

  if (options.waitMs > 0) {
    console.log(`Aguardando ${Math.round(options.waitMs / 1000)}s antes de exportar...`);
    await sleep(options.waitMs);
    await settlePage(page, 10000);
  }

  if (options.manual) {
    await waitForEnter(
      "Ajuste filtros/aba de enviados no Seller Central, depois aperte Enter aqui para exportar...",
    );
    await settlePage(page, 10000);
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function foldText(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function collectOrdersFromList(page) {
  const rows = await page.evaluate(() => {
    const orderRe = /\b\d{3}-\d{7}-\d{7}\b/g;
    const clean = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    };

    const closestContainer = (element) =>
      element.closest(
        [
          "tr",
          "li",
          "[data-test-id]",
          "[data-testid]",
          ".a-box",
          ".a-row",
          "[class*='order']",
          "[class*='Order']",
          "[class*='row']",
          "[class*='card']",
        ].join(","),
      ) || element.parentElement;

    const candidates = [];
    const anchors = Array.from(document.querySelectorAll("a[href]")).filter(visible);

    for (const anchor of anchors) {
      const href = anchor.href || "";
      const text = clean(`${anchor.innerText || ""} ${anchor.getAttribute("aria-label") || ""} ${href}`);
      const ids = text.match(orderRe) || [];
      for (const orderId of ids) {
        const container = closestContainer(anchor);
        candidates.push({
          orderId,
          url: href,
          listText: clean(container ? container.innerText : anchor.innerText),
        });
      }
    }

    if (!candidates.length) {
      const bodyText = clean(document.body ? document.body.innerText : "");
      const ids = bodyText.match(orderRe) || [];
      for (const orderId of ids) {
        candidates.push({ orderId, url: "", listText: "" });
      }
    }

    return candidates;
  });

  return uniqueBy(rows, (row) => row.orderId).map((row) => ({
    orderId: row.orderId,
    url: normalizeOrderUrl(row.orderId, row.url),
    listText: cleanText(row.listText),
  }));
}

function normalizeOrderUrl(orderId, url) {
  if (url) return url;
  return `${SELLER_CENTRAL_BASE_URL}/orders-v3/order/${orderId}`;
}

async function clickOptionalText(page, patterns) {
  for (const pattern of patterns) {
    const locator = page.getByText(pattern).first();
    try {
      if (await locator.isVisible({ timeout: 800 })) {
        await locator.click({ timeout: 1000 });
        await settlePage(page, 4000);
      }
    } catch (error) {
      // Optional expansion controls vary by Seller Central page.
    }
  }
}

async function extractOrderDetails(page, order) {
  await page.goto(order.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settlePage(page, 20000);
  await clickOptionalText(page, [
    /mostrar endereco/i,
    /show full address/i,
    /detalhes do cliente/i,
    /customer details/i,
  ]);

  const snapshot = await page.evaluate(() => {
    const clean = (value) =>
      String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\r/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const bodyText = clean(document.body ? document.body.innerText : "");
    const itemBlocks = Array.from(
      document.querySelectorAll("tr, [data-test-id*='item'], [data-testid*='item'], .a-box"),
    )
      .map((element) => clean(element.innerText))
      .filter((text) => text.length >= 15 && text.length <= 1500 && /\b(ASIN|SKU|Quantidade|Qty|quantity)\b/i.test(text));

    return {
      url: location.href,
      bodyText,
      itemBlocks: Array.from(new Set(itemBlocks)).slice(0, 8),
    };
  });

  const lines = snapshot.bodyText.split("\n").map(cleanText).filter(Boolean);
  const listLines = order.listText.split("\n").map(cleanText).filter(Boolean);
  const allLines = [...lines, ...listLines];
  const address = extractAddress(lines);
  const customerName =
    findValueAfterLabels(allLines, [
      "nome do comprador",
      "comprador",
      "buyer name",
      "buyer",
      "cliente",
      "destinatario",
      "recipient",
      "ship to",
      "enviar para",
    ]) || firstAddressLine(address);

  return {
    pedido: order.orderId,
    data_pedido: findDate(allLines),
    status: findStatus(allLines),
    cliente: customerName,
    telefone: findPhone(allLines),
    email: findEmail(allLines.join("\n")),
    endereco_envio: address,
    valor: findAmount(allLines),
    itens: extractItems(snapshot.itemBlocks, snapshot.bodyText),
    url: snapshot.url || order.url,
  };
}

async function savePageDiagnostics(page, reason = "diagnostic") {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const safeReason = String(reason || "diagnostic").replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  const basePath = path.join(OUTPUT_DIR, `amazon_orders_${safeReason}_${timestamp()}`);
  const htmlPath = `${basePath}.html`;
  const pngPath = `${basePath}.png`;

  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf8");
  } catch (error) {
    console.warn(`Nao consegui salvar HTML de diagnostico: ${error.message}`);
  }

  try {
    await page.screenshot({ path: pngPath, fullPage: true });
  } catch (error) {
    console.warn(`Nao consegui salvar screenshot de diagnostico: ${error.message}`);
  }

  return { htmlPath, pngPath };
}

function findValueAfterLabels(lines, labels) {
  const foldedLabels = labels.map(foldText);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const folded = foldText(line);
    const label = foldedLabels.find((candidate) => folded === candidate || folded.startsWith(`${candidate}:`));
    if (!label) continue;

    const sameLineValue = line.split(":").slice(1).join(":").trim();
    if (sameLineValue && !looksLikeLabel(sameLineValue)) return sameLineValue;

    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const next = lines[index + offset];
      if (!next || looksLikeLabel(next)) continue;
      if (ORDER_ID_EXACT_RE.test(next)) continue;
      return next;
    }
  }

  return "";
}

function looksLikeLabel(value) {
  const folded = foldText(value);
  return [
    "pedido",
    "order",
    "status",
    "comprador",
    "buyer",
    "cliente",
    "customer",
    "endereco",
    "shipping",
    "pagamento",
    "payment",
    "produto",
    "item",
    "entrega",
    "delivery",
    "envio",
    "shipment",
  ].some((label) => folded === label || folded.startsWith(`${label}:`));
}

function extractAddress(lines) {
  const startMatchers = [
    "endereco de envio",
    "endereco do envio",
    "endereco",
    "shipping address",
    "ship to",
    "enviar para",
    "destinatario",
    "recipient",
  ];
  const stopMatchers = [
    "informacoes do pedido",
    "order information",
    "informacoes de pagamento",
    "payment",
    "produtos",
    "items",
    "comprador",
    "buyer",
    "cliente",
    "customer",
    "rastreamento",
    "tracking",
    "resumo",
    "summary",
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const folded = foldText(lines[index]);
    if (!startMatchers.some((label) => folded.includes(label))) continue;

    const parts = [];
    for (let offset = 1; offset <= 10 && index + offset < lines.length; offset += 1) {
      const line = lines[index + offset];
      const foldedLine = foldText(line);
      if (stopMatchers.some((label) => foldedLine.includes(label))) break;
      if (findPhone(line) || findEmail(line)) continue;
      if (!line || looksLikeLabel(line)) continue;
      parts.push(line);
    }

    const address = cleanText(parts.join(" | "));
    if (address) return address;
  }

  return "";
}

function firstAddressLine(address) {
  return cleanText(address).split("|").map(cleanText).filter(Boolean)[0] || "";
}

function findPhone(input) {
  const lines = Array.isArray(input)
    ? input.map(cleanText).filter(Boolean)
    : String(input || "").split(/\n/).map(cleanText).filter(Boolean);
  const phoneLabel = /(telefone|tel\.?|celular|whats|whatsapp|phone|mobile|contact|contato)/i;

  for (let index = 0; index < lines.length; index += 1) {
    if (!phoneLabel.test(lines[index])) continue;

    const nearby = lines.slice(index, index + 4);
    for (const line of nearby) {
      const phone = findPhoneInLine(line, true);
      if (phone) return phone;
    }
  }

  for (const line of lines) {
    const phone = findPhoneInLine(line, false);
    if (phone) return phone;
  }

  return "";
}

function findPhoneInLine(line, labelContext) {
  if (isBadPhoneContext(line)) return "";

  const candidates = String(line || "").match(
    /(?:\+?55[\s().-]*)?(?:\(?[1-9][0-9]\)?[\s.-]*)?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}/g,
  ) || [];

  for (const candidate of candidates) {
    const phone = normalizeBrazilPhone(candidate);
    if (!phone) continue;
    if (labelContext || isHighConfidencePhone(candidate, line)) return phone;
  }

  return "";
}

function isBadPhoneContext(line) {
  const folded = foldText(line);
  return [
    "pedido",
    "order",
    "rastreamento",
    "tracking",
    "remessa",
    "shipment id",
    "asin",
    "sku",
    "cep",
    "postal",
    "postcode",
    "cpf",
    "cnpj",
    "nota fiscal",
    "invoice",
    "nf-e",
  ].some((term) => folded.includes(term));
}

function isHighConfidencePhone(raw, line) {
  const text = String(line || "");
  if (/(telefone|tel\.?|celular|whats|whatsapp|phone|mobile|contact|contato)/i.test(text)) return true;
  if (/\+?55/.test(raw)) return true;
  if (/\([1-9][0-9]\)/.test(raw)) return true;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 && digits[2] === "9" && /[-\s.]/.test(raw);
}

function normalizeBrazilPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return "";
  if (/^0+$/.test(digits)) return "";

  const ddd = digits.slice(0, 2);
  const local = digits.slice(2);
  const dddNumber = Number(ddd);
  if (dddNumber < 11 || dddNumber > 99) return "";
  if (local.length === 9 && !local.startsWith("9")) return "";
  if (local.length === 8 && !/^[2-5]/.test(local)) return "";

  if (local.length === 9) {
    return `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
  }
  return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
}

function findEmail(text) {
  const match = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function findDate(lines) {
  const dateLine = lines.find((line) => /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(line));
  if (dateLine) {
    const match = dateLine.match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/);
    return match ? match[0] : "";
  }

  const labelValue = findValueAfterLabels(lines, [
    "data do pedido",
    "pedido feito",
    "order date",
    "purchase date",
  ]);
  return labelValue;
}

function findStatus(lines) {
  const candidates = [
    "enviado",
    "shipped",
    "entregue",
    "delivered",
    "cancelado",
    "canceled",
    "pendente",
    "pending",
  ];
  const line = lines.find((value) => {
    const folded = foldText(value);
    return candidates.some((candidate) => folded.includes(candidate));
  });
  return line || "";
}

function findAmount(lines) {
  const joined = lines.join("\n");
  const matches = joined.match(/R\$\s*[\d.]+,\d{2}/g) || [];
  return matches[0] || "";
}

function extractItems(itemBlocks, fullText) {
  if (itemBlocks.length) {
    return itemBlocks.map((block) => compactCell(block, 420)).join(" || ");
  }

  const asin = (fullText.match(/\bB[A-Z0-9]{9}\b/g) || []).slice(0, 8);
  return Array.from(new Set(asin)).join(" | ");
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[;"\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(outputPath, rows) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const headers = ORDER_COLUMNS.map((column) => column.label);
  const lines = [
    headers.join(";"),
    ...rows.map((row) =>
      ORDER_COLUMNS.map((column) => csvEscape(compactCell(row[column.key], column.key === "itens" ? 700 : 1200))).join(";"),
    ),
  ];

  fs.writeFileSync(outputPath, `\ufeff${lines.join("\n")}\n`, "utf8");
}

function writeExcelXml(outputPath, rows) {
  const xlsPath = outputPath.replace(/\.[^.]+$/, ".xls");
  const columns = ORDER_COLUMNS.map((column) => `    <Column ss:Width="${column.width}"/>`).join("\n");
  const headerCells = ORDER_COLUMNS.map(
    (column) => `      <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`,
  ).join("\n");
  const bodyRows = rows.map((row) => {
    const cells = ORDER_COLUMNS.map((column) => {
      const maxLength = column.key === "itens" ? 700 : 1600;
      const value = compactCell(row[column.key], maxLength);
      return `      <Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
    }).join("\n");
    return `    <Row>\n${cells}\n    </Row>`;
  }).join("\n");

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
  </Style>
  <Style ss:ID="Cell">
   <Alignment ss:Vertical="Top" ss:WrapText="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Pedidos enviados">
  <Table>
${columns}
    <Row ss:StyleID="Header">
${headerCells}
    </Row>
${bodyRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/>
   <FrozenNoSplit/>
   <SplitHorizontal>1</SplitHorizontal>
   <TopRowBottomPane>1</TopRowBottomPane>
   <ActivePane>2</ActivePane>
  </WorksheetOptions>
 </Worksheet>
</Workbook>
`;

  fs.writeFileSync(xlsPath, workbook, "utf8");
  return xlsPath;
}

function compactCell(value, maxLength = 1200) {
  const text = cleanText(value).replace(/\n/g, " | ").replace(/\s*\|\s*/g, " | ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function goToNextOrdersPage(page) {
  const beforeUrl = page.url();
  const beforeOrders = await collectOrdersFromList(page);
  const beforeIds = beforeOrders.map((order) => order.orderId).join("|");

  const clickedByLocator = await clickNextByLocator(page);
  if (!clickedByLocator) {
    const clickedByDom = await page.evaluate(() => {
      const fold = (value) =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

      const collect = (root, result = []) => {
        const children = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
        for (const child of children) {
          result.push(child);
          if (child.shadowRoot) collect(child.shadowRoot, result);
        }
        return result;
      };

      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const isDisabled = (element) =>
        Boolean(element.disabled) ||
        element.getAttribute("disabled") !== null ||
        element.getAttribute("aria-disabled") === "true" ||
        fold(element.getAttribute("class")).includes("disabled");

      const clickable = collect(document)
        .filter((element) => {
          const tagName = fold(element.tagName);
          const role = fold(element.getAttribute("role"));
          return ["a", "button", "kat-button"].includes(tagName) || role === "button" || role === "link";
        })
        .filter((element) => isVisible(element) && !isDisabled(element));

      const candidates = clickable
        .map((element) => {
          const text = fold(
            [
              element.innerText,
              element.textContent,
              element.getAttribute("aria-label"),
              element.getAttribute("label"),
              element.getAttribute("title"),
              element.getAttribute("data-testid"),
              element.getAttribute("class"),
              element.id,
              element.getAttribute("name"),
            ].filter(Boolean).join(" "),
          );
          const rect = element.getBoundingClientRect();
          return { element, text, top: rect.top, left: rect.left };
        })
        .filter(({ text }) =>
          text.includes("proxima") ||
          text.includes("proximo") ||
          text.includes("next") ||
          text.includes("\u2192") ||
          text.includes("chevron-right") ||
          text.includes("right") ||
          text.includes("pagination-next"),
        )
        .sort((a, b) => b.top - a.top || b.left - a.left);

      const target = candidates[0]?.element;
      if (!target) return "";
      target.click();
      return candidates[0].text || "next";
    }).catch(() => "");

    if (!clickedByDom) {
      console.log("Nao encontrei botao de proxima pagina.");
      return false;
    }
  }

  const changed = await waitForOrdersPageChanged(page, beforeUrl, beforeIds);
  if (!changed) {
    console.log("Cliquei na proxima pagina, mas a lista de pedidos nao mudou.");
  }
  return changed;
}

async function clickNextByLocator(page) {
  const locators = [
    page.getByRole("button", { name: /proxim[oa]|pr.xim[oa]|next|\u2192/i }),
    page.getByRole("link", { name: /proxim[oa]|pr.xim[oa]|next|\u2192/i }),
    page.locator("a[aria-label*='next' i], button[aria-label*='next' i]").first(),
    page.locator("a[aria-label*='proxima' i], button[aria-label*='proxima' i]").first(),
    page.locator("a[aria-label*='proximo' i], button[aria-label*='proximo' i]").first(),
    page.locator("a[title*='next' i], button[title*='next' i]").first(),
    page.locator("a[title*='proxima' i], button[title*='proxima' i]").first(),
    page.locator("a[title*='proximo' i], button[title*='proximo' i]").first(),
    page.locator("kat-pagination button, kat-pagination a, kat-button").filter({ hasText: /next|proxim[oa]|pr.xim[oa]/i }).first(),
    page.getByText(/proxim[oa]|pr.xim[oa]|next/i).first(),
  ];

  for (const locator of locators) {
    try {
      if (await locator.isVisible({ timeout: 700 })) {
        await locator.click({ timeout: 2000 });
        return true;
      }
    } catch (error) {
      // Try the next selector.
    }
  }

  return false;
}

async function waitForOrdersPageChanged(page, beforeUrl, beforeIds) {
  await settlePage(page, 20000);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const afterOrders = await collectOrdersFromList(page).catch(() => []);
    const afterIds = afterOrders.map((order) => order.orderId).join("|");
    if (afterIds && afterIds !== beforeIds) return true;
    if (page.url() !== beforeUrl && afterIds) return true;
    await sleep(1000);
  }
  return false;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }

  console.log(`Abrindo Seller Central: ${options.url}`);
  console.log(`Perfil Chromium: ${PROFILE_DIR}`);
  console.log(`Limite: ${options.limit} pedidos | paginas: ${options.pages}`);

  const context = await buildBrowserContext();
  const listPage = await context.newPage();
  let detailPage = await context.newPage();
  const rows = [];
  const seen = new Set();

  try {
    await listPage.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForSellerCentralReady(listPage, options);

    for (let pageIndex = 1; pageIndex <= options.pages && rows.length < options.limit; pageIndex += 1) {
      console.log(`Lendo pagina ${pageIndex} de pedidos...`);
      const orders = await collectOrdersFromList(listPage);
      console.log(`Pedidos encontrados na pagina: ${orders.length}`);
      if (!orders.length) {
        const diagnostics = await savePageDiagnostics(listPage, "empty");
        console.log(`Tela sem pedidos salva para diagnostico: ${diagnostics.htmlPath}`);
        console.log(`Screenshot salvo para diagnostico: ${diagnostics.pngPath}`);
      }

      for (const order of orders) {
        if (rows.length >= options.limit) break;
        if (seen.has(order.orderId)) continue;
        seen.add(order.orderId);

        console.log(`Coletando detalhes do pedido ${order.orderId}...`);
        try {
          if (!detailPage || detailPage.isClosed()) {
            detailPage = await context.newPage();
          }
          rows.push(await extractOrderDetails(detailPage, order));
        } catch (error) {
          if (/Target page, context or browser has been closed/i.test(error.message || "")) {
            try {
              detailPage = await context.newPage();
              rows.push(await extractOrderDetails(detailPage, order));
              continue;
            } catch (retryError) {
              rows.push(buildFailedOrderRow(order, retryError));
              console.warn(`Falha ao coletar ${order.orderId}: ${retryError.message}`);
              continue;
            }
          }

          rows.push(buildFailedOrderRow(order, error));
          console.warn(`Falha ao coletar ${order.orderId}: ${error.message}`);
        }
      }

      if (pageIndex < options.pages && rows.length < options.limit) {
        const moved = await goToNextOrdersPage(listPage);
        if (!moved) {
          const diagnostics = await savePageDiagnostics(listPage, "pagination");
          console.log(`Tela de paginacao salva para diagnostico: ${diagnostics.htmlPath}`);
          console.log(`Screenshot de paginacao salvo: ${diagnostics.pngPath}`);
          break;
        }
      }
    }

    writeCsv(options.output, rows);
    const xlsPath = writeExcelXml(options.output, rows);
    console.log(`CSV salvo em: ${options.output}`);
    console.log(`Planilha XLS salva em: ${xlsPath}`);
    console.log(`Pedidos exportados: ${rows.length}`);
  } finally {
    if (options.keepOpen && !HEADLESS_MODE) {
      console.log("Janela mantida aberta. Feche o Chromium quando terminar de conferir.");
    } else {
      await context.close().catch(() => {});
    }
  }
}

function buildFailedOrderRow(order, error) {
  return {
    pedido: order.orderId,
    data_pedido: "",
    status: "",
    cliente: "",
    telefone: "",
    email: "",
    endereco_envio: "",
    valor: "",
    itens: "",
    url: order.url,
    erro: error.message,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
