# Projeto Amazon - mapa operacional

Atualizado em 2026-05-22.
Workspace: `C:\Amazon`.

Este projeto nao e uma unica automacao. Ele junta varias esteiras praticas para
operar oportunidades na Amazon/Seller Central:

1. descobrir produtos com sinal de demanda;
2. validar se o Seller Central permite vender o ASIN;
3. procurar fornecedor e margem;
4. opcionalmente cadastrar oferta;
5. exportar pedidos enviados;
6. gerar pacote de SEO/cadastro depois que ja existe um produto escolhido.

## Partes principais

### 1. `index.js` - minerador e validador Amazon/Seller Central

Este e o bot principal. Ele usa Playwright para navegar na Amazon publica e no
Seller Central com o perfil persistente `.playwright-amazon-profile`.

Responsabilidades:

- carrega `.env` com configuracoes de margem, modo de descoberta, navegador,
  filtros e execucao intermitente;
- escolhe as origens de descoberta em `keyword`, `asin` ou `public-feed`;
- evita repetir ASINs recentes usando `.discovery-state.json`;
- minera paginas publicas da Amazon por keyword, ASIN direto ou vitrines;
- filtra preco fora da faixa, produto internacional/importado e sinais de
  Private Label ou marca forte;
- abre o Seller Central e testa se o ASIN pode ser vendido;
- registra bloqueios recorrentes do Seller Central para nao insistir neles;
- busca fornecedores via Google Lens e Mercado Livre quando habilitado;
- calcula margem com taxa Amazon e custo operacional;
- grava resultado em CSV;
- pode manter paginas abertas para revisao manual;
- pode rodar em loop intermitente.

Comando principal:

```powershell
node index.js
```

Validacao rapida antes de rodar:

```powershell
node --check index.js
```

Variaveis mais importantes:

- `HEADLESS_MODE`: quando `false`, abre Chromium visivel.
- `CHROMIUM_WINDOW_MODE`: `background`, `minimized` ou `normal`.
- `SUPPRESS_BROWSER_FOCUS`: evita trazer a janela para frente.
- `KEEP_BROWSER_OPEN`: mantem navegador aberto ao final.
- `AMAZON_FEE_RATE`: taxa usada no calculo de margem. Contexto atual: `0.12`.
- `MIN_MARGIN`: margem minima em porcentagem.
- `RUN_PROFILE`: perfil padrao ou `controlled`.
- `DISCOVERY_MODE`: `keyword`, `asin` ou `public-feed`.
- `DISCOVERY_TERMS`, `KEYWORDS`, `ASIN_SEEDS`, `DISCOVERY_URLS`: entradas.
- `KEYWORD_SORTS`, `KEYWORD_PAGE_MIN`, `KEYWORD_PAGE_MAX`: varredura publica.
- `INTERMITTENT_MODE`: ativa ciclos recorrentes.
- `RECENT_ASIN_TTL_HOURS`, `RECENT_ASIN_MEMORY_LIMIT`: memoria anti-repeticao.
- `MAX_INTERNATIONAL_SKIPS_PER_SOURCE`: abandona uma origem quando ha importados demais.

Saidas relacionadas:

- `oportunidades_cnpj.csv` e variantes com timestamp;
- `outputs\*.log`;
- arquivos de diagnostico/snapshots gerados durante inspecao;
- `.bot-runtime.lock`, quando ha execucao ativa;
- `.discovery-state.json`, com memoria de ASINs e estado das fontes.

Cuidados:

- nao tratar "ASIN potencialmente aberto" da Amazon publica como aprovado;
- a decisao real acontece no Seller Central;
- se houver login/MFA, completar manualmente na janela visivel;
- se uma execucao anterior foi interrompida, verificar `.bot-runtime.lock` e
  processos `node` antes de iniciar outra.

### 2. `scripts\search-tiktok-products.js` - descoberta de produtos no TikTok

Este e o script principal para descobrir produtos por frequencia recente de
videos. A direcao das conversas antigas foi clara: nao gerar JSON/SEO antes da
descoberta. Primeiro procurar produtos no TikTok.

Responsabilidades:

- abre o TikTok com Playwright usando `.playwright-tiktok-profile`;
- pesquisa termos ou clusters de produto;
- coleta cards de video;
- busca detalhes via pagina/oEmbed quando possivel;
- decodifica data aproximada do video pelo ID do TikTok;
- filtra videos por idade com `--max-age-days`;
- agrupa produtos por frequencia recente;
- ranqueia por quantidade de videos, criadores unicos, views, likes, shares e
  idade do video mais novo;
- gera arquivos de videos, ranking de produtos e resumo.

Comando base:

```powershell
npm run tiktok:search -- --query="aquecedor torneira tiktok shop brasil|secadora portatil roupa tiktok shop brasil" --limit=8 --scrolls=2 --delay-ms=1200 --max-age-days=120 --min-videos=3 --visible
```

Saidas por execucao:

- `outputs\tiktok_product_trends_*.csv`: videos recentes filtrados;
- `outputs\tiktok_product_trends_*_produtos.csv`: ranking agregado por produto;
- `outputs\tiktok_product_trends_*_todos_videos.csv`: detalhes brutos;
- `outputs\tiktok_product_trends_*_resumo.txt`: resumo humano.

Ultimo sinal util salvo:

- `aquecedor torneira`;
- `secadora portatil roupa`;
- `limpador vidro`;
- `organizador geladeira`;
- `pano multiuso descartavel`;
- `mini impressora termica`;
- `escova limpeza eletrica`;
- `dispensador graos`.

Uso correto:

- usar `*_produtos.csv` como superficie principal de decisao;
- preferir `--visible`, porque headless deu resultados mais fracos;
- aumentar rigor para `--min-videos=3` quando quiser menos ruido;
- depois alimentar os vencedores como `DISCOVERY_TERMS` do `index.js`.

### 3. `scripts\build-amazon-asin-seo.js` - pacote SEO/cadastro downstream

Este script so deve entrar depois que um produto ja foi escolhido. Ele nao e a
ferramenta de descoberta.

Responsabilidades:

- le JSON, NDJSON ou CSV de produtos;
- normaliza nomes, nicho, views, likes, preco, custo, notas e hashtags;
- monta titulo, descricao, bullets/diferenciacao e termos backend;
- estima margem quando ha preco/custo;
- marca riscos de marca/regulatorios;
- gera pacote estruturado em JSON.

Comando exemplo:

```powershell
npm run seo:tiktok -- --input=outputs\tiktok_product_trends_20260520_220751_produtos.csv
```

Uso correto:

- usar como etapa de empacotamento para Amazon;
- nao usar como substituto para busca real no TikTok ou validacao Seller Central.

### 4. `scripts\export-amazon-shipped-orders.js` - exportador de pedidos enviados

Este fluxo e independente da descoberta de produtos. Ele existe para puxar
pedidos enviados do Seller Central e entregar uma planilha limpa.

Responsabilidades:

- abre `https://sellercentral.amazon.com.br/orders-v3/mfn/shipped`;
- usa o perfil `.playwright-amazon-profile`;
- espera login/MFA quando necessario;
- coleta a lista de pedidos;
- entra no detalhe de cada pedido;
- extrai cliente, telefone, email, endereco, valor e itens;
- normaliza telefone brasileiro;
- evita confundir telefone com pedido, CEP, CPF/CNPJ, rastreio, SKU, ASIN ou nota;
- navega paginacao do Seller Central;
- gera CSV e XLS compativel com Excel.

Comando validado:

```powershell
npm run export:amazon-orders -- --limit=50 --pages=2
```

Ultima execucao validada:

- `outputs\amazon_pedidos_enviados_20260519_094512.xls`;
- `outputs\amazon_pedidos_enviados_20260519_094512.csv`;
- 24 pedidos exportados;
- XLS e o formato preferido para abrir no Excel.

Diagnosticos:

- `outputs\amazon_orders_pagination_*.html`;
- `outputs\amazon_orders_pagination_*.png`;
- `outputs\amazon_orders_export_*.out.log`;
- `outputs\amazon_orders_export_*.err.log`.

## Pastas e arquivos de estado

### `.playwright-amazon-profile`

Perfil persistente do Chromium para Seller Central/Amazon. Guarda sessao, login
e cookies. Nao apagar sem necessidade.

### `.playwright-tiktok-profile`

Perfil persistente do Chromium para TikTok. Ajuda a manter cookies e reduzir
friccao em buscas visiveis.

### `outputs`

Pasta de resultados recentes. Contem:

- rankings TikTok;
- planilhas de pedidos;
- logs de exportacao;
- diagnosticos de paginacao;
- artefatos de mineracao.

### `backups`

Logs antigos de mineracao publica e CSVs arquivados. Use para investigar
historico, nao como fonte principal atual.

### `.discovery-state.json`

Estado anti-repeticao e progresso de descoberta. Ajuda o bot a nao testar de
novo os mesmos ASINs ou fontes recentes.

### `.env`

Configuracao operacional ativa. Ler valores com cuidado, sem expor segredo.
As chaves atuais incluem navegador visivel/background, margem, taxa Amazon,
modo keyword, termos de descoberta, ordenacao e modo intermitente.

### `NEXT_CHAT_CONTEXT.md`

Handoff antigo de 2026-05-17. Contexto: nicho de Cama, Mesa e Banho/Decoracao,
Manta Para Sofa Caramelo, VestHouse e taxa Amazon ajustada para 12%.

## Ordem recomendada de trabalho

### Para descobrir novos produtos

1. Rodar `scripts\search-tiktok-products.js` com clusters de produto.
2. Ler `*_produtos.csv` e `*_resumo.txt`.
3. Escolher familias com videos recentes de criadores diferentes.
4. Passar essas familias para `DISCOVERY_TERMS` no `.env`.
5. Rodar `node --check index.js`.
6. Rodar `node index.js` para validar ASINs no Seller Central.
7. So depois gerar SEO/cadastro com `scripts\build-amazon-asin-seo.js`.

### Para validar ASINs especificos

1. Preencher `ASIN_SEEDS`.
2. Usar `DISCOVERY_MODE=asin`.
3. Rodar `node index.js`.
4. Conferir status no CSV e logs.

### Para exportar pedidos enviados

1. Rodar `npm run export:amazon-orders -- --limit=50 --pages=2`.
2. Se parar em login/MFA, completar na janela Chromium.
3. Abrir o `.xls` mais recente em `outputs`.
4. Comparar quantidade exportada com o total visivel no Seller Central.

## Estrategia atual consolidada das conversas antigas

- Descoberta no TikTok deve ser por frequencia recente, nao por um video viral
  isolado.
- Produto que aparece em varios videos recentes de criadores diferentes e um
  sinal melhor para este projeto.
- SEO/JSON e etapa posterior, nao descoberta.
- Sem SP-API disponivel, a rota real e browser automation.
- Public Amazon sozinho gera falso positivo; Seller Central e o gate real.
- Importados/Amazon Global devem ser filtrados cedo.
- Chromium visivel em background e o padrao operacional mais util para este
  workspace.
- Quando o usuario pede para rodar, executar e reportar resultado, em vez de
  ficar em plano teorico.

## Scripts npm

```json
{
  "export:amazon-orders": "node scripts/export-amazon-shipped-orders.js",
  "tiktok:search": "node scripts/search-tiktok-products.js",
  "seo:tiktok": "node scripts/build-amazon-asin-seo.js"
}
```

## Dependencias

- `playwright`: automacao de navegador;
- `dotenv`: leitura do `.env`;
- Node.js.

## Observacao de engenharia

Nao ha repositorio Git inicializado em `C:\Amazon` neste momento. Antes de fazer
refatoracao fisica de arquivos ou mover outputs para novas pastas, inicialize
versionamento ou faca backup, porque os caminhos atuais sao usados diretamente
pelos scripts.
