# Obra 01 — Refatoração: registro de capacidades, ganchos e tools por domínio

**Lote 0. Roda sozinha no que toca. É pré-requisito de todas as outras obras.**

## Objetivo em uma frase

Sem mudar nenhum comportamento observável, transformar `bridge/index.ts`, `capabilities.ts`,
`debugger-manager/index.ts` e `tools.js` em um **registro de módulos por domínio, com ganchos e
stubs vazios nomeados**, para que dezesseis obras seguintes escrevam cada uma no seu arquivo sem
encostar no arquivo de ninguém.

## Por que existe

Dos 17 itens aprovados em 04/09/2026, 14 tocam os mesmos três arquivos. Pedreiros em paralelo no
mesmo arquivo é conflito garantido; em série, são ~14 ciclos. Além disso, dois defeitos latentes
moram na forma atual e a refatoração os fecha de graça:

- Capacidade nova que altera a página só entra no modo somente leitura se alguém lembrar de
  acrescentá-la ao `Set` fixo `ACOES_QUE_ALTERAM` (`bridge/index.ts:37-40`). Esquecer = agente
  navega na aba do usuário em modo "leitura". Com o registro, a capacidade **declara** `altera`.
- `debugger-manager/index.ts:27-34` (`onDetach`) apaga **todos** os listeners da aba, e o reattach
  em `send()` (linhas 100-111) só religa os domínios — o handler de diálogo (68-79) e qualquer
  `dm.on` somem depois do primeiro detach. Com ganchos `aoAnexar` que rodam também no reattach,
  isso deixa de acontecer. É a **única** mudança de comportamento desta obra, e é na direção segura.

## Âncoras conferidas na fonte (05/09/2026)

`entrypoints/background/bridge/index.ts` (905 linhas):
- 28-30 `INPUT_ACTIONS`, 37-40 `ACOES_QUE_ALTERAM` — os dois `Set` fixos.
- 83-95 `BridgeCommand` — repare que `name?: string` (linha 94) existe e chega em
  `resolveWorkspace(cmd.clientId, cmd.name)` (326), que o ignora (`_name`, 470).
- 261-400 `onMessage`: 276-279 `bridge_close_workspace`; 283-287 `bridge_reload`; 290-322
  `bridge_tabs`; 330-336 barreira de somente leitura; 342-350 `switch_tab`; 353-357 despacho de
  `cap_*` por `comAbaPronta` → `executarCapacidade`; 365-369 freio (`avaliar`) e `[bloqueado]`;
  371 `executionEngine.run`; 376-379 `type` ganha `lido`; 384-391 `open_tab` marca a aba; 393 o
  `TODO` da auditoria; 394 `reply`.
- 616-770 `executarCapacidade`: o `switch`. Sem estado do `BridgeClient`: `cap_js` (622),
  `cap_form_input` (625), `cap_digitar` (629), `cap_click_xy` (632-651, usa `avaliar` e
  `cdpClick`), `cap_pdf` (653), `cap_wait_network` (656), `cap_upload` (660), `cap_download`
  (664), `cap_cookies` (667), `cap_emular` (748). **Com** estado (ficam): `cap_faxina_ociosos`
  (670), `cap_limpar` (677), `cap_use_current_tab` (690), `cap_use_own_tab` (698), `cap_tabs_all`
  (727), `cap_use_tab` (741), aliases `cap_janela_propria`/`cap_voltar_aba_corrente` (758-761),
  `default` com a mensagem de "capacidade desconhecida" (763-768).
- 788-823 `comAbaPronta(action, ws, fn)` — decide por `INPUT_ACTIONS.has(action)` (789).

`entrypoints/background/bridge/capabilities.ts` (286 linhas): `executarJs` 23-40; `preencherCampo`
47-135 (relê e falha em 124-127); `lerValorDoElemento` 138-157; `digitarTeclaATecla` 171-197;
`paginaEmPdf` 200-211; `esperarRede` 214-216; `anexarArquivos` 225-232; `baixarComoBase64`
235-256; `lerCookies` 259-263; `emularAparelho`/`pararEmulacao` 266-286.

`entrypoints/background/debugger-manager/index.ts` (139 linhas): `onDetach` 27-34; `attach` 57-80
(`enable` de Page/Runtime/Network em 64-66; auto-aceite de diálogo em 68-79); `send` 93-123
(reattach 100-111; **recarrega a aba em timeout** 114-119); `screenshot` 129-136.

`bridge-server/src/tools.js` (588 linhas, **34 tools**): `SEMANTIC_TARGET_PROPS` 12-21,
`buildTarget` 24-39; núcleo 41-320 (18 tools); capacidades 324-462 (8); ponte 464-548 (6) +
`browser_tabs_list` 550-557 + `bridge_reload_extension` 559-567; `TOOLS_CONFIRMAVEIS` 574-586
(`Set` fixo: click, type, press_key, drag, navigate); `TOOL_BY_NAME` 588.

`bridge-server/src/index.js`: importa `TOOLS, TOOL_BY_NAME` de `./tools.js` (14); `formatResult`
103-115 decide por `tool.action === 'screenshot'` (105), `tool.name === 'browser_find'` (110) e
`tool.action === 'read_page'` (111).

`bridge-server/test/smoke.js`: confere uma lista de tools **essenciais** (não conta) — mantém.

## O que construir (é o desenho do capataz; hipótese até você medir)

### A. Extensão — `entrypoints/background/bridge/capacidades/`

`registro.ts` — tipos e o registro:

- `ContextoCapacidade`: `{ clientId, nome?: string, ws, tabId, ref?: number, params, confirm: boolean, acao }`
  (`nome` vem de `cmd.name`; hoje ninguém o manda, a obra 10 vai mandar).
- `Capacidade`: `{ nome: 'cap_xxx', altera?: boolean, input?: boolean, executar(ctx): Promise<unknown> }`.
- `Ganchos`: `{ aoAnexar?(tabId), antes?(ctx), depois?(ctx, r: Resultado): Promise<Resultado> }`
  com `Resultado = { ok, data?, error? }`.
- `ModuloCapacidades`: `{ nome, capacidades: Capacidade[], ganchos?: Ganchos }`.
- Funções: `registrar(modulo)`, `capacidadePorNome(nome)`, `nomesQueAlteram()`, `nomesDeInput()`,
  `ganchos()` (na ordem de registro), `listarCapacidades()`.

`index.ts` — importa e registra **cada** módulo, existentes e stubs, em ordem fixa.

Módulos com o código **movido** de `capabilities.ts` e de `index.ts` (cada um exporta as funções
que exporta hoje **e** `export const modulo: ModuloCapacidades`):
- `js.ts` — `executarJs`; capacidade `cap_js`.
- `formulario.ts` — `preencherCampo`, `lerValorDoElemento`, `digitarTeclaATecla`; `cap_form_input`
  (`altera`, `input`), `cap_digitar` (`altera`, `input`).
- `clique.ts` — o corpo de `cap_click_xy` (`index.ts:632-651`), `altera`, `input`.
- `arquivos.ts` — `paginaEmPdf`, `anexarArquivos`, `baixarComoBase64`, `lerCookies`; `cap_pdf`,
  `cap_upload` (`altera`), `cap_download`, `cap_cookies`.
- `rede.ts` — `esperarRede`; `cap_wait_network`.
- `emulacao.ts` — `emularAparelho`, `pararEmulacao`; `cap_emular` (`altera`).
- `dialogo.ts` — o auto-aceite de `debugger-manager/index.ts:68-79`, **movido para um gancho
  `aoAnexar`** que faz `dm.on(tabId, 'Page.javascriptDialogOpening', ...)` com o mesmo corpo.
  Comportamento igual ao de hoje (aceita tudo). A obra 04 reescreve este arquivo.

**Stubs vazios** (`export const modulo = { nome, capacidades: [] }`), um por obra planejada:
`desafio.ts`, `auditoria.ts`, `upload-lote.ts`, `formulario-lote.ts`, `autocomplete.ts`,
`abas-filhas.ts`, `download-nativo.ts`, `rede-inspecao.ts`, `historico.ts`, `ritmo.ts`,
`destaque.ts`, `assentar.ts`, `screenshot-recorte.ts`, `console.ts`.

`capabilities.ts` vira **barril**: `export * from './capacidades/js'` etc., para o `import` de
`index.ts:6-10` (e qualquer outro) continuar valendo. Não apague o arquivo.

**Uma capacidade de diagnóstico nova**, `cap_listar` (no `BridgeClient` ou num módulo `ponte`):
devolve `listarCapacidades()` + os nomes internos do `BridgeClient`. Serve ao teste de contrato e
ao caso "servidor antigo × extensão nova" do README.

### B. `bridge/index.ts` — despacho por registro e ganchos

- `INPUT_ACTIONS` e `ACOES_QUE_ALTERAM` viram **funções** (`exigeAbaPintada(acao)`,
  `alteraAPagina(acao)`) = união do conjunto do `BridgeClient` (as ações do motor: `navigate`,
  `click`, `type`, `press_key`, `scroll`, `drag`) com `nomesDeInput()` / `nomesQueAlteram()` do
  registro. Conferir que o resultado para os nomes de hoje é **idêntico** aos dois `Set` atuais.
- `executarCapacidade`: mantém o `switch` só para as de estado + aliases; para o resto,
  `capacidadePorNome(cmd.action)?.executar(ctx)`; sem ambos → a **mesma** mensagem de "capacidade
  desconhecida" das linhas 763-768, palavra por palavra.
- Ganchos no `onMessage`, nesta ordem: `resolveWorkspace` → indicador → barreira de somente
  leitura → `switch_tab` especial → **`antes`** (todos os módulos, na ordem; um `throw` vira
  `{ok:false, error}`) → despacho (cap ou freio+motor) → pós-processamentos que já existem (`lido`,
  `open_tab`) → **`depois`** (todos, na ordem; cada um recebe e devolve `Resultado`) → `reply`.
  **`antes` roda antes do freio** (`avaliar` faz chamada CDP; a obra 04 precisa barrar antes disso).
  **Todo caminho que responde ao agente passa por `depois`** — inclusive `[somente leitura]` e
  `[bloqueado]` — porque a obra 10 (auditoria) precisa ver o que foi barrado. Concentre isso numa
  função `responder(cmd, ctx, resultado)`; hoje há quatro `this.reply` espalhados (331, 367, 394, 396).
- `ctx.nome = cmd.name`.

### C. `debugger-manager/index.ts` — ganchos ao anexar

- `aoAnexar(fn: (tabId) => Promise<void>)` guarda numa lista; `rodarGanchos(tabId)` executa cada
  um com `catch` + `console.warn` (um gancho quebrado não pode impedir o attach).
- Chamado ao fim de `attach()` (no lugar do bloco 68-79, que sai daqui e vai para `dialogo.ts`) e
  no ramo de reattach de `send()`, depois dos três `enable` (106-108).
- Cuidado com recursão: gancho que chama `send()` no meio do reattach pode cair no mesmo `catch`.
  O `retryCount` limita a 3 por chamada; confira que não vira laço.

### D. Servidor — `bridge-server/src/tools/`

- `_comum.js` (`SEMANTIC_TARGET_PROPS`, `buildTarget`); `navegacao.js` (navigate, tab_open,
  tab_switch, tab_close); `interacao.js` (click, type, press_key, scroll, drag); `leitura.js`
  (read_page, find, extract, clipboard_copy); `diagnostico.js` (screenshot, console_logs);
  `espera.js` (wait, wait_for_text, wait_for_change, wait_network); `js.js` (javascript);
  `formulario.js` (form_input); `arquivos.js` (save_pdf, upload_file, download, cookies);
  `emulacao.js` (emulate_device); `ponte.js` (bridge_limpar, bridge_faxina_ociosos,
  use_current_tab, use_own_tab, tabs_all, use_tab, tabs_list, reload_extension, **e a nova
  `bridge_capacidades` → `cap_listar`**).
- Cada arquivo exporta `TOOLS` (array). As cinco confirmáveis ganham `confirmavel: true` na
  própria definição; `index.js` (do diretório) concatena na **ordem atual**, aplica o param
  `confirm` a quem tem `confirmavel`, monta `TOOL_BY_NAME`, exporta os dois.
- **Stubs** `export const TOOLS = [];`: `dialogo.js`, `upload-lote.js`, `autocomplete.js`,
  `formulario-lote.js`, `abas-filhas.js`, `download-nativo.js`, `rede-inspecao.js`,
  `historico.js`, `auditoria.js`. Todos importados pelo `index.js`.
- `tools.js` vira uma linha: `export { TOOLS, TOOL_BY_NAME } from './tools/index.js';`.
- `bridge-server/src/index.js` `formatResult`: **antes** dos casos existentes, `if (tool.imagem)`
  devolve `{type:'image', data, mimeType: tool.imagem}` e `if (tool.formatar)` devolve
  `textResult(tool.formatar(data, input))`. Os casos de hoje ficam como estão.

### E. `.gitignore`

Acrescente `.obra-lock` (é o arquivo de trava de build dos lotes seguintes).

## Arquivos que você PODE tocar

`entrypoints/background/bridge/index.ts`, `entrypoints/background/bridge/capabilities.ts`,
`entrypoints/background/bridge/capacidades/**` (novo), `entrypoints/background/debugger-manager/index.ts`,
`bridge-server/src/tools.js`, `bridge-server/src/tools/**` (novo), `bridge-server/src/index.js`,
`bridge-server/test/registro.js` (novo), `.gitignore`.

## Arquivos que você NÃO PODE tocar

`bridge/policy.ts` (a obra 02 está nele agora), `execution-engine/**`, `workspace-manager/**`,
`audit/**`, `shared/**`, `entrypoints/background/index.ts`, `sidepanel/**`, `hub.js`, `format.js`,
`token.js`, `package.json` (os dois), `README.md`, `ESTADO.md`, os testes existentes.

## Quem mais está construindo agora

Dois agentes: a obra **02** (só `bridge/policy.ts` + `test/freio-aba.js`) e a obra **03** (sem
código; navega no STJ pela ponte). A 02 compartilha o build e o Chrome com você: **protocolo de
trava** abaixo. A 03 usa a ponte enquanto você recarrega a extensão — o reload derruba a sessão
dela; por isso o reload só acontece com a trava, e ela sabe disso.

## Padrão da casa a imitar

- **Mensagem de erro que diz o remédio:** `bridge/index.ts:486-490` (`[aba trocou] ... navegue de
  novo antes de ler ou clicar`) e 763-768 (`capacidade desconhecida ... Reinicie a sessao do agente`).
  Mantenha as duas literalmente.
- **Comentário que conta o incidente, não o óbvio:** veja os comentários de `bridge/index.ts:476-480`
  e `677-681`. Ao mover código, **leve o comentário junto**.
- **Teste que prova o contrato, não a implementação:** `bridge-server/test/smoke.js` confere que as
  essenciais existem sem contar tools ("contar tools é frágil"). O seu `registro.js` confere o
  **conjunto** exato porque aqui a obra é justamente "nada sumiu".
- Pt-BR sem acento nos identificadores e comentários de código, como o resto do repo.

## O que NÃO fazer, e por quê

- **Não conserte nada de comportamento.** O `cap_click_xy` que você move continua avaliando o
  freio do jeito de hoje; o diálogo continua auto-aceito; `open_tab` continua abrindo onde abre
  (é defeito, e é da obra 08). Conserto aqui vira regressão invisível dentro de uma refatoração.
- **Não apague `capabilities.ts`** nem mude a assinatura de nenhuma função exportada.
- **Não use `import.meta.glob`** para auto-registrar: o capataz quer os módulos listados num
  `index.ts` que aparece no `grep`.
- **Não toque no `execution-engine`**: as ações do motor (`navigate`, `click`...) continuam
  passando por `avaliar` + `executionEngine.run` como hoje.
- **Defeito irmão:** ao calcular os conjuntos a partir do registro, se um módulo movido esquecer
  `altera: true` (por exemplo `cap_upload`, que hoje está em `ACOES_QUE_ALTERAM`), a barreira de
  somente leitura afrouxa **em silêncio**. O teste tem de comparar os conjuntos calculados com os
  literais de hoje (ver critério de pronto).

## Armadilhas conhecidas desta obra

- `chrome.scripting` roda no mundo isolado; JS de página vai por `Runtime.evaluate` (README). Você
  não escreve JS de página aqui, mas ao mover `executarJs` preserve o comentário sobre `replMode`.
- O build (`wxt build` via vite) **não typecheca**. `npx tsc --noEmit` na raiz hoje mostra **1
  erro pré-existente** em `safe-scripting.ts:8` (TS2322). Critério: nenhum erro novo.
- Service worker MV3 dorme: os módulos do registro precisam registrar tudo **no carregamento do
  módulo** (import), não em `start()`, senão um SW que acordou sem passar por `start()` fica sem
  ganchos.
- A extensão se reconecta com backoff de até 30 s; `esperarExtensao` nos testes já espera 90 s.

## Critério de pronto

1. `npx tsc --noEmit` (raiz): só o erro pré-existente de `safe-scripting.ts:8`.
2. `bridge-server/test/registro.js` (novo, no padrão `client.js` + `check`), verdes:
   - `tools/list` devolve exatamente estas 36 tools (35 de hoje + `bridge_capacidades`):
     `browser_status, browser_read_page, browser_find, browser_screenshot, browser_navigate,
     browser_click, browser_type, browser_press_key, browser_scroll, browser_drag, browser_extract,
     browser_wait, browser_wait_for_text, browser_wait_for_change, browser_console_logs,
     browser_tab_open, browser_tab_switch, browser_tab_close, browser_clipboard_copy,
     browser_javascript, browser_form_input, browser_save_pdf, browser_wait_network,
     browser_upload_file, browser_download, browser_cookies, browser_emulate_device, bridge_limpar,
     bridge_faxina_ociosos, browser_use_current_tab, browser_use_own_tab, browser_tabs_all,
     browser_use_tab, browser_tabs_list, bridge_reload_extension, bridge_capacidades`.
   - o parâmetro `confirm` existe **exatamente** em `browser_click, browser_type, browser_press_key,
     browser_drag, browser_navigate`, e em nenhuma outra.
   - `bridge_capacidades` responde; toda `action` string `cap_*` das tools existe na lista, e mais
     `cap_click_xy` e `cap_digitar` (que são `action` por função).
   - os conjuntos calculados batem com os literais de hoje: exponha-os em `cap_listar`
     (`alteram: [...]`, `input: [...]`) e compare com
     `alteram = navigate, click, type, press_key, scroll, drag, cap_form_input, cap_upload, cap_emular, cap_digitar, cap_click_xy`
     e `input = click, type, press_key, scroll, drag, cap_form_input, cap_digitar, cap_click_xy`.
3. **A bateria inteira** verde: `cd bridge-server && npm test` (smoke, isolamento, aba-sumiu,
   digitacao-real, e2e, capabilities, adotar-aba, ociosidade — 69 verificações em 03/09). Você é a
   única obra autorizada a rodá-la, e é obrigada.
4. Diff de `bridge/index.ts` lido linha a linha: **toda linha removida** ou é código movido (diga
   para onde) ou é o `Set`/`switch` substituído. Linha apagada sem destino declarado é defeito.

**Como rodar** (com a trava — ver abaixo): na raiz `npm run build`; depois `cd bridge-server &&
npm run reload` (sem o reload você testa o build anterior); depois `node test/registro.js` e
`npm test`. Exige o Chrome aberto com a extensão carregada.

## Protocolo de trava de build (obrigatório; a obra 02 usa o Chrome ao mesmo tempo)

Arquivo `C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Em Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-01 $(date +%H:%M)" > .obra-lock)`.
Já existe → espere 60 s e repita (até 15 min; com mais de 10 min é abandonada, sobrescreva e
anote). Com a trava: build → reload → seus testes → `rm .obra-lock`. Solte mesmo com teste
vermelho. Build quebrado num arquivo que não é seu (`policy.ts`): solte, espere 2 min, tente de
novo até 3 vezes; persistindo, reporte.

## Regra ADITIVO

Esta obra é a exceção que **move** código, mas não remove função, mensagem nem comportamento.
Regressão inaceitável: qualquer mudança em `isolamento.js`, `aba-sumiu.js` ou `capabilities.js`
para "fazer passar"; qualquer tool a menos; qualquer texto de erro alterado; `cap_upload` fora de
`alteram`. Não "aproveite para organizar" o `execution-engine`, o `workspace-manager` nem o
`background/index.ts` legado.

## Se concluir que não vale

Se ao medir você achar que os ganchos ou os conjuntos calculados quebram o isolamento de um jeito
que não consegue fechar, **pare e reporte com o teste que falhou** — não entregue metade. O
capataz decide se troca o desenho.

## Como reportar

No fim: (1) árvore de arquivos criada, com o que foi para onde; (2) saída dos testes colada
(`registro.js` e `npm test`); (3) `tsc` colado; (4) toda linha removida de `index.ts` com o destino;
(5) o que você mudou do desenho do capataz e por quê; (6) notas para o README (nova tool
`bridge_capacidades`, estrutura de pastas). Não edite o README.
