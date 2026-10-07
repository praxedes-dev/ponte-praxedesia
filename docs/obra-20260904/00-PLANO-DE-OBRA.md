# Plano de obra — ponte PraxedesIA, 17 itens da proposta de 04/09/2026

**Para:** o orquestrador (capataz). Não é documento para o Cezar.
**Escrito por:** o fechador, em 05/09/2026, depois de ler os quatro estudos, a proposta, o
`README.md`, o `ESTADO.md` e **o código na fonte** (toda âncora deste plano e dos briefings foi
aberta e conferida; as que não bateram com os estudos estão listadas no §8).
**Método:** `docs/fluxo-obra.md` (porte do fluxo da Estrelinha para esta casa).

---

## 1. A restrição que manda no desenho

Dos 17 itens, 14 tocam os mesmos três arquivos:

| Arquivo | Linhas hoje | Quem tocaria |
|---|---|---|
| `entrypoints/background/bridge/index.ts` | 905 | 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, ritmo |
| `entrypoints/background/bridge/capabilities.ts` | 286 | 2, 6, 8, 10, 11, 12, 15, 16 |
| `bridge-server/src/tools.js` | 588 (34 tools) | 1, 2, 6, 8, 9, 10, 11, 12, 14, 15, 16, 17 |

E um quarto que os estudos não destacaram: `debugger-manager/index.ts` (139 linhas) é onde
vivem o `attach()` e o handler de diálogo — os itens 1, 10, 11, 12, 13 e 17 precisariam mexer ali.

**Segunda restrição, que nenhum estudo nomeou:** o build (`npm run build` → `.output/`), o
`npm run reload` e o Chrome são **um recurso só**. `npm run reload` derruba a sessão de todos os
agentes conectados (`bridge/index.ts:232-239`: `ws.onclose` → `encerrarTodos()`), e o build lê o
arquivo pela metade de quem estiver escrevendo ao lado. Paralelizar a **escrita** é possível;
paralelizar **build + reload + teste** não é. Isso exige um protocolo de trava (§4).

## 2. Estratégia escolhida: refatoração de registro primeiro, depois paralelismo por arquivo novo

**Decisão:** uma obra de refatoração pura (`01`), sozinha, que transforma os três arquivos-gargalo
em **registro + módulos por domínio + ganchos**, e cria **stubs vazios com o nome de cada obra
planejada**. Depois disso, cada obra escreve no **seu próprio arquivo** (que já existe, vazio) e
não encosta em arquivo de ninguém.

O que a `01` entrega, em uma linha cada:

- **Extensão:** `bridge/capacidades/registro.ts` (tipos + registro) e `bridge/capacidades/index.ts`
  (importa cada módulo). As capacidades sem estado (`cap_js`, `cap_form_input`, `cap_digitar`,
  `cap_click_xy`, `cap_pdf`, `cap_wait_network`, `cap_upload`, `cap_download`, `cap_cookies`,
  `cap_emular`) saem do `switch` de `bridge/index.ts:616-770` para módulos. As de estado (abas,
  faxina, aliases) ficam no `BridgeClient`.
- **Ganchos:** cada módulo pode declarar `aoAnexar(tabId)` (roda no `attach` do debugger **e no
  reattach**), `antes(ctx)` e `depois(ctx, resultado)`. É por eles que diálogo, detector de
  desafio, auditoria, ritmo, destaque e assentar entram **sem editar** `bridge/index.ts`.
- **Conjuntos calculados:** `ACOES_QUE_ALTERAM` e `INPUT_ACTIONS` (`bridge/index.ts:28-40`) passam
  a ser a união do que o `BridgeClient` declara com o que cada capacidade do registro declara
  (`altera: true`, `input: true`). Capacidade nova que altera a página **não pode** escapar do
  modo somente leitura por esquecimento — hoje pode.
- **Servidor:** `tools.js` vira `tools/index.js` + um arquivo por domínio, e o `Set` fixo de
  `TOOLS_CONFIRMAVEIS` (`tools.js:574-586`) vira a flag `confirmavel: true` na própria tool.
  `index.js` (servidor) aceita `tool.imagem` e `tool.formatar` genéricos, para tool nova que
  devolve imagem não precisar editar `formatResult` (`index.js:103-115`).
- **Stubs:** um arquivo vazio por obra, dos dois lados (lista no §3). Quem constrói preenche o seu.

**Por que esta e não as outras:**

- *Lotes em série por arquivo-dono, sem refatorar:* cada obra continua editando o `switch` de 150
  linhas e o array de 588 — ~14 ciclos sequenciais de pedreiro. E a classe de defeito "capacidade
  nova esqueceu de entrar em `ACOES_QUE_ALTERAM`" continua viva.
- *Auto-registro por `import.meta.glob`:* zero arquivo compartilhado, mas mágica que não aparece
  no `grep`. Os stubs nomeados dão o mesmo paralelismo, explícitos.
- *Worktree:* proibido nesta casa.

**Risco da estratégia:** a `01` é uma refatoração de comportamento neutro num arquivo de 905
linhas que guarda o isolamento entre agentes. Mitigação: ela é a **única** obra autorizada — e
obrigada — a rodar a bateria inteira (`npm test`, 69 verificações de 03/09) e a escrever o teste
de contrato `test/registro.js` (o conjunto de tools exposto é idêntico; toda `action` `cap_*` do
servidor existe na extensão; `confirm` só nas cinco confirmáveis). Cético Opus nela, não Sonnet:
é a obra que, se errar, quebra todas as outras.

## 3. Lotes, ordem e o que cada um destrava

### Lote 0 — agora, em paralelo (3 agentes)

| Obra | Item | Arquivos | Destrava |
|---|---|---|---|
| `01-refatoracao-registro-e-ganchos` | pré-obra | `bridge/index.ts`, `capabilities.ts` → `capacidades/*`, `debugger-manager/index.ts`, `tools.js` → `tools/*`, `bridge-server/src/index.js`, `.gitignore`, `test/registro.js` | Todos os lotes seguintes |
| `02-freio-aba-nao-e-botao` | 4 | `bridge/policy.ts`, `test/freio-aba.js` | Independente (não toca o que a 01 toca) |
| `03-teste-cookies-stj-para-curl` | juris | nenhum código; relatório em `docs/obra-20260904/relatorio-03-cookies-stj.md` | Decide se o SCON sai do navegador |

A `02` compartilha o build com a `01`: as duas seguem o protocolo de trava (§4).

### Lote A — depois de a `01` passar por cético e conferência de escopo (9 obras, arquivos disjuntos)

| Obra | Item | Arquivos próprios | Toca arquivo compartilhado? |
|---|---|---|---|
| `04-dialogo-nativo-chama-o-cezar` | 1 | `capacidades/dialogo.ts`, `tools/dialogo.js`, `test/dialogo.js` | não |
| `05-upload-em-lote-que-nao-mente` | 2 | `capacidades/upload-lote.ts`, `tools/upload-lote.js`, `test/upload-lote.js` | não |
| `06-autocomplete-richfaces` | 8 | `capacidades/autocomplete.ts`, `tools/autocomplete.js`, `test/autocomplete.js` | não |
| `07-form-fill` | 6 | `capacidades/formulario-lote.ts`, `tools/formulario-lote.js`, `test/form-fill.js` | não |
| `08-abas-filhas-download-nativo-e-aba-do-usuario` | 10 (+2 achados do fechador) | `capacidades/abas-filhas.ts`, `capacidades/download-nativo.ts`, `tools/abas-filhas.js`, `tools/download-nativo.js`, `test/abas-filhas.js` | **sim: `bridge/index.ts`** (única do lote), `workspace-manager/index.ts` |
| `09-detector-de-desafio` | 3 | `capacidades/desafio.ts`, `test/desafio.js` | não |
| `10-auditoria-quem-fez-o-que` | 5a | `capacidades/auditoria.ts`, `tools/auditoria.js`, `audit/index.ts`, `shared/types/index.ts` (1 linha), `hub.js` (1 linha), `test/auditoria.js` | `shared/types`, `hub.js` — só ela |
| `11-inspecao-de-rede` | 11 | `capacidades/rede-inspecao.ts`, `tools/rede-inspecao.js`, `test/rede-inspecao.js` | não |
| `12-navegacao-voltar-e-ritmo-por-host` | 14 + ritmo | `capacidades/historico.ts`, `capacidades/ritmo.ts`, `tools/historico.js`, `test/historico-ritmo.js` | não |

Se a fila da trava de build ficar longa, parta em **A1 = 04, 05, 06, 07, 08** (o que já custou
processo ou documento) e **A2 = 09, 10, 11, 12**.

### Lote B — arquivos disjuntos do Lote A; pode entrar quando a fila da trava esvaziar (3 obras)

| Obra | Itens | Arquivos |
|---|---|---|
| `13-clique-destaque-e-assentar` | 13 + 7 | `capacidades/destaque.ts`, `capacidades/assentar.ts`, `tools/interacao.js` (param `esperar`), `test/clique-assentar.js` |
| `14-diagnostico-screenshot-recorte-e-console-cdp` | 12 + 17 | `capacidades/screenshot-recorte.ts`, `capacidades/console.ts`, `tools/diagnostico.js`, `test/diagnostico.js` |
| `15-pdf-e-js-com-argumentos` | 15 + 16 | `capacidades/arquivos.ts`, `capacidades/js.ts`, `tools/arquivos.js`, `tools/js.js`, `test/pdf-js-args.js` |

### Lote C — depois do B (2 obras)

| Obra | Item | Arquivos | Por que só agora |
|---|---|---|---|
| `16-timeout-configuravel` | 9 | `tools/navegacao.js`, `tools/interacao.js`, `tools/js.js`, `tools/espera.js`, `capacidades/js.ts`, `test/timeouts.js` | Toca os arquivos de tool que 13 e 15 acabaram de editar |
| `17-painel-quem-esta-fazendo-o-que` | 5b | `sidepanel/App.tsx`, `bridge/index.ts` (estado dos agentes + listener de mensagem) | Toca `bridge/index.ts` depois da 08 |

### Dependências, resumidas

- Tudo depende da `01`, exceto `02` e `03`.
- `16` depende de `13` e `15` (mesmos arquivos de tool). `17` depende de `08` (mesmo arquivo).
- `08` e `10` são as únicas do Lote A com arquivo compartilhado, e cada uma tem o seu; não colidem.
- `05` (upload em lote) e `07` (form_fill) se complementam no PJe (o tipo de cada anexo é
  aplicado por `form_fill`), mas não dependem uma da outra em código.

## 4. Protocolo de trava de build — vale para TODO pedreiro, em todo lote

O arquivo de trava é `C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock` (a `01` põe no
`.gitignore`; antes do Lote 0 o capataz adiciona a linha à mão).

1. Antes de `npm run build`: crie a trava com o seu nome e a hora. Em Git Bash:
   `cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "<obra> $(date +%H:%M)" > .obra-lock)`.
   Se falhar porque já existe, espere 60 s e tente de novo, até 15 min. Trava com mais de 10 min
   é abandonada: leia o conteúdo, anote no relatório, sobrescreva.
2. Com a trava: `npm run build` (raiz) → `cd bridge-server && npm run reload` → `node test/<seu-teste>.js`.
3. Solte a trava (`rm .obra-lock`) **assim que o teste terminar**, mesmo vermelho.
4. **Nunca** rode `reload` ou teste sem a trava: o reload derruba a sessão de todos os agentes.
5. Build quebrou num arquivo que **não é seu**: não conserte o arquivo alheio. Solte a trava,
   espere 2 min, tente de novo (até 3 vezes). Persistindo, reporte com o erro.
6. Rode **só o seu teste**. A bateria inteira (`npm test`) é só da `01` e do capataz no fim do lote.

Consequência para o capataz: **não dispare mais de ~5 pedreiros que precisem do Chrome ao mesmo
tempo**. Cada ciclo build+reload+teste leva 2 a 4 min com a trava presa.

## 5. Regras de escopo que os briefings repetem (e por quê)

- **Ninguém edita `package.json`, `README.md`, `ESTADO.md`** durante um lote. Teste novo é
  arquivo novo em `bridge-server/test/`; quem liga no script `test` do `package.json` é o capataz,
  uma vez, no fim do lote. Notas para o README vão no relatório final do pedreiro.
- **Ninguém commita.** `git checkout`, `git stash`, `git reset` são proibidos com outro pedreiro
  escrevendo (destroem trabalho não commitado alheio). Backup é `cp`. O capataz cria a branch
  `obra-20260904` antes do Lote 0 e commita por lote, depois de cético e conferência de escopo.
- **Conferência de escopo no fim de cada lote:** `git status` contra a união das listas "PODE
  tocar" de todos os briefings do lote. Arquivo fora da lista é achado; arquivo da lista sem toque
  também.
- **Cético por obra** (Sonnet, contexto limpo; **Opus** para a `01`, `04`, `05` e `08`, que tocam
  freio, isolamento e escrita no PJe). Template no §9.

## 6. O que é arriscado, e por quê

| Obra | Toca | Cuidado |
|---|---|---|
| `01` | tudo que os outros dependem; conjuntos que sustentam o modo somente leitura | bateria inteira + `registro.js`; cético Opus |
| `02` | o freio (`policy.ts`) | afrouxar demais deixa passar botão real; o teste tem o par (aba passa / botão barra) |
| `04` | um freio novo que bloqueia **todo** comando da aba enquanto houver diálogo | o gate tem de rodar antes de qualquer chamada CDP, senão o comando trava e o `send()` recarrega a aba (`debugger-manager/index.ts:114-119`) — perde o rascunho do PJe |
| `05` | escrita no PJe (anexos) | só se prova de verdade num protocolo real; o teste com página falsa prova o contrato, não o PJe |
| `08` | `bridge/index.ts`, o conjunto `abasCriadasPelaPonte`, a aba do usuário | aba filha de aba do **usuário** nunca pode virar da ponte; `close_tab` de aba do usuário tem de ser barrado |
| `12` | navegação (voltar) | `altera: true` obrigatório, senão volta na aba do usuário em modo leitura |
| `13` | o caminho de todo clique | +300 ms por clique; se `Overlay` não for permitido pelo `chrome.debugger`, o módulo se desliga sozinho |
| `16` | o transporte (timeouts) | teto menor que o interno da ação faz a ponte desistir antes da extensão responder |

## 7. O que precisa do Cezar no Chrome (teste manual)

| Obra | O quê | Quando |
|---|---|---|
| `03` | se aparecer "Verificação automática em andamento" no SCON, é ele quem resolve; o testador **para e reporta**, não insiste | durante o teste |
| `04` | ver o diálogo aparecer na janela da ponte e a ponte devolver o texto (opcional; o teste automatiza com `confirm()`) | depois do lote A |
| `05` | **próximo protocolo real** pela skill `protocolo-pje-ponte`, com `browser_upload_batch` no lugar do ciclo de 5 passos | primeiro MS após o lote A |
| `06` | CEP e autoridade num cadastro real do PJe | mesmo protocolo |
| `08` | emissão de guia de custas pela ponte (é a decisão 2 dele) — **em conferência primeiro**, sem clicar em Emitir, porque emitir cria boleto real | depois que a skill de custas for adaptada (trabalho de skill, fora deste plano) |
| `17` | abrir o painel da extensão com dois agentes rodando | depois do lote C |

## 8. Âncoras dos estudos que NÃO bateram com a fonte (corrigidas nos briefings)

1. **Estudo 2, "29 tools":** são **34** em `tools.js` (18 núcleo + 8 capacidades + 8 de ponte) mais
   `browser_status` em `index.js:34-40` = 35.
2. **Estudo 2 e 3, `browser_console_logs` "lê de um array que talvez ninguém preencha":** o array
   **é** preenchido — `entrypoints/content/index.ts:8-26` monkeypatcha `console.log/warn/error`.
   O problema é outro: o content script roda no **mundo isolado** (sem `world: 'MAIN'`), então
   intercepta o `console` do mundo isolado, não o da página. A tool volta vazia para log de página
   por esse motivo, e não por falta de injeção. (Obra `14`, medir antes de construir.)
3. **Estudo 3, "auto-wait é manual depois de navegar/clicar":** `navigate` **já espera** —
   `cdp-tools.ts:516-519` (`cdpNavigate` → `waitForNetworkIdle`, teto 15 s). O que não espera é o
   **clique**. O item 7 é sobre clique/Enter/form_input, não sobre navigate.
4. **Proposta, item 7, "reaproveita o wait_network":** não dá para reaproveitar `waitForNetworkIdle`
   como está. `cdp-tools.ts:460-470`: `checkIdle` só resolve depois de um evento de ciclo de vida
   (`firstContentfulPaint`/`load`). Clique que dispara só AJAX, sem navegação, nunca recebe esse
   evento e o "assentar" gastaria o teto inteiro em **todo** clique. Precisa de contador próprio.
5. **Estudo 2, "reattach não reinstala o listener de diálogo":** correto, e é pior:
   `debugger-manager/index.ts:27-34` (`onDetach`) apaga **todos** os listeners da aba. Depois de
   qualquer detach+reattach some o handler de diálogo e some qualquer `dm.on` de módulo. Por isso
   os ganchos `aoAnexar` da `01` rodam também no reattach (`send()`, linhas 100-111).
6. **Estudo 2, `wxt.config.ts:29-50`:** `permissions` é 29-46; `host_permissions` 47-51. Sem efeito.
7. **Proposta, item 1, "timeout de segurança que aceita depois de N s":** vencida pela decisão do
   Cezar — nunca responder sozinho, nem por timeout. O que evita a aba presa é ele mesmo clicar na
   janela da ponte (é Chrome real) e a ponte ouvir `Page.javascriptDialogClosed`.

## 9. Dois achados do fechador fora dos 17 (entram na obra `08`)

1. **`browser_tab_open` abre a aba na janela do usuário, não na da ponte.** `execution-engine/index.ts:201-205`
   → `workspaceManager.addTab` → `workspace-manager/index.ts:184`: `chrome.tabs.create({ url, active: false })`
   **sem `windowId`**, que para um service worker é a janela focada — a do usuário. O `bridge/index.ts:384-391`
   marca a aba como da ponte e a torna ativa de trabalho; o próximo input (`comAbaPronta`, linha
   796) a **ativa na janela do usuário**. É a mesma classe do incidente de 19/08 ("ele via a aba
   trocar"). A `abrirAbaPropria()` de `bridge/index.ts:511-517` já faz certo (`windowId` da ponte).
   Hipótese a medir pelo pedreiro da `08` antes de consertar.
2. **`browser_tab_close {tabId}` fecha aba do usuário.** `execution-engine/index.ts:220-224` remove
   qualquer id; `bridge/index.ts` não guarda esse caminho (`abasCriadasPelaPonte.has` só aparece nas
   linhas 344, 868). `close_tab` não está em `ACOES_QUE_ALTERAM`, então nem o modo leitura pega. O
   README promete que só aba da ponte é fechada; o código não cumpre.

## 10. Template do cético (um por obra, contexto limpo)

> Você é o cético da obra `NN-<slug>`. Leia o briefing em `docs/obra-20260904/NN-<slug>.md` e o
> relatório do pedreiro (colado abaixo). **Não aceite a narrativa: confira na fonte.** Para cada
> afirmação do relatório, abra o arquivo. Todo achado precisa de "como quebra": entrada concreta →
> resultado errado. Sem isso é opinião.
> **Mutation testing obrigatório:** mutile o conserto (inverta a condição, apague a linha que
> relê o valor, troque o seletor) e rode o teste da obra: tem de ficar VERMELHO. Se ficar verde
> com o defeito de volta, o teste é teatro — reporte. Backup por **cópia** (`cp arquivo arquivo.bak`
> e restaure com `cp` de volta), **nunca** `git checkout`/`git stash` — há outros pedreiros com
> trabalho não commitado. Siga o protocolo de trava de build do plano (§4) para rodar o teste.
> Confira também: (a) o pedreiro tocou só os arquivos "PODE tocar"? (`git status`); (b) toda
> capacidade nova que altera a página declara `altera: true`? (c) `npx tsc --noEmit` (raiz) mostra
> só o erro pré-existente de `safe-scripting.ts:8`? Entregue: lista de achados com arquivo:linha e
> "como quebra", e o veredito: APROVADA / VOLTA PARA O PEDREIRO (com o que consertar).

## 11. Decisões que tomei no lugar dele (reversíveis, avisar se quiser mudar)

- Destaque antes do clique (`13`): **ligado** por padrão, 300 ms, desligável por
  `chrome.storage.local.set({ destacarAntesDeClicar: false })`.
- Ritmo por host (`12`): **4 s** entre `navigate` no mesmo host `*.jus.br` ou `jusbrasil.com.br`,
  global para todos os agentes, configurável por `ritmoMs`/`ritmoHosts` no storage.
- Pasta padrão do download nativo (`08`): `~/.praxedes-bridge/downloads/` (a ponte já é dona de
  `~/.praxedes-bridge/`, ver `bridge-server/src/token.js:6`).
- `browser_wait_new_tab` sem aba nova dentro do teto **não é erro** — devolve "nenhuma; leia a aba
  atual". Erro aqui reproduziria a guia órfã (quem leu erro repetiu o Emitir).
- Detector de desafio (`09`): página **inteira** de desafio (Cloudflare/hCaptcha interstitial) é
  erro; **widget** de reCAPTCHA dentro de formulário normal (caso TJ-SP) é só aviso, senão o
  detector bloqueia o único caminho que funciona no TJ-SP.

## 12. Perguntas que só o Cezar responde

Uma, e não bloqueia nenhum lote:

1. **"Emitir a guia de recolhimento" (custas.tjro.jus.br) entra no freio?** Emitir cria boleto
   real no CPF do cliente (foi assim que nasceu a guia órfã de R$ 153,10 do CLIENTE C, 18/08). Se
   sim, a frase `emitir a guia` (estreita, não `emitir` sozinho) entra em `TEXTOS_DESTRUTIVOS`
   (`policy.ts:37-42`). A `02` **não** faz isso por conta própria; se a resposta chegar antes de
   ela começar, o capataz acrescenta ao briefing.

## 13. Depois do plano (não é obra de código)

- Adaptar a skill `protocolo-pje-ponte` (§4.1–4.3) para `browser_upload_batch` + `browser_upload_verify` e
  `browser_form_fill`; a skill `juris-tribunais` conforme o relatório da `03`; o
  `checklist-pje.md` de custas para a ponte (depende da `08`). Skills moram em `~/.claude/skills`,
  fora deste repo, e a regra da casa é proposta (`-proposta.md`) antes de substituir.
- Atualizar `README.md` (tabela de tools, armadilhas novas) e `ESTADO.md` com as notas dos
  relatórios dos pedreiros, uma vez por lote.
- O botão "Limpar grupos da ponte" do painel (`sidepanel/App.tsx:56-75`) e `limparGruposDaPonte`
  (`background/index.ts:204-220`) procuram grupos que não existem mais desde 14/08. Dívida,
  não urgência; a `17` mexe no painel e pode relatar, não remover (ADITIVO).

---

## 14. Obra 18, acrescentada em 05/09/2026 pelo capataz

**Link aberto de fora do Chrome cai DENTRO da janela da ponte.**

Medido durante os testes do Lote 0: `Start-Process chrome 'https://...'` (equivalente a clicar num
link do WhatsApp Desktop, do Drive ou de qualquer app) abriu a aba **na janela da ponte**, não numa
janela do usuário — o Chrome manda a aba para a última janela focada, e a janela da ponte nasce com
`focused: true` (precisa, senão não é pintada e o clique não funciona).

**O Cezar confirmou que isso aconteceu com ele em 04/09 e atrapalhou o trabalho.** Não é hipótese.

Não há perda de dado: a aba dele não entra em `abasCriadasPelaPonte`, então a faxina não a fecha.
O estrago é de convivência — a aba dele nasce misturada com as dos agentes, na janela que ele
deixou de lado, e ele perde de vista o que abriu.

Briefing: `docs/obra-20260904/18-janela-da-ponte-nao-recebe-aba-do-usuario.md`.
Entra no **Lote A** (toca `bridge/index.ts`, então **serializa com a obra 08** — as duas não podem
rodar ao mesmo tempo; rode 18 depois que 08 for aprovada pelo cético).

---

## 15. Obra 19, acrescentada em 05/09/2026 — a ponte adota aba `chrome://` e trava

Apareceu como "falha do teste `isolamento.js`", mas **é defeito da ponte**, não do teste.

`abaCorrenteDoUsuario()` (`bridge/index.ts`, ~628-636) escolhe a aba ativa da janela do usuário
**sem filtrar `chrome://`**. `cap_tabs_all` (~742) filtra. Resultado: com o Cezar numa "Nova guia"
(`chrome://newtab`), `browser_use_current_tab` adota uma aba que a ponte **não consegue ler nem
operar** — o CDP responde `Cannot access a chrome:// URL`.

Para ele, na prática: "olha isso aqui" com a nova guia na frente devolve erro incompreensível em
vez de dizer "essa aba é uma página interna do Chrome, abra o site primeiro".

Custou tempo três vezes hoje: derrubou `isolamento.js` para o capataz, para o cético da 01 e para
o pedreiro da 01 — cada um investigando do zero.

**Escopo:** `abaCorrenteDoUsuario` recusa `chrome://`, `edge://`, `about:` (menos `about:blank`) e
`chrome-extension://`, com erro que diz o que fazer; se houver outra aba utilizável na janela,
sugerir. `cap_use_tab` idem (hoje aceita qualquer `tabId`). **Toca `bridge/index.ts`** → serializa
com as obras 08 e 18. Teste: `use_current_tab` com nova guia ativa devolve erro explicativo, e
`isolamento.js` deixa de depender de sorte.

---

## 16. Obra 20, achada em 05/09/2026 pelo cético da 01 — `browser_javascript` fura o modo somente leitura

**O modo "somente leitura" não é somente leitura.** `cap_js` não declara `altera`
(`capacidades/js.ts:35`), então **não entra em `ACOES_QUE_ALTERAM`** — e `browser_javascript` roda
JS arbitrário na aba do Dr. Cezar mesmo com o agente em modo leitura. Um
`document.querySelector('form').submit()` passa; navegar, clicar e digitar não passam.

**É pré-existente** — o `Set` fixo de antes da refatoração (`ACOES_QUE_ALTERAM`, HEAD, linhas
37-40) também não listava `cap_js`, e a obra 01 preservou fielmente. Não é regressão; é buraco
que estava lá desde que o modo leitura nasceu (19/08), e ninguém tinha olhado.

Hoje é **o furo mais largo da barreira**, e some com a garantia que o Cezar pediu em 04/09:
"um erro do agente não pode custar a aba em que eu trabalho".

**O que decidir na obra:** `cap_js` com `altera: true` bloqueia leitura legítima por JS (é a
ferramenta que o cético usou para medir, e a que a skill do PJe usa para inspecionar). Provável
saída: separar leitura de escrita — `browser_javascript` continua livre, mas em aba do usuário
roda numa avaliação que **recusa efeito colateral** (sem `submit()`, `click()`, `.value =`,
`location =`), ou exige `permitir_acao`. Medir antes: quantos usos reais da skill
`protocolo-pje-ponte` seriam barrados por essa regra.

Toca `capacidades/js.ts` (+ talvez `bridge/index.ts`). **Entra no Lote A**, e é mais urgente que
metade dele.

## 17. Duas dívidas menores da bancada, do mesmo cético

1. **A sonda de `registro.js` é destrutiva quando falha.** Por construção ela tenta navegar,
   digitar e emular na aba real do Cezar; se a barreira estiver quebrada E ele estiver com o PJe
   na frente, **o teste é que faz o estrago**. A sonda tem de abrir a própria aba-cobaia.
2. **`browser_use_tab` não tem sonda** (`adotar-aba.js` adota mas não afirma o modo leitura), então
   uma mutação em `cap_use_tab` escaparia. Três linhas na sonda fecham.

## 18. Achado lateral do pedreiro da 02 — `ax-tree` não dá `ref` a `<td>`/`<li>`

`execution-engine/ax-tree.ts` só lista um conjunto fixo de roles como interativos; `cell` e
`listitem` ficam de fora. Um `<td>` ou `<li>` puro (sem `role` explícito) **nunca ganha `ref`**,
então o agente não consegue clicar nele por `browser_click{ref}` — só por coordenada.

Importa porque o PJe é feito de tabela: linha de anexo, linha de parte, célula clicável de lista
de processos. Hoje o contorno é medir a posição por JS e clicar por `x`/`y`.

Não é urgente (o clique por coordenada existe e funciona), mas explica atrito que a skill do PJe
documenta como "não achei o elemento". Vira obra quando alguém tiver o caso na mão.

## 19. Dívida da bancada: `registro.js` tem baseline fixa de tools

`bridge-server/test/registro.js` afirma a lista **exata** de tools (36 na data do Lote 0). Toda obra
que acrescenta tool deixa esse teste vermelho até alguém atualizar a lista — o pedreiro da 07
reportou isso ao ver `browser_dialog` (obra 04) e `browser_form_fill` (obra 07) faltando.

**É de propósito** (lista fixa foi a correção do cético: baseline que se atualiza sozinha não prova
nada). Mas o dono da atualização é **a conferência de escopo no fim do lote**, nunca o pedreiro —
senão cada um mexe no teste do outro.

**Procedimento ao consolidar um lote:** rodar `bridge_capacidades`, conferir que as tools novas são
exatamente as das obras aprovadas (nem mais, nem menos), atualizar a lista, e rodar de novo.
Tool que apareceu sem obra é achado.

## 20. Obra 21 — `browser_press_key` quebrado para edição de texto (regressão de 03/09)

Medido pelo pedreiro da obra 06 **contra site real**, fora de fixture: `Ctrl+A` **insere a letra "a"**
no campo (virou "LIXOa") em vez de selecionar tudo, e `Backspace` **não apaga nada** (o evento
dispara, mas sem ação nativa de edição).

**A parte do `Ctrl+A` é regressão introduzida pelo capataz em 03/09**, ao consertar o
`press_key` que não inseria caractere: o conserto manda `text` sempre que a tecla tem um
caractere só (`key.length === 1`), sem excluir o caso em que há **modificador de comando**
(Control/Meta/Alt). Com `Ctrl+A`, `key` é `"a"` e o `text` insere a letra. Antes do conserto,
`Ctrl+A` também não funcionava — mas não sujava o campo.

O `Backspace` é pré-existente: teclas de controle vão como `rawKeyDown` sem
`windowsVirtualKeyCode`/`nativeVirtualKeyCode`, e sem isso o Chrome não executa a ação de edição.

**Impacto:** qualquer fluxo que precise limpar um campo antes de digitar. A obra 06 contornou
localmente (`.value = ''` direto no DOM) e documentou; o contorno não serve para campo que só
reage a digitação real, que é justamente o caso do PJe.

**Escopo:** `entrypoints/background/execution-engine/cdp-tools.ts` (`cdpPressKey`) — arquivo do
motor, fora de `capacidades/`, então **não colide com nenhuma obra do Lote A**. Regra: só mandar
`text` quando não houver modificador de comando; mapear `windowsVirtualKeyCode`/`code` para as
teclas de edição (Backspace, Delete, Enter, Tab, setas, Home/End). Teste: `Ctrl+A` seguido de
`Backspace` esvazia o campo; digitar depois escreve só o texto novo.

## 21. Obra 22 — canal de feedback DO AGENTE, ideia do Cezar (05/09/2026)

**A ideia, na fala dele:** *"um lugar na extensão/MCP onde o agente, quando usar, possa deixar
feedback de melhorias ou apontar algo que esteja dando erro. Um lugar feito pra agente e não pra
gente (humano)."*

**Por que vale, com evidência desta própria rodada:** os dois melhores achados do estudo vieram de
`HANDOFF-*.md` que agentes escreveram **à mão**, porque tiveram a disciplina de parar e documentar.
E hoje, em uma tarde, os pedreiros acharam quatro defeitos fora do próprio escopo — `ax-tree` sem
`ref` para `<td>`, `press_key` quebrado para edição, `cap_js` furando o modo leitura,
`use_current_tab` travando em `chrome://`. **Todos foram registrados à mão pelo capataz**, que por
acaso estava lendo os relatórios. Sem ele, morriam na sessão. Um agente no meio de um protocolo do
PJe não escreve `.md`; chamaria uma tool em dois segundos.

**Desenho proposto (o pedreiro decide os detalhes, medindo):**

- **`bridge_feedback`** — o agente relata. O schema **força o formato "como quebra"**, o mesmo que
  exigimos dos céticos, senão vira "não funcionou": `tipo` (erro | mentiu | faltou | confuso),
  `tool`, `o_que_eu_queria`, `o_que_eu_chamei`, `o_que_veio`, `o_que_eu_esperava`,
  `como_descobri`. Campos vazios ou vagos: a tool recusa e diz o que falta.
- **A ponte preenche o resto sozinha:** URL, hostname, aba, agente, hora, versão do build. O agente
  só escreve o julgamento.
- **`bridge_feedback_ler`** — agrupa por tool e por hostname. É o que transforma depósito em pauta
  ("browser_upload_file: 7 relatos, 5 em pje.jus.br").
- **Captura automática**, que só a ponte pode dar: toda tool que devolve erro já grava o contexto;
  o agente complementa quando quiser dizer *por que* estava errado. Liga direto na auditoria da
  obra 10.
- **Onde mora:** `~/.praxedes-bridge/feedback.jsonl` — fora do repo (é dado, não código), uma linha
  por relato, que é o formato que aguenta várias sessões escrevendo ao mesmo tempo.

**Risco a nascer com defesa:** virar mural que ninguém lê. Duas travas: o schema recusa relato sem
"o que veio" e "o que eu esperava"; e **ler o feedback vira o primeiro passo do estudo** de toda
rodada de obras futura — a mesma posição que os `HANDOFF-*.md` ocupam hoje.

**Escopo:** stubs novos em `capacidades/` e `tools/` (não colide com nenhuma obra em curso).
Servidor grava o arquivo (é o lado que tem disco). **Não toca `bridge/index.ts`** se a captura
automática entrar por gancho `depois`, que a obra 01 criou justamente para isso.
