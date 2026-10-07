# Obra 12 — Voltar/avançar (`browser_back`, item 14) e ritmo por host de tribunal (jurisprudência)

**Lote A. Depende da obra 01 (stubs `capacidades/historico.ts`, `capacidades/ritmo.ts`,
`tools/historico.js`).**

## Objetivo em uma frase

`browser_back`/`browser_forward` navegam pelo histórico da aba sem perder o estado do formulário,
e um gancho `antes` de `navigate` impõe **N segundos entre navegações ao mesmo host de tribunal**,
global para todos os agentes da ponte — a disciplina que hoje é texto de skill.

## Por que existe

- **Voltar:** hoje o agente navega de novo para a URL anterior e perde o estado do formulário
  (estudo 2, §B "itens já cobertos"). `chrome.tabs.goBack/goForward` resolvem sem CDP; nem isso
  está exposto.
- **Ritmo:** em 03/09/2026 cinco agentes abriram o SCON em sequência e prenderam até a aba do
  Chrome real no desafio por mais de dez minutos (memória `reference_stj-scon-cloudflare.md`); o
  WAF do TJ-RO bloqueia por ritmo devolvendo 200 com "suspeita de robotização" (memória
  `reference_juris-tjro-backend.md`). "Espace as requisições" é orientação de skill, fácil de
  esquecer; a extensão é **um processo só** para todos os agentes, então um mapa `host → último
  navigate` no módulo serializa entre agentes de graça (estudo 4, §C "rate limit").

## Âncoras conferidas na fonte (05/09/2026)

- `execution-engine/index.ts:194-199` `navigate`; `cdp-tools.ts:516-519` `cdpNavigate` já espera
  a rede (15 s). O seu gancho `antes` roda **antes** disso e do freio.
- `bridge/index.ts:37-40` `ACOES_QUE_ALTERAM` inclui `navigate`; a sua `cap_back` precisa de
  `altera: true` para ser barrada na aba do usuário em modo leitura — é a mesma coisa que navegar.
- `capabilities.ts:214-216` (pós-01: `rede.ts`) — `esperarRede(tabId, maxWaitMs)`; importe.
- `policy.ts:47-55` `hostFinanceiro` — modelo de casar host por sufixo com `new URL(url).hostname`.
- `bridge/index.ts:166-173` — leitura/gravação em `chrome.storage.local` para configuração
  (`janelaDaPonteBounds`); use o mesmo mecanismo para `ritmoMs`/`ritmoHosts`.

## O que construir

`capacidades/historico.ts`: `cap_back` e `cap_forward` (`altera: true`, `input: false`):
`chrome.tabs.goBack(tabId)` / `goForward` (lançam se não há para onde ir) → `esperarRede(tabId,
3000)` → `chrome.tabs.get` → `{ url, titulo }`. Sem histórico → erro `nao ha pagina
anterior/seguinte no historico desta aba — use browser_navigate`.

`capacidades/ritmo.ts`: gancho `antes(ctx)` só para `ctx.acao === 'navigate'`: `host =
new URL(params.url).hostname` (inválida → não faz nada); `hosts` = `chrome.storage.local.ritmoHosts`
(array de sufixos) ou padrão `['.jus.br', 'jusbrasil.com.br']`; casa por `host === h ||
host.endsWith(h)` (cuidado: `.jus.br` já é sufixo com ponto; `jusbrasil.com.br` casa
`www.jusbrasil.com.br`). `N` = `ritmoMs` ou 4000. Mapa **de módulo** `ultimo: Map<host, ts>`; se
`agora - ultimo < N` → `await sleep(N - delta)`; registra `agora` (após a espera). `console.log`
`[ritmo] esperei Xms antes de navegar em <host>`. Não altera o resultado.

`tools/historico.js`: `browser_back`, `browser_forward`. Descrição: "mantém o estado do formulário;
prefira a navegar de novo para a URL".

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/historico.ts`, `entrypoints/background/bridge/capacidades/ritmo.ts`,
`bridge-server/src/tools/historico.js`, `bridge-server/test/historico-ritmo.js` (novo).

## Arquivos que você NÃO PODE tocar

`capacidades/rede.ts`, `policy.ts`, `bridge/index.ts`, `registro.ts`/`index.ts` dos dois lados,
`tools/navegacao.js` (é da obra 16, Lote C), qualquer outro módulo, `package.json`, `README.md`,
`ESTADO.md`, skills.

## Quem mais está construindo agora

Lote A: 04, 05, 06, 07, 08, 09, 10, 11, cada uma no próprio módulo. A 08 toca `bridge/index.ts`.
Trava de build compartilhada.

## Padrão da casa a imitar

- **Host por sufixo:** `policy.ts:47-55`.
- **Configuração em storage com padrão no código:** `bridge/index.ts:176-178`
  (`ociosidadeMs` do storage ou `OCIOSIDADE_MS`).
- **Erro que diz o remédio:** `bridge/index.ts:486-490`.
- Teste: `test/isolamento.js:39-46` (duas navegações e leitura da primeira linha de `read_page`).

## O que NÃO fazer, e por quê

- **Não aplique o ritmo por agente**: a rajada de 03/09 foi **cinco agentes, uma abertura cada**.
  O mapa é do módulo (global na extensão).
- **Não bloqueie com erro**: espere. Erro faria o agente repetir e piorar a rajada.
- **Não inclua `example.com`/hosts genéricos** no padrão; só tribunal e JusBrasil.
- **Não implemente `back` por `Page.navigateToHistoryEntry`**: `chrome.tabs.goBack` basta e
  não depende do debugger anexado.
- **Defeito irmão:** `cap_back` sem `altera: true` volta a página da aba do usuário em modo
  leitura — o mesmo furo que a 01 fechou ao calcular os conjuntos. O teste tem de provar que
  `browser_back` na aba do usuário (`browser_use_current_tab`) é barrado.

## Armadilhas conhecidas

- `chrome.tabs.goBack` resolve antes de a página carregar; por isso o `esperarRede(3000)`.
- Aba `about:blank` recém-criada não tem histórico: erro esperado.
- O ritmo atrasa o `navigate` **dentro** do teto de transporte (90 s, `tools.js:95`): 4 s cabem.
  Se algum dia `ritmoMs` for grande, avise na descrição que o teto é o do navigate.

## Critério de pronto

`bridge-server/test/historico-ritmo.js` (novo):
1. `navigate example.com` → `navigate iana.org/help/example-domains` → `browser_back` →
   primeira linha de `read_page` tem `example.com`; `browser_forward` → `iana.org`.
2. `browser_tab_open` (aba nova) → `browser_back` → `isError` com `historico`.
3. `browser_use_current_tab` → `browser_back` → `isError` `[somente leitura]`; `browser_use_own_tab`.
4. Ritmo: `t0 = Date.now()`; `navigate https://www.tjro.jus.br/` duas vezes seguidas (é site
   público estático; **duas** aberturas, espaçadas por construção); `Date.now() - t0 >= 4000`.
   E duas vezes `example.com` seguidas terminam em bem menos (registre o número; não asserte se
   for instável).
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/historico-ritmo.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-12 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seu teste →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`browser_navigate` continua igual, fora a espera em host de tribunal. Regressão inaceitável:
`isolamento.js` vermelho (rode só ele além do seu, porque você tocou o caminho de `navigate` com
um gancho).

## Se concluir que não vale

Se medir que 4 s no `navigate` não cobre o caso real (por exemplo, o SCON conta cliques de
paginação, não só navegações), construa o `back` e reporte o ritmo com a medição em vez de
construir algo que não protege.

## Como reportar

Saída dos testes; os números do ritmo; notas para o README (tools novas; `ritmoMs`/`ritmoHosts`
no storage) e para a skill `juris-tribunais` (a ponte espaça sozinha; a regra "uma abertura por
vez" continua). Não edite nenhum.
