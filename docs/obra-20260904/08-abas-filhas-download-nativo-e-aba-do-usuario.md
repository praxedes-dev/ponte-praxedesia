# Obra 08 — Aba filha vira da ponte, download nativo cai numa pasta, e dois furos na aba do usuário (item 10 + achados)

**Lote A. Depende da obra 01. É a ÚNICA obra do lote autorizada a editar `bridge/index.ts`.**
**Cético: Opus** (toca o isolamento e a aba do usuário).

## Objetivo em uma frase

Que "clique aqui e pegue o PDF onde ele aparecer" funcione pela ponte: aba filha de aba da ponte
passa a ser da ponte (`browser_wait_new_tab` espera ela nascer), download que o Chrome faz sozinho
cai numa pasta conhecida e a ponte sabe quando terminou — e, de passagem, `browser_tab_open` deixa
de abrir aba na janela do usuário e `browser_tab_close` deixa de fechar aba dele.

## Por que existe

**Custas (decisão 2 do Cezar: vem para a ponte).** A emissão de guia de custas hoje **nem usa a
ponte**: o clique em "Emitir a guia de recolhimento" ora abre **aba nova**
(`…guiaRecolhimentoEmitirAvulsa.jsf?cid=N`), ora navega na própria aba. O script Playwright
vigiava só a aba de origem, morria com `TypeError ... reading 'innerText'` **depois de a guia ter
sido emitida**, e quem executou leu isso como falha, repetiu, e ficou uma **segunda guia órfã de
R$ 153,10 no CPF do cliente CLIENTE C** (18/08/2026;
`~/.claude/skills/mandado-seguranca-icms-solar/nucleo/checklist-pje.md` 55-69). Depois, só o
clique em "Imprimir boletos" gera o PDF — um download que o navegador faz sozinho, sem URL para o
`browser_download`. Tribunais abrem inteiro teor e comprovante em aba nova do mesmo jeito.

**Os dois achados do fechador** (05/09, lendo a fonte; hipóteses até você medir):
1. `browser_tab_open` abre a aba **na janela do usuário**: `execution-engine/index.ts:201-205` →
   `workspaceManager.addTab` → `workspace-manager/index.ts:184` `chrome.tabs.create({ url, active: false })`
   **sem `windowId`** — para um service worker, "janela atual" é a focada, a dele. Aí
   `bridge/index.ts:384-391` marca a aba como da ponte e a torna ativa; o próximo input
   (`comAbaPronta`, 794-797) faz `chrome.tabs.update(active: true)` **na janela dele**. É a mesma
   classe do incidente de 19/08 ("via a aba trocar pelo link que o agente precisava abrir").
2. `browser_tab_close { tabId }` fecha **qualquer** aba: `execution-engine/index.ts:220-224`
   `chrome.tabs.remove(closeTabId)`; em `bridge/index.ts` o conjunto `abasCriadasPelaPonte` só
   guarda `switch_tab` (344) e `encerrar` (868), nunca `close_tab`; e `close_tab` não está em
   `ACOES_QUE_ALTERAM`, então nem o modo leitura pega. O README promete o contrário ("são as
   únicas que ela pode fechar").

## Âncoras conferidas na fonte (05/09/2026, antes da 01 — confira onde a 01 deixou cada trecho)

- `bridge/index.ts:106-113` `abasAdotadas` (aba do usuário adotada, nunca fechar) e
  `abasCriadasPelaPonte` (as únicas que a ponte fecha); 144-164 `start()` (onde entra o
  `chrome.tabs.onCreated`); 342-350 `switch_tab` (aba fora do conjunto → adoção em leitura — **isso
  já garante que trocar para uma filha da ponte fica em modo ação**); 384-391 `open_tab`;
  511-517 `abrirAbaPropria()` (cria **na janela da ponte**, `active: true`, marca no conjunto —
  é o que `open_tab` devia usar); 531-563 `janelaDaPonte()`; 833-851 `limparAbasOrfas` (aba em
  `ws.tabs` tem dono); 857-879 `encerrar` (fecha `ws.tabs ∩ abasCriadasPelaPonte − abasAdotadas`).
- `workspace-manager/index.ts:182-197` `addTab`; 199-207 `switchActiveTab`.
- `debugger-manager/index.ts:100-111` — `send()` anexa sozinho em aba nunca anexada (o erro
  "Debugger is not attached" cobre os dois casos). A filha não precisa de `attach` explícito.
- `capabilities.ts:235-256` (pós-01: `arquivos.ts`) — `baixarComoBase64` só cobre "sei a URL".
- `bridge-server/src/token.js:6` — `CONFIG_DIR = ~/.praxedes-bridge` (pasta que a ponte já é dona).
- `bridge-server/src/index.js:90-101` — `gravarEmDisco`: o servidor tem disco e `mkdirSync`.
- Estudo 2 §B.3: `Browser.setDownloadBehavior { behavior: 'allow', downloadPath, eventsEnabled: true }`
  + eventos `Browser.downloadWillBegin`/`downloadProgress`; pegadinha: "exige `Browser` domain
  por sessão; testar contra a versão do Chrome instalada". Download de `blob:` não gera
  `Network.requestWillBeSent`.

## O que construir (desenho do capataz; as partes b e c começam por MEDIÇÃO)

### a. Aba filha (`bridge/index.ts` + `capacidades/abas-filhas.ts`)

Em `start()`: `chrome.tabs.onCreated.addListener(tab => ...)`. Se `tab.openerTabId` está em
`abasCriadasPelaPonte`: a filha entra em `abasCriadasPelaPonte`, entra no `ws.tabs` do agente dono
do opener (`workspaceManager.update`), e é registrada no módulo
(`registrarFilha(openerTabId, { tabId, url: tab.pendingUrl ?? tab.url, quando })`, função
exportada por `abas-filhas.ts`). **Se o opener é aba adotada do usuário** (`abasAdotadas`): só
registra no módulo para o `wait_new_tab` **avisar**; **não** entra em `abasCriadasPelaPonte` (a
ponte nunca fecha aba nascida do lado do usuário) e trocar para ela cai na adoção em leitura, como
hoje. Popup em janela nova também chega por `onCreated` com `openerTabId`.

`cap_wait_new_tab { timeout_ms = 10000 }` (não altera): espera uma filha **ainda não reportada**
de `ws.activeTabId`; achando, marca reportada, espera `status === 'complete'` (até 3 s) e devolve
`{ abaNova: { tabId, url, titulo, janela, daPonte: boolean }, mensagem: 'use browser_tab_switch
{ tabId } para trabalhar nela' }`. **Sem filha no teto → NÃO é erro:** `{ abaNova: null,
mensagem: 'nenhuma aba filha em Ns — a pagina provavelmente navegou na propria aba; leia-a com
browser_read_page antes de repetir qualquer clique' }`. Erro aqui reproduziria a guia órfã.

### b. Download nativo (`capacidades/download-nativo.ts` + `tools/download-nativo.js`) — MEÇA PRIMEIRO

Antes de escrever a capacidade, prove numa aba própria qual destes o `chrome.debugger` desta
versão do Chrome aceita, nesta ordem: (1) `Browser.setDownloadBehavior` na sessão da aba;
(2) `Page.setDownloadBehavior` (deprecado, mas costuma existir) com `Page.downloadWillBegin`/
`downloadProgress`; (3) nada disso → **pare e reporte**: o plano C é a API `chrome.downloads`,
que exige a permissão `downloads` em `wxt.config.ts` — só com autorização do capataz.

Com o caminho provado: `cap_download_armar { pasta }` — arma o comportamento na aba
(`behavior: 'allow'`, `downloadPath: pasta`, `eventsEnabled: true`) e registra listeners
(`aoAnexar` do módulo, para sobreviver ao reattach) que guardam por aba `{ guid, url,
suggestedFilename, estado, bytes }`. `cap_download_esperar { timeout_ms = 60000 }` — espera um
download `completed` ainda não reportado e devolve `{ pasta, nome, bytes, url }`. **Arma só sob
comando**, nunca no `attach`: aba **adotada do usuário** também passa pelo `attach`, e armar ali
desviaria os downloads dele para a pasta da ponte.

Servidor (`tools/download-nativo.js`): `browser_download_arm { pasta? }` — `build` resolve
`pasta ?? join(homedir(), '.praxedes-bridge', 'downloads')` e faz `mkdirSync` (é o lado com disco);
`browser_download_wait { timeout_ms? }` — depois da resposta, **relê o disco**: `existsSync` +
`statSync` de `pasta/nome`; se não existir, lista o arquivo mais novo da pasta e diz isso (o Chrome
renomeia para `nome (1)` quando já existe). Use `formatar` da tool (a 01 criou) para o texto
"gravado em ... — N KB".

### c. `browser_tab_open` na janela da ponte — MEÇA PRIMEIRO

`browser_tab_open` e depois `browser_tabs_list`/`browser_tabs_all`: a aba nova está na
`janelaDaPonte`? Se **sim**, o achado 1 estava errado — registre e não mexa. Se **não**: em
`onMessage`, antes de mandar `open_tab` ao motor, trate na ponte: `abrirAbaPropria()` (já cria na
janela certa e marca o conjunto) → `chrome.tabs.update(id, { url })` se veio URL → `workspaceManager.update`
com a aba em `ws.tabs` → `switchActiveTab` → `ws.activeTabId = id`. **Não altere `addTab`** (é do
`workspace-manager`; se você precisar de um `windowId` opcional ali, pode, mas prefira não).

### d. `browser_tab_close` só fecha aba da ponte

Em `onMessage`, antes do motor: `alvo = params.tabId ?? ws.activeTabId`; se
`!abasCriadasPelaPonte.has(alvo)` → `{ ok: false, error: '[aba do usuario] a aba N nao foi aberta
pela ponte; eu so fecho aba que eu mesma abri. Feche-a voce ou peca ao usuario.' }`. Fechar a
**própria** aba continua permitido (`test/aba-sumiu.js` depende disso: B fecha a aba de A, que é
da ponte).

## Arquivos que você PODE tocar

`entrypoints/background/bridge/index.ts` (só os pontos acima), `entrypoints/background/bridge/capacidades/abas-filhas.ts`,
`entrypoints/background/bridge/capacidades/download-nativo.ts`, `bridge-server/src/tools/abas-filhas.js`,
`bridge-server/src/tools/download-nativo.js`, `bridge-server/test/abas-filhas.js` (novo). Com
ressalva: `workspace-manager/index.ts` (só se precisar de `windowId` em `addTab`);
`wxt.config.ts` (**só** com autorização do capataz, para a permissão `downloads`).

## Arquivos que você NÃO PODE tocar

`execution-engine/**`, `debugger-manager/**`, `registro.ts`/`index.ts` dos dois lados, qualquer
outro módulo de `capacidades/` ou `tools/`, `hub.js`, `package.json`, `README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote A: 04, 05, 06, 07, 09, 10, 11, 12, cada uma no próprio módulo — **nenhuma delas em
`bridge/index.ts`**, que é seu neste lote. A 10 toca `hub.js` (uma linha) e `shared/types`. Trava
de build compartilhada (abaixo).

## Padrão da casa a imitar

- **Falhar alto com o que morreu e o que nasceu:** `bridge/index.ts:486-490`.
- **Só fecha o que abriu:** `bridge/index.ts:106-113` e `677-681` (o `tudo` que saiu porque
  derrubava agente vivo).
- **Escrita que relê:** o servidor conferindo o arquivo no disco depois do download, como
  `gravarEmDisco` devolve tamanho (`index.js:98-100`).
- Teste de isolamento com dois clientes e foto das abas do usuário antes/depois:
  `test/isolamento.js:26-35, 90-105` e `test/aba-sumiu.js:36-59`.

## O que NÃO fazer, e por quê

- **Não adote filha de aba do usuário no conjunto da ponte**: o Cezar clica num link dele, abre
  aba, e um agente que por acaso estava lendo aquela aba passaria a "ser dono" dela e a fecharia
  ao sair. Regra: só filha de aba que **a ponte** criou.
- **Não faça `wait_new_tab` trocar de aba sozinho**: trocar é decisão do agente
  (`browser_tab_switch`), que já sabe se é leitura ou ação.
- **Não arme download no `attach`** (motivo acima).
- **Não devolva erro quando não nasce aba** (motivo: guia órfã).
- **Não mexa em `addTab`/`execution-engine`** para consertar o achado 1: a ponte já tem
  `abrirAbaPropria()`; use-a.
- **Defeito irmão:** `chrome.tabs.onCreated` também dispara para as abas que a **própria ponte**
  cria (`abrirAbaPropria`, `addTab`) — sem `openerTabId`, então o filtro não pega; mas confira que
  uma aba criada pela ponte com `openerTabId` (se o Chrome preencher) não é registrada duas vezes.

## Armadilhas conhecidas

- Aba nova nasce sem debugger; `send()` anexa no primeiro comando. Se a filha for popup em
  **janela nova sem foco**, ela pode não pintar; `comAbaPronta` ativa a aba, não a janela — se o
  clique nela falhar calado, registre (é o caso do `focarParaClicar`, README).
- `pendingUrl` vs `url` no `onCreated`: a URL final só chega no `onUpdated`; devolva a que houver
  e o `wait_new_tab` releia com `chrome.tabs.get` na hora de responder.
- Download de `data:`/`blob:` não passa pelo `Network`; só pelos eventos de download. Se
  `data:` não disparar `downloadWillBegin`, teste com `blob:` (`URL.createObjectURL`).
- `~/.praxedes-bridge/downloads` é caminho do Windows; a extensão recebe a string pronta do
  servidor e passa ao Chrome, que roda na mesma máquina.

## Critério de pronto

`bridge-server/test/abas-filhas.js` (novo), com cliente A (e B onde indicado):
1. (c) `browser_tab_open` → a aba nova está em `janelaDaPonte` (`browser_tabs_list`).
2. (a) `browser_javascript "window.open('https://example.com/?filha')"` → `browser_wait_new_tab`
   → `abaNova.url` contém `filha`, `daPonte: true`; `browser_tab_switch` para ela; `browser_read_page`
   sem `[somente leitura]`; `browser_navigate` funciona nela.
3. (a) `browser_wait_new_tab { timeout_ms: 1500 }` sem filha → **não** é erro; `abaNova: null`;
   mensagem contém "leia-a".
4. (d) `browser_tab_close { tabId: <aba do usuário fora da janela da ponte> }` → `isError`
   `[aba do usuario]`; a aba continua em `browser_tabs_all`. E `browser_tab_close` da própria aba
   continua funcionando (o `aba-sumiu.js` cobre; não o rode — confira lendo).
5. (b) página com `<a download="prova.txt" href="data:text/plain,ola">` → `browser_download_arm`
   (pasta em `tmpdir()`) → `browser_click` → `browser_download_wait` → arquivo existe com `ola`.
6. Ao fechar o cliente A, a filha da ponte foi fechada; nenhuma aba do usuário sumiu (foto
   antes/depois como em `isolamento.js`).
`npx tsc --noEmit` só com o erro pré-existente. E, como você tocou `bridge/index.ts`, rode
**também** `node test/isolamento.js` e `node test/aba-sumiu.js` (são os guardas do que você
mexeu; não a bateria inteira).

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/abas-filhas.js && node test/isolamento.js && node test/aba-sumiu.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-08 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seus testes →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`browser_download` (por URL) continua igual. `browser_tab_open`/`close` mudam **só** onde abre e o
que recusa. Regressão inaceitável: `isolamento.js` ou `aba-sumiu.js` vermelho; qualquer aba do
usuário fechada ou trocada de página em qualquer teste; filha de aba do usuário no conjunto da
ponte.

## Se concluir que não vale

Medições (b) e (c) mandam. Se nenhum comando CDP de download for aceito, entregue (a), (c), (d) e
reporte (b) com o erro literal de cada tentativa. Se (c) já estiver certo, diga e não toque.

## Como reportar

As medições com números; saída dos três testes; a lista exata de linhas tocadas em
`bridge/index.ts`; notas para o README (aba filha, `browser_wait_new_tab`, `browser_download_arm/wait`,
`tab_close` só da ponte) e para o `checklist-pje.md` de custas (fluxo pela ponte: navegar →
`form_fill` → conferir → `Emitir` → `wait_new_tab` → `Imprimir boletos` → `download_arm/wait`;
**em conferência primeiro, sem emitir**). Não edite nenhum dos dois.
