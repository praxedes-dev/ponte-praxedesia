# Obra 18 — link aberto de fora do Chrome cai dentro da janela da ponte

**Lote A. Serializa com a obra 08 — as duas editam `bridge/index.ts` e NUNCA rodam ao mesmo
tempo. Rode 18 só depois que a 08 for aprovada pelo cético.**
**Cético: Opus** (toca o isolamento e a aba do usuário, igual à 08).

## Objetivo em uma frase

Que abrir um link **de fora do Chrome** — WhatsApp Desktop, Drive, um PDF, `Start-Process chrome
<url>` — não misture a aba dele com as dos agentes na janela da ponte; e se não der para evitar
que ela nasça lá, que a ponte perceba e devolva a aba para uma janela do usuário, sem nunca deixar
de pintar a janela da ponte para o clique dos agentes continuar funcionando.

**Não confunda com a obra 08.** A 08 conserta o sentido contrário: `browser_tab_open` (comando do
agente) abrindo aba na janela do **usuário** por engano. A 18 é o sentido oposto: um link **do
usuário** caindo dentro da janela **da ponte**. As duas mexem em `bridge/index.ts` porque são a
mesma classe de bug (a ponte confundindo qual janela é de quem), mas são bugs diferentes com
correções em pontos diferentes do arquivo.

## Por que existe

Medido em 05/09/2026, durante os testes do Lote 0: `Start-Process chrome 'https://example.com/x'`
(o mesmo que clicar num link no WhatsApp Desktop, no Drive ou num PDF) abriu a aba **na janela da
ponte**. O Chrome manda aba nova para a última janela focada, e a janela da ponte nasce com
`focused: true` **de propósito** — testado e documentado: janela criada com `focused: false` nunca
é pintada, e aba não pintada ignora clique sem erro (README.md:128-134 e
`bridge/index.ts:584-587`). Qualquer solução que tire esse foco de nascença está proibida antes de
começar.

**O Cezar confirmou que isso aconteceu com ele em 04/09/2026 e atrapalhou o trabalho dele.** Não é
hipótese, é fato medido duas vezes (relato dele + reprodução do capataz).

Não há perda de dado: a aba dele não entra em `abasCriadasPelaPonte`, então `limparAbasOrfas` e
`encerrar` nunca a fecham (`bridge/index.ts:853-871, 877-899` só mexem no que está nesse conjunto).
O estrago é de convivência — a aba nasce misturada com a dos agentes, na janela que ele deixou de
lado, e ele perde de vista o que abriu.

## Âncoras conferidas na fonte (05/09/2026, antes de a obra 08 construir — confira de novo antes
## de editar, os números VÃO mudar)

- `bridge/index.ts:65` `JANELA_PADRAO` (tamanho só da primeira vez).
- `bridge/index.ts:116-157` — os conjuntos de estado do `BridgeClient`: `abasAdotadas` (126),
  `abasCriadasPelaPonte` (132), `abaPropriaDoCliente` (147), `abaAncora` (157, a aba `about:blank`
  que segura a janela viva — nenhum agente a usa).
- `bridge/index.ts:163-183` `start()` — hoje registra só `chrome.alarms` (faxina de ociosos, 168-174)
  e `chrome.windows.onBoundsChanged` (178-180, → `lembrarPosicao`). **Não existe
  `chrome.tabs.onCreated` neste arquivo hoje** (conferido por grep; zero ocorrências). A obra 08
  vai adicionar um, para a "aba filha" dela (`tab.openerTabId` apontando para aba da ponte) —
  **confira se ela já chegou antes de você escrever o seu**, ver §"O que investigar", item 5.
- `bridge/index.ts:572-579` `abrirAbaPropria()` — cria a aba do agente `windowId: janelaDaPonte(),
  url: 'about:blank', active: true` e marca em `abasCriadasPelaPonte`. É o único ponto que cria aba
  de agente na janela da ponte.
- `bridge/index.ts:581-625` `janelaDaPonte()` — o método inteiro é o objeto desta obra:
  - 593-601: se já existe `janelaDaPonte` no storage e a janela ainda está viva, devolve o id sem
    recriar nada.
  - 603: `chrome.windows.getLastFocused()` **antes** de criar a janela — guarda em `focoAnterior`.
  - 606-614: `chrome.windows.create({ url: 'about:blank', focused: true, type: 'normal', ...bounds })`
    — **`type: 'normal'` está explícito**; é o candidato natural da hipótese 4.
  - 617-618: guarda o id no storage e `this.abaAncora = janela.tabs?.[0]?.id`.
  - 620-623: **devolve** o foco para `focoAnterior`, só se ele existir e for diferente da janela
    nova. Se `focoAnterior` for `undefined` (não havia nenhuma janela antes — Chrome acabado de
    abrir, o cenário exato do teste de 05/09), **nada é devolvido** e a janela da ponte fica sendo
    a única janela, logo a "última focada" por eliminação.
- `bridge/index.ts:627-636` `abaCorrenteDoUsuario()` — já resolve um problema parecido: pega todas
  as janelas `windowTypes: ['normal']`, **filtra a da ponte** (`w.id !== janelaDaPonte`, 631), pega
  a focada ou a primeira. É o padrão pronto para achar "uma janela do usuário" se a hipótese 5
  precisar de destino para mover uma aba intrusa.
- `bridge/index.ts:792-843` `comAbaPronta()` — a fila de todo input. Sob `focarParaClicar` (storage,
  **desligado por padrão**), 822-825 chama `chrome.windows.getLastFocused()` de novo e
  `chrome.windows.update(tab.windowId, { focused: true })`; sem essa flag (o caso comum), o único
  toque em foco de janela é implícito — `chrome.tabs.update(ws.activeTabId, { active: true })`
  (816), que ativa a aba **dentro** da janela dela sem necessariamente focar a janela. Isso é
  exatamente a hipótese 3: medir se essa chamada, sozinha, muda `getLastFocused()`.
- `README.md:128-134` — a armadilha "Input exige aba renderizada", com o motivo de a janela nascer
  com foco e devolvê-lo. Não repita a redação; ela já está certa.
- `entrypoints/background/bridge/capacidades/abas-filhas.ts` e `download-nativo.ts` — stubs vazios
  (7 linhas, `capacidades: []`) em 05/09/2026: a obra 08 ainda não construiu quando este briefing
  foi escrito. **Isso significa que quando você começar, `bridge/index.ts` pode já ter mudado** —
  releia antes de tocar, não confie nas linhas acima.
- `entrypoints/background/bridge/capacidades/index.ts:1-46` — registro central; **não tem stub
  para a obra 18** (ela nasceu depois da refatoração 01, como item avulso do capataz, item 14 do
  plano). Se a sua solução virar uma capacidade nova, você vai precisar acrescentar duas linhas
  aqui (import + entrada no array de `registrar`), do mesmo jeito que a obra 10 teve licença para
  uma linha em `hub.js`. **Isso é uma exceção explícita, autorizada por este briefing** — não é
  "tocar arquivo de outra obra", é o cadastro que toda obra nova precisa fazer uma vez.

## O que investigar (MEDIÇÃO — nenhuma destas é conclusão; meça e decida)

Construa **depois** de medir. Se a medição já responder a pergunta 1 com "não, o foco já volta
direito", pule para a pergunta 2, e assim por diante — não implemente a hipótese 5 sem antes matar
as mais baratas.

1. **Depois que a janela da ponte é criada e o foco é devolvido (linha 621-623), o Chrome ainda
   considera a janela da ponte como "última focada"?** Experimento: com o Chrome tendo só uma
   janela do usuário aberta, force `janelaDaPonte()` a rodar o caminho de criação (apague
   `janelaDaPonte` do storage antes) e, logo depois que a promise resolve, chame
   `chrome.windows.getLastFocused()` de dentro do service worker (console do `chrome://extensions`)
   e compare o id com o da janela do usuário. Repita esperando 500 ms, 2 s — o Windows pode levar
   um instante para repintar o foco.
2. **A devolução de foco falha quando não existe outra janela normal?** É o cenário exato do teste
   de 05/09 (Chrome recém-aberto, só a janela da ponte existe). Nesse caso `focoAnterior` é
   `undefined` (linha 603) e o `if` de 621 nunca executa — não tem para onde devolver. Pergunta em
   aberto: **para onde devolver, se não existe janela do usuário nenhuma?** Não force uma resposta
   aqui; é decisão do pedreiro à luz da medição 4.
3. **`chrome.tabs.update(ws.activeTabId, { active: true })` de `comAbaPronta` (linha 816, roda
   antes de todo clique) muda a "última janela focada"?** Meça chamando `getLastFocused()` antes e
   depois de um `browser_click` normal, com a janela do usuário focada no momento do clique.
4. **Existe uma propriedade de janela que a torne preterida como alvo de link externo e ainda
   pintável?** Investigue `chrome.windows.create({ ..., type: 'popup' })` no lugar do `'normal'`
   de hoje (linha 609). Duas coisas para confirmar, **as duas, não uma**:
   a. Ela ainda pinta e o clique funciona (repita o teste de `janela-coberta.js` ou um clique
      simples com a janela em primeiro plano).
   b. Ela ainda aceita **várias abas** — hoje cada agente tem a própria aba na mesma janela
      (`abrirAbaPropria`, linha 574, `chrome.tabs.create({ windowId, ... })`). Se `chrome.tabs.create`
      com o `windowId` de uma janela `popup` falhar, ou a janela não expor as abas de um jeito que
      `browser_tabs_list`/`browser_tabs_all` continuem enxergando, **essa saída morre** — diga isso
      no relatório, não force.
   Se (a) e (b) as duas se confirmarem, ainda falta medir se o Chrome de fato **não** manda link
   externo para uma janela `popup` (é o comportamento conhecido do Chrome — janela popup/app fica
   fora da lista de "última janela normal usada" — mas **meça**, não assuma; se não houver nenhuma
   janela normal na hora, o Chrome pode abrir uma janela normal nova em vez de usar a popup, o que
   já seria uma vitória: a aba dele nasceria separada, não dentro da ponte).
5. **Se nada disso resolver: dá para detectar a intrusão e mover a aba?** `chrome.tabs.onCreated`
   dispara para toda aba nova, inclusive as que a própria ponte cria. **Achado deste briefing, não
   estava na lista original:** o sinal mais simples para diferenciar "aba da ponte" de "aba
   intrusa" não é `openerTabId` (a obra 08 já usa isso para filha de `window.open`, que é outro
   caso) — é que **toda aba que a própria ponte cria nasce com `url: 'about:blank'`**
   (`abrirAbaPropria`, linha 575; a aba-âncora da própria `janelaDaPonte()`, linha 607). Uma aba
   aberta de fora chega com `tab.pendingUrl` já apontando para o destino real, não para
   `about:blank`. **Meça isso antes de confiar nele**: dispare `browser_tab_open` e um
   `Start-Process chrome <url>` e compare `tab.pendingUrl`/`tab.url` no instante do `onCreated` dos
   dois casos, com `console.log` no service worker. Se o sinal se confirmar, ainda falta decidir
   o destino: mover para a "janela do usuário" já resolvida por `abaCorrenteDoUsuario()`
   (linha 627-636), ou abrir uma janela nova para ela com `chrome.windows.create({ tabId })`. Qual
   dos dois é menos assustador para quem clicou no link é **decisão do pedreiro** — mas registre no
   relatório por que escolheu um e não o outro (ex.: mover para a janela existente preserva o
   contexto de abas dele; abrir janela nova nunca risca fechar nada por engano).
   **Cuidado com o cold start:** quando a janela da ponte nasce pela primeira vez, a própria
   criação (`chrome.windows.create`, linha 606) dispara `onCreated` para a aba-âncora também —
   prove que esse instante não é tratado como intrusão nem crasha por a ponte ainda não ter
   `janelaDaPonte` gravado no storage no momento exato do evento.

## O que construir (decisão do pedreiro, com base na medição — não adivinhe aqui)

Não há desenho fixo desta vez porque a resposta certa depende inteiramente do que as medições 1-5
mostrarem. Regras que valem **qualquer que seja a saída escolhida**:

- **Proibido**: qualquer mudança que tire `focused: true` da criação da janela da ponte
  (linha 608) sem confirmar, pela medição 4, que a alternativa ainda pinta e ainda aceita várias
  abas. Isso já foi testado e documentado (README.md:128-134); reabrir essa discussão sem medir de
  novo é regressão.
- **Provavelmente isso não é uma "capacidade".** Capacidades (`capacidades/*.ts`) são comandos que
  o agente invoca (`cap_click_xy`, `cap_js`...). Este conserto é comportamento de fundo, reagindo a
  um evento do Chrome, do mesmo jeito que `lembrarPosicao` (`bridge/index.ts:185-192`, ligado a
  `chrome.windows.onBoundsChanged` em 178-180) ou `limparAbasOrfas` (853-871). Prefira colocar a
  lógica nova como método privado do `BridgeClient`, registrado em `start()` — é o padrão que já
  existe para "escuta um evento do Chrome e ajusta estado sozinho". Só crie um arquivo em
  `capacidades/` se a solução realmente expuser uma ação nova para o agente ou para o teste chamar
  (por exemplo, um `cap_diagnostico_janela` que devolve `{ tipo, focused, abaCount }` da janela da
  ponte, para o teste novo inspecionar sem depender de `chrome.windows.get` direto). Se criar esse
  arquivo, lembre de cadastrá-lo em `capacidades/index.ts` (a exceção já autorizada acima).
- **Se a obra 08 já registrou um `chrome.tabs.onCreated` em `start()`** quando você começar,
  **não crie um segundo listener**: decida se a lógica da 18 entra como mais um `if` dentro do
  listener dela ou se vale a pena um listener próprio (Chrome permite os dois, mas dois listeners
  competindo por decidir o "dono" da mesma aba nova é fonte de bug sutil — documente a ordem no
  comentário, como o registro de capacidades já documenta "a ORDEM importa" em
  `capacidades/index.ts:31`).

## Arquivos que você PODE tocar

`entrypoints/background/bridge/index.ts` (o objeto da obra); um arquivo novo em
`entrypoints/background/bridge/capacidades/` **só se** a solução expuser uma ação nova (ver acima)
— e, nesse caso, as duas linhas de cadastro em `entrypoints/background/bridge/capacidades/index.ts`
(import + `registrar`); um teste novo em `bridge-server/test/` (ex.: `test/janela-externa.js`).

## Arquivos que você NÃO PODE tocar

`entrypoints/background/bridge/policy.ts` (obra 02 — **ignore qualquer marca
`// MUTACAO-CETICO` que encontrar lá, não é código real e não é desta obra**), qualquer
`capacidades/*.ts` de outra obra, `bridge-server/src/tools/*` de outra obra, `workspace-manager/**`,
`execution-engine/**`, `debugger-manager/**`, `package.json`, `README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Você serializa com a **08** em `bridge/index.ts` — nunca ao mesmo tempo; espere ela ser aprovada
pelo cético antes de tocar no arquivo. As outras obras do Lote A (04, 05, 06, 07, 09, 10, 11, 12)
estão cada uma no próprio módulo e não encostam em `bridge/index.ts`. A trava de build
(`.obra-lock`, §4 abaixo) é a mesma para todo mundo.

## Padrão da casa a imitar

- **Listener registrado em `start()`, reagindo a um evento do Chrome e ajustando estado sozinho,
  sem o agente pedir nada:** `bridge/index.ts:176-192` (`chrome.windows.onBoundsChanged` →
  `lembrarPosicao`). É o molde mais próximo do que esta obra provavelmente vai escrever.
- **Achar "uma janela do usuário" excluindo a da ponte:** `abaCorrenteDoUsuario()`,
  `bridge/index.ts:627-636` — reuse esse padrão em vez de inventar um novo, se a hipótese 5 vingar.
- **Falhar quieto, sem alarmar o usuário:** toda operação de janela no arquivo usa
  `.catch(() => {})` (linhas 599, 622, 824, 835) — um link externo mal comportado não pode virar
  diálogo ou erro na cara do Cezar; na pior hipótese, loga no console do service worker.
- **Registro documentado no cabeçalho do método:** o comentário de `janelaDaPonte()`
  (`bridge/index.ts:581-591`) explica o "porquê" antes do "o quê" — qualquer lógica nova de foco
  merece o mesmo tratamento, porque é a segunda vez que alguém mexe nesse método por causa de um
  incidente real de foco.

## O que NÃO fazer, e por quê

- **Não tire `focused: true` da criação da janela da ponte sem medir a alternativa.** É a razão
  documentada de a aba do agente pintar; sem foco na criação, nenhum clique de nenhum agente
  funciona, e isso é pior que o problema desta obra.
- **Não trate `wait`/detecção de intrusão como erro para o usuário.** Ele não pediu nada à ponte;
  não é a vez dela de reportar isso a ninguém além do console. Se a solução escolhida for mover a
  aba, faça isso silenciosamente (como o resto do arquivo já faz com `.catch(() => {})`).
- **Não adote a aba intrusa no conjunto `abasCriadasPelaPonte`** nem em `abasAdotadas`: ela nunca
  foi da ponte nem foi adotada por um agente em modo leitura — é só uma aba do usuário que nasceu
  no lugar errado. Colocá-la em qualquer um desses conjuntos faria a ponte tratá-la como sua (por
  exemplo, fechável pela faxina) e reintroduziria, ao contrário, o próprio incidente de 19/08 que
  os dois conjuntos existem para evitar.
- **Não confie em `tab.openerTabId` para distinguir intrusa de legítima.** É o sinal que a obra 08
  usa para "aba filha" (nasceu de `window.open` dentro de uma aba da ponte) — um problema
  diferente. Uma aba aberta de fora do Chrome **não tem** `openerTabId` de aba nenhuma, e uma aba
  que a própria ponte cria (`abrirAbaPropria`) **também não tem** — os dois casos são indistinguíveis
  por esse campo. Use outro sinal (ver hipótese 5 e a nota "cold start").
- **Defeito irmão:** se a detecção da hipótese 5 for ampla demais, ela vai capturar a **própria**
  aba que a ponte acabou de criar (`abrirAbaPropria`, sem `openerTabId`, mesma "assinatura" de uma
  intrusa) e tentar movê-la ou fechá-la — isso quebraria `test/isolamento.js` na hora (a aba do
  agente sumiria da janela da ponte). O sinal de `url: 'about:blank'` no instante da criação (achado
  do §"O que investigar", item 5) existe para separar os dois; teste os dois casos lado a lado
  antes de considerar pronto.

## Armadilhas conhecidas

- `chrome.windows.getLastFocused()` pode não refletir a mudança de foco imediatamente depois de um
  `chrome.windows.update` — dê uma folga de algumas centenas de ms antes de medir (o próprio código
  já faz isso em `comAbaPronta`, linha 817: `250ms` depois de ativar a aba).
- Chrome recém-aberto (sem nenhuma janela normal) é um estado real de teste, não só teórico — foi
  o cenário exato da medição de 05/09. Rodar o teste novo com o Chrome já tendo pelo menos uma
  janela do usuário aberta esconde esse caso; peça ao pedreiro (você) para testar os dois cenários,
  mesmo que o segundo (Chrome do zero) só dê para simular manualmente.
- `chrome.tabs.onCreated` entrega o evento **antes** de `chrome.tabs.create()` (quando é a própria
  ponte criando) terminar de resolver a promise, em alguns casos — não conte com "a aba já está em
  `abasCriadasPelaPonte`" no instante do `onCreated` para diferenciar intrusa de própria; meça a
  ordem real com `console.log` de timestamp antes de decidir a lógica.
- Simular "aba aberta de fora" de dentro de um teste Node é o próprio limite do teste: o cliente
  MCP fala com a extensão só pelas ações que ela expõe (`cap_*`/`browser_*`), e nenhuma delas cria
  uma aba do jeito que o Windows cria ao abrir um link externo. O jeito mais fiel de simular é
  literalmente repetir a medição original — `child_process.execSync('start chrome "URL"')` (ou o
  equivalente com o caminho do executável do Chrome) rodado pelo próprio script de teste, já que o
  teste roda na mesma máquina que o Chrome. Se isso for lento ou instável para rodar toda vez,
  proponha uma alternativa no relatório, mas registre por que a descartou.

## Critério de pronto

Teste novo em `bridge-server/test/` (nome sugerido `janela-externa.js`, mas o pedreiro decide):

1. Com um agente conectado (`browser_tab_open` ou o fluxo normal de handshake), simule uma aba
   "de fora" (via `Start-Process`/equivalente, ou a alternativa que você propuser) e prove, via
   `browser_tabs_all`, que ela **não termina** na `janelaDaPonte` — ou, se terminar, que some de lá
   dentro de um teto curto (alguns segundos) e apareça numa janela do usuário.
2. **Regressão obrigatória, sem rodar de novo do zero** (leia os dois, não precisa executar se o
   seu conserto não mexeu no caminho deles — mas se mexeu, rode): `node test/isolamento.js` e
   `node test/aba-sumiu.js` continuam verdes. As abas dos agentes continuam na janela da ponte, o
   clique continua funcionando, e nenhuma aba do usuário some ou muda de página.
3. Caso de cold start: prove (por leitura de log ou teste manual documentado, já que recriar um
   Chrome do zero num teste automatizado é caro) que a criação da janela da ponte não trata a
   própria aba-âncora como intrusa.
4. `npx tsc --noEmit` (raiz) só com o erro pré-existente de `safe-scripting.ts:8`.

## Se concluir que não vale

As medições 1-4 mandam antes da 5. Se a medição 1 já mostrar que o foco volta certinho e a
"última janela focada" nunca fica sendo a da ponte fora do cenário de Chrome-recém-aberto, e você
julgar que esse cenário residual (Chrome do zero, sem nenhuma janela do usuário) é raro e barato
demais para justificar a hipótese 5, **não implemente a detecção** — documente as medições 1-3 no
relatório, registre a decisão e por quê, e pare aí. Reportar "medi e não compensa" é uma entrega
válida desta obra.

## Como reportar

As âncoras que conferiu e se as linhas mudaram por causa da obra 08; os números de cada medição
(1-5, com o que cada uma respondeu, não só "deu certo"/"deu errado"); qual saída escolheu e por que
descartou as outras; a lista exata de trechos tocados em `bridge/index.ts` (e, se criou capacidade
nova, o que entrou em `capacidades/index.ts`); saída do teste novo e das regressões que rodou;
notas para o README (armadilha nova, se houver) e para o `ESTADO.md` — sem editar nenhum dos dois.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-18 $(date +%H:%M)" > .obra-lock)`.
Existe → espere 60 s, repita (até 15 min; trava com mais de 10 min é abandonada — leia, anote,
sobrescreva). Com a trava: `npm run build` (raiz) → `cd bridge-server && npm run reload` →
`node test/<seu-teste>.js`. Solte a trava assim que o teste terminar, mesmo vermelho. **Nunca**
reload sem trava — derruba a sessão de todos os agentes conectados. Build quebrado em arquivo
alheio: solte, espere 2 min, tente de novo (até 3 vezes), depois reporte. Rode só o seu teste, não
`npm test`. Sem commit; `git checkout`/`stash`/`reset` proibidos com outro pedreiro escrevendo;
backup é `cp arquivo arquivo.bak`.

## Regra ADITIVO

Ninguém muda o contrato de `browser_tab_open`/`browser_tab_switch`/`browser_tab_close` — isso é
território da obra 08. Regressão inaceitável: `isolamento.js` ou `aba-sumiu.js` vermelho; qualquer
aba do usuário fechada, movida sem necessidade ou trocada de página; a janela da ponte deixando de
pintar (mesmo que só num teste manual, registre).
