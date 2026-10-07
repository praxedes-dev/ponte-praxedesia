/**
 * CETICO (06/09/2026) — a MESMA divergencia "freio le um campo, motor le
 * outro" do `close_tab`, agora no FREIO DE CLIQUE DESTRUTIVO (bridge/policy.ts
 * `avaliar`, regra 4) x `execution-engine` `case 'click'`.
 *
 * Freio: `if (action.target?.agentId !== undefined)` -> descreve o elemento de
 *        agentId e casa o TEXTO DELE contra TEXTOS_DESTRUTIVOS; senao usa
 *        `action.target?.text`.
 * Motor: so usa agentId quando `strategy === 'agent-id'`; senao resolve por
 *        busca semantica (`resolveTarget`), e ainda tem um "rescue" que le
 *        `action.params.text` quando o target semantico vem vazio.
 *
 * Duas formas de fazer o freio olhar um elemento e o motor clicar em outro:
 *   golpe 1: target { strategy:'semantic', agentId: <ref inofensivo>, text:'Protocolar inicial' }
 *   golpe 2: target { strategy:'semantic' } + params { text:'Protocolar inicial' }
 *
 * Fixture montada por injecao de DOM em pagina real (data: nao carrega nesta
 * bancada). Abas-cobaia proprias; a aba do Dr. Cezar nunca e alvo.
 *
 *   node test/cetico-click-alvo.js
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

const sonda = startClient('sonda-click-alvo');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('cetico-click-alvo');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(800);
  const mont = await m.cmd('cap_js', { params: { codigo: MONTAR } });
  console.log('montagem:', JSON.stringify(mont.result), mont.error ?? '');

  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  console.log('elementos:', els.map((e) => `${e.agentId}:${e.text}`).join(' | '));
  const ino = els.find((e) => /Ver detalhes/.test(e.text || ''));
  const perigo = els.find((e) => /Protocolar/.test(e.text || ''));
  if (!ino || !perigo) throw new Error('fixture nao montou');

  const r1 = await m.cmd('click', { target: { strategy: 'agent-id', agentId: perigo.agentId } });
  console.log('[baseline] click por ref no "Protocolar inicial" -> ok=', r1.ok, '|', (r1.error || '').slice(0, 90));

  await m.cmd('cap_js', { params: { codigo: 'window.__clicado = null; "reset"' } });

  const r2 = await m.cmd('click', { target: { strategy: 'semantic', agentId: ino.agentId, text: 'Protocolar inicial' } });
  console.log('[golpe] click{strategy:semantic, agentId:INOFENSIVO, text:"Protocolar inicial"} -> ok=', r2.ok, '|', (r2.error || '').slice(0, 90));
  await sleep(500);
  const q = await m.cmd('cap_js', { params: { codigo: 'window.__clicado' } });
  console.log('>>> QUEM FOI CLICADO DE VERDADE:', JSON.stringify(q.result));

  // Variante 2: o "rescue" do motor le params.text; o freio le target.text (vazio).
  await m.cmd('cap_js', { params: { codigo: 'window.__clicado = null; "reset"' } });
  const r3 = await m.cmd('click', { target: { strategy: 'semantic' }, params: { text: 'Protocolar inicial' } });
  console.log('[golpe 2] click{target:{strategy:semantic}, params.text:"Protocolar inicial"} -> ok=', r3.ok, '|', (r3.error || '').slice(0, 90));
  await sleep(500);
  const q3 = await m.cmd('cap_js', { params: { codigo: 'window.__clicado' } });
  console.log('>>> QUEM FOI CLICADO DE VERDADE (2):', JSON.stringify(q3.result));
  check(r2.ok === false || q.result !== 'PERIGOSO',
    'golpe 1: o motor clicou no MESMO elemento que o freio conferiu',
    `ok=${r2.ok} clicado=${JSON.stringify(q.result)}`);
  check(r3.ok === false || q3.result !== 'PERIGOSO',
    'golpe 2 (rescue por params.text): o motor clicou no que o freio conferiu',
    `ok=${r3.ok} clicado=${JSON.stringify(q3.result)}`);
  check(r1.ok === false && /bloqueado/.test(r1.error || ''),
    'baseline: clique por ref no botao destrutivo continua BARRADO', (r1.error||'').slice(0,60));
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
