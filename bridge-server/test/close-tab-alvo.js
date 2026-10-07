/**
 * O freio de `close_tab` era furável (achado por dois auditores, 06/09/2026):
 * ele calculava o alvo como `params.tabId ?? ws.activeTabId` — NUNCA olhava
 * `target.agentId` — enquanto o motor (`execution-engine/index.ts`) aceitava
 * `params.tabId || target.agentId || tabId`. Bastava mandar `close_tab` com
 * `target.agentId` preenchido e SEM `params.tabId`: o freio verificava a aba
 * ATIVA do próprio agente (que é dele, então libera) e o motor fechava OUTRA
 * aba — a de `target.agentId`, nunca checada por ninguém.
 *
 * Conserto: `resolverAlvoDeCloseTab` (execution-engine/index.ts) é a ÚNICA
 * leitura de params/target para essa ação, usada pelos DOIS lados — freio e
 * motor concordam sempre sobre qual aba está em jogo.
 *
 * Este teste fala o protocolo BRUTO do hub (mesmo shape de
 * `bridge-server/src/hub.js`), pulando `bridge-server/src/tools.js` de
 * propósito: nenhuma tool exposta (`browser_tab_close`,
 * `tools/navegacao.js`) monta `target` para `close_tab` — só `params.tabId`.
 * É o único jeito de reproduzir o formato exato do achado.
 *
 *   Caso 1 — o exploit original: target.agentId de uma aba que a ponte NUNCA
 *   abriu (id inventado, nunca existiu — o teste nunca fecha nada de
 *   verdade neste caso, então é seguro rodar em mutação). Tem de ser
 *   RECUSADO, e a MENSAGEM tem de ser a do freio ("nao foi aberta pela
 *   ponte"), não um erro genérico do Chrome — é essa distinção que denuncia
 *   a mutação (ver comentário antes do caso).
 *
 *   Caso 2 — legítimo com target.agentId: duas abas-cobaia PRÓPRIAS (A e B,
 *   B fica ativa). close_tab com target.agentId=A e SEM params.tabId tem de
 *   fechar exatamente A — nunca B. Antes do conserto, B era o que o freio
 *   verificava (por acaso passava, já que também é da ponte), mas nada
 *   garantia que o motor não fechasse a aba errada; hoje os dois lados
 *   concordam no mesmo alvo.
 *
 *   Caso 3 — regressão: close_tab sem target nem params.tabId continua
 *   fechando a aba ativa do agente (comportamento de sempre).
 *
 * Ver docs/obra-20260904 (achado do furo em close_tab, 06/09/2026) e
 * bridge-server/test/aba-sumiu.js (cobre o caminho legítimo por
 * params.tabId, entre agentes diferentes — não repetido aqui).
 *
 *   node test/close-tab-alvo.js
 */
import { WebSocket } from 'ws';
import { getToken } from '../src/token.js';
import { HOST, PORT } from '../src/hub.js';
import { startClient, esperarExtensao } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

/** Peer bruto: fala o protocolo do hub direto, sem passar por tools.js — é o
 * único jeito de montar `args.target` para `close_tab` (nenhuma tool monta). */
function peerBruto(clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}`);
    const pending = new Map();
    let seq = 0;
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'peer', clientId, name: clientId, token: getToken() }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'welcome') {
        if (!msg.extensionOnline) return reject(new Error('extensao nao esta conectada no hub'));
        resolve({
          cmd: (action, args = {}, timeoutMs = 30_000) => new Promise((res, rej) => {
            const id = `${clientId}:${++seq}`;
            const timer = setTimeout(() => { pending.delete(id); rej(new Error(`timeout em ${action}`)); }, timeoutMs);
            pending.set(id, (m) => { clearTimeout(timer); res(m); });
            ws.send(JSON.stringify({ type: 'cmd', id, clientId, name: clientId, action, args }));
          }),
          fechar: () => ws.close(),
        });
        return;
      }
      if (msg.type === 'result') {
        const entry = pending.get(msg.id);
        if (entry) { pending.delete(msg.id); entry(msg); }
      }
    });
    ws.on('error', reject);
  });
}

/** true se a aba ainda existe de verdade no Chrome. Leitura pura via
 * `cap_tabs_all` (lista todas as abas, sem tocar nenhuma) — NAO usa
 * switch_tab: aquela acao MUDA ESTADO (troca a aba ativa do proprio agente
 * e, se o alvo nao for da ponte, adota a aba do usuario em modo somente
 * leitura — ver bridge/index.ts:516-533), bem no meio do mesmo terreno que
 * o furo desta suite testa. Um helper de "so verificar" nao pode ele mesmo
 * mexer no estado que o teste se propoe a proteger. */
async function abaExiste(peer, tabId) {
  const r = await peer.cmd('cap_tabs_all', {});
  return r.ok === true && Array.isArray(r.result) && r.result.some((t) => t.tabId === tabId);
}

// Espera a extensao com o cliente MCP de sempre (retry embutido) antes de
// abrir a conexao crua — assim a mensagem de erro, se a extensao estiver
// fora, e a mesma dos outros testes, nao um timeout cru do WebSocket.
const sonda = startClient('sonda-close-tab-alvo');
try {
  await sonda.handshake();
  if (!(await esperarExtensao(sonda))) throw new Error('extensao nao conectou');
} finally {
  sonda.close();
}

const medidor = await peerBruto('teste-close-tab-alvo');
try {
  // ── Caso 1: target.agentId de aba que a ponte nunca abriu ───────────────
  // Id inventado (a ordem de grandeza real das abas nesta maquina e
  // 2 bilhoes e algo — ver medicoes anteriores; isto nunca colide com uma
  // aba de verdade). O teste NUNCA fecha nada aqui: se o freio recusar
  // (esperado), o motor nem roda; se o freio (mutado) liberar, o motor tenta
  // fechar um id que nao existe e so falha por isso — e exatamente essa
  // diferenca de MOTIVO que a segunda checagem abaixo denuncia.
  const alvoInexistente = 987654321;
  const rAbriu = await medidor.cmd('open_tab', { params: { url: 'about:blank' } });
  check(rAbriu.ok === true, 'abriu aba propria para o medidor ter workspace', rAbriu.error);

  const rExploit = await medidor.cmd('close_tab', { target: { agentId: alvoInexistente } });
  check(rExploit.ok === false,
    'close_tab com target.agentId de aba que a ponte nao abriu, SEM params.tabId -> RECUSADO',
    rExploit.ok ? JSON.stringify(rExploit.result) : rExploit.error);
  // Esta e a checagem que morre com a mutacao: se o freio voltar a olhar so
  // `params.tabId ?? ws.activeTabId`, ele libera (a aba ativa do medidor E
  // dele), o motor tenta fechar `alvoInexistente` e falha com o erro NATIVO
  // do Chrome ("No tab with id..."), no lugar da mensagem do freio.
  check(!rExploit.ok && /nao foi aberta pela ponte/.test(rExploit.error ?? ''),
    'a recusa e do FREIO (cita "nao foi aberta pela ponte"), nao um erro generico do Chrome',
    rExploit.error);

  // ── Caso 2: legitimo — target.agentId aponta pra aba PROPRIA de verdade ─
  const rA = await medidor.cmd('open_tab', { params: { url: 'https://example.com/close-tab-alvo-A' } });
  const tabA = rA.result?.newTabId;
  const rB = await medidor.cmd('open_tab', { params: { url: 'https://example.com/close-tab-alvo-B' } }); // fica ativa
  const tabB = rB.result?.newTabId;
  check(rA.ok === true && rB.ok === true && Boolean(tabA) && Boolean(tabB),
    'abriu as duas abas-cobaia (A e B, B fica ativa)', `A=${tabA} B=${tabB}`);

  const rCloseA = await medidor.cmd('close_tab', { target: { agentId: tabA } }); // SEM params.tabId, B ativa
  check(rCloseA.ok === true, 'close_tab com target.agentId=A (SEM params.tabId, B ativa) -> autorizado', rCloseA.error);

  const existeA = await abaExiste(medidor, tabA);
  const existeB = await abaExiste(medidor, tabB);
  check(existeA === false, 'a aba A (o target.agentId pedido) foi fechada de verdade');
  check(existeB === true,
    'a aba B (so estava ativa, nunca foi o alvo) continua aberta — e a que o furo teria fechado');

  // ── Caso 3: regressao — sem target nem params.tabId fecha a aba ativa ───
  const rC = await medidor.cmd('open_tab', { params: { url: 'https://example.com/close-tab-alvo-C' } }); // fica ativa
  const tabC = rC.result?.newTabId;
  check(rC.ok === true && Boolean(tabC), 'abriu aba-cobaia C (fica ativa)', `C=${tabC}`);

  const rCloseDefault = await medidor.cmd('close_tab', {});
  check(rCloseDefault.ok === true, 'close_tab sem target/params (regressao) -> autorizado', rCloseDefault.error);
  check((await abaExiste(medidor, tabC)) === false, 'a aba ativa (C) foi fechada de verdade — comportamento de sempre');
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  medidor.fechar();
}
