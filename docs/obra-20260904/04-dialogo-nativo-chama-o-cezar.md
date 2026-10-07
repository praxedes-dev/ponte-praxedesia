# Obra 04 — Diálogo nativo (`confirm`/`alert`/`prompt`/`beforeunload`) chama o Cezar (item 1)

**Lote A. Depende da obra 01 (registro, ganchos, stub `capacidades/dialogo.ts`).**

## Objetivo em uma frase

Nenhum diálogo nativo é mais respondido pela ponte: ele vira **erro alto com o texto da pergunta**
em todo comando daquela aba, e só a tool nova `browser_dialog` — chamada pelo agente **depois de
perguntar ao Cezar** — responde.

## Por que existe

Hoje `debugger-manager` aceita todo diálogo sem ninguém ver: um `confirm("Confirma o protocolo?")`
do PJe é confirmado sozinho, e um `beforeunload` ("sair sem salvar?") é aceito — perde o rascunho.
Pior: depois de um detach+reattach o handler sumia e o diálogo passava a **travar a aba em
silêncio** (a obra 01 já fez o gancho rodar no reattach). **Decisão do Cezar, fechada:** o agente
nunca responde sozinho, **nem depois de timeout**. Quem responde é ele (pelo chat, via
`browser_dialog`) ou ele mesmo clicando na janela da ponte, que é Chrome real.

## Âncoras conferidas na fonte (05/09/2026, antes da obra 01)

- `debugger-manager/index.ts:68-79` — o auto-aceite: `dm.on(tabId, 'Page.javascriptDialogOpening',
  ...)` → `Page.handleJavaScriptDialog { accept: true, promptText: defaultPrompt }`. A obra 01 moveu
  esse corpo para `capacidades/dialogo.ts`, num gancho `aoAnexar`, sem mudar o comportamento.
  **Você substitui esse arquivo inteiro.**
- `debugger-manager/index.ts:114-119` — `send()` **recarrega a aba** quando vê "Debugger command
  timed out". Comando CDP preso atrás de um diálogo que caia aí = rascunho do PJe perdido. Por isso
  o seu gancho `antes` tem de barrar o comando **antes de qualquer chamada CDP**.
- `debugger-manager/index.ts:27-34` — `onDetach` apaga os listeners; o gancho `aoAnexar` da 01
  roda no reattach, então seus listeners voltam. Não dependa de nada além disso.
- `bridge/index.ts` (pós-01): a ordem no `onMessage` é resolveWorkspace → indicador → somente
  leitura → switch_tab → **`antes`** → freio (`avaliar`, que chama CDP) → execução → **`depois`**
  → reply. Confirme abrindo o arquivo como a 01 o deixou.
- `hub.js:8` — timeout padrão do transporte é 60 s; `hub.js:321-324` a mensagem genérica
  "estourou Ns sem resposta". É o que o agente vê hoje se um comando fica preso atrás do diálogo.
- Estudo 2, §B.2: enquanto o diálogo está aberto, `Runtime.evaluate` e boa parte dos comandos CDP
  **ficam bloqueados** na aba. Decisão tem de vir do texto do diálogo, não do DOM.

## O que construir (desenho do capataz; meça o comportamento do CDP antes de fechar)

`capacidades/dialogo.ts` (reescrever o stub):

- Estado por aba: `pendentes: Map<tabId, { tipo, mensagem, url, defaultPrompt, desde }>`.
- Gancho `aoAnexar(tabId)`: `dm.on(tabId, 'Page.javascriptDialogOpening', p => pendentes.set(...))`
  e `dm.on(tabId, 'Page.javascriptDialogClosed', () => pendentes.delete(tabId))` (cobre o Cezar
  clicando ele mesmo). `chrome.tabs.onRemoved` limpa a entrada. **Sem** `handleJavaScriptDialog`
  automático em lugar nenhum.
- Gancho `antes(ctx)`: se há pendente para `ctx.tabId` e `ctx.acao !== 'cap_dialogo'`, lance
  `Error` com: `[dialogo aberto] a pagina em <url> perguntou (<tipo>): "<mensagem>". Nenhum comando
  roda nesta aba ate alguem responder. NAO responda por conta propria: pergunte ao usuario e depois
  chame browser_dialog { aceitar: true|false, texto? }. Ele tambem pode responder clicando na
  janela da ponte.` Sem chamada CDP nenhuma aqui.
- Gancho `depois(ctx, r)`: se um diálogo **abriu durante** a ação (pendente registrado depois do
  início), devolva `{ ok: false, error: <mesma mensagem> + " (abriu durante " + acao + ")" }` — o
  agente descobre na hora, não no comando seguinte.
- Capacidade `cap_dialogo { aceitar: boolean, texto?: string }` (`altera: true`): sem pendente →
  erro `nenhum dialogo aberto nesta aba`; com → `Page.handleJavaScriptDialog { accept, promptText }`,
  limpa a pendência, devolve `{ respondido: tipo, mensagem, aceito }`.

`tools/dialogo.js`: `browser_dialog { aceitar (obrigatório), texto? }` → `cap_dialogo`. Descrição
tem de dizer: "use só depois de perguntar ao usuário; nunca por conta própria".

**Medições obrigatórias antes de fechar o desenho** (relate os três):
1. Clique num botão cujo handler chama `confirm()`: o `Input.dispatchMouseEvent` retorna ou fica
   preso? (Se retorna, o `depois` entrega o erro na hora. Se prende, o erro chega pelo timeout do
   transporte e o `antes` pega o comando seguinte — documente e ajuste a mensagem.)
2. `browser_javascript` emitido **com** diálogo aberto e o gancho `antes` desligado: fica preso?
   por quanto? o ramo de reload de `send()` (114-119) chega a disparar? Se disparar, isso é
   **bloqueante** e o `antes` é a única defesa — diga isso no relatório.
3. `beforeunload`: `window.onbeforeunload = () => 'x'` + um clique antes (o Chrome exige gesto) +
   `browser_navigate` para outra URL: o diálogo aparece? o navigate retorna? Documente; se for
   instável, deixe fora do teste e registre.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/dialogo.ts`, `bridge-server/src/tools/dialogo.js`,
`bridge-server/test/dialogo.js` (novo).

## Arquivos que você NÃO PODE tocar

`debugger-manager/index.ts` (o auto-aceite já saiu de lá na 01; se ainda estiver lá, pare e
reporte — não conserte), `bridge/index.ts`, `capacidades/registro.ts`, `capacidades/index.ts`,
`tools/index.js`, `hub.js`, qualquer outro módulo de `capacidades/` ou `tools/`, `package.json`,
`README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote A: obras 05, 06, 07, 08, 09, 10, 11, 12 em paralelo, cada uma no próprio módulo em
`capacidades/` e `tools/`. A 08 é a única em `bridge/index.ts`; a 10 toca `shared/types`,
`audit/` e `hub.js`. Ninguém toca o seu arquivo. Todos dividem o build e o Chrome: protocolo de
trava abaixo.

## Padrão da casa a imitar

- **Erro que diz o remédio:** `bridge/index.ts:486-490` (`[aba trocou] ... navegue de novo antes
  de ler ou clicar`) — a sua mensagem `[dialogo aberto]` segue o mesmo molde: o que aconteceu, o
  que está bloqueado, o que fazer.
- **Freio devolve erro em vez de modal:** `policy.ts:13-15` ("Modal no side panel nao serve:
  ninguem esta olhando para ele"). Mesmo princípio: o texto vai para o agente, que pergunta no chat.
- Teste: `test/aba-sumiu.js` prova "o comando seguinte falha alto e o erro diz o que morreu".
  Copie a estrutura (`c.call('tools/call', ...)` + `isError` + regex no texto).

## O que NÃO fazer, e por quê

- **Nenhum auto-aceite, nem por timeout, nem "só para alert".** Decisão do Cezar. `alert` também
  espera: ele quer ver o que a página disse.
- **Não use o canal `push` do hub** (`hub.js:164-169`): MCP por stdio não entrega evento ao
  agente fora de uma chamada (estudo 2, §B.10). O erro na chamada é o canal.
- **Não leia o DOM para decidir nada** enquanto o diálogo está aberto: trava.
- **Não toque no `debugger-manager`** para "proteger" o ramo de reload: reporte a medição 2 e o
  capataz decide numa obra própria.
- **Defeito irmão:** listener registrado só no `attach` original some no detach (era o bug D6 do
  estudo 2). Registre **só** pelo gancho `aoAnexar`, que a 01 faz rodar no reattach também.
  Confira no teste: `bridge_reload_extension`? Não — isso derruba todo mundo. Confira lendo o
  código da 01 (`send()`, ramo de reattach chama os ganchos).

## Armadilhas conhecidas

- Aba não pintada ignora clique (README) — o botão de teste que abre o `confirm()` precisa de
  `browser_click`, que já passa por `comAbaPronta`.
- `replMode` quebra serialização; `executarJs` já não usa. Devolva objetos simples.
- `Page.javascriptDialogOpening` traz `{ url, message, type, hasBrowserHandler, defaultPrompt }`.
  `type` ∈ `alert | confirm | prompt | beforeunload`.
- A extensão não pode aparecer na própria leitura: nada de UI nova fora do shadow root
  (`agent-indicator.content.ts:11-29`). Você não desenha nada; só registro.

## Critério de pronto

`bridge-server/test/dialogo.js` (novo), verde, cobrindo:
1. `setTimeout(() => { window.__r = confirm('Sair sem salvar?') }, 300)` via `browser_javascript`
   (retorna antes do diálogo); 800 ms; `browser_read_page` → `isError`, texto casa
   `/dialogo aberto/` e contém `Sair sem salvar?` e `browser_dialog`.
2. `browser_dialog { aceitar: false }` → ok; `window.__r` lê `false`.
3. Mesmo com `aceitar: true` → `window.__r` lê `true`.
4. `prompt('Nome?')` + `browser_dialog { aceitar: true, texto: 'Cezar' }` → `Cezar`.
5. `alert('Atencao')` → comando seguinte erra; `browser_dialog { aceitar: true }` limpa; comando
   seguinte funciona.
6. `browser_dialog` sem pendência → `isError` com `nenhum dialogo`.
7. Medição 1 como teste, se estável: clique em botão que chama `confirm()` → o **próprio**
   `browser_click` volta `isError` com o texto do diálogo.
E `npx tsc --noEmit` (raiz) só com o erro pré-existente de `safe-scripting.ts:8`.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/dialogo.js`. Só o seu teste.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-04 $(date +%H:%M)" > .obra-lock)`.
Existe → espere 60 s, repita (até 15 min; >10 min é abandonada, sobrescreva e anote). Com a trava:
build → reload → seu teste → `rm .obra-lock`, mesmo vermelho. Nunca reload sem trava. Build quebrado
em arquivo alheio: solte, espere 2 min, até 3 vezes, depois reporte. Não commite; não use
`git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

Você troca o comportamento de um módulo (é o objetivo), e nada mais. Regressão inaceitável: aba
que fica presa **sem** o agente receber o texto; `browser_dialog` respondendo sem pendência;
qualquer comando chegando ao CDP com diálogo aberto por um caminho que o `antes` não cobre (liste
os caminhos que você conferiu: `cap_*`, ações do motor, `switch_tab`, `bridge_tabs`).

## Se concluir que não vale

Se a medição 2 mostrar que o `send()` recarrega a aba antes de o `antes` conseguir proteger algum
caminho real, **não entregue pela metade**: reporte com o caso concreto e a proposta (por exemplo,
a 01 ou uma obra nova tirar o reload do `send()`).

## Como reportar

As três medições com números; saída do teste; a mensagem final do erro, literal; notas para o
README (seção "Freio": diálogo nativo chama o usuário; tool `browser_dialog`) e para a skill
`protocolo-pje-ponte` (o que muda no fluxo quando o PJe pergunta). Não edite nenhum dos dois.
