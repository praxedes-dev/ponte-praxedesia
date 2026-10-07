# Obra 14 — Diagnóstico: screenshot de um elemento (item 12) e console de verdade via CDP (item 17)

**Lote B. Depende da obra 01 (stubs `capacidades/screenshot-recorte.ts`, `capacidades/console.ts`;
`tool.imagem`; gancho `aoAnexar`). Arquivos disjuntos do Lote A.**

## Objetivo em uma frase

`browser_screenshot { ref }` recorta só o elemento (conferir o campo preenchido ou o número do
protocolo sem gastar a tela inteira), e `browser_console_logs` passa a ler o console **real** da
página pelo CDP — inclusive exceções não tratadas e erros de rede — em vez de um array que só vê o
console do mundo isolado.

## Por que existe

- **Console:** o estudo 2 achou que `browser_console_logs` "lê de um array que talvez ninguém
  preencha". **Correção do fechador:** o array **é** preenchido — `entrypoints/content/index.ts:8-26`
  monkeypatcha `console.log/warn/error` — mas o content script roda no **mundo isolado** (sem
  `world: 'MAIN'`, linhas 3-6), então intercepta o `console` do mundo isolado, **não o da página**.
  Para log de página a tool volta vazia por esse motivo. O CDP já tem `Runtime.enable` ligado
  (`debugger-manager/index.ts:65`): `Runtime.consoleAPICalled` e `Runtime.exceptionThrown` chegam
  de graça; `Log.enable` traz o resto (404, CORS, segurança).
- **Recorte:** hoje `debuggerManager.screenshot` (`debugger-manager/index.ts:129-136`) sempre
  captura a aba inteira. `Page.captureScreenshot` aceita `clip`; o cálculo de retângulo já existe
  em `cdpClickByRef` (`cdp-tools.ts:243-271`).

## Âncoras conferidas na fonte (05/09/2026)

- `entrypoints/content/index.ts:3-26` — `defineContentScript({ matches: ['<all_urls>'], runAt:
  'document_idle' })`, sem `world`; o monkeypatch. **Não é seu arquivo**; fica como está.
- `execution-engine/index.ts:357-368` — `get_console_logs` lê `window.__agentConsoleLogs` por
  `safeExecuteScript` (mundo isolado, coerente com o content script — e por isso nunca vê a página).
- `execution-engine/index.ts:34-47` — `screenshot`: esconde o indicador (`HIDE_FOR_TOOL_USE`),
  50 ms, captura, `SHOW_AFTER_TOOL_USE` em `finally`. **Copie a coreografia** no recorte.
- `debugger-manager/index.ts:129-136` — `screenshot(tabId)`: `Page.captureScreenshot { format:
  'jpeg', quality: 75, optimizeForSpeed: true }`. Não edite; chame `dm.send` com `clip` no seu módulo.
- `tools.js:80-84` (pós-01: `tools/diagnostico.js`) — `browser_screenshot`, `action: 'screenshot'`
  fixo; `tools.js:266-274` — `browser_console_logs`, `action: 'get_console_logs'`.
- `bridge-server/src/index.js:103-107` — `formatResult` devolve imagem **só** quando
  `tool.action === 'screenshot'` (comparação com string). A obra 01 pôs, **antes** disso, o
  suporte genérico `tool.imagem`. **Defeito irmão:** se você transformar `action` de
  `browser_screenshot` em função (ref → `cap_screenshot_ref`) **sem** marcar `imagem:
  'image/jpeg'` na tool, o screenshot inteiro passa a voltar como texto base64 gigante. Marque.
- Estudo 2, §B.6: `clip` é em coordenadas de página × viewport dependendo da versão; testar com
  rolagem não-zero.

## O que construir

`capacidades/screenshot-recorte.ts`, `cap_screenshot_ref { ref?, regiao?: {x,y,w,h}, escala? }`
(não altera):
- Com `ref`: `DOM.scrollIntoViewIfNeeded { backendNodeId }` → `DOM.getBoxModel` (quad `content`,
  como em `cdp-tools.ts:261-270`) → retângulo no viewport. Com `regiao`: usa direto.
- `chrome.tabs.sendMessage(tabId, { type: 'HIDE_FOR_TOOL_USE' })`, 50 ms,
  `Page.captureScreenshot { format: 'jpeg', quality: 80, clip: { x, y, width, height, scale:
  escala ?? 1 } }`, `finally` `SHOW_AFTER_TOOL_USE`. **Meça** com a página rolada se `clip` quer
  coordenadas de viewport ou de página (`captureBeyondViewport`); ajuste e documente.
- Elemento sem caixa (display none) → erro `o elemento nao tem area visivel`.

`capacidades/console.ts`:
- `aoAnexar(tabId)`: `dm.send(tabId, 'Log.enable')` (meça se permitido; erro → segue só com
  `Runtime`); `dm.on` para `Runtime.consoleAPICalled` (`{ type, args, timestamp }` → texto =
  `args.map(a => a.value ?? a.description).join(' ')`), `Runtime.exceptionThrown`
  (`exceptionDetails.exception?.description ?? text`, `url`, `lineNumber`) e `Log.entryAdded`
  (`entry.level`, `text`, `url`, `source`). Buffer por aba, 200 entradas
  `{ quando, nivel: log|info|warn|error|excecao, origem: console|excecao|rede|seguranca|outro,
  texto (≤ 500), url?, linha? }`. `chrome.tabs.onRemoved` limpa.
- `cap_console { max = 50, nivel? }` (não altera): cronológico, últimas `max`.

`tools/diagnostico.js`:
- `browser_screenshot`: schema ganha `ref`, `regiao`, `escala`; `action: (i) => (i.ref !== undefined
  || i.regiao) ? 'cap_screenshot_ref' : 'screenshot'`; `build` passa os params; **`imagem:
  'image/jpeg'`**. Descrição: "com ref, só o elemento — mais barato e sem ambiguidade".
- `browser_console_logs`: `action: 'cap_console'`; schema ganha `nivel`; descrição: "console real
  da página via CDP, com exceções não tratadas e erros de rede; desde a última reconexão da aba".

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/screenshot-recorte.ts`,
`entrypoints/background/bridge/capacidades/console.ts`, `bridge-server/src/tools/diagnostico.js`,
`bridge-server/test/diagnostico.js` (novo).

## Arquivos que você NÃO PODE tocar

`entrypoints/content/index.ts` (o monkeypatch fica; é dívida a relatar, não a remover),
`execution-engine/**`, `debugger-manager/**`, `bridge-server/src/index.js`, `bridge/index.ts`,
`registro.ts`/`index.ts` dos dois lados, qualquer outro módulo/tool, `package.json`, `README.md`,
`ESTADO.md`.

## Quem mais está construindo agora

Lote B: obras 13 (`destaque.ts`, `assentar.ts`, `tools/interacao.js`) e 15 (`arquivos.ts`,
`js.ts`, `tools/arquivos.js`, `tools/js.js`). Talvez obras do Lote A terminando. Ninguém mais em
`tools/diagnostico.js`. Trava de build compartilhada.

## Padrão da casa a imitar

- **A extensão não pode aparecer na própria leitura:** `execution-engine/index.ts:34-47` e o
  cabeçalho de `agent-indicator.content.ts:11-29`. Esconder/mostrar em volta da captura.
- **Retângulo por `DOM.getBoxModel` quando `getBoundingClientRect` falha:** `cdp-tools.ts:258-270`.
- **Buffer com teto e limpeza por aba:** a obra 11 (`rede-inspecao.ts`) faz igual; se ela já
  estiver no repo quando você começar, imite a forma.
- Teste que decodifica a imagem: `test/e2e.js:107-108` só confere `type === 'image'` e tamanho;
  você vai além — lê as dimensões do JPEG (marcador SOF0/SOF2: bytes `FF C0`/`FF C2`, altura e
  largura em big-endian logo depois) para provar o recorte.

## O que NÃO fazer, e por quê

- **Não mude `entrypoints/content/index.ts` para `world: 'MAIN'`**: injetar monkeypatch no mundo da
  página altera o `console` que o site vê (e sites de tribunal têm scripts frágeis). O CDP observa
  sem tocar.
- **Não remova a `action: 'screenshot'` do caminho sem ref**: o recorte é adição.
- **Não devolva o buffer inteiro por padrão**: `max = 50`.
- **Não guarde `args` de objeto inteiro** (`description` pode ter kilobytes): corte em 500.
- **Defeito irmão:** `Runtime.consoleAPICalled` também dispara para `console.log` feito **pelo
  próprio agente** via `browser_javascript`; é correto listar, mas marque `origem: console` igual —
  não tente filtrar "quem chamou".

## Armadilhas conhecidas

- `replMode` quebra serialização (não use). `returnByValue` sempre.
- Aba anexada antes desta obra ganha listeners no próximo reattach; documente ("desde a última
  reconexão").
- `clip` com `scale` > 1 aumenta a imagem; padrão 1.
- Service worker dorme: buffer some; aceitável e documentado.

## Critério de pronto

`bridge-server/test/diagnostico.js` (novo):
1. Console: `browser_javascript "console.log('marca-123'); console.error('erro-456'); 1"` →
   `browser_console_logs` traz os dois, com `nivel` certo e `origem: console`.
2. `browser_javascript "setTimeout(() => { throw new Error('boom-789') }, 50); 1"`, 300 ms →
   entrada `origem: excecao` com `boom-789`.
3. `fetch('https://example.com/nao-existe-404')` → se `Log.enable` foi permitido, entrada
   `origem: rede` com 404 (senão, registre que `Log` não é permitido e pule).
4. `nivel: 'error'` filtra.
5. Recorte: página com `<div id="alvo" style="width:200px;height:100px;background:red">` precedido
   de um espaçador de 3000 px → `browser_screenshot { ref }` → `type === 'image'`; dimensões do
   JPEG ≈ 200×100 (±3 px, considerando `devicePixelRatio` — leia `window.devicePixelRatio` e
   divida). Mesmo com a página rolada ao topo antes.
6. `browser_screenshot` sem `ref` continua voltando imagem (o defeito irmão do `formatResult`).
7. `regiao: {x:0,y:0,w:50,h:50}` → ≈ 50×50.
`npx tsc --noEmit` só com o erro pré-existente. Rode também `node test/e2e.js` (usa screenshot).

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/diagnostico.js && node test/e2e.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-14 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seus testes →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

Screenshot inteiro e `get_console_logs` do motor continuam existindo. Regressão inaceitável:
`e2e.js` vermelho; screenshot inteiro voltando como texto.

## Como reportar

Medições (`Log.enable` permitido?; `clip` em que coordenadas?); saída dos testes; notas para o
README (tabela de tools: screenshot com `ref`; console real) e a dívida do monkeypatch em
`content/index.ts` (sem uso agora; candidata a remoção em obra própria). Não edite o README.
