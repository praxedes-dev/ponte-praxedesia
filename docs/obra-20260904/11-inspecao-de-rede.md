# Obra 11 — Ver a rede: listar requisições e ler corpo de resposta (item 11)

**Lote A. Depende da obra 01 (stub `capacidades/rede-inspecao.ts`, gancho `aoAnexar`).**

## Objetivo em uma frase

`browser_network_requests` lista o que a aba pediu (URL, método, status, tipo, tamanho, falha) e
`browser_network_body` lê o corpo de uma resposta já carregada via `Network.getResponseBody` —
para, quando um upload do PJe falha em silêncio, o corpo do 400/500 ser a pista.

## Por que existe

Hoje a ponte só **espera** a rede acalmar (`browser_wait_network`); não vê o que passou. O domínio
`Network` já está ligado (`debugger-manager/index.ts:66`) e os eventos já chegam — só alimentam um
contador (`cdp-tools.ts:472-491`). Quando o Dropzone do PJe recusa um arquivo "sem mensagem, sem
`.dz-error-message`, sem console" (skill `protocolo-pje-ponte` §4.0), a resposta HTTP é a única
testemunha. Playwright MCP e Chrome DevTools MCP têm listagem + corpo (estudo 3, §A).

## Âncoras conferidas na fonte (05/09/2026)

- `debugger-manager/index.ts:37-55` `dm.on(tabId, method, cb)` devolve o `off`; 27-34 `onDetach`
  apaga os listeners (por isso você registra pelo gancho `aoAnexar`, que a 01 roda no reattach).
- `cdp-tools.ts:472-491` — `Network.requestWillBeSent`, `loadingFinished`, `loadingFailed` já são
  escutados por `waitForNetworkIdle`; **não** os mexa; você registra os seus.
- `capabilities.ts:214-216` (pós-01: `rede.ts`) — `esperarRede`; **não** é seu arquivo.
- Estudo 2 §B.1: `Network.getResponseBody(requestId)` só funciona enquanto a resposta está no
  cache do domínio; navegou, some. Corpo binário volta `base64Encoded: true`.

## O que construir

`capacidades/rede-inspecao.ts`:

- Buffer por aba (`Map<tabId, Entrada[]>`, teto 300, descarta o mais velho). `Entrada = {
  requestId, url, metodo, tipo (Document|XHR|Fetch|Script|...), status?, mime?, bytes?,
  iniciadoEm, concluidoEm?, falha?: string }`.
- Gancho `aoAnexar(tabId)`: `dm.on` para `Network.requestWillBeSent` (cria a entrada;
  `initiator.type` se quiser), `Network.responseReceived` (status, mime), `Network.loadingFinished`
  (`encodedDataLength`), `Network.loadingFailed` (`errorText`). `chrome.tabs.onRemoved` apaga o
  buffer da aba.
- `cap_network_requests { filtro_url?, tipo?, so_falhas?, limite = 50 }` (não altera): do mais
  novo para o mais velho; `url` cortada em 200; `filtro_url` é substring, case-insensitive.
- `cap_network_body { requestId?, filtro_url?, max_chars = 20000 }` (não altera): sem
  `requestId`, pega a **mais recente** que casa `filtro_url`. `Network.getResponseBody` → texto:
  corta em `max_chars` com aviso `[... N caracteres restantes]`; `base64Encoded` e mime não
  textual → `{ binario: true, mime, bytes, aviso: 'use browser_download com esta url' }`. Erro do
  CDP ("No resource with given identifier"/"No data found") → `corpo nao esta mais em cache (a aba
  navegou ou a resposta expirou) — refaça a acao e leia logo depois`.

`tools/rede-inspecao.js`: `browser_network_requests` e `browser_network_body`, descrições com o
caso de uso (upload do PJe que falha calado; API do tribunal que a tela não mostra).

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/rede-inspecao.ts`, `bridge-server/src/tools/rede-inspecao.js`,
`bridge-server/test/rede-inspecao.js` (novo).

## Arquivos que você NÃO PODE tocar

`capacidades/rede.ts`, `cdp-tools.ts`, `debugger-manager/**`, `bridge/index.ts`,
`registro.ts`/`index.ts` dos dois lados, qualquer outro módulo, `package.json`, `README.md`,
`ESTADO.md`.

## Quem mais está construindo agora

Lote A: 04, 05, 06, 07, 08, 09, 10, 12, cada uma no próprio módulo. A 08 toca `bridge/index.ts`.
Trava de build compartilhada.

## Padrão da casa a imitar

- **Listener por aba com `off` guardado:** `cdp-tools.ts:488-503`.
- **Resposta cortada com aviso de continuação:** `format.js:54-66` (`cortar`).
- **Erro que diz o remédio:** `bridge/index.ts:486-490`.
- Teste: `test/capabilities.js` (navegar, `browser_javascript` para provocar um `fetch`, conferir).

## O que NÃO fazer, e por quê

- **Não use `Fetch.enable`/interceptação**: muda o comportamento de toda requisição da aba; o
  estudo 2 chama de "caminho pesado, evitável". Só leitura passiva.
- **Não devolva corpo binário em base64 no texto** (PDF de inteiro teor tem megabytes; a janela
  do agente morre). `browser_download` já existe para isso.
- **Não guarde corpo no buffer**; só metadados. O corpo se busca sob demanda.
- **Defeito irmão:** o listener de `waitForNetworkIdle` e o seu escutam o mesmo evento; se você
  lançar dentro do callback, `dm.onEvent` (`debugger-manager/index.ts:14-25`) itera com
  `forEach` e um `throw` seu interrompe os outros. `try/catch` em todo callback.

## Armadilhas conhecidas

- `Network.requestWillBeSent` chega **antes** de `Network.enable`? Não: só depois. Aba anexada
  antes desta obra ganha listeners no próximo reattach; documente.
- Redirecionamentos: o mesmo `requestId` recebe novo `requestWillBeSent` com `redirectResponse`;
  atualize a entrada em vez de duplicar.
- `replMode` não se aplica (não há `evaluate` aqui). `returnByValue` idem.
- Service worker dorme: buffer em memória some; é aceitável (diga na descrição da tool: "desde a
  última reconexão").

## Critério de pronto

`bridge-server/test/rede-inspecao.js` (novo):
1. `browser_navigate example.com` → `browser_network_requests` traz a entrada `Document` com
   `status 200` e `url` de `example.com`; `browser_network_body { filtro_url: 'example.com' }`
   contém `Example Domain`.
2. `browser_javascript "fetch('https://example.com/?x=1').then(r=>r.text())"` →
   `browser_network_requests { filtro_url: 'x=1' }` traz `Fetch`/`XHR` com 200; `body` legível.
3. `fetch('https://nao-existe.invalid/')` → `so_falhas: true` lista com `falha` preenchida.
4. Após `browser_navigate` para outra página, `browser_network_body` da requisição antiga →
   erro com `nao esta mais em cache`.
5. `limite: 2` devolve 2, do mais novo.
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/rede-inspecao.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-11 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seu teste →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`browser_wait_network` e `waitForNetworkIdle` intocados. Regressão inaceitável: `capabilities.js`
(que usa `wait_network`) vermelho; qualquer requisição da página alterada ou bloqueada.

## Como reportar

Saída do teste; exemplo real de listagem; notas para o README (duas tools; "desde a última
reconexão"; corpo binário → `browser_download`). Não edite o README.
