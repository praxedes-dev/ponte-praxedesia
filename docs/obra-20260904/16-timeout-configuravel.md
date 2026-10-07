# Obra 16 — Teto de tempo configurável pelo agente (`timeout_ms`, item 9)

**Lote C. Depende das obras 01, 13 e 15 (você edita arquivos de tool que elas acabaram de
editar). Roda quando o Lote B fechou.**

## Objetivo em uma frase

`browser_navigate`, `browser_click`, `browser_type`, `browser_press_key` e `browser_javascript`
aceitam `timeout_ms`, e o teto do transporte passa a ser calculado a partir dele — para um ciclo
AJAX longo do PJe não estourar os 60 s fixos do JS nem um portal atrás de Cloudflare os 90 s
fixos do navigate.

## Por que existe

`browser_javascript` estoura em 60 s no meio de um ciclo AJAX do PJe (a skill `protocolo-pje-ponte`
316-320 documenta duas ocorrências no ROGÉRIO); `navigate` tem 90 s fixos e portal atrás de
Cloudflare em dia ruim passa disso (estudos 1 e 3). Playwright MCP expõe `--timeout-action` e
`--timeout-navigation`; aqui os tetos estão no código (estudo 3, §B.9).

## Âncoras conferidas na fonte (05/09/2026; os caminhos são os pós-01)

- `hub.js:8` `DEFAULT_TIMEOUT_MS = 60_000` — o teto quando a tool não declara `timeout`;
  `hub.js:320-326` a mensagem `acao "X" estourou Ns sem resposta`. **Não edite `hub.js`.**
- `bridge-server/src/index.js:72` — `timeout = typeof tool.timeout === 'function' ?
  tool.timeout(input) : tool.timeout`. É por aqui que `timeout_ms` vira teto; nada a mudar ali.
- Tetos hoje (em `tools.js`, agora nos arquivos por domínio): navigate `90_000` (95) →
  `tools/navegacao.js`; type por função `30_000 + len × delay` ou `60_000` (139) →
  `tools/interacao.js`; click/press_key **sem** `timeout` (caem no padrão 60 s); wait `120_000`
  (219), wait_for_text/change `timeout_ms + 15_000` (238, 263), wait_network `max_wait_ms + 10_000`
  (388) → `tools/espera.js` (já configuráveis, só conferir); javascript **sem** `timeout` (60 s) →
  `tools/js.js`; save_pdf `120_000`, download `180_000` → `tools/arquivos.js` (não mexa).
- `capacidades/js.ts` `executarJs` — `Runtime.evaluate` aceita `timeout` (ms, experimental) que
  aborta a avaliação na página; hoje não é passado. Sem ele, quando o transporte desiste a
  Promise continua rodando na página. A obra 15 acrescentou `args`/`callFunctionOn`; passe
  `timeout` nos dois caminhos.
- `cdp-tools.ts:516-519` — o `navigate` tem espera interna **fixa** de 15 s (`waitForNetworkIdle`);
  `timeout_ms` aqui só governa o transporte. Documente na descrição.
- Descrições desatualizadas que citam "grupo" (não existe desde 14/08): `browser_tab_open`
  (`tools.js:277`), `browser_tab_switch` (288), `browser_tabs_list` (553-554). Você está nesses
  arquivos; corrija o texto.

## O que construir

- `tools/navegacao.js`: `browser_navigate` ganha `timeout_ms` (descrição: "teto do transporte;
  padrão 90000; a espera interna pela rede é de até 15 s"); `timeout: (i) => i.timeout_ms ?? 90_000`.
  Corrija as descrições de `tab_open`/`tab_switch` ("na janela da ponte, deste agente").
- `tools/interacao.js`: `browser_click`, `browser_type`, `browser_press_key` ganham `timeout_ms`;
  `timeout: (i) => i.timeout_ms ?? <o de hoje>` (no `type`, mantenha a fórmula do modo teclado e
  aplique `timeout_ms` como piso: `Math.max(formula, i.timeout_ms ?? 0)`). Cuidado: a obra 13 pôs
  `esperar`/`esperar_ms` no `click` — o teto tem de cobrir `esperar_ms` (some-o).
- `tools/js.js`: `browser_javascript` ganha `timeout_ms` (padrão 55 000 na página, transporte
  `+ 5_000`); `build` passa `timeout_ms` nos params.
- `capacidades/js.ts`: `executarJs(tabId, codigo, args?, timeoutMs?)` passa `timeout: timeoutMs`
  ao `Runtime.evaluate`/`callFunctionOn`; o erro do CDP por timeout vira `erro no script: estourou
  Nms na pagina` (mais útil que o do transporte). Registro `cap_js` passa `p.timeout_ms`.
- `tools/ponte.js`: só o texto de `browser_tabs_list`.

Regra: **transporte ≥ teto interno + folga**, sempre (`tools.js:7-9`, o comentário de cabeçalho).

## Arquivos que você PODE tocar

`bridge-server/src/tools/navegacao.js`, `bridge-server/src/tools/interacao.js`,
`bridge-server/src/tools/js.js`, `bridge-server/src/tools/espera.js` (só se algo estiver
inconsistente), `bridge-server/src/tools/ponte.js` (só descrição de `tabs_list`),
`entrypoints/background/bridge/capacidades/js.ts`, `bridge-server/test/timeouts.js` (novo).

## Arquivos que você NÃO PODE tocar

`hub.js`, `bridge-server/src/index.js`, `cdp-tools.ts`, `execution-engine/**`, `tools/arquivos.js`,
`tools/diagnostico.js`, qualquer outro módulo, `package.json`, `README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote C: a obra 17 (`sidepanel/App.tsx`, `bridge/index.ts`). Nenhuma das duas toca o arquivo da
outra. Trava de build compartilhada.

## Padrão da casa a imitar

- **Teto por função do input:** `tools.js:139` (type), 238 (wait_for_text), 388 (wait_network).
- **Comentário de cabeçalho de `tools.js`** (7-9): "timeout e o teto do transporte e precisa ser
  MAIOR que o teto interno da acao".
- Teste: `test/smoke.js` lê `tools/list` e confere schema; você confere que `timeout_ms` aparece.

## O que NÃO fazer, e por quê

- **Não mexa no padrão de 60 s do hub**: é a rede de segurança de toda tool sem `timeout`.
- **Não deixe o teto do transporte menor que o interno**: a ponte desiste e a extensão responde
  no vazio (o comentário de cabeçalho existe por isso).
- **Não altere `esperar`/`esperar_ms`** da obra 13 nem `args` da 15; só some/propague.
- **Defeito irmão:** `timeout_ms` gigante em `wait_for_text` já é possível hoje; não crie um
  segundo parâmetro com outro nome (`timeout`, `teto_ms`) — o nome é `timeout_ms` em toda tool.

## Armadilhas conhecidas

- `Runtime.evaluate.timeout` é marcado experimental no protocolo; **meça** que funciona nesta
  versão (uma Promise de 3 s com `timeout: 1000` tem de errar em ~1 s). Se não funcionar, o
  transporte continua sendo o teto e a mensagem é a do hub — documente.
- `replMode` não se aplica.

## Critério de pronto

`bridge-server/test/timeouts.js` (novo):
1. `browser_javascript { codigo: 'new Promise(r => setTimeout(() => r(1), 3000))', timeout_ms: 1000 }`
   → `isError`, texto casa `/estourou|timed out|tempo/i`, e levou < 4 s.
2. Mesmo código com `timeout_ms: 6000` → `1`.
3. `tools/list`: `timeout_ms` presente em `browser_navigate`, `browser_click`, `browser_type`,
   `browser_press_key`, `browser_javascript`.
4. Descrições de `browser_tab_open`, `browser_tab_switch`, `browser_tabs_list` não contêm "grupo".
5. `browser_navigate { url: example.com, timeout_ms: 30000 }` funciona.
`npx tsc --noEmit` só com o erro pré-existente. Rode também `node test/smoke.js` e
`node test/pdf-js-args.js` (da 15, que você tocou por baixo).

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/timeouts.js && node test/smoke.js && node test/pdf-js-args.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-16 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seus testes →
`rm .obra-lock`. Nunca reload sem trava. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

Sem `timeout_ms`, todo teto é o de hoje. Regressão inaceitável: `smoke.js` ou `pdf-js-args.js`
vermelho; alguma tool com transporte menor que o interno.

## Como reportar

Medição do `Runtime.evaluate.timeout`; saída dos testes; tabela final de tetos por tool; notas
para o README. Não edite o README.
