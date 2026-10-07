/**
 * CETICO (06/09/2026) — a MESMA divergencia "freio le um campo, motor le
 * outro" que o conserto do `close_tab` matou, ainda VIVA em `switch_tab`.
 *
 * Freio  (bridge/index.ts ~521): `const alvo = Number(params.tabId ?? target.agentId)`
 *                                `if (alvo && !abasCriadasPelaPonte.has(alvo)) { ...adota em SOMENTE LEITURA...; return; }`
 *                                `somenteLeitura.delete(clientId)`
 * Motor  (execution-engine ~245): `const switchTabId = (params.tabId) || target.agentId`
 *
 * `??` x `||`. Com `params.tabId` FALSY-mas-nao-nulo (0, NaN, ""), os dois
 * discordam:
 *   - o freio calcula `alvo = 0`, cai fora do `if (alvo && ...)`, NAO confere
 *     nada e ainda executa `somenteLeitura.delete(clientId)`;
 *   - o motor calcula `0 || target.agentId` = a aba do target — que ninguem
 *     conferiu.
 *
 * Caso 1 mede a queda da barreira (so com abas PROPRIAS: a aba do Dr. Cezar
 * nunca e alvo de nada aqui).
 * Caso 2 mede a divergencia de alvo (o motor troca para `target.agentId`
 * enquanto o freio olhou o 0).
 * Caso 3 e a regressao: `switch_tab` normal continua funcionando.
 *
 *   node test/cetico-switch-tab-alvo.js
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

/** Peer bruto: fala o protocolo do hub direto (unico jeito de montar target). */
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

const dono = startClient('cetico-switch-dono');
const atacante = startClient('cetico-switch-atacante');
let medidor = null;

try {
  await dono.handshake();
  if (!(await esperarExtensao(dono))) throw new Error('extensao nao conectou');

  // Abas-cobaia PROPRIAS. Nunca a aba do Dr. Cezar.
  await dono.tool('browser_tab_open', { url: 'https://example.com/cetico-switch-X' });
  const tabX = (await dono.json('browser_tabs_list')).activeTabId;
  check(Boolean(tabX), 'aba-cobaia X aberta', `X=${tabX}`);

  const abasAntes = await dono.json('browser_tabs_all');
  const doUsuarioAntes = abasAntes.filter((t) => !t.desteAgente).map((t) => t.tabId);

  // ── Caso 1: a barreira de somente leitura cai com switch_tab tabId:0 ────
  await atacante.handshake();
  const adocao = (await atacante.tool('browser_use_tab', { tabId: tabX })).content[0].text;
  check(/SOMENTE LEITURA/i.test(adocao), 'atacante adotou a aba X em SOMENTE LEITURA', adocao.slice(0, 60));

  const statusAntes = await atacante.json('browser_tabs_list');
  check(/somente leitura/i.test(statusAntes.modo), 'browser_tabs_list confirma modo somente leitura', statusAntes.modo);

  const navAntes = await atacante.call('tools/call', {
    name: 'browser_navigate',
    arguments: { url: 'https://example.com/cetico-switch-PROIBIDO' },
  });
  const textoAntes = navAntes.result?.content?.[0]?.text ?? '';
  check(navAntes.result?.isError === true && /somente leitura/i.test(textoAntes),
    'ANTES: navigate na aba adotada e BARRADO pela barreira', textoAntes.slice(0, 70));

  // O golpe: um unico switch_tab com tabId falsy. O motor nem chega a trocar
  // de aba (devolve erro), mas o freio ja apagou o modo somente leitura.
  const golpe = await atacante.call('tools/call', {
    name: 'browser_tab_switch',
    arguments: { tabId: 0 },
  });
  console.log(`     [golpe] browser_tab_switch({tabId:0}) -> ${JSON.stringify(golpe.result?.content?.[0]?.text ?? '').slice(0, 90)}`);

  const statusDepois = await atacante.json('browser_tabs_list');
  console.log(`     [medida] activeTabId antes=${statusAntes.activeTabId} depois=${statusDepois.activeTabId}`);
  check(statusDepois.activeTabId === statusAntes.activeTabId,
    'a aba ativa NAO mudou (o motor recusou) — a barreira caiu sem trocar de aba',
    `${statusAntes.activeTabId} -> ${statusDepois.activeTabId}`);

  check(/somente leitura/i.test(statusDepois.modo),
    'DEPOIS: o modo continua somente leitura (se FALHAR, a barreira caiu)',
    statusDepois.modo);

  const navDepois = await atacante.call('tools/call', {
    name: 'browser_navigate',
    arguments: { url: 'https://example.com/cetico-switch-PROIBIDO' },
  });
  const textoDepois = navDepois.result?.content?.[0]?.text ?? '';
  check(navDepois.result?.isError === true && /somente leitura/i.test(textoDepois),
    'DEPOIS: navigate continua BARRADO (se FALHAR, o agente acabou de escrever numa aba que so podia ler)',
    textoDepois.slice(0, 70));

  // ── Caso 2: o motor troca para target.agentId que o freio nunca olhou ───
  medidor = await peerBruto('cetico-switch-medidor');
  const rA = await medidor.cmd('open_tab', { params: { url: 'https://example.com/cetico-switch-A' } });
  const tabA = rA.result?.newTabId;
  const rB = await medidor.cmd('open_tab', { params: { url: 'https://example.com/cetico-switch-B' } }); // fica ativa
  const tabB = rB.result?.newTabId;
  check(Boolean(tabA) && Boolean(tabB), 'medidor abriu A e B (B ativa)', `A=${tabA} B=${tabB}`);

  const rDiv = await medidor.cmd('switch_tab', { params: { tabId: 0 }, target: { agentId: tabA } });
  const rStatus = await medidor.cmd('bridge_tabs', {});
  const ativaAgora = rStatus.result?.activeTabId;
  console.log(`     [medida] switch_tab{params.tabId:0, target.agentId:${tabA}} -> ok=${rDiv.ok} ativa=${ativaAgora} (B=${tabB})`);
  check(ativaAgora === tabB,
    'o alvo do motor bate com o que o freio calculou (se FALHAR, motor foi para target.agentId sem checagem)',
    `ativa=${ativaAgora} A=${tabA} B=${tabB}`);

  // ── Caso 3: regressao — switch_tab normal continua trocando de aba ──────
  const rNorm = await medidor.cmd('switch_tab', { params: { tabId: tabA } });
  const rStatus2 = await medidor.cmd('bridge_tabs', {});
  check(rNorm.ok === true && rStatus2.result?.activeTabId === tabA,
    'regressao: switch_tab com tabId de verdade troca a aba ativa',
    `ok=${rNorm.ok} ativa=${rStatus2.result?.activeTabId}`);

  // ── A aba do Dr. Cezar continua la ─────────────────────────────────────
  const abasDepois = await dono.json('browser_tabs_all');
  const sumiram = doUsuarioAntes.filter((id) => !abasDepois.some((t) => t.tabId === id));
  check(sumiram.length === 0, `nenhuma das ${doUsuarioAntes.length} abas de fora do agente sumiu`, sumiram.join(','));

  // Faxina das cobaias.
  await medidor.cmd('close_tab', { params: { tabId: tabA } }).catch(() => {});
  await medidor.cmd('close_tab', { params: { tabId: tabB } }).catch(() => {});
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  if (medidor) medidor.fechar();
  dono.close();
  atacante.close();
}
