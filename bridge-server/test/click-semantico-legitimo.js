/**
 * Regressao do conserto do FURO 2 (policy.ts regra 4 / execution-engine
 * `case 'click'`, `resolverAlvoDeClique`): clique legitimo por estrategia
 * semantica, SEM spoofing de agentId, continua funcionando — nao pode virar
 * um freio rigido demais que barra tudo que e semantico (isso reprovaria
 * igual, ver criterio de pronto item 5 do briefing).
 *
 * Casos:
 *  1. click{strategy:semantic, text:"Ver detalhes..."} num botao INOFENSIVO
 *     sem agentId nenhum -> passa e clica de verdade.
 *  2. click{strategy:semantic, text:"Protocolar inicial"} no botao
 *     DESTRUTIVO de verdade (sem spoofing) -> e barrado (comportamento
 *     correto, ja existia antes do FURO 2) e com confirm:true passa e clica.
 *  3. click{strategy:agent-id, agentId} no botao inofensivo continua
 *     funcionando normalmente (agent-id puro, sem semantic).
 *
 * Aba-cobaia propria.
 *   node test/click-semantico-legitimo.js
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

const MONTAR = [
  'document.body.innerHTML = "<button id=ino>Ver detalhes do processo</button> <button id=perigo>Protocolar inicial</button>";',
  'window.__clicado = null;',
  'document.getElementById("ino").addEventListener("click", function(){ window.__clicado = "INOFENSIVO"; });',
  'document.getElementById("perigo").addEventListener("click", function(){ window.__clicado = "PERIGOSO"; });',
  '"montado"',
].join('\n');

const sonda = startClient('sonda-click-legitimo');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('click-semantico-legitimo');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(800);
  await m.cmd('cap_js', { params: { codigo: MONTAR } });

  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  const ino = els.find((e) => /Ver detalhes/.test(e.text || ''));
  if (!ino) throw new Error('fixture nao montou');

  // 1. Semantico legitimo, sem agentId nenhum, no botao inofensivo.
  const r1 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Ver detalhes do processo' } });
  await sleep(300);
  const q1 = await m.cmd('cap_js', { params: { codigo: 'window.__clicado' } });
  check(r1.ok === true && q1.result === 'INOFENSIVO',
    'clique semantico legitimo (sem agentId) no botao inofensivo passa e clica',
    `ok=${r1.ok} clicado=${JSON.stringify(q1.result)}`);

  // 2. Semantico legitimo no botao destrutivo, sem confirm -> barrado.
  await m.cmd('cap_js', { params: { codigo: 'window.__clicado = null; "reset"' } });
  const r2 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Protocolar inicial' } });
  check(r2.ok === false && /bloqueado/.test(r2.error || ''),
    'clique semantico legitimo no botao destrutivo, SEM confirm, e barrado',
    (r2.error || '').slice(0, 60));

  // 3. Mesmo alvo, com confirm:true -> passa e clica de verdade (nao pode
  // virar rigido demais: destrutivo real, com confirmacao, tem de ir).
  const r3 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Protocolar inicial' }, confirm: true });
  await sleep(300);
  const q3 = await m.cmd('cap_js', { params: { codigo: 'window.__clicado' } });
  check(r3.ok === true && q3.result === 'PERIGOSO',
    'o MESMO clique destrutivo, com confirm:true, passa e clica de verdade',
    `ok=${r3.ok} clicado=${JSON.stringify(q3.result)}`);

  // 4. agent-id puro no botao inofensivo continua funcionando.
  await m.cmd('cap_js', { params: { codigo: 'window.__clicado = null; "reset"' } });
  const r4 = await m.cmd('click', { target: { strategy: 'agent-id', agentId: ino.agentId } });
  await sleep(300);
  const q4 = await m.cmd('cap_js', { params: { codigo: 'window.__clicado' } });
  check(r4.ok === true && q4.result === 'INOFENSIVO',
    'clique por agent-id puro no botao inofensivo continua funcionando',
    `ok=${r4.ok} clicado=${JSON.stringify(q4.result)}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
