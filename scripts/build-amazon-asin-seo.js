const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR || "outputs");
const AMAZON_FEE_RATE = parseNumber(process.env.AMAZON_FEE_RATE, 0.12);
const DEFAULT_FREIGHT_AND_OPERATIONAL_COST = parseNumber(
  process.env.FREIGHT_AND_OPERATIONAL_COST,
  20,
);
const BACKEND_KEYWORDS_MAX_BYTES = 250;
const TITLE_MAX_CHARS = 200;

const FIELD_ALIASES = {
  name: [
    "produto",
    "product",
    "nome",
    "name",
    "titulo",
    "title",
    "produto_analisado",
    "termo",
    "keyword",
    "search_term",
  ],
  category: ["categoria", "category", "nicho", "niche", "segmento", "vertical"],
  views: ["views", "visualizacoes", "visualizações", "plays", "view_count"],
  likes: ["likes", "curtidas", "like_count"],
  shares: ["shares", "compartilhamentos", "share_count"],
  comments: ["comments", "comentarios", "comentários", "comment_count"],
  price: ["preco", "preço", "preco_medio", "preço_médio", "price", "amazon_price"],
  cost: ["custo", "custo_estimado", "cost", "supplier_cost"],
  notes: [
    "observacao",
    "observação",
    "descricao",
    "descrição",
    "caption",
    "legenda",
    "hook",
    "gancho",
    "video_title",
  ],
  hashtags: ["hashtags", "tags"],
  material: ["material", "materiais"],
  dimensions: ["medidas", "dimensions", "dimensoes", "dimensões", "tamanho"],
  brand: ["marca", "brand"],
};

const STOPWORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "ate",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
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

const GENERIC_NOISE_WORDS = new Set([
  "achadinho",
  "achadinhos",
  "amazon",
  "brasil",
  "comprar",
  "encontrado",
  "favorito",
  "link",
  "melhor",
  "oferta",
  "promo",
  "promocao",
  "shopee",
  "tiktok",
  "viral",
]);

const BRAND_RISK_WORDS = [
  "apple",
  "barbie",
  "coca cola",
  "disney",
  "dyson",
  "lego",
  "nike",
  "stanley",
  "xiaomi",
];

const REGULATORY_RISK_WORDS = [
  "bateria",
  "carregador",
  "creme",
  "dermatologico",
  "eletronico",
  "infantil",
  "maquiagem",
  "medicinal",
  "oleo essencial",
  "protetor solar",
  "remedio",
  "serum",
  "suplemento",
  "vitamina",
];

const MATERIAL_HINTS = [
  "aco inox",
  "inox",
  "silicone",
  "plastico",
  "acrilico",
  "vidro",
  "bambu",
  "algodao",
  "microfibra",
  "aluminio",
  "abs",
  "poliester",
  "nylon",
];

const NICHE_PROFILES = [
  {
    id: "cozinha",
    match: ["cozinha", "pote", "temper", "escorredor", "pia", "talher", "detergente", "air fryer"],
    benefit: "organiza e agiliza a rotina",
    problem: "bagunca na bancada e perda de tempo nas tarefas pequenas",
    transformation: "deixa a cozinha mais pratica com o efeito de antes e depois que chama atencao nos videos",
    use: "cozinha, pia, armario e bancada",
    genericTerms: ["utilidades cozinha", "organizador cozinha", "acessorio cozinha"],
  },
  {
    id: "organizacao",
    match: ["organizador", "organizacao", "caixa", "cesto", "gaveta", "armario", "geladeira"],
    benefit: "ganha espaco e reduz a bagunca",
    problem: "itens espalhados que deixam o ambiente com aspecto desorganizado",
    transformation: "cria a sensacao visual de casa arrumada que costuma viralizar no TikTok",
    use: "quarto, banheiro, cozinha e lavanderia",
    genericTerms: ["organizador multiuso", "organizador casa", "caixa organizadora"],
  },
  {
    id: "banheiro",
    match: ["banheiro", "shampoo", "sabonete", "toalha", "box", "ralo", "tapete"],
    benefit: "mantem tudo acessivel e seco",
    problem: "produtos molhados, bancada cheia e falta de espaco no box",
    transformation: "deixa o banheiro com aparencia limpa e funcional em poucos segundos",
    use: "banheiro, box, lavabo e area de servico",
    genericTerms: ["suporte banheiro", "organizador banheiro", "acessorio banheiro"],
  },
  {
    id: "beleza",
    match: ["beleza", "cabelo", "escova", "pente", "make", "maquiagem", "necessaire", "skin"],
    benefit: "facilita a rotina de beleza",
    problem: "preparacao demorada e acessorios espalhados",
    transformation: "entrega o resultado pratico de arrume-se comigo que viraliza nos videos",
    use: "rotina de beleza, necessaire, viagem e bancada",
    genericTerms: ["acessorio beleza", "organizador maquiagem", "escova cabelo"],
  },
  {
    id: "limpeza",
    match: ["limpeza", "vassoura", "rodo", "escova", "esponja", "paninho", "lavanderia"],
    benefit: "limpa mais rapido com menos esforco",
    problem: "sujeira dificil e ferramentas que ocupam muito espaco",
    transformation: "mostra uma limpeza visualmente satisfatoria, do tipo que prende a atencao",
    use: "casa, cozinha, banheiro e lavanderia",
    genericTerms: ["produto limpeza casa", "escova limpeza", "utilidade limpeza"],
  },
  {
    id: "decoracao",
    match: ["decoracao", "decorativo", "manta", "capa", "almofada", "tapete", "cortina", "sofa", "cama"],
    benefit: "renova o ambiente sem reforma",
    problem: "ambiente sem acabamento visual ou sofa e cama com aparencia antiga",
    transformation: "cria o efeito de renovacao rapida visto em videos de casa e decoracao",
    use: "sala, quarto, sofa e cama",
    genericTerms: ["decoracao casa", "manta sofa", "capa decorativa"],
  },
];

function parseArgs(argv) {
  const options = {
    input: "",
    output: "",
    product: "",
    json: "",
    category: "",
    price: "",
    cost: "",
    notes: "",
    stdout: false,
    pretty: true,
    help: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--stdout") {
      options.stdout = true;
    } else if (arg === "--compact") {
      options.pretty = false;
    } else if (arg.startsWith("--input=")) {
      options.input = arg.slice("--input=".length).trim();
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length).trim();
    } else if (arg.startsWith("--product=")) {
      options.product = arg.slice("--product=".length).trim();
    } else if (arg.startsWith("--json=")) {
      options.json = arg.slice("--json=".length).trim();
    } else if (arg.startsWith("--category=")) {
      options.category = arg.slice("--category=".length).trim();
    } else if (arg.startsWith("--price=")) {
      options.price = arg.slice("--price=".length).trim();
    } else if (arg.startsWith("--cost=")) {
      options.cost = arg.slice("--cost=".length).trim();
    } else if (arg.startsWith("--notes=")) {
      options.notes = arg.slice("--notes=".length).trim();
    }
  }

  if (!options.output) {
    options.output = path.join(OUTPUT_DIR, `tiktok_asin_seo_${timestamp()}.json`);
  } else {
    options.output = path.resolve(process.cwd(), options.output);
  }

  return options;
}

function printHelp() {
  console.log(`Uso:
  npm run seo:tiktok -- --input=outputs\\trends.csv
  npm run seo:tiktok -- --input=outputs\\trends.json --output=outputs\\seo.json
  npm run seo:tiktok -- --product="organizador de geladeira" --category=casa --price=59.90 --cost=18
  node scripts\\build-amazon-asin-seo.js --json="{\\"produto\\":\\"pote hermetico\\",\\"nicho\\":\\"cozinha\\"}"

Entradas aceitas:
  - JSON: array, objeto unico, ou objeto com products/trends/items
  - NDJSON: um objeto JSON por linha
  - CSV/TSV: cabecalhos como produto,nicho,views,curtidas,preco,custo,observacao

Saida:
  - Um objeto no formato solicitado quando houver 1 produto
  - Um array de objetos quando houver varios produtos`);
}

function main() {
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp();
    return;
  }

  const rawProducts = loadProducts(options);
  if (!rawProducts.length) {
    throw new Error("Nenhum produto informado. Use --product, --json ou --input.");
  }

  const packages = rawProducts.map((raw) => buildAmazonPackage(normalizeProduct(raw)));
  const outputData = packages.length === 1 ? packages[0] : packages;
  const outputJson = JSON.stringify(outputData, null, options.pretty ? 2 : 0);

  if (options.stdout) {
    console.log(outputJson);
    return;
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${outputJson}\n`, "utf8");
  console.log(`Pacote SEO Amazon salvo em ${options.output}`);
}

function loadProducts(options) {
  if (options.json) {
    return coerceProducts(parseJson(options.json, "argumento --json"));
  }

  if (options.product) {
    return [
      {
        produto: options.product,
        nicho: options.category,
        preco: options.price,
        custo: options.cost,
        observacao: options.notes,
      },
    ];
  }

  if (!options.input) {
    return [];
  }

  const inputPath = path.resolve(process.cwd(), options.input);
  const content = fs.readFileSync(inputPath, "utf8").trim();
  if (!content) return [];

  const firstChar = content[0];
  if (firstChar === "{" || firstChar === "[") {
    return coerceProducts(parseJson(content, inputPath));
  }

  const ndjson = parseNdjson(content);
  if (ndjson.length) return ndjson;

  return parseDelimited(content);
}

function parseJson(value, source) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`JSON invalido em ${source}: ${error.message}`);
  }
}

function coerceProducts(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  for (const key of ["products", "produtos", "trends", "items", "data", "results"]) {
    if (Array.isArray(value[key])) return value[key];
  }

  return [value];
}

function parseNdjson(content) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every((line) => line.startsWith("{") && line.endsWith("}"))) {
    return [];
  }

  try {
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    return [];
  }
}

function parseDelimited(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseDelimitedLine(lines[0], delimiter).map((header) => normalizeHeader(header));
  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] === undefined ? "" : values[index];
    });
    return row;
  });
}

function detectDelimiter(headerLine) {
  const candidates = [",", ";", "\t", "|"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: parseDelimitedLine(headerLine, delimiter).length,
    }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseDelimitedLine(line, delimiter) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function normalizeProduct(raw) {
  const product = {
    name: pick(raw, FIELD_ALIASES.name),
    category: pick(raw, FIELD_ALIASES.category),
    views: parseMetric(pick(raw, FIELD_ALIASES.views)),
    likes: parseMetric(pick(raw, FIELD_ALIASES.likes)),
    shares: parseMetric(pick(raw, FIELD_ALIASES.shares)),
    comments: parseMetric(pick(raw, FIELD_ALIASES.comments)),
    price: parseCurrency(pick(raw, FIELD_ALIASES.price)),
    cost: parseCurrency(pick(raw, FIELD_ALIASES.cost)),
    notes: pick(raw, FIELD_ALIASES.notes),
    hashtags: normalizeHashtags(pick(raw, FIELD_ALIASES.hashtags)),
    material: pick(raw, FIELD_ALIASES.material),
    dimensions: pick(raw, FIELD_ALIASES.dimensions),
    brand: pick(raw, FIELD_ALIASES.brand),
    raw,
  };

  if (!product.name) {
    product.name = inferNameFromRaw(raw);
  }

  product.name = cleanProductName(product.name);
  product.searchText = normalizeText(
    [
      product.name,
      product.category,
      product.notes,
      product.hashtags.join(" "),
      product.material,
      product.dimensions,
      product.brand,
    ].join(" "),
  );

  return product;
}

function buildAmazonPackage(product) {
  const profile = detectNicheProfile(product);
  const primaryKeyword = buildPrimaryKeyword(product.name);
  const material = detectMaterial(product, profile);
  const dimensions = product.dimensions || "medidas aproximadas conforme variacao do fornecedor";
  const differentiation = buildDifferentiation(product, profile, primaryKeyword, material);
  const title = buildTitle(primaryKeyword, differentiation.titleBenefit, material, profile.use);
  const backendKeywords = buildBackendKeywords(product, profile, primaryKeyword, material);

  return {
    produto_analisado: product.name || "produto nao informado",
    estrategia_diferenciacao: differentiation.strategy,
    seo_novo_asin: {
      titulo: title,
      bullet_points: [
        `TRANSFORMACAO VIRAL: ${capitalizeSentence(profile.transformation)}.`,
        `RESOLVE O PROBLEMA: Ideal para quem sofre com ${profile.problem}.`,
        `KIT EXCLUSIVO: ${differentiation.bundleSentence}.`,
        `MATERIAL E MEDIDAS: Produzido em ${material}; ${dimensions}.`,
        `USO VERSATIL: Funciona bem em ${profile.use} e combina com a rotina mostrada nos videos.`,
      ],
      descricao_persuasiva: buildDescription(product, profile, primaryKeyword, differentiation, material),
      backend_keywords: backendKeywords,
    },
    termos_busca_asin_generico: buildGenericSearchTerms(product, profile, primaryKeyword, material),
  };
}

function buildDifferentiation(product, profile, primaryKeyword, material) {
  const risk = assessRisk(product);
  const margin = assessMargin(product);
  const bundle = chooseBundle(product, profile, material, risk);
  const titleBenefit = profile.benefit;

  const strategyParts = [
    `Viabilidade ${margin.level}${risk.level === "baixa" ? "" : ` com risco ${risk.level}`}`,
    bundle.strategy,
  ];

  if (margin.detail) {
    strategyParts.push(margin.detail);
  }

  if (risk.reasons.length) {
    strategyParts.push(`Ponto de atencao: ${risk.reasons.join("; ")}.`);
  }

  strategyParts.push(
    `Evite competir direto por ASIN generico usando nome proprio de linha, embalagem propria e fotos demonstrando o uso viral de ${primaryKeyword}.`,
  );

  return {
    titleBenefit,
    bundleSentence: bundle.bullet,
    strategy: strategyParts.join(" "),
  };
}

function chooseBundle(product, profile, material, risk) {
  const text = product.searchText;

  if (/pote|organizador|caixa|cesto|cabide|suporte|gancho|porta/.test(text)) {
    return {
      strategy:
        "Cadastre como kit exclusivo com 2 ou 3 unidades, variacao de tamanho ou cor e embalagem propria.",
      bullet: "Inclua 2 unidades ou uma combinacao de tamanhos para criar uma oferta dificil de comparar por preco",
    };
  }

  if (/escova|pente|beleza|maquiagem|necessaire/.test(text)) {
    return {
      strategy:
        "Cadastre como kit de rotina com brinde simples, como necessaire, espelho compacto ou presilha.",
      bullet: "Combine o item principal com um brinde leve para aumentar valor percebido e diferenciar o ASIN",
    };
  }

  if (/manta|capa|tapete|almofada|cortina|sofa|cama/.test(text)) {
    return {
      strategy:
        "Cadastre por cor, medida e ambiente de uso, com fotos de antes e depois e promessa de renovacao rapida.",
      bullet: "Use uma variacao clara de cor ou medida e posicione como renovacao rapida do ambiente",
    };
  }

  if (/limpeza|rodo|vassoura|escova|esponja/.test(text)) {
    return {
      strategy:
        "Cadastre como combo de limpeza com refil, gancho adesivo ou pano extra para separar do produto comum.",
      bullet: "Adicione refil ou acessorio leve para transformar o item em solucao completa de limpeza",
    };
  }

  if (risk.level === "alta") {
    return {
      strategy:
        "Crie ASIN novo somente se houver fornecedor regular, comprovacao de seguranca e documentacao exigida pela categoria.",
      bullet: "Use embalagem propria e documentacao do fornecedor antes de escalar a oferta",
    };
  }

  return {
    strategy:
      "Cadastre como bundle exclusivo com embalagem propria, nome de linha e um brinde leve de baixo custo.",
    bullet: `Monte uma oferta exclusiva com embalagem propria e brinde simples compativel com ${material}`,
  };
}

function assessMargin(product) {
  if (Number.isFinite(product.price) && Number.isFinite(product.cost)) {
    const freight = DEFAULT_FREIGHT_AND_OPERATIONAL_COST;
    const profit = product.price - product.cost - product.price * AMAZON_FEE_RATE - freight;
    const marginPct = product.price > 0 ? (profit / product.price) * 100 : 0;
    const level = marginPct >= 28 ? "alta" : marginPct >= 15 ? "media" : "baixa";
    return {
      level,
      detail: `Estimativa com preco ${formatCurrency(product.price)}, custo ${formatCurrency(product.cost)}, taxa ${Math.round(
        AMAZON_FEE_RATE * 100,
      )}% e custo operacional ${formatCurrency(freight)}: margem aproximada de ${marginPct.toFixed(1)}%.`,
    };
  }

  const text = product.searchText;
  if (/organizador|pote|suporte|cesto|porta|gancho|escova|pano|capa|manta/.test(text)) {
    return {
      level: "media",
      detail:
        "Sem preco e custo informados; a categoria costuma permitir bundle leve, mas valide fornecedor e frete antes do cadastro.",
    };
  }

  return {
    level: "incerta",
    detail:
      "Sem preco e custo informados; valide custo landed, taxa da categoria e frete antes de criar estoque ou ASIN novo.",
  };
}

function assessRisk(product) {
  const text = product.searchText;
  const reasons = [];

  if (product.brand || BRAND_RISK_WORDS.some((word) => text.includes(word))) {
    reasons.push("risco de marca ou termo protegido");
  }

  if (REGULATORY_RISK_WORDS.some((word) => text.includes(word))) {
    reasons.push("pode exigir documentacao, certificacao ou aprovacao de categoria");
  }

  if (/original|oficial|replica|inspirado/.test(text)) {
    reasons.push("evite promessa de produto oficial ou copia");
  }

  const level = reasons.length >= 2 ? "alta" : reasons.length === 1 ? "media" : "baixa";
  return { level, reasons };
}

function buildTitle(primaryKeyword, benefit, material, use) {
  const title = `${toTitleCase(primaryKeyword)} - ${capitalizeSentence(benefit)}, ${material} para ${use}`;
  return truncateClean(title, TITLE_MAX_CHARS);
}

function buildDescription(product, profile, primaryKeyword, differentiation, material) {
  const metrics = [];
  if (Number.isFinite(product.views)) metrics.push(`${formatCompact(product.views)} visualizacoes`);
  if (Number.isFinite(product.likes)) metrics.push(`${formatCompact(product.likes)} curtidas`);
  const socialProof = metrics.length ? ` A trend analisada trouxe ${metrics.join(" e ")}, sinalizando demanda ativa.` : "";
  const note = product.notes ? ` O apelo do video foi: ${cleanSentence(product.notes)}.` : "";

  return [
    `Este item, ${primaryKeyword}, foi estruturado para quem viu a solucao viral no TikTok e quer aplicar a mesma ideia na rotina.`,
    socialProof,
    note,
    ` O produto foi posicionado para resolver ${profile.problem}, com foco em ${profile.benefit}.`,
    ` A oferta pode ser cadastrada como ASIN novo com material ${material} e fotos que mostrem o antes e depois. Para diferenciar, ${differentiation.bundleSentence.toLowerCase()}.`,
  ]
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBackendKeywords(product, profile, primaryKeyword, material) {
  const seedTerms = [
    primaryKeyword,
    ...profile.genericTerms,
    product.category,
    product.hashtags.join(" "),
    material,
    "achadinho tiktok",
    "produto viral",
    "utilidades casa",
    "organizador pratico",
    "presente util",
    "rotina casa",
  ];

  const keywords = tokenizeKeywords(seedTerms.join(" "));
  return limitBackendKeywords(keywords);
}

function buildGenericSearchTerms(product, profile, primaryKeyword, material) {
  const materialTerm = primaryKeyword.includes(material) ? "" : `${primaryKeyword} ${material}`;
  const terms = [
    primaryKeyword,
    `${primaryKeyword} ${profile.id}`,
    materialTerm,
    ...profile.genericTerms,
  ]
    .map(cleanSearchTerm)
    .filter(Boolean);

  return unique(terms).slice(0, 3);
}

function detectNicheProfile(product) {
  const text = product.searchText;
  const profile =
    NICHE_PROFILES.find((entry) => entry.match.some((pattern) => text.includes(pattern))) ||
    NICHE_PROFILES.find((entry) => entry.id === "organizacao");
  return profile;
}

function detectMaterial(product) {
  if (product.material) return cleanSearchTerm(product.material);
  const found = MATERIAL_HINTS.find((material) => product.searchText.includes(material));
  if (found) return found;
  if (/manta|capa|tapete|almofada|cortina|necessaire/.test(product.searchText)) {
    return "tecido resistente";
  }
  if (/escova|suporte|organizador|pote|cesto|porta|gancho/.test(product.searchText)) {
    return "material resistente";
  }
  return "material duravel";
}

function buildPrimaryKeyword(name) {
  const tokens = tokenizeKeywords(name)
    .filter((token) => !GENERIC_NOISE_WORDS.has(token))
    .slice(0, 5);
  return tokens.length ? tokens.join(" ") : cleanSearchTerm(name);
}

function cleanProductName(value) {
  return cleanSentence(value)
    .replace(/[#@]/g, " ")
    .replace(/\b(achadinho|achadinhos|viral|tiktok|amazon|shopee|link na bio)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSentence(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSearchTerm(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeKeywords(value) {
  const tokens = cleanSearchTerm(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));

  return unique(tokens);
}

function limitBackendKeywords(tokens) {
  const accepted = [];
  for (const token of tokens) {
    const candidate = [...accepted, token].join(" ");
    if (Buffer.byteLength(candidate, "utf8") > BACKEND_KEYWORDS_MAX_BYTES) break;
    accepted.push(token);
  }
  return accepted.join(" ");
}

function pick(object, aliases) {
  if (!object || typeof object !== "object") return "";
  const normalizedLookup = new Map();

  Object.entries(object).forEach(([key, value]) => {
    normalizedLookup.set(normalizeHeader(key), value);
  });

  for (const alias of aliases) {
    const value = normalizedLookup.get(normalizeHeader(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function inferNameFromRaw(raw) {
  if (!raw || typeof raw !== "object") return "";
  const values = Object.values(raw)
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 3 && value.length <= 120);
  return values[0] || "";
}

function normalizeHashtags(value) {
  if (Array.isArray(value)) return value.map(cleanSearchTerm).filter(Boolean);
  return String(value || "")
    .split(/[,\s|;]+/)
    .map((tag) => cleanSearchTerm(tag.replace(/^#/, "")))
    .filter(Boolean);
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function capitalizeSentence(value) {
  const text = String(value || "").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

function toTitleCase(value) {
  return cleanSearchTerm(value)
    .split(" ")
    .map((word) => (STOPWORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function truncateClean(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars + 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 120 ? lastSpace : maxChars).trim()}`;
}

function parseMetric(value) {
  if (value === undefined || value === null || value === "") return Number.NaN;
  const raw = normalizeText(value).replace(/\s+/g, "");
  const multiplier =
    raw.includes("mi") || raw.includes("milhao") || raw.includes("m") ? 1000000 : raw.includes("k") || raw.includes("mil") ? 1000 : 1;
  const match = raw.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return Number.NaN;
  return Number(match[0]) * multiplier;
}

function parseCurrency(value) {
  if (value === undefined || value === null || value === "") return Number.NaN;
  const raw = String(value).replace(/[^\d,.-]/g, "").trim();
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseNumber(value, fallback) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatCurrency(value) {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
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

try {
  main();
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exit(1);
}
