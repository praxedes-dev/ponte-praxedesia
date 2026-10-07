# Obra 15 — PDF com cabeçalho/rodapé e páginas (item 15) e `browser_javascript` com argumentos (item 16)

**Lote B. Depende da obra 01 (módulos `capacidades/arquivos.ts` e `capacidades/js.ts` já
existem, movidos de `capabilities.ts`; `tools/arquivos.js`, `tools/js.js`). Arquivos disjuntos
do Lote A.**

## Objetivo em uma frase

`browser_save_pdf` ganha cabeçalho/rodapé (data no comprovante), seleção de páginas e margens;
`browser_javascript` ganha `args`, para texto de petição e nome com aspas irem como argumento e
não interpolados dentro de string de código — tudo mantendo as chamadas de hoje funcionando.

## Por que existe

- **PDF:** comprovante de protocolo precisa de data/hora no rodapé; decisão longa, só as páginas
  relevantes; timbre pede margem. `paginaEmPdf` passa só `landscape` e `printBackground`
  (estudo 2, §B.8).
- **JS:** hoje todo dado entra interpolado por `JSON.stringify` dentro da string de código
  (`baixarComoBase64` faz isso à mão em `capabilities.ts:236-250`); aspas e quebras de linha num
  texto de petição quebram o script (estudo 2, §B.9).

## Âncoras conferidas na fonte (05/09/2026, antes da 01 — confira onde a 01 pôs cada trecho)

- `capabilities.ts:199-211` → `capacidades/arquivos.ts` — `paginaEmPdf(tabId, { paisagem, fundo })`:
  `Page.printToPDF { landscape, printBackground, preferCSSPageSize: false }`; erro se `!res.data`.
- `bridge/index.ts:653-654` → registro em `arquivos.ts` — `cap_pdf` passa `{ paisagem, fundo }`.
- `tools.js:359-376` → `tools/arquivos.js` — `browser_save_pdf { caminho, paisagem, fundo }`,
  `timeout: 120_000`, `gravaEm: (i) => i.caminho` (o servidor grava; `index.js:90-101`).
- `capabilities.ts:23-40` → `capacidades/js.ts` — `executarJs(tabId, codigo)`: `Runtime.evaluate
  { expression, returnByValue, awaitPromise, userGesture }`, **sem `replMode`** (comentário na 32:
  "ligado, ele quebra a serializacao e todo objeto volta como {}"); `exceptionDetails` → `Error('erro
  no script: ...')`.
- `bridge/index.ts:622-623` → registro em `js.ts` — `cap_js` passa `p.codigo`.
- `tools.js:326-337` → `tools/js.js` — `browser_javascript { codigo }`.
- `capabilities.ts:52-63` — `Runtime.callFunctionOn { objectId, functionDeclaration, arguments:
  [{ value }], returnByValue }` já é usado em `preencherCampo`; é o mecanismo dos `args`.
- Estudo 2, §B.8 pegadinhas: `displayHeaderFooter: true` senão os templates são ignorados em
  silêncio; o cabeçalho "come" a margem superior.

## O que construir

### PDF (`capacidades/arquivos.ts`, `tools/arquivos.js`)

`paginaEmPdf(tabId, opts)` aceita, além de `paisagem`/`fundo`: `cabecalho?: string`,
`rodape?: string` (HTML; classes do CDP `date`, `title`, `url`, `pageNumber`, `totalPages`),
`paginas?: string` (`"1-3,5"`), `margens_cm?: { cima, baixo, esquerda, direita }`, `escala?:
number`. Monta `displayHeaderFooter: !!(cabecalho || rodape)`, `headerTemplate: cabecalho ??
'<span></span>'`, `footerTemplate: rodape ?? '<span></span>'`, `pageRanges`, margens em
**polegadas** (cm ÷ 2,54; padrão do Chrome ~1 cm; com cabeçalho/rodapé, mínimo 1,5 cm em cima e
embaixo ou o template some), `scale`. `pageRanges` inválido → o CDP erra; repasse a mensagem.
Registro `cap_pdf` passa tudo. Schema de `browser_save_pdf` ganha os campos; descrição traz um
exemplo de rodapé pronto:
`<div style="font-size:9px;width:100%;text-align:right;padding-right:1cm">Pág. <span class="pageNumber"></span>/<span class="totalPages"></span> · <span class="date"></span></div>`
(templates sem `font-size` renderizam minúsculos — diga isso).

### JS com argumentos (`capacidades/js.ts`, `tools/js.js`)

`executarJs(tabId, codigo, args?: unknown[])`: `args === undefined` → caminho de hoje, byte a byte.
Com `args`: `Runtime.evaluate { expression: 'window', returnByValue: false }` → `objectId`;
`Runtime.callFunctionOn { objectId, functionDeclaration: 'async function(...args) { ' + codigo + '\n}',
arguments: args.map(v => ({ value: v })), returnByValue: true, awaitPromise: true, userGesture: true }`;
mesmo tratamento de `exceptionDetails`; `Runtime.releaseObject` do `window` em `finally`. `async`
para `await` funcionar no corpo. Só JSON-serializável em `args` (documente). Registro `cap_js`
passa `p.args`. Schema de `browser_javascript` ganha `args: { type: 'array', items: {} }` com a
descrição: "com args, `codigo` é o CORPO de uma função (use return) e recebe o array `args`; passe
aqui texto de petição, nome com aspas, JSON — nunca interpolado no código".

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/arquivos.ts`, `entrypoints/background/bridge/capacidades/js.ts`,
`bridge-server/src/tools/arquivos.js`, `bridge-server/src/tools/js.js`, `bridge-server/test/pdf-js-args.js` (novo).

## Arquivos que você NÃO PODE tocar

`bridge-server/src/index.js` (`gravarEmDisco` já serve), `capabilities.ts` (barril),
`bridge/index.ts`, `registro.ts`/`index.ts` dos dois lados, qualquer outro módulo/tool,
`package.json`, `README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote B: obras 13 (`destaque.ts`, `assentar.ts`, `tools/interacao.js`) e 14 (`screenshot-recorte.ts`,
`console.ts`, `tools/diagnostico.js`). A obra 16 (Lote C) vai tocar `js.ts` e `tools/js.js`
**depois** de você; deixe o código limpo para ela. Trava de build compartilhada.

## Padrão da casa a imitar

- **Compatibilidade por parâmetro opcional**, não por tool nova: `browser_type` com `modo`
  (`tools.js:118-140`) e `browser_click` com `x/y`.
- **`callFunctionOn` com `arguments`:** `capabilities.ts:52-63`.
- **Comentário que registra a pegadinha:** `capabilities.ts:32` (`replMode`). Escreva o da
  `displayHeaderFooter` e o do `async` no mesmo tom.
- Teste: `test/capabilities.js:105-108` (PDF gravado, tamanho > 1000).

## O que NÃO fazer, e por quê

- **Não mude o caminho sem `args`** de `executarJs` (é o que toda skill usa hoje).
- **Não "detecte" `return` e embrulhe automaticamente**: mágica que erra em código com `return`
  dentro de função interna. Documente que com `args` é corpo de função.
- **Não converta `cm` em `in` errado**: 1 cm = 0,3937 in.
- **Defeito irmão:** `headerTemplate` vazio com `displayHeaderFooter: true` imprime o cabeçalho
  padrão do Chrome (data + título) — por isso `'<span></span>'` quando só um dos dois veio.

## Armadilhas conhecidas

- `replMode` quebra serialização (não use). `returnByValue` sempre.
- `Page.printToPDF` em página com diálogo aberto trava — a obra 04 barra antes.
- Templates de cabeçalho não carregam CSS externo nem imagens de URL; só inline.

## Critério de pronto

`bridge-server/test/pdf-js-args.js` (novo):
1. Página longa (30 parágrafos via JS) → `browser_save_pdf` inteiro (S1 bytes) e com `paginas: '1'`
   (S2) → `S2 < S1`, ambos > 1000.
2. `rodape` com `pageNumber` e `margens_cm: { cima: 2, baixo: 2 }` → arquivo gravado, tamanho
   diferente do sem rodapé; sem erro.
3. `paginas: '9-7'` → `isError` com a mensagem do CDP.
4. `browser_javascript { codigo: 'return args[0] + args[1]', args: [1, 2] }` → `3`.
5. `{ codigo: 'return args[0].length', args: ['um "texto" com \'aspas\' e\nquebra'] }` → o tamanho
   certo.
6. `{ codigo: 'return await new Promise(r => setTimeout(() => r(args[0]), 100))', args: ['ok'] }` → `ok`.
7. `{ codigo: 'document.title' }` (sem `args`) continua funcionando como hoje.
8. `{ codigo: 'throw new Error("x")', args: [] }` → `isError` com `erro no script`.
`npx tsc --noEmit` só com o erro pré-existente. Rode também `node test/capabilities.js` (usa
`browser_javascript` e `browser_save_pdf` sem os campos novos).

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/pdf-js-args.js && node test/capabilities.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-15 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seus testes →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

Toda chamada de hoje (`codigo` só; `caminho`/`paisagem`/`fundo` só) produz o mesmo resultado.
Regressão inaceitável: `capabilities.js` vermelho; `browser_javascript` sem `args` mudando de
comportamento.

## Como reportar

Saída dos testes; o exemplo de rodapé que ficou bonito (descreva); notas para o README (tabela de
tools) e para a skill `protocolo-pje-ponte` (texto de petição via `args`). Não edite nenhum.
