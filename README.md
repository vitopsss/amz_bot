# Amazon Automation Workspace

Comece por `PROJECT_CONTEXT.md`. Ele separa cada parte do projeto, o que cada
script faz, quais arquivos sao estado/saida e qual fluxo usar em cada caso.

## Fluxos principais

- Descoberta TikTok: `npm run tiktok:search`
- Mineracao/validacao Amazon + Seller Central: `node index.js`
- Exportacao de pedidos enviados: `npm run export:amazon-orders`
- Pacote SEO/cadastro depois de escolher produto: `npm run seo:tiktok`

## Validacao rapida

```powershell
node --check index.js
node --check scripts\search-tiktok-products.js
node --check scripts\export-amazon-shipped-orders.js
node --check scripts\build-amazon-asin-seo.js
```

## Ordem recomendada para novos produtos

1. Procurar produto no TikTok por frequencia recente.
2. Usar os vencedores como termos de descoberta do `index.js`.
3. Validar o ASIN no Seller Central.
4. Procurar fornecedor/margem.
5. Gerar SEO/cadastro so depois que o produto estiver escolhido.

Nao ha repositorio Git inicializado neste workspace no momento.
