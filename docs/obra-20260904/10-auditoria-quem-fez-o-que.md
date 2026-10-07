# Obra 10 — Ligar a auditoria: quem fez o quê, em que aba (item 5a)

**Lote A. Depende da obra 01 (stub `capacidades/auditoria.ts`, gancho `depois` em todo caminho,
`ctx.nome`).**

## Objetivo em uma frase

Cada comando da ponte grava `{ agente, clientId, ação, aba, url, ok, erro, quando, ms }` no
`auditLogger` que já existe e nunca foi chamado, e uma tool `bridge_auditoria` lista os últimos —
para, com cinco agentes no mesmo Chrome, alguém saber quem navegou o quê.

## Por que existe

O módulo de auditoria existe, funciona (IndexedDB, `log()`/`getByWorkspace()`), é inicializado no
`background/index.ts:315`, e a ponte nunca o chama — há um `TODO` em `bridge/index.ts:393`. Em
03/09/2026 outra sessão navegou por cima do cadastro do PJe **duas vezes**, e o diagnóstico foi
feito à mão, por handoff escrito, porque não havia rastro de quem fez o quê (skill
`protocolo-pje-ponte`, "A quarta parede"). O painel (obra 17, Lote C) vai mostrar "agentes ativos
e última ação"; esta obra grava o dado.

## Âncoras conferidas na fonte (05/09/2026)

- `bridge/index.ts:393` — `// TODO: registrar no auditLogger com o formato AuditEvent correto.`
  Pós-01, o lugar é o gancho `depois`, que a 01 faz rodar em **todo** caminho de resposta,
  inclusive `[somente leitura]` e `[bloqueado]`. Confira no arquivo como a 01 deixou.
- `audit/index.ts:9-21` `init()` (IndexedDB `browser-agent-audit`, índices `workspaceId` e
  `timestamp`); 23-35 `log(event)` — **se `db` ainda não abriu, só `console.warn` e descarta**
  (29-32); 37-46 `getByWorkspace`. Não há `listarRecentes`, não há rotação.
- `shared/types/index.ts:183-206` `AuditEvent { id, workspaceId, tabId?, type: <união de 19
  literais>, timestamp, payload: Record<string, unknown> }`. Não há literal para a ponte.
- `background/index.ts:315` `auditLogger.init()` sem `await`; 419-424 `GET_AUDIT_LOG` responde
  `getByWorkspace` ao painel legado.
- `hub.js:302-327` `send(action, args, timeoutMs)` — o payload é `{ type: 'cmd', id, clientId,
  action, args }` (304): **não vai o nome do agente**. Para peers, `#onHubMessage` repassa
  `{ ...msg, clientId: ws.clientId }` (151) — um `name` no payload passa intacto.
- `bridge-server/src/index.js:26-27` — `clientName` (de `--name`) e `clientId` (8 hex).
- `bridge/index.ts:83-95` `BridgeCommand.name?` existe (94) e a 01 o põe em `ctx.nome`.

## O que construir

1. `hub.js:304`: o payload ganha `name: this.name`. Uma linha. Nada mais em `hub.js`.
2. `shared/types/index.ts`: acrescente `| 'bridge_command'` à união de `type`. Uma linha.
3. `audit/index.ts` (ADITIVO):
   - `log()` antes do `init` terminar: guarde numa fila e descarregue em `init` (hoje descarta).
   - `listarRecentes(limite = 50, filtro?: { clientId?: string })`: cursor `prev` no índice
     `timestamp`, filtrando `payload.clientId` se pedido.
   - Rotação: a cada 100 `log`, se `count() > 5000`, apaga os mais antigos até 5000.
4. `capacidades/auditoria.ts`:
   - Gancho `antes(ctx)`: guarda `inicio` num `WeakMap<ctx, number>` (ou `Map` por `cmd.id`).
   - Gancho `depois(ctx, r)`: `auditLogger.log({ workspaceId: ws.workspaceId, tabId,
     type: 'bridge_command', payload: { clientId, agente: ctx.nome ?? null, acao, ok: r.ok,
     erro: r.error?.slice(0, 300), url, resumo, ms } })` e devolve `r` **inalterado**. `url` por
     `chrome.tabs.get(tabId).url` (o `ws.tabs[].url` fica velho — `policy.ts:92-95` explica).
     `resumo`: só o essencial dos params, cortado em 200 caracteres — `url` de navigate, `ref`,
     `text` cortado em 60, `codigo` cortado em 120, `caminhos` só os basenames; **nunca** base64,
     nunca o `valor` de `cap_form_input` inteiro além de 60.
   - Capacidade `cap_auditoria { limite?, so_meus? }` (não altera): `listarRecentes(limite,
     so_meus ? { clientId } : undefined)` → array `{ quando (ISO), agente, clientId, acao, aba,
     url, ok, erro, ms }`, do mais novo para o mais velho.
5. `tools/auditoria.js`: `bridge_auditoria { limite?, so_meus? }` → `cap_auditoria`. Descrição:
   "quem fez o quê nesta ponte, últimos N comandos de todos os agentes; use quando uma aba mudou
   sem você pedir".

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/auditoria.ts`, `entrypoints/background/audit/index.ts`,
`shared/types/index.ts` (uma linha), `bridge-server/src/hub.js` (uma linha),
`bridge-server/src/tools/auditoria.js`, `bridge-server/test/auditoria.js` (novo).

## Arquivos que você NÃO PODE tocar

`bridge/index.ts` (o `TODO` da linha 393 fica; a 17 ou o capataz apaga), `background/index.ts`,
`sidepanel/**`, `registro.ts`/`index.ts` dos dois lados, qualquer outro módulo, `package.json`,
`README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote A: 04, 05, 06, 07, 08, 09, 11, 12, cada uma no próprio módulo. A 08 toca `bridge/index.ts`.
Você é a única em `hub.js`, `shared/types` e `audit/`. Trava de build compartilhada.

## Padrão da casa a imitar

- **Gancho que observa sem alterar:** o indicador (`bridge/index.ts:402-437`) acende e apaga em
  volta do comando sem tocar no resultado. Seu `depois` devolve `r` como recebeu.
- **URL da aba, não do workspace:** `policy.ts:92-95`.
- **Ponte não expõe segredo:** `policy.ts:97-107` (senha nunca passa). O resumo não grava valor
  inteiro digitado.
- Teste com dois clientes nomeados (`agente-A`/`agente-B`): `test/aba-sumiu.js:22-27`.

## O que NÃO fazer, e por quê

- **Não grave base64, screenshot, PDF nem `document.body`**: o IndexedDB vira gigabyte.
- **Não mude a assinatura de `log()`** nem o formato dos eventos legados: o painel legado lê
  `getByWorkspace`.
- **Não faça `depois` lançar**: erro na auditoria não pode derrubar o comando — `try/catch` com
  `console.warn`.
- **Não adicione o nome pelo `hello`** da extensão: ela não sabe de peers. É no `cmd`.
- **Defeito irmão:** `chrome.tabs.get` numa aba que acabou de morrer lança; a auditoria do
  comando que recebeu `[aba trocou]` não pode explodir por isso (`catch` → `url: null`).

## Armadilhas conhecidas

- Service worker dorme: IndexedDB reabre; `init()` é chamado no boot do SW. A fila cobre o
  intervalo.
- `ctx.nome` chega `undefined` de servidor MCP antigo (subiu antes desta obra): grave `null`, não
  falhe.
- Timestamp: `Date.now()` do SW; converta para ISO só na listagem.

## Critério de pronto

`bridge-server/test/auditoria.js` (novo), clientes `agente-A` e `agente-B`:
1. A navega `example.com`; B navega `iana.org/help/example-domains`; A monta um botão "Excluir
   processo" e clica nele (freio barra).
2. `bridge_auditoria { limite: 30 }` de A: contém `{ acao: 'navigate', ok: true, agente: 'agente-A' }`,
   `{ acao: 'navigate', agente: 'agente-B' }` com a `url` da iana, e `{ acao: 'click', ok: false,
   erro: /bloqueado/ , agente: 'agente-A' }`; `ms` numérico; `aba` bate com `browser_tabs_list`.
3. `{ so_meus: true }` de A → nenhum `agente-B`.
4. `resumo` do `navigate` contém a URL e o do `click` não contém base64 nem texto > 200 chars.
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/auditoria.js`. Como tocou `hub.js`, rode também `node test/smoke.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-10 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seus testes →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

Nenhum comportamento de comando muda; só nasce rastro. Regressão inaceitável: `smoke.js` vermelho;
qualquer comando falhando por causa da auditoria; `GET_AUDIT_LOG` do painel legado quebrado.

## Como reportar

Saída dos testes; um exemplo real de linha da auditoria; tamanho estimado por evento; notas para o
README (tool `bridge_auditoria`; o que é gravado e por quanto tempo). Não edite o README.
