# Automação de Marketplace (Amazon)

Conjunto de automações com **Playwright** que cobre o ciclo de escolha e cadastro de produtos num marketplace:

1. **Descoberta**: busca produtos com sinal de demanda recente no TikTok (`scripts/search-tiktok-products.js`).
2. **Mineração e validação** (`index.js`): navega na Amazon por keyword, ASIN ou vitrines, filtra faixa de preço, importados e marcas fortes, e testa no Seller Central se o ASIN pode ser vendido.
3. **Margem**: calcula a margem com a taxa do marketplace e o custo operacional, e grava tudo em CSV.
4. **SEO de cadastro**: gera título, bullets e palavras-chave para o produto escolhido (`scripts/build-amazon-asin-seo.js`).
5. **Pedidos**: exporta pedidos enviados do Seller Central (`scripts/export-amazon-shipped-orders.js`).

Também guarda estado entre execuções (ASINs já vistos e bloqueios recorrentes) para não repetir trabalho, e pode rodar em loop intermitente.

## Stack

Node.js · Playwright · dotenv

## Como rodar

```bash
npm install
npx playwright install chromium
# crie um .env com MIN_MARGIN, HEADLESS_MODE etc. (lista em PROJECT_CONTEXT.md)

npm run tiktok:search          # descoberta
node index.js                  # mineração + validação
npm run seo:tiktok             # pacote de SEO
npm run export:amazon-orders   # exportação de pedidos
```

O login no Seller Central usa um perfil persistente do navegador. Nenhuma credencial fica no código.

Detalhes de cada script, variáveis e arquivos de estado: [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).
