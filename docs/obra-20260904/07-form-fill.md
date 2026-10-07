# Obra 07 — Preencher vários campos numa chamada (`browser_form_fill`, item 6)

**Lote A. Depende da obra 01 (stub `capacidades/formulario-lote.ts`, `tools/formulario-lote.js`).**

## Objetivo em uma frase

`browser_form_fill { campos: [{ ref, valor }] }` aplica `preencherCampo` em sequência e devolve o
`lido` de **todos**, parando no primeiro que não bateu — 8 a 15 chamadas da qualificação de parte
do PJe viram uma.

## Por que existe

A qualificação de parte no PJe tem 8 a 15 campos; hoje são 8 a 15 chamadas de `browser_form_input`,
cada uma esperando o PJe. O Chrome DevTools MCP tem `fill_form` e recomenda usá-lo no lugar de
chamadas soltas (estudo 3, §D.2). E no PJe cada anexo exige "aplicar o tipo de cada arquivo do
lote" (skill §4.2) — com a obra 05 (upload em lote), é esta tool que aplica os tipos.

## Âncoras conferidas na fonte (05/09/2026)

- `capabilities.ts:47-135` (pós-01: `capacidades/formulario.ts`) — `preencherCampo(tabId,
  backendNodeId, valor)`: sobe de `<option>` para o `<select>` (67), sobe do `<span>` do Select2
  para o `<select>` real (74-83), dispara `input`/`change` (107-108), **relê e falha se não bater**
  (113-127), devolve a string `detalhe`. Lança `Error` com o motivo (`ref X nao existe mais na
  pagina`, 56; `opcao nao encontrada. Disponiveis: ...`, 97; `escrevi "..." mas o campo ficou com
  "..."`, 125). **Reutilize; não copie.**
- `bridge/index.ts:625-627` (pós-01: registro) — `cap_form_input` exige `ref`.
- `bridge/index.ts:28-30 / 37-40` (pós-01: flags) — `cap_form_input` é `input` e `altera`. A sua
  capacidade herda as duas.
- Skill `protocolo-pje-ponte/SKILL.md` 338-342: "Aplicar o tipo em vários selects na mesma passada
  faz parte deles voltar para `Selecione o tipo` sem erro (4 de 47, depois 4 de 9)" — isso foi
  **numa única chamada de `browser_javascript`**, sem espera entre os `change`. A sua tool aplica
  um por vez, **com intervalo** e relendo cada um. É hipótese: o PJe real confirma.

## O que construir

`capacidades/formulario-lote.ts`, capacidade `cap_form_fill` (`altera: true`, `input: true`):

- Params: `campos: [{ ref: number, valor: string|boolean }]`, `parar_no_erro` (true),
  `intervalo_ms` (150).
- Para cada campo, na ordem: `preencherCampo` → guarda `{ ref, ok: true, detalhe }`; em `Error`
  → `{ ref, ok: false, erro: message }` e, se `parar_no_erro`, os restantes entram como
  `{ ref, ok: false, erro: 'nao tentado' }`. `intervalo_ms` entre campos (framework re-renderiza).
- Resposta `{ total, preenchidos, campos: [...] }`. **Algum falhou → `ok: false`**, com o relatório
  inteiro na mensagem e a instrução: `releia a pagina (as refs podem ter mudado depois de um campo
  re-renderizar) e mande de novo so os que faltaram`.
- Validação de entrada: `campos` vazio ou sem `ref` numérico → erro claro antes de tocar a página.

`tools/formulario-lote.js`: `browser_form_fill`, schema com `campos` (array de objetos `ref`,
`valor` `anyOf string|boolean`, como em `tools.js:348-352`), descrição: "prefira isto a várias
`browser_form_input`; devolve o lido de cada campo; para no primeiro que não bateu".

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/formulario-lote.ts`,
`bridge-server/src/tools/formulario-lote.js`, `bridge-server/test/form-fill.js` (novo).

## Arquivos que você NÃO PODE tocar

`capacidades/formulario.ts` (importe; não edite), `tools/formulario.js`, `bridge/index.ts`,
`registro.ts`/`index.ts` dos dois lados, qualquer outro módulo, `package.json`, `README.md`,
`ESTADO.md`.

## Quem mais está construindo agora

Lote A: 04, 05, 06, 08, 09, 10, 11, 12, cada uma no próprio módulo. A 05 é a complementar sua
(upload em lote → **form_fill dos tipos** → verify). A 08 toca `bridge/index.ts`. Trava de build.

## Padrão da casa a imitar

- **Escrita que devolve o que ficou:** `preencherCampo` (acima) e o `lido` do `type`
  (`bridge/index.ts:372-379`).
- **Erro que diz o remédio:** `bridge/index.ts:486-490`.
- Teste: `test/digitacao-real.js:81-92` (form_input em Select2 falso e o caso "teimoso" que falha
  alto). Reaproveite a página de prova.

## O que NÃO fazer, e por quê

- **Não paralelize os campos** (`Promise.all`): re-render de um invalida a ref do próximo e
  `change` simultâneo é o que fez 4 de 47 voltarem para "Selecione o tipo".
- **Não engula erro de um campo para "seguir"**: `parar_no_erro` padrão é `true`; com `false` o
  relatório continua `ok: false` no fim.
- **Não reimplemente o Select2/option-climbing**: está em `preencherCampo`.
- **Defeito irmão:** esquecer `input: true` faz a capacidade pular a fila/ativação; hoje
  `cap_form_input` passa por ela (`INPUT_ACTIONS`, linha 29) — mantenha a paridade.

## Armadilhas conhecidas

- `<option>` no lugar do `<select>` (README): já tratado em `preencherCampo`.
- Aba do usuário em modo leitura: `altera: true` barra, como `cap_form_input`.
- Não há teto de campos, mas o transporte tem 60 s (`hub.js:8`): declare `timeout` na tool como
  função do tamanho (`(i) => 15_000 + campos.length * 5_000`), no molde de `tools.js:139`.

## Critério de pronto

`bridge-server/test/form-fill.js` (novo), página de prova com texto, select nativo, checkbox, Select2
falso (como em `digitacao-real.js`) e o campo "teimoso" (que reescreve o valor):
1. 4 campos válidos → `ok`, 4 `ok: true`, cada `detalhe` com o lido; ordem preservada; valores no
   DOM conferidos por `browser_javascript`.
2. 5 campos com o teimoso em 3º → `isError`; relatório: 2 ok, teimoso com `escrevi "..." mas o
   campo ficou com "..."`, 2 `nao tentado`; o texto contém "releia a pagina".
3. Mesmo caso com `parar_no_erro: false` → 4 ok, 1 falha, ainda `isError`.
4. `campos: []` → erro sem tocar a página.
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/form-fill.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-07 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seu teste →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`browser_form_input` continua igual. Regressão inaceitável: `digitacao-real.js` vermelho; a tool
nova devolvendo `ok` com campo que não bateu.

## Como reportar

Saída do teste; exemplo real da resposta e do erro; notas para a skill `protocolo-pje-ponte`
(qualificação de parte e tipos de anexo em uma chamada). Não edite a skill nem o README.
