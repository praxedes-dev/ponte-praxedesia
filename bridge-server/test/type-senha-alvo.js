/**
 * FURO 3, achado na varredura da familia pedida no briefing dos furos 1/2
 * (06/09/2026): a regra 1 de `policy.ts` ("nunca digitar em campo de senha")
 * so examinava o elemento quando `action.target?.agentId !== undefined`. Um
 * `type` puramente semantico (so placeholder/role/text, sem agentId nenhum)
 * pulava a checagem INTEIRA — nao "olhava o elemento errado" como nos furos
 * 1 e 2, simplesmente nunca examinava nada — e o texto ia direto para o
 * campo de senha.
 *
 * Medido ao vivo ANTES do conserto (script ad hoc, apagado): `type
 * {target:{strategy:'semantic', placeholder:'Senha de acesso'}}` preencheu
 * de verdade `document.getElementById('senha').value` com o texto, ok:true,
 * sem erro nenhum.
 *
 * Conserto: `policy.ts` agora resolve o alvo com a MESMA regra do motor
 * (agentId cru so em strategy==='agent-id'; fora disso, `resolveTarget` — a
 * mesma funcao que o motor chama) e olha o `type`/tag do elemento que essa
 * funcao aponta, via `document.elementFromPoint` no ponto exato.
 *
 * Casos:
 *  1. type semantico (SEM agentId) em campo password -> BARRADO.
 *  2. type semantico (SEM agentId) em campo normal -> passa e digita (nao
 *     pode virar rigido demais).
 *  3. type por agent-id cru em campo password -> continua BARRADO
 *     (regressao do comportamento que ja existia).
 *  4. type por agent-id cru em campo normal -> continua funcionando.
 *
 * Aba-cobaia propria.
 *   node test/type-senha-alvo.js
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

const lerValor = (id) => `document.getElementById('${id}').value`;

const sonda = startClient('sonda-type-senha');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('type-senha-alvo');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(800);
  const mont = await m.cmd('cap_js', { params: { codigo: MONTAR } });
  console.log('montagem:', JSON.stringify(mont.result), mont.error ?? '');

  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  const senha = els.find((e) => /Senha de acesso/.test(e.text || '') || e.role === 'textbox');
  const normalPorAgentId = els.find((e) => /Nome completo/.test(e.text || ''));
  console.log('elementos:', els.map((e) => `${e.agentId}:${e.text}`).join(' | '));

  // ── Caso 1: semantico SEM agentId em campo password -> BARRADO ─────────
  const r1 = await m.cmd('type', {
    target: { strategy: 'semantic', placeholder: 'Senha de acesso' },
    params: { text: 'segredo123', clear: true },
  });
  const v1 = (await m.cmd('cap_js', { params: { codigo: lerValor('senha') } })).result;
  console.log('[caso 1] type semantico sem agentId em senha -> ok=', r1.ok, '| valor real=', JSON.stringify(v1));
  check(r1.ok === false && /senha/i.test(r1.error || ''),
    'caso 1: type semantico (sem agentId) em campo password e BARRADO',
    (r1.error || '').slice(0, 80));
  check(!v1, 'caso 1: o campo de senha continua VAZIO (nada foi digitado)', `valor=${JSON.stringify(v1)}`);

  // ── Caso 2: semantico SEM agentId em campo normal -> passa ──────────────
  const r2 = await m.cmd('type', {
    target: { strategy: 'semantic', placeholder: 'Nome completo' },
    params: { text: 'Fulano de Tal', clear: true },
  });
  const v2 = (await m.cmd('cap_js', { params: { codigo: lerValor('normal') } })).result;
  console.log('[caso 2] type semantico sem agentId em campo normal -> ok=', r2.ok, '| valor=', JSON.stringify(v2));
  check(r2.ok === true && v2 === 'Fulano de Tal',
    'caso 2: type semantico (sem agentId) em campo NORMAL continua funcionando (sem falso positivo)',
    `ok=${r2.ok} valor=${JSON.stringify(v2)}`);

  // ── Caso 3: agent-id cru em campo password -> continua BARRADO ──────────
  if (senha) {
    const r3 = await m.cmd('type', {
      target: { strategy: 'agent-id', agentId: senha.agentId },
      params: { text: 'outrosegredo', clear: true },
    });
    const v3 = (await m.cmd('cap_js', { params: { codigo: lerValor('senha') } })).result;
    check(r3.ok === false && /senha/i.test(r3.error || ''),
      'caso 3 (regressao): type por agent-id cru em campo password continua BARRADO',
      (r3.error || '').slice(0, 80));
    check(!v3, 'caso 3: o campo de senha continua VAZIO', `valor=${JSON.stringify(v3)}`);
  } else {
    check(false, 'caso 3: nao achei o agentId do campo de senha via read_page (fixture/ax-tree)');
  }

  // ── Caso 4: agent-id cru em campo normal -> continua funcionando ────────
  if (normalPorAgentId) {
    await m.cmd('cap_js', { params: { codigo: "document.getElementById('normal').value=''; \"reset\"" } });
    const r4 = await m.cmd('type', {
      target: { strategy: 'agent-id', agentId: normalPorAgentId.agentId },
      params: { text: 'Ciclano', clear: true },
    });
    const v4 = (await m.cmd('cap_js', { params: { codigo: lerValor('normal') } })).result;
    check(r4.ok === true && v4 === 'Ciclano',
      'caso 4 (regressao): type por agent-id cru em campo normal continua funcionando',
      `ok=${r4.ok} valor=${JSON.stringify(v4)}`);
  } else {
    check(false, 'caso 4: nao achei o agentId do campo normal via read_page (fixture/ax-tree)');
  }
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
