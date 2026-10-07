# Obra 06 — Campo de autocomplete como capacidade da ponte (item 8)

**Lote A. Depende da obra 01 (stub `capacidades/autocomplete.ts`, `tools/autocomplete.js`).**

## Objetivo em uma frase

`browser_autocomplete { ref, texto, escolher }` digita **de verdade** no campo, espera a lista de
sugestões aparecer, acha a sugestão pelo texto e clica nela **com mouse real** — tirando da skill
a gambiarra de ler o `<script>` inline do RichFaces e remontar o `A4J.AJAX.Submit` à mão.

## Por que existe

CEP da parte, ente e autoridade no PJe são campos `suggest` do RichFaces: o `onchange` é
`if(this.value != '') return false;;A4J.AJAX.Submit(...)` — **valor colado nunca dispara o
ciclo**. A skill contorna lendo o script inline do componente, extraindo `similarityGroupingId` e
`containerId`, setando `<id>_selection` e disparando o submit (`protocolo-pje-ponte/SKILL.md`
210-249). Funciona, mas o `j_idNNNN` do meio **muda a cada abertura do modal**, e é gambiarra de
produção reinventada por quem usa, não recurso de quem constrói. As peças já existem na ponte:
digitar tecla a tecla com `isTrusted` (`digitarTeclaATecla`) e clicar por coordenada com mouse
real (`cap_click_xy`) — o ESTADO de 03/09 diz que o clique por coordenada nasceu exatamente
"para linha de autocomplete".

## Âncoras conferidas na fonte (05/09/2026)

- `capabilities.ts:171-197` (pós-01: `capacidades/formulario.ts`) — `digitarTeclaATecla(tabId,
  backendNodeId, texto, delayMs=60)`: `DOM.focus` + `keyDown`/`keyUp` por caractere com `text`, e
  devolve `{ digitado, lido }`. **Reutilize; não copie.**
- `bridge/index.ts:632-651` (pós-01: `capacidades/clique.ts`) — `cap_click_xy`: `DOM.getDocument`
  → `DOM.getNodeForLocation { x, y }` → `avaliar(...)` (freio) → `cdpClick`. Imite a sequência
  (freio antes do clique na sugestão).
- `cdp-tools.ts:5-10` — `cdpClick` manda `mouseMoved` antes de `mousePressed`/`mouseReleased`
  (widgets que selecionam em `mouseover`/`mousedown` recebem tudo).
- `capabilities.ts:138-157` — `lerValorDoElemento` para o `lido`.
- Skill, 218-221: "Disparar KeyboardEvent sintético a cada caractere **carrega as sugestões** (a
  tabela `…:suggest` se enche). O que o widget recusa é a **seleção** por clique sintético." O
  clique da ponte não é sintético (`Input.dispatchMouseEvent`, `isTrusted`) — é a hipótese central
  desta obra, e **só o PJe real a confirma** (plano, §7).
- Skill, 247-249: localizar campo por sufixo (`input[id$="pessoaAutoridadeSuggest"]`), nunca pelo
  id inteiro.

## O que construir (hipótese do capataz)

`capacidades/autocomplete.ts`, capacidade `cap_autocomplete` (`altera: true`, `input: true`):

Params: `ref` (obrigatório), `texto`, `escolher`, `delay_ms` (60), `timeout_ms` (8000),
`seletor_sugestoes?`, `limpar?` (apaga o campo antes: `Ctrl+A`+`Backspace` via `cdpPressKey`).

1. `digitarTeclaATecla(tabId, ref, texto, delay_ms)`.
2. A cada 250 ms até `timeout_ms`, `Runtime.evaluate` que lista candidatos **visíveis** (rect com
   área > 0, `visibility`/`display` ok, fora do próprio input): se `seletor_sugestoes` veio, só
   ele; senão a lista padrão `[id$=":suggest"] tr, .rich-sb-int, [role="option"], [role="listbox"] li,
   .ui-autocomplete li, .select2-results__option, .tt-suggestion, .autocomplete-suggestion` **e**,
   como último recurso, elementos folha cujo texto normalizado contenha o `escolher` normalizado.
   Normalização: minúsculas, sem acento (`normalize('NFD')` + remover diacríticos), espaços
   colapsados. Devolve `[{ texto, x, y }]` (centro do rect), no máximo 30.
3. Escolha: igualdade normalizada > começa com > contém. Empate → a primeira.
4. Freio como em `cap_click_xy`: `DOM.getNodeForLocation` no centro → `avaliar` com
   `ctx.confirm`. Depois `cdpClick(x, y)`. 300 ms. `lerValorDoElemento(ref)`.
5. Resposta: `{ digitado, sugestoes_vistas: [...até 10], escolhida, lido }`. `lido` vazio ou
   igual ao `texto` digitado (sem a sugestão) → **erro**: `[autocomplete] cliquei em "X" e o
   campo ficou com "Y" — a selecao nao pegou. Se for RichFaces, confira o seletor_sugestoes...`.
6. Timeout sem candidato: erro `[autocomplete] digitei "T" e nenhuma sugestao com "E" apareceu
   em Ns. Vi: A | B | C. Confira o texto ou passe seletor_sugestoes.` — a lista do que viu é o que
   deixa o agente corrigir sem tentativa e erro.

`tools/autocomplete.js`: `browser_autocomplete`, `confirmavel: true` (o clique na sugestão passa
pelo freio), descrição citando CEP/autoridade do PJe.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/autocomplete.ts`, `bridge-server/src/tools/autocomplete.js`,
`bridge-server/test/autocomplete.js` (novo).

## Arquivos que você NÃO PODE tocar

`capacidades/formulario.ts` (importe `digitarTeclaATecla`/`lerValorDoElemento`; não edite),
`capacidades/clique.ts`, `policy.ts`, `bridge/index.ts`, `registro.ts`/`index.ts` dos dois lados,
`cdp-tools.ts`, qualquer outro módulo, `package.json`, `README.md`, `ESTADO.md`, a skill.

## Quem mais está construindo agora

Lote A: 04, 05, 07, 08, 09, 10, 11, 12, cada uma no próprio módulo. A 08 toca `bridge/index.ts`.
Trava de build compartilhada.

## Padrão da casa a imitar

- **Digitação real quando o campo escuta o ato de digitar:** o comentário de
  `capabilities.ts:159-170` explica por que `Input.insertText` não serve. Não reinvente.
- **Freio valendo no clique por coordenada:** `bridge/index.ts:633-636` (comentário) — "O freio
  continua valendo: descobre-se o no naquele ponto".
- **Erro com a lista do que viu:** `capabilities.ts:96-97` (`opcao nao encontrada. Disponiveis: ...`).
- Teste com widget falso fiel: `test/digitacao-real.js:27-51`.

## O que NÃO fazer, e por quê

- **Não selecione por JS** (`.value =`, `_selection`, `A4J.AJAX.Submit`): é a gambiarra que a obra
  aposenta, e em sites com reCAPTCHA (TJ-SP) preencher por JS faz o captcha barrar.
- **Não use `Input.insertText`** para digitar: não gera `keydown` e o widget não acorda.
- **Não clique sem passar pelo freio**: a sugestão pode ser um botão (raro, mas o freio é barato).
- **Não construa "limpar" com `Ctrl+A` global** sem foco no campo: seleciona a página inteira
  (`cdp-tools.ts:203-211` documenta o risco).
- **Defeito irmão:** aba não pintada ignora clique — a capacidade é `input: true` para passar pela
  fila e ativação (`comAbaPronta`); esquecer a flag faz o clique na sugestão "dar certo" sem
  selecionar nada.

## Armadilhas conhecidas

- `replMode` quebra serialização: devolva arrays de objetos simples.
- A árvore de acessibilidade lista `<option>` como elemento; a `ref` que o agente manda pode ser do
  wrapper, não do `<input>`: se `DOM.focus` falhar, suba/desça para o `input` mais próximo
  (`cdp-tools.ts:44-54` tem o `findRealInput`).
- Widget que fecha a lista no `blur`: não clique em outro lugar entre digitar e escolher.
- Aba do usuário em modo leitura: `altera: true` cuida; nunca teste isso na aba dele.

## Critério de pronto

`bridge-server/test/autocomplete.js` (novo): página falsa com `<input id="cep">` cujo `keydown`
monta, **200 ms depois**, `<div id="sug"><table><tr class="rich-sb-int">…` com
`['Porto Velho', 'Presidente Medici', 'Pimenta Bueno']` filtrados por prefixo; a linha registra
`mousedown`/`click` **só se `isTrusted`**, seta o valor do input e esconde a lista. Verifica:
1. `{ texto: 'P', escolher: 'presidente médici' }` (com acento, para provar a normalização) →
   `lido === 'Presidente Medici'`, `escolhida` correta, `sugestoes_vistas` com as três.
2. `{ texto: 'P', escolher: 'Ji-Parana', timeout_ms: 1500 }` → `isError`, texto lista
   `Porto Velho | Presidente Medici | Pimenta Bueno`.
3. Sugestão que **não** aceita o clique (handler só em evento sintético) → `isError` com "a
   selecao nao pegou".
4. `seletor_sugestoes: '#sug tr'` explícito funciona igual ao padrão.
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/autocomplete.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-06 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seu teste →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`browser_type` modo teclado e `browser_click` por coordenada continuam iguais; a tool nova é
composição deles. Regressão inaceitável: `digitacao-real.js` vermelho (rode só ele se tocou algo
que ele cobre — não deveria tocar).

## Se concluir que não vale

Se a lista padrão de seletores for inútil fora do widget falso e você achar que só
`seletor_sugestoes` explícito é honesto, construa assim e diga. O PJe real decide o padrão no
próximo cadastro (plano, §7).

## Como reportar

Saída do teste; um exemplo real de resposta e de erro; o que só o PJe confirma; notas para a
skill `protocolo-pje-ponte` §"O campo suggest" (substituir o truque pela tool, mantendo o truque
como plano B até a confirmação real). Não edite a skill.
