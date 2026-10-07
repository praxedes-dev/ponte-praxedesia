/**
 * FURO 6, parte 2 (06/09/2026) — "confira de passagem" do briefing: alem de
 * `type` sem target, `press_key` de um CARACTERE isolado tambem escreve no
 * `document.activeElement` (`execution-engine/index.ts`, case 'press_key',
 * nunca olha `target`; `cdp-tools.ts`, `cdpPressKey`, variavel `imprimivel`
 * manda o caractere como `text` no evento quando nao ha modificador de
 * comando). `browser_press_key` (`bridge-server/src/tools/interacao.js`)
 * NUNCA manda target — e a UNICA porta de entrada real desta acao — entao
 * antes deste conserto a regra 1 (senha) simplesmente nao existia para
 * `press_key`.
 *
 * Casos:
 *  1. press_key{key:'a'} com o campo de senha focado -> BARRADO, campo
 *     continua vazio.
 *  2. press_key{key:'a'} com um campo NORMAL focado -> passa e escreve (sem
 *     falso positivo).
 *  3. press_key{key:'Enter'} com o campo de senha focado -> NAO e barrado
 *     por esta regra (tecla de controle, nao escreve caractere nenhum) —
 *     controle de falso positivo: esta defesa e so sobre insercao de texto.
 *  4. press_key{key:'a', modifiers:['Control']} com o campo de senha focado
 *     -> NAO e barrado por esta regra (atalho de edicao, o Chrome NAO insere
 *     "a" no campo com Control pressionado).
 *
 * Aba-cobaia propria.
 *   node test/press-key-senha-alvo.js
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
  'document.body.innerHTML = "<input id=senha type=password placeholder=\\"Senha de acesso\\">'
    + ' <input id=normal placeholder=\\"Nome completo\\">";',
  '"montado"',
].join('\n');

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => r.result);
const valor = (m, id) => js(m, `document.getElementById('${id}').value`);
const focar = (m, id) => js(m, `document.getElementById('${id}').focus(); document.activeElement && document.activeElement.id`);
const limpar = (m, id) => js(m, `document.getElementById('${id}').value=''; "reset"`);

const sonda = startClient('sonda-press-key-senha');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('press-key-senha-alvo');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(800);
  const mont = await js(m, MONTAR);
  console.log('montagem:', JSON.stringify(mont));

  // ── Caso 1: caractere isolado, senha focada -> BARRADO ──────────────────
  await limpar(m, 'senha');
  const foco1 = await focar(m, 'senha');
  const r1 = await m.cmd('press_key', { params: { key: 'a' } });
  const v1 = await valor(m, 'senha');
  console.log(`[caso 1] press_key 'a' com senha focada (${foco1}) -> ok=${r1.ok} | erro=${(r1.error || '').slice(0, 80)}`);
  check(r1.ok === false && /senha/i.test(r1.error || ''),
    'caso 1: press_key de caractere isolado com senha focada e BARRADO',
    (r1.error || '').slice(0, 80));
  check(!v1, 'caso 1: o campo de senha continua VAZIO (nada foi digitado)', `valor=${JSON.stringify(v1)}`);

  // ── Caso 2: caractere isolado, campo normal focado -> passa ─────────────
  await limpar(m, 'normal');
  await focar(m, 'normal');
  const r2 = await m.cmd('press_key', { params: { key: 'a' } });
  const v2 = await valor(m, 'normal');
  console.log(`[caso 2] press_key 'a' com campo normal focado -> ok=${r2.ok} | valor=${JSON.stringify(v2)}`);
  check(r2.ok === true && v2 === 'a',
    'caso 2 (falso positivo): press_key de caractere isolado em campo NORMAL continua funcionando',
    `ok=${r2.ok} valor=${JSON.stringify(v2)}`);

  // ── Caso 3: tecla de controle (Enter), senha focada -> nao e esta regra ─
  await limpar(m, 'senha');
  await focar(m, 'senha');
  const r3 = await m.cmd('press_key', { params: { key: 'Enter' } });
  const v3 = await valor(m, 'senha');
  console.log(`[caso 3] press_key 'Enter' com senha focada -> ok=${r3.ok} | erro=${(r3.error || '').slice(0, 80)}`);
  check(r3.ok === true, 'caso 3 (falso positivo): tecla de controle nao e barrada por esta regra', `ok=${r3.ok}`);
  check(!v3, 'caso 3: Enter nao insere caractere nenhum no campo', `valor=${JSON.stringify(v3)}`);

  // ── Caso 4: Ctrl+A, senha focada -> nao e esta regra (atalho, nao texto) ─
  await limpar(m, 'senha');
  await focar(m, 'senha');
  const r4 = await m.cmd('press_key', { params: { key: 'a', modifiers: ['Control'] } });
  const v4 = await valor(m, 'senha');
  console.log(`[caso 4] press_key 'a'+Control com senha focada -> ok=${r4.ok} | erro=${(r4.error || '').slice(0, 80)}`);
  check(r4.ok === true, 'caso 4 (falso positivo): Ctrl+A e atalho, nao insercao de texto, nao e barrado', `ok=${r4.ok}`);
  check(!v4, 'caso 4: Ctrl+A nao insere "a" no campo', `valor=${JSON.stringify(v4)}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
