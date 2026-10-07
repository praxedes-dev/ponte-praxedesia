# Obra 17 — Painel da extensão: agentes ativos e última ação de cada um (item 5b)

**Lote C. Depende das obras 01 (função `responder` central em `bridge/index.ts`), 08 (que editou
`bridge/index.ts` antes de você) e 10 (que faz o nome do agente chegar em `cmd.name`).**

## Objetivo em uma frase

O painel da extensão passa a listar, ao vivo, cada agente conectado — nome, aba (título/id), modo
(leitura/ação) e última ação com resultado e "há N s" — para o Cezar ver quem está fazendo o quê
sem abrir o chat de ninguém.

## Por que existe

Com até cinco agentes no mesmo Chrome, hoje o painel só mostra status de conexão, token e um botão
de limpeza (`ESTADO.md`, "Painel da extensão"). Quando uma aba muda sem ninguém pedir, o
diagnóstico é por handoff escrito (estudo 1, Top 10 #10). A obra 10 gravou o rastro; esta mostra o
presente.

## Âncoras conferidas na fonte (05/09/2026)

- `sidepanel/App.tsx` (179 linhas): 28-45 listener de `BRIDGE_STATUS` (`chrome.runtime.onMessage`);
  86-103 cartão de status; 106-157 token; 159-172 "Limpar grupos da ponte" (aciona `LIMPAR_GRUPOS`
  em `background/index.ts:405-410` → `limparGruposDaPonte`, 204-220, que procura grupos que **não
  existem mais** desde 14/08 — dívida, não sua). Estilo: classes `card`, `text-[var(--text-muted)]`,
  `text-white`; ícones `lucide-react`.
- `bridge/index.ts` (pós-01/08): estado por agente em `workspaceByClient` (104),
  `ultimoComando` (116), `somenteLeitura` (125), `abaPropriaDoCliente` (128), `abaAncora` (138);
  `broadcastStatus` (896-902) manda `BRIDGE_STATUS` ao painel; `janelaDaPonte` no storage.
- `background/index.ts:360-427` — roteador de mensagens do painel; para tipo desconhecido não
  responde (cai fora do `switch`). Você **não** edita este arquivo: a ponte registra o próprio
  `chrome.runtime.onMessage` dentro de `start()`.
- `bridge/index.ts:83-95` `BridgeCommand.name?` — desde a obra 10 vem preenchido com o `--name`
  do servidor (`agente-A`, `Claude Code`...).

## O que construir

`bridge/index.ts`:
- `ultimaAcao: Map<clientId, { acao, ok, quando, erro?: string }>` atualizado na função
  `responder(...)` que a 01 centralizou (todo caminho de resposta passa por ela). `nomeDoCliente:
  Map<clientId, string>` alimentado por `cmd.name` quando vier.
- `estadoDosAgentes()`: para cada `clientId` em `workspaceByClient`: `{ clientId, nome, tabId:
  ws.activeTabId, titulo/url (chrome.tabs.get, com catch), modo: somenteLeitura ? 'leitura' :
  'acao', ultimoComandoEm, ultimaAcao }`, mais `{ janelaDaPonte, extensaoOnline: this.online }`.
- Em `start()`: `chrome.runtime.onMessage.addListener((msg, _s, respond) => { if (msg?.type !==
  'PONTE_AGENTES') return; this.estadoDosAgentes().then(respond); return true; })`.

`sidepanel/App.tsx`: novo cartão "Agentes agora", abaixo do status: enquanto o painel está aberto,
`chrome.runtime.sendMessage({ type: 'PONTE_AGENTES' })` a cada 2 s (e ao receber `BRIDGE_STATUS`);
lista uma linha por agente: `nome` (ou `clientId`), `modo` (etiqueta), aba (título cortado em 40 +
`#tabId`), última ação (`acao` + ✓/✗ + "há Ns"; erro cortado em 60 no `title`). Vazio → "nenhum
agente conectado". Mostre também "janela da ponte #N". `useEffect` com `clearInterval` no
desmonte. Mesmo estilo dos cartões existentes; sem biblioteca nova.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/index.ts` (só os pontos acima), `entrypoints/sidepanel/App.tsx`.

## Arquivos que você NÃO PODE tocar

`background/index.ts`, `sidepanel/stores/**`, `sidepanel/style.css` (use as classes que existem),
`capacidades/**`, `tools/**`, `hub.js`, `audit/**`, `package.json`, `README.md`, `ESTADO.md`.

## Quem mais está construindo agora

Lote C: a obra 16 (`tools/navegacao.js`, `interacao.js`, `js.js`, `espera.js`, `ponte.js`,
`capacidades/js.ts`). Nenhum arquivo em comum. Trava de build compartilhada.

## Padrão da casa a imitar

- **Painel é diagnóstico, não controle:** `App.tsx:81-83` ("A automação roda pelo agente externo").
  Nada de botão que aja sobre agente (parar, fechar aba) — não foi pedido.
- **Mensagem runtime com `respond` assíncrono e `return true`:** `background/index.ts:365-370`.
- **Estado do agente já exposto por `bridge_tabs`:** `bridge/index.ts:290-322` — o
  `estadoDosAgentes()` é a versão "todos os agentes" daquilo; reaproveite os mesmos campos.

## O que NÃO fazer, e por quê

- **Não remova nem renomeie "Limpar grupos da ponte"**: ADITIVO. Relate a dívida.
- **Não faça polling com o painel fechado**: o `useEffect` só vive enquanto o componente vive.
- **Não chame `chrome.tabs.get` sem `catch`**: aba morta lança e derruba a listagem inteira.
- **Não mostre o token nem a URL inteira de aba do usuário** (o painel fica visível na tela;
  título cortado basta).
- **Defeito irmão:** dois `chrome.runtime.onMessage` (o legado e o da ponte) respondendo à mesma
  mensagem gera "message port closed" — o seu só responde a `PONTE_AGENTES`, e o legado não
  responde a esse tipo (confira o `switch`).

## Armadilhas conhecidas

- O service worker pode estar dormindo quando o painel abre; a primeira `sendMessage` o acorda e
  o estado em memória (`workspaceByClient`) pode estar vazio até a extensão reconectar. Mostre
  "reconectando" quando `extensaoOnline === false`.
- `npx tsc --noEmit` cobre o `App.tsx` (React 19 + TS): nenhum erro novo.

## Critério de pronto

Não há teste automatizado possível pelo cliente MCP (o painel não é aba). Critério:
1. `npm run build` limpo; `npx tsc --noEmit` só com o erro pré-existente.
2. Com a trava: `npm run reload`; rode `node test/isolamento.js` (dois agentes) e, **enquanto
   roda**, o Cezar (ou o capataz, se estiver na máquina) abre o painel: duas linhas aparecem com
   nomes `sessao-A`/`sessao-B`, modo, aba e última ação mudando; ao fim, somem. Isso é **teste
   manual do Cezar** (plano, §7); peça ao capataz para agendar e descreva no relatório exatamente o
   que ele deve ver.
3. `bridge_tabs`/`browser_tabs_list` continua igual (você não o alterou).

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/isolamento.js` (para haver agentes a mostrar).

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-17 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → teste →
`rm .obra-lock`. Nunca reload sem trava. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

Nada do painel atual sai; nada do comportamento de comando muda (`responder` só ganha uma
anotação). Regressão inaceitável: `isolamento.js` vermelho; painel quebrando quando a extensão
está offline.

## Como reportar

Descrição do que o Cezar deve ver (passo a passo); print se conseguir (`chrome-extension://` não
é alcançável pela ponte — diga se não conseguiu); a dívida do botão "Limpar grupos"; notas para o
`ESTADO.md` ("Painel da extensão" deixa de ser só diagnóstico de conexão). Não edite o ESTADO.
