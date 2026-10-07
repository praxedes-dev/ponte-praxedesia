# Obra 13 — Clique: contorno visível antes (item 13) e "assentar" depois (item 7)

**Lote B. Depende da obra 01 (stubs `capacidades/destaque.ts`, `capacidades/assentar.ts`;
ganchos `antes`/`depois`/`aoAnexar`). Arquivos disjuntos do Lote A.**

## Objetivo em uma frase

Todo clique da ponte passa a (a) desenhar por 300 ms um contorno no elemento que vai ser clicado,
para o Cezar ver na tela dele o que o agente vai fazer, e (b) esperar a rede **acalmar de fato**
(teto curto) antes de responder, para o agente não ler a tela do PJe cedo demais — com `esperar:
false` para desligar.

## Por que existe

- **Assentar:** no PJe (RichFaces com AJAX parcial) a causa mais comum de erro é ler a tela antes
  de o ciclo terminar; hoje o agente tem de lembrar de `browser_wait_network`/`wait_for_change`
  depois de cada clique (estudo 3, §B.3 e §D.1: Playwright MCP embute um "settle"). **Correção do
  fechador:** `navigate` **já** espera (`cdp-tools.ts:516-519`); é o **clique** que não espera.
- **Destaque:** o Cezar compartilha a tela com até cinco agentes; um contorno de 300 ms antes do
  clique é confirmação visual barata do que vai acontecer (estudo 2, §D.3).

## Âncoras conferidas na fonte (05/09/2026)

- `cdp-tools.ts:443-514` `waitForNetworkIdle` — **não reaproveite como está**: `checkIdle`
  (460-470) só resolve depois de `hasReceivedFCP`, que só vira `true` num `Page.lifecycleEvent`
  `firstContentfulPaint`/`load` (481-486). Clique que dispara só AJAX **nunca** recebe esse evento
  → resolveria só no teto (`maxWait`), em **todo** clique. É a hipótese da proposta ("reaproveita o
  wait_network") derrubada na fonte.
- `cdp-tools.ts:227-282` `cdpClickByRef` — resolve o nó, rola para o centro, calcula o retângulo
  (243-271), clica. `execution-engine/index.ts:49-84` — caso `click` do motor.
- `bridge/index.ts:632-651` (pós-01: `capacidades/clique.ts`) — `cap_click_xy` faz
  `DOM.getNodeForLocation` para achar o nó sob (x, y): é como você acha o `backendNodeId` para
  destacar quando o clique é por coordenada.
- `debugger-manager/index.ts:64-66` — domínios habilitados: `Page`, `Runtime`, `Network`.
  `Overlay` **não**. Você habilita no gancho `aoAnexar` (e mede se o `chrome.debugger` permite).
- `bridge/index.ts:166-178` — padrão de configuração em `chrome.storage.local`.
- `tools.js:98-116` (pós-01: `tools/interacao.js`) — `browser_click`: `action` por função
  (`cap_click_xy` se `x`/`y`), `build` monta `target`. Você acrescenta `esperar`/`esperar_ms` ao
  schema e aos `params` (o motor ignora params que não usa; `execution-engine/index.ts:65-68` só
  lê `params.text/role/placeholder/ariaLabel` como socorro).
- `execution-engine/index.ts:38-46` — o motor esconde o indicador antes do screenshot
  (`HIDE_FOR_TOOL_USE`); o destaque do `Overlay` **não** entra em `innerText` nem na árvore AX, mas
  entra no screenshot se sobreposto — por isso sempre `hideHighlight` em `finally`.

## O que construir

`capacidades/assentar.ts` (**arma no `antes`, espera no `depois`**, senão perde as requisições
que o clique disparou antes de o gancho registrar):
- `antes(ctx)` para `ctx.acao ∈ { click, cap_click_xy, press_key(Enter), cap_form_input }` e
  `params.esperar !== false`: registra listeners `Network.requestWillBeSent` (+1),
  `loadingFinished`/`loadingFailed` (−1, mínimo 0), `Page.frameStartedLoading` do frame principal
  (`navegou = true`), `Page.loadEventFired` (`carregou = true`); guarda o estado por `cmd.id`.
- `depois(ctx, r)`: espera até `teto = params.esperar_ms ?? 2500` que (`emVoo === 0` por
  `quieto = 400 ms` **e** (`!navegou || carregou`)); remove os listeners; acrescenta
  `assentou_ms` e `requisicoes` ao `r.data` (se `data` não for objeto, embrulhe). Nunca falha:
  teto vencido → devolve com `assentou_ms = teto` e `esgotou: true`.
- Sem `waitForNetworkIdle`.

`capacidades/destaque.ts`:
- `aoAnexar(tabId)`: `dm.send(tabId, 'Overlay.enable')`. **Meça** se o `chrome.debugger` desta
  versão permite o domínio `Overlay`. Erro → módulo se desliga (`ativo = false`, um `console.warn`),
  nunca derruba o attach.
- `antes(ctx)` para `click` com `ctx.ref` e `cap_click_xy`, se `ativo` e
  `chrome.storage.local.destacarAntesDeClicar !== false`: `backendNodeId` = `ctx.ref` ou
  `DOM.getNodeForLocation(x, y)`; `Overlay.highlightNode { backendNodeId, highlightConfig: {
  contentColor: { r: 59, g: 130, b: 246, a: 0.35 }, borderColor: { r: 37, g: 99, b: 235, a: 0.9 } } }`;
  `sleep(300)`; `finally { Overlay.hideHighlight }`. Marca `destacou` por `cmd.id`.
- `depois(ctx, r)`: acrescenta `destacado: true|false` ao `r.data` (para o teste provar).

`tools/interacao.js`: `browser_click` ganha `esperar` (boolean, padrão true) e `esperar_ms`
(number, padrão 2500) no schema e nos `params`; descrição: "depois do clique a ponte espera a rede
acalmar (até 2,5 s) — desligue com esperar:false em página que nunca acalma".

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/destaque.ts`, `entrypoints/background/bridge/capacidades/assentar.ts`,
`bridge-server/src/tools/interacao.js`, `bridge-server/test/clique-assentar.js` (novo).

## Arquivos que você NÃO PODE tocar

`cdp-tools.ts`, `execution-engine/**`, `debugger-manager/**`, `capacidades/clique.ts`,
`bridge/index.ts`, `registro.ts`/`index.ts` dos dois lados, qualquer outro módulo/tool,
`package.json`, `README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote B: obras 14 (`screenshot-recorte.ts`, `console.ts`, `tools/diagnostico.js`) e 15
(`arquivos.ts`, `js.ts`, `tools/arquivos.js`, `tools/js.js`). Pode haver obras do Lote A ainda
terminando (04-12), todas em módulos próprios. Ninguém mais em `tools/interacao.js`. Trava de
build compartilhada.

## Padrão da casa a imitar

- **Fallback desligado por storage, ligado só se medido:** `focarParaClicar`
  (`bridge/index.ts:783-786, 800-806`). Seu `destacarAntesDeClicar` é o inverso (ligado por
  padrão), mesmo mecanismo.
- **Ganchos que não alteram o resultado além de anotar:** o indicador (`bridge/index.ts:402-437`).
- **Não cheque `hasReceivedFCP` em espera pós-ação:** aprenda com `cdp-tools.ts:460-470` o que
  **não** copiar.
- Teste: `test/digitacao-real.js:100-103` (clique por coordenada com contador `isTrusted`).

## O que NÃO fazer, e por quê

- **Não use `waitForNetworkIdle`** (motivo acima). Se você concluir que dá para reaproveitar,
  prove com o número: clique que dispara só um `fetch` tem de assentar em < 1 s, não em 2,5 s.
- **Não espere DOM "estabilizar" por `innerText`** (`wait_for_change` já faz isso quando o
  agente pede; aqui é rede, barato e determinístico).
- **Não deixe o destaque aceso** em caso de erro/`throw` (marca perdida na tela do Cezar e no
  screenshot). `finally` sempre.
- **Não destaque clique semântico sem ref** (não há nó conhecido antes de resolver; pular é certo).
- **Defeito irmão 1:** `antes` roda **antes do freio**; um clique barrado ainda acende o contorno
  300 ms. Aceitável, mas o `depois` **também** roda para resultado barrado: garanta que os
  listeners do assentar são removidos nesse caminho (senão vazam por comando).
- **Defeito irmão 2:** `loadingFinished` de requisição iniciada **antes** do `antes` (não contada)
  zera o contador negativo → clamp em 0.

## Armadilhas conhecidas

- Aba não pintada ignora clique (README): o clique já passa por `comAbaPronta`; seus ganchos
  rodam fora da fila — o `Overlay` numa aba não ativa não aparece, e tudo bem.
- `Overlay.highlightNode` exige `Overlay.enable` na sessão **atual**; depois de reattach o gancho
  `aoAnexar` religa (a 01 garante).
- `replMode` não se aplica. `returnByValue` idem.
- SPA que nunca acalma: teto de 2,5 s cobre; documentado na descrição.

## Critério de pronto

`bridge-server/test/clique-assentar.js` (novo), página de prova com um botão cujo `click` faz
`fetch('https://www.iana.org/help/example-domains').then(() => { document.title = 'pronto' })`:
1. `browser_click { ref }` (padrão) → **sem** nenhuma espera explícita, `document.title === 'pronto'`
   (via `browser_javascript`); resposta tem `assentou_ms` < 2500 e `requisicoes >= 1`.
2. Botão sem rede (`onclick` só muda o título) → `assentou_ms` ≈ 400-600 (não gasta o teto).
3. `browser_click { ref, esperar: false }` → sem `assentou_ms`; registre se o título ainda era o
   antigo logo após (não asserte; é corrida).
4. Resposta traz `destacado: true` e o clique **funciona** (contador `isTrusted` = 1); com
   `Overlay` recusado pelo Chrome, `destacado: false` e o clique funciona igual.
5. Clique barrado pelo freio (botão "Excluir") → `isError` **e** nenhum listener vazou (prove:
   `requisicoes` do clique seguinte não conta as do anterior).
`npx tsc --noEmit` só com o erro pré-existente. Rode também `node test/e2e.js` (cobre clique por
ref navegando) e `node test/digitacao-real.js` (clique por coordenada): você tocou o caminho de
todo clique.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/clique-assentar.js && node test/e2e.js && node test/digitacao-real.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-13 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seus testes →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

O clique em si (`cdpClickByRef`, `cdpClick`, freio) não muda. Regressão inaceitável: `e2e.js` ou
`digitacao-real.js` vermelho; clique mais lento que 300 ms + assentar real; contorno esquecido na
tela.

## Se concluir que não vale

Se `Overlay` for recusado pelo `chrome.debugger`, entregue o assentar e reporte o destaque com o
erro literal (o plano C seria desenhar via content script **dentro do shadow root** — não faça sem
autorização; é outra obra). Se medir que o assentar atrasa demais o fluxo de upload (dezenas de
cliques), proponha o teto/quieto com números.

## Como reportar

Medições (`Overlay` permitido?; `assentou_ms` típico nos casos 1 e 2); saída dos três testes;
notas para o README (armadilha nova: clique espera até 2,5 s; `esperar:false`;
`destacarAntesDeClicar`). Não edite o README.
