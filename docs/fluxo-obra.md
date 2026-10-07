# Fluxo de obra da ponte — estudo antes do briefing, pedreiros em arquivos disjuntos, cético por obra

> Porte, em 05/09/2026, do `fluxo-obra-em-lote.md` da Estrelinha (desenho do Cezar, 03-04/09/2026)
> para **esta casa**: a extensão PraxedesIA + servidor MCP (`bridge-server/`). Mesmo método, exemplos
> daqui. O que era só de lá (Prisma, PDV, banco de produção, estoque, pre-commit) ficou lá.
>
> **A ideia, na fala do Cezar:** *"um workflow onde um sonnet vai na frente achando os códigos e
> linhas e um opus depois recebe o estudo do código e monta o raciocínio. Aí tu recebe algo pronto
> e não enche a sua janela de contexto."* E o porquê: *"pedreiro tem que receber a ordem do que vai
> construir. E você também não pode ficar lendo código o tempo todo... faz sua janela de contexto
> encher e o compact vem cedo demais."*
>
> ⚠️ **Quando vale: SEMPRE.** É o modo padrão do orquestrador, não um gatilho de tamanho. Uma
> feature ou um bug único passam pelo estudo. O tamanho muda **quantos** levantadores, nunca **se**.
> ⛔ **"É pequeno, eu mesmo leio" é a frase proibida.** Medido lá: três âncoras escritas de cabeça,
> as três erradas. Medido aqui (§4): sete âncoras dos estudos não batiam com a fonte.

---

## 1. Por que DOIS workflows

1. **Ler 50 arquivos custa token e não precisa de modelo caro.** Achar `arquivo:linha` é cadastro;
   o caro é o julgamento em cima dele.
2. **Orquestrador que lê código enche a própria janela** — justamente quem precisa dela livre para
   escrever briefing e conversar.
3. **Briefing bom nasce do estudo, não da intuição.** Aqui, o estudo 2 disse que `browser_console_logs`
   lia "um array que talvez ninguém preencha"; o fechador abriu `entrypoints/content/index.ts` e o
   array **é** preenchido — no mundo isolado, onde não vê o console da página. O conserto é outro.

---

## 2. WORKFLOW 1 — ANÁLISE

**Objetivo:** transformar "temos N coisas para fazer" em N fichas com `arquivo:linha`. Ninguém
escreve código.

### 2.1 Levantadores — Sonnet, um por frente, em paralelo

- ⛔ **Você NÃO escreve nada.** Nem código, nem arquivo, nem commit.
- ✅ **Pode:** ler código, `grep`, `git log -S`, ler skills e memória. Pode usar a ponte
  (`browser_*`) **só para olhar** uma página, na própria aba, nunca na do usuário, nunca agindo.
- ⛔ **NÃO CONCLUA.** Conclusão de levantador vira pergunta aberta para o fechador.
- **Toda afirmação com `arquivo:linha`.** "NÃO ACHEI" é melhor que chute educado.
- **Três estados:** EXISTE E FUNCIONA · EXISTE PELA METADE (qual metade falta) · NÃO EXISTE (e onde
  nasceria). Exemplo daqui: auditoria = existe pela metade (módulo pronto, nunca chamado;
  `bridge/index.ts:393` é um `TODO`).
- **Número medido, nunca estimado.** "~35 tools" só vale depois de contar (34 + `browser_status`).

Em 04/09 foram quatro levantadores, um por frente: uso real (skills/memória), código+CDP,
mercado, jurisprudência. Saíram em `docs/estudos-20260904/`.

### 2.2 Fechador — Opus, um só, depois de todos

🔴 **O furo do formato:** Opus lendo só o texto do Sonnet herda o ponto cego dele. Se o Sonnet não
abriu o arquivo que importa, o texto não denuncia.

👉 **Conserto:** o fechador **confere na fonte** toda âncora em que vai se apoiar. Abre 5 arquivos
em vez de 50. Aqui abriu ~25 e corrigiu 7 âncoras (§4) e achou 2 defeitos fora da lista.

**Entrega:** o plano de obra (`docs/obra-<data>/00-PLANO-DE-OBRA.md`, para o capataz) e um
briefing por obra (`NN-<slug>.md`). Nesta casa o "documento para o dono" já existia antes — a
`PROPOSTA-MELHORIAS-*.md` que o Cezar aprovou; o fechador não a reescreve.

### 2.3 Triagem — para lista que já existe

Antes de gastar pedreiro numa fila, descobrir se a obra **existe**. A proposta de 04/09 começou
por uma tabela "o que os estudos apontaram e JÁ está resolvido": dez atritos dos handoffs de 19/08
e 03/09 tinham fechado nas 24 h anteriores. Sem a triagem, dez pedreiros sem o que consertar.

⚠️ Procure o conserto que entrou por outra porta (`git log -S`), não só o arquivo de hoje.
⚠️ O inverso conta igual: item **pior** do que o texto diz (o `tab_close` que fecha aba do
usuário) vale tanto quanto item morto.

---

## 3. WORKFLOW 2 — PEDREIROS E CÉTICOS

Só dispara depois que o Workflow 1 fechou e os briefings existem.

### 3.1 Construção — um pedreiro por conjunto DISJUNTO de arquivos

⛔ Worktree é proibido. ⛔ `git checkout`, `git stash`, `git reset` são proibidos com outro
pedreiro escrevendo. Ninguém commita; o capataz commita por lote.

**Como se consegue disjunção nesta casa:** a ponte tem três arquivos-gargalo (`bridge/index.ts`,
`capabilities.ts`, `tools.js`) que quase toda obra tocaria. A resposta (obra 01 de 05/09) foi
**registro + módulos por domínio + ganchos (`aoAnexar`/`antes`/`depois`) + stubs vazios nomeados**:
cada obra nasce com o seu arquivo já existindo, vazio, dos dois lados (`capacidades/<obra>.ts`,
`tools/<obra>.js`), e ninguém edita o arquivo de ninguém. Obra que precisa mesmo do arquivo
compartilhado é **a única do lote** nele (a 08 em `bridge/index.ts`).

**Todo briefing leva:** objetivo em uma frase · por que existe (o incidente) · âncoras conferidas ·
`arquivo:linha` que pode tocar · os que **não pode** · quantos outros estão escrevendo e onde · o
padrão da casa a imitar (exemplo real) · o que não fazer e o defeito irmão · critério de pronto
com o teste novo · a regra ADITIVO · e "se concluir que não vale, não construa; reporte com números".

⚠️ **A diferença desta casa: build + `npm run reload` + Chrome são UM recurso.** O reload derruba a
sessão de todos os agentes (`bridge/index.ts:232-239`), e o build lê arquivo pela metade de quem
está escrevendo. Por isso o **protocolo de trava** (`.obra-lock` na raiz; `set -o noclobber`;
build → reload → **só o seu teste** → soltar). Não dispare mais de ~5 pedreiros que precisem do
Chrome ao mesmo tempo.

⚠️ **Só o seu teste, nunca `npm test`.** Com outro pedreiro de arquivo pela metade, a bateria dá
falso vermelho. A bateria inteira é da obra de refatoração (que roda sozinha) e do capataz no fim
do lote.

**Padrões da casa que todo briefing aponta:** toda escrita **relê o valor e falha se não bater**
(`preencherCampo`, `capabilities.ts:110-127`); erro que **diz o remédio** (`[aba trocou]`,
`bridge/index.ts:486-490`); teste que prova o **contrato**, não a implementação
(`bridge-server/test/*.js`, com `check()` e página de prova montada por `browser_javascript`).

### 3.2 Cético — um por obra, contexto limpo, assim que o pedreiro entrega

Quem constrói não revisa. Recebe o briefing e o relatório do pedreiro com a ordem de **não aceitar
a narrativa**: abrir a fonte. Todo achado com "como quebra" (entrada → resultado errado).

🔴 **Mutation testing:** mutile o conserto e confirme que o teste fica VERMELHO. Verde com o defeito
de volta = teste de teatro. Backup por **`cp`**, nunca comando de git que reverte árvore.
**Proibição sem técnica é proibição que vai ser furada por quem está tentando fazer o certo.**

**Cético Opus, não Sonnet,** quando a obra toca o freio (`policy.ts`), o isolamento entre agentes
e a aba do usuário (`bridge/index.ts`), diálogo nativo, ou escrita no PJe. É o equivalente daqui
à "trava de dinheiro" da Estrelinha: o dano é processo, documento do cliente ou a aba em que o
Cezar trabalha.

### 3.3 Conferência de escopo — no fim de cada lote

Um agente compara `git status` com a **união** das listas "PODE tocar" de todos os briefings do
lote. Arquivo fora da lista é achado (o cético só olha o diff da obra dele). Arquivo da lista
**sem** toque também: pode ser obra que não saiu do papel. Depois: capataz liga os testes novos no
`package.json`, atualiza README/ESTADO com as notas dos relatórios, roda a bateria inteira, commita.

---

## 4. O que ficou MEDIDO nesta casa (05/09/2026, fechador conferindo na fonte)

| Achado | Onde |
|---|---|
| Estudo 2 dizia "29 tools"; são 34 + `browser_status` | `tools.js`, `index.js:34-40` |
| Estudos 2/3: console "lê array que ninguém preenche"; é preenchido no mundo isolado | `content/index.ts:3-26` |
| Estudo 3: "auto-wait é manual depois de navegar"; `navigate` já espera 15 s | `cdp-tools.ts:516-519` |
| Proposta: "assentar reaproveita wait_network"; `checkIdle` só resolve depois de FCP/load — clique AJAX gastaria o teto inteiro | `cdp-tools.ts:460-470` |
| Estudo 2: reattach não reinstala o handler de diálogo; é pior: `onDetach` apaga **todos** os listeners | `debugger-manager/index.ts:27-34` |
| Proposta: diálogo com "timeout de segurança"; vencida pela decisão do Cezar (nunca responder sozinho) | — |
| **Fora da lista:** `browser_tab_open` cria a aba na janela do **usuário** (sem `windowId`) | `workspace-manager/index.ts:184` |
| **Fora da lista:** `browser_tab_close {tabId}` fecha aba do usuário; nada guarda | `execution-engine/index.ts:220-224` |

Na Estrelinha, em 04/09: triagem evitou 6 pedreiros inúteis de 17; a conferência de escopo pegou o
próprio orquestrador editando fora do escopo; o cético achou defeito **dentro** do conserto em 3
de 6 obras.

---

## 5. Padrões que se repetem (cada um vale um parágrafo no briefing)

### 5.1 Mandar MEDIR antes de construir — e autorizar a não construir
Exemplos daqui: a obra 08 mede qual comando CDP de download o `chrome.debugger` aceita antes de
escrever a capacidade; a 14 mede se `Log.enable`/`Overlay.enable` são permitidos; a 02 mede o DOM
da aba do PJe antes de decidir a regra. 👉 Escreva: *"se concluir que não vale, NÃO construa —
reporte com os números."*

### 5.2 O desenho do capataz é hipótese até alguém medir
O item 7 da proposta dizia "reaproveita o wait_network"; a fonte derrubou (§4). O briefing dá o
desenho e diz que quem constrói pode derrubá-lo com número.

### 5.3 Avisar do que NÃO fazer, com o motivo
"Widget de reCAPTCHA não é desafio — senão o detector bloqueia o único caminho do TJ-SP" (09).
"`wait_new_tab` sem aba não é erro — erro reproduziria a guia órfã" (08). "Não adicione `emitir`
ao freio — é pergunta aberta ao Cezar" (02).

### 5.4 Nomear o defeito irmão que o conserto pode reintroduzir
"Capacidade nova sem `altera: true` volta a página da aba do usuário em modo leitura" (12).
"`action` de `browser_screenshot` virando função sem `imagem:` faz o screenshot inteiro voltar em
texto base64" (14). "`loadingFinished` de requisição não contada zera o contador negativo" (13).

### 5.5 Pedir a decisão justificada, não a obediência
"Caso 6 (link de ajuda com 'Protocolar' no texto): decida e documente no teste" (02). *"Se você
julgar que isso esconde comportamento, NÃO faça e explique."*

### 5.6 O cético acha defeito dentro do conserto
Não é luxo. Nesta casa dois testes já deram **falso positivo** por verificação frouxa (ESTADO:
`iana.org` no href; ordem entre processos). Mutation testing pega os dois tipos.

### 5.7 Conferir a estrutura do documento depois de editar por script
Exemplo de código com crase, `\n` ou `#` não se escreve por script no `.md`; descreva em palavras.

---

## 6. Armadilhas que o fluxo NÃO resolve

- ⚠️ **Página falsa prova o contrato, não o PJe.** Upload em lote (05) e autocomplete (06) só se
  provam de verdade num protocolo real, com o Cezar no Chrome. O plano marca o que exige teste
  manual dele.
- ⚠️ **Medir no contexto errado ressuscita defeito.** Testar o modo isolado × mundo da página,
  aba pintada × não pintada, janela da ponte × do usuário: antes de dizer que algo "não funciona",
  pergunte onde a defesa está instalada e se o seu teste passa por lá.
- ⚠️ **O teto é o Chrome, não o commit.** N frentes escrevendo ≠ N frentes testando. A trava
  serializa a verificação.
- ⚠️ **Freio, diálogo, aba do usuário e escrita no PJe saem do cético Sonnet** e vão para Opus.
- ⚠️ **A vistoria do conjunto continua obrigatória** no fim do lote (bateria inteira + escopo),
  antes de commitar e de atualizar `ESTADO.md`.

---

## 7. Como disparar

- Levantadores (2.1), fechador (2.2), triagem (2.3) e conferência de escopo (3.3): `Workflow`
  (itens independentes; o agente morre ao terminar).
- Construção (3.1): `Workflow` para tijolo pequeno e fechado; obra que vai precisar de conserto
  (volta do cético) abre por `Agent`, porque só ele aceita `SendMessage` de volta. Três voltas está
  medido; a partir daí, troque de agente.
- Modelo (regra da máquina, `~/.claude/CLAUDE.md`): `haiku` braçal; `sonnet` padrão (pedreiro,
  cético comum, levantador); `opus` só o difícil (fechador, cético de freio/isolamento, obra de
  refatoração). Sempre `model` explícito.
- Subagente em background por padrão; diga o que está rodando enquanto roda.
- Documentos desta obra: `docs/obra-20260904/00-PLANO-DE-OBRA.md` e os briefings `NN-*.md`.
