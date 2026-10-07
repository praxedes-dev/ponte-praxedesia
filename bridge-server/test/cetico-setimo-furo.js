/**
 * SETIMO FURO da familia "o freio confere uma coisa e o motor faz outra" —
 * sonda AO VIVO, escrita em 06/09/2026 pelo cetico da rodada final.
 *
 * NAO FOI POSSIVEL RODAR NO DIA: a extensao da ponte estava offline
 * (`extensionOnline:false`) desde ~03:30 e nao reconecta sozinha — precisa de
 * "Recarregar" no chrome://extensions. Os quatro casos abaixo foram medidos
 * na bancada sem Chrome (`cetico-bancada-freio-motor.mjs`, que roda o codigo
 * REAL de policy.ts/execution-engine contra um DOM linkedom). Este arquivo e
 * a mesma medicao contra o Chrome de verdade — rode assim que a extensao
 * voltar.
 *
 * O que ele mede (tudo hoje ESPERADO FALHAR = furo aberto):
 *
 *  7-A  `type` com alvo semantico que NAO RESOLVE. `browser_type({text:'X'})`
 *       sem `ref` monta `target:{strategy:'semantic', text:'X'}` — o MESMO
 *       campo `text` serve de "texto a digitar" e de "texto do elemento"
 *       (`bridge-server/src/tools/_comum.js`, buildTarget + interacao.js). Se
 *       nenhum elemento da pagina tem esse texto, `resolveTarget` devolve
 *       null; o freio (`tipoNoAlvoSemantico`) devolve `undefined` e LIBERA,
 *       enquanto o motor, no MESMO caso, nao clica em nada e chama
 *       `cdpType(..., undefined)`, que digita no `document.activeElement`.
 *       Ou seja: o caminho que o FURO 6 fechou (`type` sem target) e o
 *       caminho RARO; este, que continua aberto, e o caminho NORMAL de todo
 *       `browser_type` sem ref.
 *
 *  7-B  `type` DESPACHA CLIQUE REAL no alvo antes de digitar
 *       (`cdpClickByRef` no ramo agent-id, `cdpClick(coords)` no semantico) —
 *       e a regra 4 (clique destrutivo) so roda para `action.type === 'click'`.
 *       `browser_type({text:'Protocolar inicial'})` clica no botao
 *       "Protocolar inicial" sem passar pelo freio de clique.
 *
 *  7-C  `type` por ref de um WRAPPER: o freio SOBE ate o ancestral clicavel
 *       (`descreverElementoPorObjectId`) e ve "label"/"td"/"div"; o
 *       `cdpType` DESCE (`findRealInput` -> `querySelector('input,...')`) e
 *       escreve no `<input type=password>` de dentro.
 *
 *  7-D  `cap_autocomplete` digita (`digitarTeclaATecla`, o mesmo digitador do
 *       FURO 5) ANTES de qualquer `avaliar()` — o freio dele so cobre o
 *       clique na sugestao. `browser_autocomplete({ref:<senha>})` preenche
 *       credencial sem bloqueio nenhum.
 *
 * Aba-cobaia propria. Nunca a aba do Dr. Cezar.
 *   node test/cetico-setimo-furo.js
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
  'window.__cliques = 0;',
  'document.body.innerHTML = "'
    + '<label id=rotulo for=senha>Senha <input id=senha type=password placeholder=\\"Senha de acesso\\"></label>'
    + ' <input id=nome placeholder=\\"Nome completo\\">'
    + ' <button id=protocolar>Protocolar inicial</button>'
    + '";',
  'document.getElementById("protocolar").addEventListener("click", function(){ window.__cliques++; });',
  '"montado"',
].join('\n');

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => r.result);
const valor = (m, id) => js(m, `document.getElementById('${id}').value`);
const zerar = (m) => js(m, "document.getElementById('senha').value=''; document.getElementById('nome').value=''; window.__cliques=0; 'reset'");

const sonda = startClient('sonda-setimo-furo');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('cetico-setimo-furo');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(800);
  console.log('montagem:', JSON.stringify(await js(m, MONTAR)));

  // ── 7-A ────────────────────────────────────────────────────────────────
  await zerar(m);
  await js(m, "document.getElementById('senha').focus(); 'focado'");
  const r1 = await m.cmd('type', {
    target: { strategy: 'semantic', text: 'segredo123' },
    params: { text: 'segredo123' },
  });
  const v1 = await valor(m, 'senha');
  console.log(`[7-A] ok=${r1.ok} erro=${(r1.error || '').slice(0, 60)} | senha=${JSON.stringify(v1)}`);
  check(r1.ok === false || !v1,
    '7-A: browser_type sem ref (alvo semantico nao resolvido) NAO pode escrever no campo de senha focado',
    `ok=${r1.ok} valor=${JSON.stringify(v1)}`);

  // ── 7-B ────────────────────────────────────────────────────────────────
  await zerar(m);
  const r2 = await m.cmd('type', {
    target: { strategy: 'semantic', text: 'Protocolar inicial' },
    params: { text: 'Protocolar inicial' },
  });
  const cliques = await js(m, 'window.__cliques');
  console.log(`[7-B] ok=${r2.ok} | cliques no "Protocolar inicial"=${cliques}`);
  check(Number(cliques) === 0,
    '7-B: `type` NAO pode disparar clique real em botao destrutivo sem passar pela regra 4',
    `cliques=${cliques}`);

  const r2b = await m.cmd('click', { target: { strategy: 'semantic', text: 'Protocolar inicial' } });
  check(r2b.ok === false && /irreversivel|protocolar/i.test(r2b.error || ''),
    '7-B (contraprova): o MESMO alvo, como `click`, continua BARRADO pela regra 4',
    (r2b.error || '').slice(0, 70));

  // ── 7-C (best effort: depende de o read_page expor uma ref do wrapper) ──
  await zerar(m);
  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  const wrapper = els.find((e) => /senha/i.test(e.text || '') && !/textbox|input/i.test(e.role || ''));
  if (wrapper) {
    const r3 = await m.cmd('type', {
      target: { strategy: 'agent-id', agentId: wrapper.agentId },
      params: { text: 'outrosegredo' },
    });
    const v3 = await valor(m, 'senha');
    console.log(`[7-C] ref=${wrapper.agentId} (${wrapper.role}) ok=${r3.ok} | senha=${JSON.stringify(v3)}`);
    check(r3.ok === false || !v3,
      '7-C: ref de WRAPPER (<label>) nao pode escrever no <input type=password> de dentro',
      `ok=${r3.ok} valor=${JSON.stringify(v3)}`);
  } else {
    console.log('[7-C] pulado: read_page nao expos ref de wrapper nesta fixture '
      + `(elementos: ${els.map((e) => `${e.agentId}:${e.role}:${e.text}`).join(' | ')})`);
  }

  // ── 7-D ────────────────────────────────────────────────────────────────
  await zerar(m);
  const senhaEl = els.find((e) => /Senha de acesso/i.test(e.text || '') || /Senha de acesso/i.test(e.placeholder || ''));
  if (senhaEl) {
    const r4 = await m.cmd('cap_autocomplete', {
      target: { strategy: 'agent-id', agentId: senhaEl.agentId },
      params: { ref: senhaEl.agentId, texto: 'segredo', escolher: 'segredo', timeout_ms: 1500, delay_ms: 10 },
    }, 30000);
    const v4 = await valor(m, 'senha');
    console.log(`[7-D] ok=${r4.ok} erro=${(r4.error || '').slice(0, 70)} | senha=${JSON.stringify(v4)}`);
    check(!v4 && /bloqueado|senha/i.test(r4.error || ''),
      '7-D: cap_autocomplete (browser_autocomplete) nao pode digitar em campo de senha sem passar pelo freio',
      `valor=${JSON.stringify(v4)} erro=${(r4.error || '').slice(0, 60)}`);
  } else {
    check(false, '7-D: nao achei a ref do campo de senha no read_page');
  }

  // ── sem falso positivo ─────────────────────────────────────────────────
  await zerar(m);
  const r5 = await m.cmd('type', {
    target: { strategy: 'semantic', placeholder: 'Nome completo' },
    params: { text: 'Fulano de Tal', clear: true },
  });
  const v5 = await valor(m, 'nome');
  check(r5.ok === true && v5 === 'Fulano de Tal',
    'sem falso positivo: digitar em campo normal por busca semantica continua funcionando',
    `ok=${r5.ok} valor=${JSON.stringify(v5)}`);

  await zerar(m);
  await js(m, "document.getElementById('nome').focus(); 'focado'");
  const r6 = await m.cmd('type', { target: { strategy: 'semantic', text: 'texto qualquer' }, params: { text: 'texto qualquer' } });
  const v6 = await valor(m, 'nome');
  check(r6.ok === true && v6 === 'texto qualquer',
    'sem falso positivo: digitar no campo NORMAL ja focado (mesmo caminho do 7-A) continua funcionando',
    `ok=${r6.ok} valor=${JSON.stringify(v6)}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
