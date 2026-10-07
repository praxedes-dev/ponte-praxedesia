# Obra 05 — Upload em lote que não mente (item 2)

**Lote A. Depende da obra 01 (stub `capacidades/upload-lote.ts`, `tools/upload-lote.js`).**
**Cético: Opus** (escreve no PJe).

## Objetivo em uma frase

Uma tool `browser_upload_batch` que recebe a lista de arquivos, anexa em lotes **reachando o input
a cada lote** (a ref expira), **relê a lista real da página** e devolve por arquivo
`{ nome, entrou, motivo }` — parando no primeiro lote que perdeu arquivo; e uma
`browser_upload_verify` que lê o **check verde por `opacity`**, não o `<select>`.

## Por que existe (o incidente mais caro da ponte)

No PJe a ref do campo de anexo **expira a cada lote**: cada upload re-renderiza a lista, e reusar a
ref anterior faz `browser_upload_file` devolver `1 arquivo(s) anexado(s)` **sem anexar nada**.
Assim sumiram **9 de 47** (CLIENTE A) e **4 de 20** (CLIENTE B) documentos em 19/08/2026 — um deles o
documento de identidade do cliente — com sucesso reportado em todos. Depois, no CLIENTE D (03/09),
33 anexos um a um custaram ~100 chamadas e mais de uma hora. A skill hoje exige um ciclo de cinco
passos por lote (`~/.claude/skills/protocolo-pje-ponte/SKILL.md` §4.1) e conferência do check
verde por `opacity` (§4.3), porque o `<select>` de tipo "mente": documento sem tipo aplicado não
existe no servidor mesmo aparecendo na tela (§4.2). Tudo isso é conhecimento tribal em texto de
skill. Esta obra o torna contrato da tool.

## Âncoras conferidas na fonte (05/09/2026)

- `capabilities.ts:225-232` (pós-01: `capacidades/arquivos.ts`) — `anexarArquivos(tabId,
  backendNodeId, caminhos)`: um `DOM.setFileInputFiles { backendNodeId, files }` e devolve a
  string `N arquivo(s) anexado(s): ...` **sem ler nada de volta**. É a mentira da ref velha: o CDP
  não erra em nó que a página já descartou.
- `tools.js:391-409` (pós-01: `tools/arquivos.js`) — `browser_upload_file { ref, caminhos }`.
  **Fica como está**; a sua tool é outra.
- `capabilities.ts:124-127` — o padrão: `preencherCampo` **relê o valor e falha se não bater**.
- Skill `protocolo-pje-ponte/SKILL.md`, conferida:
  - 154-162 os `input[type=file]` do PJe são invisíveis (`opacity:0`, classe
    `rich-fileupload-hidden`); `browser_find` não os vê. **"Escolher arquivo" no singular é o
    documento principal; no plural é o de anexos** (`multiple`).
  - 260-267 (§4.0) nome de arquivo comprido é recusado **em silêncio** (`file.accepted === false`,
    sem mensagem, sem console); medido 89 caracteres falhou, 57 passou; `montar_pasta.py` derruba
    a montagem em 80.
  - 288-328 (§4.1) o ciclo por lote de até 10: expor input e ler N0 de `.dz-preview` → ref nova →
    upload na ordem → esperar `.dz-preview` chegar a N0+lote e conferir **cada nome, na ordem** →
    faltou um, **pare** → aplicar tipo um select por chamada → conferir §4.3.
  - 326-328 o nome em `[data-dz-name]` vem sujo no primeiro preview (um `<script>` inline antes):
    ler a **última linha** (`.split('\n').pop().trim()`).
  - 316-320 `browser_javascript` tem teto de 60 s e o `change` do tipo trava o JS da página.
  - 388-406 (§4.3) o check: `parseFloat(getComputedStyle(p.querySelector('.dz-success-mark')).opacity) > 0.9`;
    `dz-success-mark` e `dz-error-mark` convivem no mesmo lugar e os dois passam em
    `offsetParent !== null` — **quem decide é a `opacity`**. Nome em `input[id$=":descDoc"]`.

## O que construir (desenho do capataz; hipótese — o PJe real só se mede no próximo protocolo)

`capacidades/upload-lote.ts`:

- `cap_upload_lote` (`altera: true`), params: `caminhos: string[]`, `seletor_input`
  (padrão `input[type=file][multiple]`), `tamanho_lote` (10), `seletor_item` (`.dz-preview`),
  `seletor_nome` (`[data-dz-name]`), `timeout_lote_ms` (30000), `forcar?: boolean`.
- **Pré-voo, antes de anexar qualquer coisa:** nome (basename) com ≥ 80 caracteres → erro listando
  os nomes, a menos que `forcar: true` (a causa conhecida da recusa calada, §4.0). Caminho que não
  existe: o servidor tem disco — mas a extensão não; faça a checagem de existência **no servidor**
  (`tools/upload-lote.js`, no `build`, com `fs.existsSync`) e falhe antes de mandar.
- Por lote: `DOM.getDocument { depth: 0 }` → `DOM.querySelector { nodeId, selector: seletor_input }`
  → `DOM.setFileInputFiles { nodeId, files: lote }` (o CDP aceita `nodeId` ou `backendNodeId`).
  Reachar o input **a cada lote** é o que substitui "ref nova". Depois, `Runtime.evaluate` a cada
  500 ms até `timeout_lote_ms`: conta `seletor_item` e lê o nome de cada item novo (última linha
  do `textContent` de `seletor_nome`). Quando chegar a N0 + lote, compara com os basenames **na
  ordem**. Faltou → devolve o que entrou e o que não, com `parou_no_lote: k`, e **não sobe o
  próximo**. Timeout → idem, com `motivo: 'nao apareceu na lista em Ns'`.
- Resposta: `{ total, entraram, lotes, arquivos: [{ nome, entrou, motivo? }], parou_no_lote?,
  proximo_passo }` — `proximo_passo` diz em português o que fazer ("aplique o tipo de cada arquivo
  com browser_form_fill, depois browser_upload_verify"). Se algum não entrou → `ok: false` com o
  relatório inteiro na mensagem (o agente precisa ver os dois lados).
- `cap_upload_conferir`: params `seletor_item`, `seletor_ok` (`.dz-success-mark`), `seletor_nome`
  (`input[id$=":descDoc"]`, com fallback `[data-dz-name]`), devolve `[{ nome, ok }]` pela
  `opacity`. Não altera.

`tools/upload-lote.js`: `browser_upload_batch` e `browser_upload_verify`, com os padrões do PJe
nas descrições e a frase: "isto sobe e confere que entrou na lista; **o tipo de cada arquivo é o
que grava** — aplique com browser_form_fill/browser_form_input e confira com
browser_upload_verify".

**Não é escopo:** aplicar o tipo (é `form_fill`, obra 07, e a skill manda um select por chamada —
não está provado que uma tool faça vários em sequência sem regressão). Se você quiser propor,
proponha no relatório; não construa.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/upload-lote.ts`, `bridge-server/src/tools/upload-lote.js`,
`bridge-server/test/upload-lote.js` (novo).

## Arquivos que você NÃO PODE tocar

`capacidades/arquivos.ts` (é da obra 15 no Lote B; `anexarArquivos` fica como está — importe se
precisar), `tools/arquivos.js`, `bridge/index.ts`, `registro.ts`, `index.ts` dos dois lados,
qualquer outro módulo, `package.json`, `README.md`, `ESTADO.md`, a skill.

## Quem mais está construindo agora

Lote A: 04, 06, 07, 08, 09, 10, 11, 12, cada uma no próprio módulo. A 07 (`form_fill`) é a
complementar sua no PJe. A 08 toca `bridge/index.ts`. Build e Chrome são compartilhados: trava.

## Padrão da casa a imitar

- **Toda escrita relê e falha se não bater:** `capabilities.ts:47-135` (`preencherCampo`),
  especialmente 110-127 ("A leitura de volta e a unica defesa, e tem de vir da propria tool — nao
  bateu, e erro, nunca ok").
- **`type` devolve `lido`:** `bridge/index.ts:372-379` (pós-01, no pós-processamento).
- Teste com página falsa fiel ao DOM real: `test/digitacao-real.js:27-51` imita o Select2 do PJe.
  Você imita o Dropzone do PJe — inclusive a linha de `<script>` suja no primeiro preview e a
  recusa calada por nome comprido.
- `test/capabilities.js:83-93` mostra como criar arquivo de prova e checar `files[0].name`.

## O que NÃO fazer, e por quê

- **Não use `browser_find` nem ref para achar o input**: é a ref que expira. Seletor a cada lote.
- **Não anexe mais de um lote sem conferir o anterior**: foi exatamente isso que perdeu 9 de 47.
- **Não confie em `offsetParent`/visibilidade para o check verde**: 100% de aprovação sempre.
- **Não conte itens; compare nomes na ordem.** Contar não pega "um sumiu e outro entrou".
- **Não leia `textContent` inteiro do nome**: última linha.
- **Não exponha o input mudando CSS**: `setFileInputFiles` não precisa de input visível; o
  `cssText` da skill (§2.5) existia só para o `browser_find` enxergar.
- **Defeito irmão:** a tool devolver `ok` com relatório parcial "entrou 11 de 12" em texto de
  sucesso. O agente lê "ok" e segue. Faltou um → `isError`, com o relatório dentro.

## Armadilhas conhecidas

- `browser_javascript` e `Runtime.evaluate` têm teto; seus laços de espera são no service worker
  (`setTimeout` entre `evaluate`s curtos), nunca um laço **dentro** da página.
- `replMode` quebra serialização — devolva objetos simples com `returnByValue`.
- Caminho Windows: basename por `\` **e** `/`. Não confie em `path` da Node na extensão (não
  existe lá); o servidor pode mandar `nomes` já calculados junto com `caminhos`.
- O input `multiple` do PJe é o de **anexos**; o singular é o documento principal. Padrão do
  seletor com `[multiple]`.
- Nome ≥ 80 caracteres: recusa calada. O pré-voo existe por isso.

## Critério de pronto

`bridge-server/test/upload-lote.js` (novo), página falsa montada por `browser_javascript` com:
input `type=file multiple` com `opacity:0`; handler de `change` que, **para cada arquivo aceito**,
cria `.dz-preview` com `[data-dz-name]` cujo `textContent` tem uma primeira linha de lixo
(`<script>...</script>\n` + nome), um `input[id$=":descDoc"]` com o nome e um `.dz-success-mark`
com `opacity: 0`; e que **recusa em silêncio** nome ≥ 80 caracteres. Arquivos de prova criados em
`tmpdir()` pelo teste (12 curtos + 1 com 85 caracteres). Verifica:
1. 12 arquivos, `tamanho_lote: 10` → `lotes: 2`, 12 `entrou: true`, ordem preservada.
2. Lista com o nome de 85 → erro **antes** de anexar (pré-voo), listando o nome; contagem de
   `.dz-preview` não mudou.
3. Mesmo caso com `forcar: true` → `isError`, relatório com `entrou: false` no de 85,
   `parou_no_lote` e os posteriores marcados como não enviados.
4. `browser_upload_verify` depois de setar `opacity: 1` em 2 dos 3 marks → `[{nome, ok}]` bate
   (2 true, 1 false); e com `dz-error-mark` visível no lugar → `ok: false`.
5. Caminho inexistente → erro do servidor antes de chegar à extensão.
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/upload-lote.js`. Só o seu.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-05 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seu teste →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`browser_upload_file` e `anexarArquivos` continuam existindo e iguais. Regressão inaceitável:
`capabilities.js` (upload simples) vermelho; a nova tool devolvendo sucesso com arquivo faltando.

## Se concluir que não vale

Se ao imitar o Dropzone você concluir que sem o PJe real o contrato não se prova, construa o
**mínimo que a página falsa prova** (lotes + reachar input + nomes na ordem + pré-voo + verify) e
diga no relatório o que só o protocolo real vai confirmar. O capataz agenda o teste manual do
Cezar (plano, §7).

## Como reportar

Saída do teste; a forma final da resposta da tool (um exemplo real); o que ficou para o PJe real
confirmar; notas para a skill `protocolo-pje-ponte` §4.1-4.3 (ciclo novo em 3 chamadas: batch →
form_fill dos tipos → verify). Não edite a skill nem o README.
