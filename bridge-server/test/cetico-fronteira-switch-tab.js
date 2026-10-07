/**
 * CETICO (06/09/2026) — bateria de VALORES DE FRONTEIRA contra o conserto do
 * FURO 1 (`resolverAlvoDeSwitchTab`), que e o unico furo da familia que
 * DESARMAVA o modo somente leitura por tool normal.
 *
 * Montagem: o cliente `alvo` abre uma aba-cobaia PROPRIA (nunca a do Dr.
 * Cezar); o cliente `preso` adota essa cobaia com `cap_use_tab` sem
 * `permitir_acao`, ficando em modo SOMENTE LEITURA. Depois de cada tentativa
 * de `switch_tab` com valor torto, o teste mede se `preso` continua preso —
 * a sonda e um `scroll` (acao que ALTERA e por isso tem de voltar
 * "[somente leitura]").
 *
 * A aba do Dr. Cezar NAO entra em nenhum payload: a regra de ferro 5 proibe
 * aponta-la como alvo de qualquer coisa, e `switch_tab` para uma aba que nao
 * e da ponte ANEXA o depurador nela (adocao em leitura). O que essa variante
 * provaria — "aba que nao e da ponte cai na adocao em leitura" — ja e medido
 * aqui pelo caso da aba INEXISTENTE, que percorre o mesmo ramo do freio.
 *
 * ⚠️ JSON nao transporta NaN nem Infinity: `JSON.stringify({tabId: NaN})`
 * vira `{"tabId":null}`. Os casos marcados (json->null) chegam na extensao
 * como `null` — o rotulo diz o que de fato foi enviado, nao a intencao.
 *
 *   node test/cetico-fronteira-switch-tab.js
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

/** Sonda: `scroll` altera a pagina, entao em modo leitura tem de voltar barrado. */
async function presoAindaEmLeitura(cliente) {
  const r = await cliente.cmd('scroll', { params: { deltaY: 1 } });
  return r.ok === false && /somente leitura/i.test(r.error || '');
}

const sonda = startClient('sonda-fronteira-switch');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const alvo = await peer('cetico-fronteira-alvo');
const preso = await peer('cetico-fronteira-preso');

try {
  const abriu = await alvo.cmd('open_tab', { params: { url: 'https://example.com/cobaia-fronteira' } });
  const cobaia = abriu.result?.newTabId;
  console.log('cobaia (aba PROPRIA do cliente "alvo"):', cobaia);
  if (!cobaia) throw new Error('nao consegui abrir a cobaia');
  await sleep(700);

  // Uma aba da ponte que existiu e ja morreu: exercita o ramo "alvo nao e
  // aba da ponte / aba sumiu" sem tocar em nada do Dr. Cezar.
  const efemera = (await alvo.cmd('open_tab', { params: { url: 'https://example.com/efemera' } })).result?.newTabId;
  await sleep(500);
  await alvo.cmd('close_tab', { params: { tabId: efemera } });
  await sleep(400);
  console.log('aba efemera (aberta e fechada, id agora invalido):', efemera);

  const adotou = await preso.cmd('cap_use_tab', { params: { tabId: cobaia } });
  console.log('adocao em leitura:', adotou.ok, JSON.stringify(adotou.result ?? adotou.error).slice(0, 120));
  check(await presoAindaEmLeitura(preso), 'montagem: o cliente "preso" comeca em modo SOMENTE LEITURA');

  const CASOS = [
    ['tabId: 0', { params: { tabId: 0 } }],
    ['tabId: -1', { params: { tabId: -1 } }],
    ['tabId: NaN (json->null)', { params: { tabId: NaN } }],
    ['tabId: "0"', { params: { tabId: '0' } }],
    ['tabId: ""', { params: { tabId: '' } }],
    ['tabId: null', { params: { tabId: null } }],
    ['tabId: Infinity (json->null)', { params: { tabId: Infinity } }],
    ['tabId: 2.5', { params: { tabId: 2.5 } }],
    ['tabId: 1e21 (gigante)', { params: { tabId: 1e21 } }],
    ['tabId: true', { params: { tabId: true } }],
    ['tabId: []', { params: { tabId: [] } }],
    ['tabId: {}', { params: { tabId: {} } }],
    ['tabId: "abc"', { params: { tabId: 'abc' } }],
    ['sem params e sem target', {}],
    ['params vazio + target vazio', { params: {}, target: {} }],
    ['target.agentId: 0', { target: { agentId: 0 } }],
    ['target.agentId: -1', { target: { agentId: -1 } }],
    ['target.agentId: "0"', { target: { agentId: '0' } }],
    ['target.agentId: null', { target: { agentId: null } }],
    ['aba EFEMERA (ja fechada, id invalido)', { params: { tabId: efemera } }],
    // O combo que abriu o FURO 1: params.tabId falsy + target.agentId util.
    ['COMBO params.tabId:0 + target.agentId:<cobaia>', { params: { tabId: 0 }, target: { agentId: cobaia } }],
    ['COMBO params.tabId:"" + target.agentId:<cobaia>', { params: { tabId: '' }, target: { agentId: cobaia } }],
    ['COMBO params.tabId:null + target.agentId:<cobaia>', { params: { tabId: null }, target: { agentId: cobaia } }],
  ];

  for (const [rotulo, args] of CASOS) {
    const r = await preso.cmd('switch_tab', args);
    const aindaPreso = await presoAindaEmLeitura(preso);
    console.log(`  switch_tab ${rotulo} -> ok=${r.ok} | ${(r.error || '').slice(0, 70)}`);
    check(aindaPreso, `fronteira: ${rotulo} NAO desarma o modo somente leitura`, `ok=${r.ok}`);
  }

  console.log('\n---- caso honesto: alvo e aba DA PONTE e ao mesmo tempo ADOTADA em leitura ----');
  const legit = await preso.cmd('switch_tab', { params: { tabId: cobaia } });
  const depois = await presoAindaEmLeitura(preso);
  console.log(`  switch_tab {tabId: <cobaia, aba da ponte E adotada>} -> ok=${legit.ok} | ainda em leitura? ${depois}`);
  check(true, `(medicao, nao veredito) leitura apos switch_tab para a propria cobaia adotada: ${depois ? 'MANTIDA' : 'DESARMADA'}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  await preso.cmd('cap_use_own_tab', {}).catch(() => {});
  preso.fechar();
  alvo.fechar();
}
