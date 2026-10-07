# Obra 20 — `browser_javascript` fura o modo somente leitura (achado do cético da 01)

**Lote A, à frente de metade dele — prioridade do capataz (`00-PLANO-DE-OBRA.md` §16).** Toca
`entrypoints/background/bridge/capacidades/js.ts` e `bridge-server/src/tools/js.js`. **Serialização
nova que o plano ainda não tinha registrado:** esses dois arquivos são também o alvo da obra
`15-pdf-e-js-com-argumentos` (Lote B, item 16 da proposta). A 20 tem de terminar, passar pelo
cético e ser commitada **antes** de a 15 tocar os mesmos arquivos — não dispare as duas juntas
mesmo que os lotes pareçam separados no papel. Avise disso quando escrever o briefing da 15.

## Objetivo em uma frase

Fazer o modo somente leitura barrar JS que **altera** a aba do Dr. Cezar (`submit()`, `.click()`,
`.value =`, `location =`, POST por `fetch`...) do mesmo jeito que já barra clicar, digitar e
navegar — sem quebrar o JS de **leitura** que a própria casa usa para inspecionar e medir.

## Por que existe

Achado do cético da obra 01, 05/09/2026 (`00-PLANO-DE-OBRA.md` §16). `cap_js`
(`capacidades/js.ts:35`) não declara `altera`, então nunca entra em `nomesQueAlteram()`
(`registro.ts:114-116`, filtra `c.altera === true`) — e a checagem de somente leitura
(`bridge/index.ts:390`, `this.somenteLeitura.has(cmd.clientId) && alteraAPagina(cmd.action)`)
nunca dispara para `cap_js`. Um `document.querySelector('form').submit()` roda liso na aba do
Cezar mesmo com o agente adotado por `browser_use_current_tab` sem `permitir_acao`. É
**pré-existente**: o `Set` fixo de antes da refatoração também não listava `cap_js`; a 01
preservou fielmente. Está lá desde 19/08, quando o modo leitura nasceu.

## Âncoras conferidas na fonte (05/09/2026)

- `capacidades/js.ts` (39 linhas, arquivo inteiro): `executarJs` (12-29) chama
  `dm.send(tabId, 'Runtime.evaluate', { expression: codigo, returnByValue: true, awaitPromise: true,
  userGesture: true })` — sem `throwOnSideEffect`. O `modulo` (31-39) registra só `nome: 'cap_js'`
  e `executar`; nenhuma flag `altera`/`input`.
- `capacidades/registro.ts`: `interface Capacidade` (32-40) tem `altera?: boolean` (36) e
  `input?: boolean` (38), ambos opcionais — omitir é o mesmo que `false`. `nomesQueAlteram()`
  (114-116) e `nomesDeInput()` (119-121) são só filtros sobre o que cada módulo declarou; não
  existe mais lista fixa por nome de capacidade para editar (a 01 já fez essa parte).
  `ContextoCapacidade` (12-23) carrega `clientId, nome?, ws, tabId, ref, params, confirm, acao` —
  **nenhum campo diz "esta chamada está em modo somente leitura" nem "esta aba é do usuário"**.
- `bridge/index.ts:28-59`: `alteraAPagina(acao)` = `ACOES_QUE_ALTERAM_MOTOR.has(acao) ||
  nomesQueAlteram().has(acao)` — puramente por **nome da ação**, decidido **antes** de qualquer
  gancho `antes()` ou de `capacidade.executar` rodar (a checagem de somente leitura, linha 390,
  vem antes do loop de ganchos, ~415 em diante). Ou seja: hoje não há como uma capacidade decidir
  "bloqueio só às vezes, conforme o conteúdo" — o gate ou bloqueia sempre pelo nome, ou nunca.
- `bridge-server/test/registro.js` (219 linhas): a sonda viva (bloco final, ~150-219) abre uma
  aba-cobaia **própria** (nunca a do Cezar — comentário "Conserto 2", explica o motivo), adota com
  `browser_use_tab`, e para cada nome do `ALTERAM_ESPERADO` fixo (33-34) chama a tool mapeada em
  `MAPA_ACAO_PARA_TOOL` (linha ~113) e exige `[somente leitura]` na resposta. Ela testa **por nome
  de capacidade, sempre bloqueado** — não serve, como está, para uma regra que decide por
  conteúdo (a mesma `cap_js` ora passa, ora barra).
- `bridge-server/src/tools/js.js` (17 linhas): tool `browser_javascript`, `action: 'cap_js'`, sem
  `confirmavel`, sem parâmetro de modo, `description` não avisa nada sobre a aba do usuário.

## Achado técnico desta obra: o gate não tem por onde decidir por conteúdo sem tocar arquivo compartilhado

Isto não estava no plano e muda o cálculo das quatro saídas propostas. Como `ContextoCapacidade`
não carrega nenhum sinal de "estou em somente leitura" (achado acima), **qualquer regra que
precise diferenciar "aba do usuário sem permissão" de "aba própria da ponte" dentro do próprio
`js.ts` não tem de onde puxar essa informação hoje**. As saídas são, na prática, só duas:

- (a) usar o mecanismo **estático** já pronto — `altera: true` em `cap_js` — que bloqueia **toda**
  chamada de `browser_javascript` na aba do usuário em modo leitura, leitura incluída, até
  `permitir_acao: true`. Zero toque em `bridge/index.ts` ou `registro.ts`.
- (b) acrescentar um campo a `ContextoCapacidade` (ex.: `emSomenteLeitura?: boolean`) e preenchê-lo
  em `bridge/index.ts` onde `ctx` é montado (~375-383) — toque pequeno, aditivo, mas real no
  arquivo compartilhado. Por regra do plano (§3, "toca `bridge/index.ts`") isso **serializa com as
  obras 08, 18 e 19**. Se for essa a rota, registre a decisão e o motivo no relatório antes de
  tocar — não é proibido, é caro.

Uma regra de conteúdo (heurística de string ou `throwOnSideEffect`) que rodasse **sempre**, sem
saber se está na aba do usuário, bloquearia efeito colateral também na aba **própria** da ponte —
onde o cadastro do PJe inteiro depende de `browser_javascript` escrever (`.value =`,
`dispatchEvent`, setter do Select2/RichFaces). Isso quebraria o próprio protocolo, não só o furo.
Meça as duas construções (a) e (b) antes de escolher — não presuma que (b) é inevitável só porque
parece "mais correto".

## Correção de premissa: a skill do PJe NÃO roda JS na aba do usuário

O pedido desta obra presumia que "a skill `protocolo-pje-ponte` usa `browser_javascript` para
inspecionar [a aba do Cezar]" — para dimensionar o estrago de travar JS. Conferi a fonte
(`~/.claude/skills/protocolo-pje-ponte/SKILL.md:198-204`, seção "A quarta parede"): a própria
skill **proíbe** `browser_use_current_tab`/`browser_use_tab` para o cadastro — *"são abas do Dr.
Cezar e entram em somente leitura"* — e roda o cadastro inteiro (os três Select2, o `_selection`
do RichFaces, a conferência de anexo por opacidade, o campo `suggest`) na **aba própria** da
sessão, que nasce logada no mesmo perfil do Chrome mas fora do alcance do modo leitura. O mesmo
vale para `~/.claude/skills/juris-tribunais/SKILL.md:583-591` (fetch por `browser_javascript`
depois de `browser_navigate`, sem adotar aba do usuário). **Não achei, em nenhuma skill instalada,
um uso registrado de `browser_javascript` sobre uma aba adotada por `browser_use_current_tab` ou
`browser_use_tab`.**

Isso não zera o risco — muda onde ele mora. O caso real que esta obra protege é o **ad hoc**:
"olha isso aqui" (memória: `"olha isso" = browser_use_current_tab, SOMENTE LEITURA`) seguido de um
`browser_javascript` de inspeção rápida na conversa — que não fica registrado em skill nenhuma
porque é conversa, não script, e por isso não dá para medir por `grep`. Relate isto ao Cezar como
parte do fechamento, não como fato resolvido: pergunte se ele topa que "olha isso aqui" + JS passe
a pedir a mesma permissão explícita que clicar/digitar já pedem (ver Opção 2).

## O dilema — meça, não chute

**1. Heurística de string no próprio JS** (bloquear `codigo` que contenha `submit(`, `.click(`,
`.value =`, `location =`, `document.write`, `innerHTML =`, `dispatchEvent`, `fetch`/`XHR` com
método não-GET...). Só faz sentido combinada com o sinal de "somos leitura" (achado técnico
acima) — senão bloqueia escrita também na aba própria e derruba o cadastro do PJe. **Meça:** rode
os padrões propostos contra os trechos de `codigo` citados em
`protocolo-pje-ponte/SKILL.md:150-256` e `210-256` (os blocos de setter nativo, `_selection`,
CEP/`suggest`) — quantos casariam por engano? É só um exercício de contagem: essa skill roda na
aba própria, então nenhum desses casos DEVERIA ser bloqueado por esta obra; o teste é se a
heurística é fina o bastante para não incomodar quem no futuro quiser rodar o mesmo padrão de
escrita **na aba do usuário** com permissão já concedida. Escreva o número.

**2. Exigir `permitir_acao`** — marcar `cap_js.altera = true`, sem condição. Mecanismo já pronto,
zero toque em arquivo compartilhado. Custo: todo `browser_javascript` na aba do usuário —
**leitura incluída** — fica barrado até `browser_use_current_tab`/`browser_use_tab` repetir com
`permitir_acao: true`, igual a clique e digitação hoje. **Meça:** não há como contar isso em
arquivo (achado acima); documente a pergunta ao Cezar no relatório em vez de decidir sozinho por
ele. Se ele topar, é a saída mais barata e a mais alinhada ao padrão que já existe.

**3. `throwOnSideEffect` — a mais promissora, meça primeiro.** `Runtime.evaluate` aceita o
parâmetro `throwOnSideEffect` (boolean) no protocolo CDP padrão — é o mesmo mecanismo que o
preview do autocomplete/console do DevTools usa: V8 aborta a avaliação e lança uma exceção de
efeito colateral em vez de executar, para expressão que mutaria algo. Como
`debuggerManager.send` (`debugger-manager/index.ts:100-104`) só encaminha
`chrome.debugger.sendCommand({tabId}, method, params)` sem filtrar chaves, o parâmetro passa de
graça — é só acrescentar a chave no objeto de `params` que `js.ts` já monta. **Isto é o que a
documentação do protocolo descreve; ninguém aqui testou pela ponte de verdade — meça antes de
apostar nele:**
- `document.title` (leitura pura) tem de voltar o valor normalmente;
- `document.title = 'x'` tem de **lançar** a exceção de efeito colateral, sem escrever;
- combine com `awaitPromise: true` (que `executarJs` já liga, linha 19) e teste
  `(async () => { document.title = 'x'; return 1; })()` — há risco documentado de a checagem de
  efeito colateral não cobrir bem código assíncrono (a análise é sobre o efeito síncrono; uma
  mutação que só acontece depois do `await` pode escapar). Registre o resultado dos três testes
  no relatório, com o texto exato do erro que voltou.

Se os três casos se comportarem como esperado, o desenho é: manter `cap_js` sem `altera`
(sempre despachado), e dentro de `executarJs`, quando o sinal de "aba do usuário sem permissão"
vier de fora (achado técnico acima — ainda precisa da rota (a) ou (b)), tentar primeiro com
`throwOnSideEffect: true`; se lançar a exceção específica de efeito colateral, devolver o mesmo
formato `[somente leitura] ...` que as outras ações usam, dizendo o que fazer. Sem o sinal
externo, esta rota não decide nada — não é solução isolada, é a metade fina de uma solução que
ainda depende da (a) ou (b) do achado técnico.

**4. Não fazer nada, documentar.** Só se as três anteriores se mostrarem piores que o buraco
atual — por exemplo, `throwOnSideEffect` não está disponível pela ponte, ou quebra código
assíncrono de forma inaceitável, ou a heurística de string é fácil demais de furar E `altera: true`
incondicional mata um uso real que o Cezar não abre mão. Autorizado explicitamente, com a
exigência de números das três medições acima — não é o default por preguiça de medir.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/js.ts`, `bridge-server/src/tools/js.js`, teste novo em
`bridge-server/test/` (sugestão de nome: `js-somente-leitura.js`).

Se a decisão exigir o campo novo em `ContextoCapacidade` (achado técnico, rota b): também pode
tocar `entrypoints/background/bridge/capacidades/registro.ts` (só para adicionar o campo na
interface, aditivo — não mude os outros campos) e `entrypoints/background/bridge/index.ts` (só
para preencher esse campo ao montar `ctx`, ~375-383). **Declare no relatório se tocou, e por quê**
— essa é a exceção que serializa com as obras 08, 18 e 19.

## Arquivos que você NÃO PODE tocar

`policy.ts` (freio da obra 02, aprovada — matéria diferente: aquele decide por texto do elemento
clicado, este por conteúdo de JS). `capacidades/*` de qualquer outra obra.
`bridge-server/test/registro.js`, **exceto** para acrescentar `cap_js` a `ALTERAM_ESPERADO` e um
mapeamento em `MAPA_ACAO_PARA_TOOL` **se e só se** a decisão final for a Opção 2 incondicional
(`altera: true` sem condição de conteúdo) — porque só nesse caso `cap_js` vira uma capacidade
"sempre bloqueada por nome", que é exatamente o que aquela sonda testa. Se a rota for 1 ou 3
(decisão por conteúdo), **não mexa em `registro.js`** — escreva o par de casos no teste novo desta
obra, porque a sonda geral não sabe testar "a mesma ação, ora passa, ora barra".

## Quem mais está construindo agora

A obra `01` (Lote 0) é dona de `capacidades/registro.ts` e `bridge/index.ts` enquanto não for
aprovada pelo cético — se ainda estiver em curso quando você começar, espere ela fechar antes de
tocar qualquer um dos dois (mesmo que seja só o campo aditivo da rota b). A obra `02` mexe em
`policy.ts`, arquivo disjunto, sem colisão. **Achado desta obra, fora do que o plano registrava:**
a obra `15-pdf-e-js-com-argumentos` (Lote B) também tem `capacidades/js.ts` e
`bridge-server/src/tools/js.js` na lista dela — colisão direta de arquivo com esta obra. Como a 20
é prioridade sobre metade do Lote A, ela tem de estar terminada, aprovada e commitada antes de a
15 começar a escrever nesses dois arquivos; isso vale mesmo que a 15 só entre "depois do Lote A"
no papel — avise o capataz para não disparar as duas por engano numa janela de trava apertada.

## Padrão da casa a imitar

- Erro que diz o remédio: `bridge/index.ts:392-395` (`[somente leitura] ... repita
  browser_use_current_tab com permitir_acao: true`); `policy.ts:145-146`. A mensagem nova, seja
  qual for a rota, segue o mesmo molde: diz o que aconteceu e o comando exato para destravar.
- Teste que prova o contrato com página/aba de prova, nunca a do Cezar: `test/registro.js`,
  comentário "Conserto 2" (abre aba-cobaia própria por `browser_tab_open`, adota por
  `browser_use_tab`, devolve para `browser_use_own_tab` no `finally` antes de fechar a cobaia).
  Copie esse esqueleto para o teste novo.
- Mudança em conjunto calculado nasce coberta pela sonda **viva** (que executa a ação de verdade),
  não só pelo diagnóstico (`bridge_capacidades`/`cap_listar`) — achado F1 do cético, comentado em
  `test/registro.js` acima do bloco da sonda. Se a rota for 2, o teste novo precisa **executar**
  `browser_javascript` de verdade na cobaia, não só ler `diag.alteram`.

## O que NÃO fazer, e por quê

- **Não reaproveite `ALTERAM_ESPERADO`/`registro.js` para uma regra de conteúdo.** Aquela lista
  testa "esta capacidade está sempre barrada"; uma regra por conteúdo muda de decisão a cada
  chamada, e forçar isso na sonda fixa produz teste que não testa o que importa (a mesma `cap_js`
  passando ora com leitura, ora barrando com efeito).
- **Não venda a heurística de string como garantia**, se essa for a rota escolhida. Ela é porosa
  por natureza: `window['loc'+'ation'] = x`, `eval(...)`, `new Function(...)`, propriedade
  computada (`obj['sub'+'mit']()`) furam qualquer lista de padrões por regex. **Escreva isso no
  código** — um comentário acima da lista de padrões dizendo que é um freio de conveniência, não
  uma trava, e nomeando explicitamente o furo (é o defeito irmão desta obra: a própria obra que
  fecha o furo mais largo não pode abrir um novo e fingir que fechou).
- **Não toque `bridge/index.ts` "de passagem"** sem declarar. Se a rota (b) do achado técnico for
  necessária, é decisão registrada no relatório antes de editar, não efeito colateral silencioso
  descoberto pela conferência de escopo do fim do lote.
- **Não decida a Opção 2 pelo Cezar.** Documente a pergunta ("olha isso aqui" + JS passa a pedir
  permissão, igual a clique?) no relatório; não presuma a resposta.

## Armadilhas conhecidas

- `awaitPromise: true` já ligado (`js.ts:19`) — combinado com `throwOnSideEffect`, pode não
  detectar efeito colateral que só acontece depois do `await` resolver (achado do protocolo, não
  hipótese sua). Meça o caso assíncrono antes de confiar (Opção 3, item 3 da medição).
- `userGesture: true` já ligado (`js.ts:20`), sem comentário explicando por quê no arquivo atual.
  Não mude essa linha sem entender o efeito — não é escopo desta obra mexer nela, só notar que ela
  já existe e que `Runtime.evaluate` via CDP nunca marca o evento como `isTrusted`, então isso não
  muda o desenho da barreira.
- `Runtime.evaluate` roda no **mundo real da página** (não é `chrome.scripting`) — qualquer regra
  por string tem de lidar com o código exatamente como o agente mandou, sem AST (trazer um parser
  para isso é sinal de que a Opção 1 não vale o custo; prefira 2 ou 3 nesse caso).
- `dm.send` tem retry automático em detach e em timeout (`debugger-manager/index.ts:100-131`) —
  se o teste novo disparar um `Runtime.evaluate` que trava a aba (ex.: `while(true){}` sem
  `throwOnSideEffect`), pode levar até a `reload` automático da aba-cobaia; prefira sempre a
  cobaia, nunca a aba do Cezar, também por isso.

## Critério de pronto

Teste novo (`bridge-server/test/js-somente-leitura.js`), com aba-cobaia **própria** (nunca a do
Cezar, seguindo o "Conserto 2" de `registro.js`):

1. `browser_tab_open` numa página inócua → `browser_use_tab {tabId}` (sem `permitir_acao`) →
   confirma `[somente leitura]` na resposta (como a sonda de `registro.js` já faz).
2. JS de **leitura** (`document.title`, `location.href`, um `querySelector(...).textContent`) via
   `browser_javascript` continua funcionando, sem erro, na aba-cobaia em modo leitura.
3. JS com **efeito** (`document.title = 'sonda'`, `document.body.innerHTML = 'x'`, um
   `fetch('https://example.com', {method:'POST'})`) é barrado, com mensagem dizendo o que fazer
   (pedir `permitir_acao: true` e repetir `browser_use_tab`/`browser_use_current_tab`).
4. Depois de `browser_use_tab {tabId, permitir_acao: true}`, o mesmo JS com efeito do item 3
   **passa** — a barreira não pode virar bloqueio permanente.
5. `browser_use_own_tab` devolve o agente para a aba própria antes de fechar a cobaia (mesmo
   padrão de `registro.js`).
6. Rodar também `node test/registro.js` inteiro (não só a parte de `cap_js`) para confirmar que
   nada regrediu nos outros conjuntos calculados.

**Mutation testing:** reverta o conserto (tire o `throwOnSideEffect`/a checagem de conteúdo/o
`altera: true`, conforme a rota escolhida) e confirme que o item 3 acima fica VERMELHO. Verde com
o furo de volta é teste de teatro.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-20 $(date +%H:%M)" > .obra-lock)`.
Existe → espere 60 s, repita (até 15 min; >10 min é abandonada, leia e sobrescreva). Com a trava:
`npm run build` (raiz) → `cd bridge-server && npm run reload` → `node test/js-somente-leitura.js`
→ `rm .obra-lock` assim que terminar, mesmo vermelho. Nunca reload sem trava (derruba a sessão de
todos os agentes). Build quebrado em arquivo que não é seu: solte, espere 2 min, até 3 tentativas,
depois reporte. Rode só o seu teste — `npm test` é só da obra 01 e do capataz no fim do lote.

## Regra ADITIVO

Escopo é fechar o furo de `cap_js` no modo leitura. Não mexa em `policy.ts` (freio por texto de
elemento, obra 02) nem em qualquer outra capacidade. Regressão inaceitável: `test/registro.js`
vermelho; JS de leitura pura barrado na aba do usuário; JS com efeito passando sem
`permitir_acao` na aba do usuário depois do conserto.

## Se concluir que não vale

Se as três primeiras saídas se mostrarem piores que o buraco atual — meça primeiro, documente os
números de cada uma (heurística × trechos do SKILL.md; os três testes de `throwOnSideEffect`; se
perguntou ao Cezar sobre a Opção 2 e o que ele respondeu) — pare na Opção 4 e reporte com esses
números. Não é permitido chegar em "não vale" sem ter medido as três.

## Como reportar

Rota escolhida e por quê, em uma frase. Os números das medições pedidas (heurística contra os
trechos do SKILL.md; os três casos de `throwOnSideEffect` com o texto exato do erro que voltou;
se a Opção 2 foi ao Cezar e o que ele respondeu). Se tocou `registro.ts`/`bridge/index.ts`, a
mudança exata e por quê. Saída do teste novo e de `test/registro.js` inteiro. O defeito irmão
nomeado no código, se a rota escolhida foi a heurística de string. Não edite o README.