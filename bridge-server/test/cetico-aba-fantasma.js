/**
 * CETICO (06/09/2026) — confirmacao do achado que a bateria de fronteira
 * levantou: `switch_tab` para o id de uma aba que a ponte ABRIU e JA FOI
 * FECHADA solta o modo somente leitura, mesmo devolvendo erro.
 *
 * Mecanismo suspeito (lido na fonte, medido aqui):
 *   - `abasCriadasPelaPonte` so perde id em `encerrar()` e em
 *     `limparAbasOrfas()`. Nao ha listener de `chrome.tabs.onRemoved` que
 *     limpe o conjunto (o unico onRemoved do projeto,
 *     `entrypoints/background/index.ts:430`, so faz detach do depurador).
 *     Logo, id de aba fechada FICA no conjunto para sempre.
 *   - O freio de `switch_tab` (bridge/index.ts) decide pelo conjunto: se o
 *     alvo esta em `abasCriadasPelaPonte`, ele apaga `somenteLeitura` ANTES
 *     de o motor tentar a troca. Se a troca falhar, a leitura ja foi solta.
 *
 * O teste imprime o ERRO CRU de cada sonda para nao inferir nada: distingue
 * "[somente leitura]" (freio intacto) de "[aba trocou]" (o workspace foi
 * parar na aba morta) de "ok" (escrita liberada de verdade).
 *
 * Aba do Dr. Cezar nunca e alvo: as duas abas usadas sao proprias.
 *
 *   node test/cetico-aba-fantasma.js
 */
import { WebSocket } from 'ws';
import { getToken } from '../src/token.js';
import { HOST, PORT } from '../src/hub.js';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

function peer(clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}`);
    const p = new Map();
    let s = 0;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'peer', clientId, name: clientId, token: getToken() })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'welcome') {
        if (!m.extensionOnline) return reject(new Error('sem extensao'));
        resolve({
          cmd: (action, args = {}, t = 60000) => new Promise((res, rej) => {
            const id = `${clientId}:${++s}`;
            const tm = setTimeout(() => { p.delete(id); rej(new Error('timeout ' + action)); }, t);
            p.set(id, (x) => { clearTimeout(tm); res(x); });
            ws.send(JSON.stringify({ type: 'cmd', id, clientId, name: clientId, action, args }));
          }),
          fechar: () => ws.close(),
        });
        return;
      }
      if (m.type === 'result') { const e = p.get(m.id); if (e) { p.delete(m.id); e(m); } }
    });
    ws.on('error', reject);
  });
}

const sonda = startClient('sonda-aba-fantasma');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const alvo = await peer('cetico-fantasma-alvo');
const preso = await peer('cetico-fantasma-preso');

const probe = async (rotulo) => {
  const r = await preso.cmd('scroll', { params: { deltaY: 1 } });
  console.log(`   sonda[${rotulo}] scroll -> ok=${r.ok} | erro=${JSON.stringify((r.error || '').slice(0, 110))}`);
  return r;
};

try {
  const cobaia = (await alvo.cmd('open_tab', { params: { url: 'https://example.com/cobaia-fantasma' } })).result?.newTabId;
  const fantasma = (await alvo.cmd('open_tab', { params: { url: 'https://example.com/fantasma' } })).result?.newTabId;
  await sleep(800);
  console.log('cobaia:', cobaia, '| fantasma (sera fechada):', fantasma);

  const fech = await alvo.cmd('close_tab', { params: { tabId: fantasma } });
  console.log('fechando a fantasma pela propria ponte -> ok=', fech.ok, (fech.error || '').slice(0, 60));
  await sleep(600);

  const ad = await preso.cmd('cap_use_tab', { params: { tabId: cobaia } });
  console.log('adocao em leitura:', ad.ok);
  const p0 = await probe('antes');
  check(p0.ok === false && /somente leitura/i.test(p0.error || ''),
    'montagem: "preso" comeca barrado por [somente leitura]');

  const st = await preso.cmd('switch_tab', { params: { tabId: fantasma } });
  console.log(`switch_tab {tabId: <FANTASMA, ja fechada>} -> ok=${st.ok} | erro=${JSON.stringify((st.error || '').slice(0, 110))}`);

  const p1 = await probe('depois-1');
  const p2 = await probe('depois-2');

  const aindaBarradoPorLeitura = /somente leitura/i.test(p1.error || '') || /somente leitura/i.test(p2.error || '');
  check(aindaBarradoPorLeitura,
    'switch_tab para aba FANTASMA (id que ficou em abasCriadasPelaPonte) NAO solta o modo somente leitura',
    `p1=${JSON.stringify((p1.error || 'ok').slice(0, 70))} p2=${JSON.stringify((p2.error || 'ok').slice(0, 70))}`);

  // Prova complementar do mecanismo: se o id da fantasma ainda esta no
  // conjunto, o freio de close_tab tambem a aceita como "aba minha".
  const ct = await preso.cmd('close_tab', { params: { tabId: fantasma } });
  console.log(`close_tab {tabId: <FANTASMA>} -> ok=${ct.ok} | erro=${JSON.stringify((ct.error || '').slice(0, 110))}`);
  check(/aba do usuario|nao foi aberta pela ponte/i.test(ct.error || ''),
    'o freio de close_tab ja nao reconhece a aba FANTASMA como "aba da ponte" (conjunto limpo)',
    `erro=${JSON.stringify((ct.error || 'ok').slice(0, 80))}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  await preso.cmd('cap_use_own_tab', {}).catch(() => {});
  preso.fechar();
  alvo.fechar();
}
