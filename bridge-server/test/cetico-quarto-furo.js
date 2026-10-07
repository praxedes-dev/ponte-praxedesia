/**
 * CETICO (06/09/2026) — caca ao QUARTO caso da familia "o freio confere uma
 * coisa e o motor faz outra", depois dos consertos de close_tab, switch_tab,
 * click (regra 4) e type-em-senha (regra 1).
 *
 * Hipoteses medidas aqui (todas levantadas por leitura da fonte ANTES de rodar):
 *
 *  H1 — regra 4 (clique destrutivo), caminho SEMANTICO: o freio le
 *       `alvo.target.text` (a STRING DE BUSCA que o agente mandou) e nunca o
 *       ELEMENTO que `resolveTarget` vai achar. Como `resolveTarget` casa por
 *       `includes` em innerText/placeholder/aria-label, basta buscar por
 *       `ariaLabel` (que o freio nem le) ou por um PEDACO do texto que nao
 *       contenha palavra destrutiva.
 *
 *  H2 — `cap_digitar` (browser_type modo:"teclado") nao chama `avaliar()`.
 *       O dispatch de bridge/index.ts so chama o freio no ramo do MOTOR; toda
 *       capacidade `cap_*` tem de chamar sozinha (e `cap_form_input`, no MESMO
 *       arquivo, chama, com comentario explicando por que). Se `cap_digitar`
 *       nao chama, a regra 1 (senha) e a regra 3 (site financeiro) nao existem
 *       nesse caminho.
 *
 *  H3 — `type` SEM `target`: a regra 1 e `if (action.type === 'type' &&
 *       action.target)`. Sem target ela nao roda; o motor, sem target, chama
 *       `cdpType(..., undefined)`, que digita no `document.activeElement`.
 *
 * Controles de FALSO POSITIVO no fim: clique semantico legitimo, digitacao
 * legitima por teclado e clique por ref/texto destrutivo continuam se
 * comportando como devem.
 *
 * Abas-cobaia proprias; a aba do Dr. Cezar nunca e alvo de nada.
 *
 *   node test/cetico-quarto-furo.js
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
          cmd: (action, args = {}, t = 90000) => new Promise((res, rej) => {
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
  'var html = "";',
  'html += "<button id=ino>Ver detalhes do processo</button> ";',
  'html += "<button id=aria aria-label=\'Excluir conta definitivamente\'>Opcoes avancadas</button> ";',
  'html += "<button id=sub>Excluir conta do usuario</button> ";',
  'html += "<input id=senha type=password placeholder=\'Senha de acesso\'> ";',
  'html += "<input id=normal placeholder=\'Nome completo\'>";',
  'document.body.innerHTML = html;',
  'window.__clicado = null;',
  'document.getElementById("ino").addEventListener("click", function(){ window.__clicado = "INOFENSIVO"; });',
  'document.getElementById("aria").addEventListener("click", function(){ window.__clicado = "PERIGO_ARIA"; });',
  'document.getElementById("sub").addEventListener("click", function(){ window.__clicado = "PERIGO_SUB"; });',
  '"montado"',
].join('\n');

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => r.result);
const valor = (m, id) => js(m, `document.getElementById('${id}').value`);
const clicado = (m) => js(m, 'window.__clicado');
const reset = (m) => js(m, 'window.__clicado = null; "reset"');

const sonda = startClient('sonda-quarto-furo');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('cetico-quarto-furo');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(900);
  const mont = await js(m, MONTAR);
  console.log('montagem:', JSON.stringify(mont));

  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  console.log('elementos:', els.map((e) => `${e.agentId}:${JSON.stringify(e.text)}`).join(' | '));
  const refSenha = els.find((e) => /Senha de acesso/.test(e.text || ''))?.agentId;
  const refNormal = els.find((e) => /Nome completo/.test(e.text || ''))?.agentId;
  const refSub = els.find((e) => /Excluir conta do usuario/.test(e.text || ''))?.agentId;

  console.log('\n================ H1: freio julga a BUSCA, motor clica o ELEMENTO ================');

  // H1a — busca por ariaLabel: o freio so le `target.text` (undefined aqui).
  await reset(m);
  const a1 = await m.cmd('click', { target: { strategy: 'semantic', ariaLabel: 'Excluir conta' } });
  await sleep(500);
  const c1 = await clicado(m);
  console.log(`[H1a] click{semantic, ariaLabel:"Excluir conta"} -> ok=${a1.ok} | erro=${(a1.error || '').slice(0, 90)}`);
  console.log(`>>> QUEM FOI CLICADO DE VERDADE: ${JSON.stringify(c1)}`);
  check(a1.ok === false || c1 !== 'PERIGO_ARIA',
    'H1a: clique destrutivo alcancado por ariaLabel foi barrado (ou nao aconteceu)',
    `ok=${a1.ok} clicado=${JSON.stringify(c1)}`);

  // H1b — busca por PEDACO do texto que nao contem palavra destrutiva.
  await reset(m);
  const a2 = await m.cmd('click', { target: { strategy: 'semantic', text: 'do usuario' } });
  await sleep(500);
  const c2 = await clicado(m);
  console.log(`[H1b] click{semantic, text:"do usuario"} -> ok=${a2.ok} | erro=${(a2.error || '').slice(0, 90)}`);
  console.log(`>>> QUEM FOI CLICADO DE VERDADE: ${JSON.stringify(c2)}`);
  check(a2.ok === false || c2 !== 'PERIGO_SUB',
    'H1b: clique destrutivo alcancado por substring inocente foi barrado (ou nao aconteceu)',
    `ok=${a2.ok} clicado=${JSON.stringify(c2)}`);

  console.log('\n================ H2: cap_digitar nao passa pelo freio ================');

  if (refSenha === undefined) {
    check(false, 'H2: nao achei o agentId do campo de senha (fixture/ax-tree)');
  } else {
    await js(m, "document.getElementById('senha').value=''; \"reset\"");
    const b1 = await m.cmd('cap_digitar', { target: { agentId: refSenha }, params: { text: 'segredo123', delay_ms: 5 } });
    await sleep(400);
    const v1 = await valor(m, 'senha');
    console.log(`[H2a] cap_digitar (browser_type modo:"teclado") em campo type=password -> ok=${b1.ok} | erro=${(b1.error || '').slice(0, 90)}`);
    console.log(`>>> VALOR REAL DO CAMPO DE SENHA: ${JSON.stringify(v1)}`);
    check(b1.ok === false && !v1,
      'H2a: cap_digitar em campo de senha e BARRADO pelo freio (regra 1)',
      `ok=${b1.ok} valor=${JSON.stringify(v1)}`);
  }

  console.log('\n================ H3: type SEM target digita no elemento focado ================');
  await js(m, "document.getElementById('senha').value=''; document.getElementById('senha').focus(); \"focado\"");
  const foco = await js(m, 'document.activeElement && document.activeElement.id');
  console.log('elemento focado antes do type:', JSON.stringify(foco));
  const d1 = await m.cmd('type', { params: { text: 'segredo456' } });
  await sleep(400);
  const v3 = await valor(m, 'senha');
  console.log(`[H3] type SEM target, com o campo de senha focado -> ok=${d1.ok} | erro=${(d1.error || '').slice(0, 90)}`);
  console.log(`>>> VALOR REAL DO CAMPO DE SENHA: ${JSON.stringify(v3)}`);
  check(d1.ok === false && !v3,
    'H3: type sem target com senha focada e BARRADO',
    `ok=${d1.ok} valor=${JSON.stringify(v3)}`);

  console.log('\n================ CONTROLES (falso positivo / regressao) ================');

  await reset(m);
  const e1 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Ver detalhes' } });
  await sleep(400);
  const ce1 = await clicado(m);
  check(e1.ok === true && ce1 === 'INOFENSIVO',
    'C1 (falso positivo): clique semantico legitimo continua passando',
    `ok=${e1.ok} clicado=${JSON.stringify(ce1)} erro=${(e1.error || '').slice(0, 60)}`);

  if (refNormal !== undefined) {
    await js(m, "document.getElementById('normal').value=''; \"reset\"");
    const e2 = await m.cmd('cap_digitar', { target: { agentId: refNormal }, params: { text: 'Fulano', delay_ms: 5 } });
    await sleep(400);
    const ve2 = await valor(m, 'normal');
    check(e2.ok === true && ve2 === 'Fulano',
      'C2 (falso positivo): cap_digitar em campo normal continua funcionando',
      `ok=${e2.ok} valor=${JSON.stringify(ve2)} erro=${(e2.error || '').slice(0, 60)}`);
  }

  if (refSub !== undefined) {
    await reset(m);
    const e3 = await m.cmd('click', { target: { strategy: 'agent-id', agentId: refSub } });
    const ce3 = await clicado(m);
    check(e3.ok === false && /bloqueado/.test(e3.error || ''),
      'C3 (regressao): clique por ref em botao destrutivo continua BARRADO',
      `ok=${e3.ok} clicado=${JSON.stringify(ce3)}`);
  }

  await reset(m);
  const e4 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Excluir conta do usuario' } });
  const ce4 = await clicado(m);
  check(e4.ok === false && /bloqueado/.test(e4.error || ''),
    'C4 (regressao): clique semantico com o texto destrutivo INTEIRO continua BARRADO',
    `ok=${e4.ok} clicado=${JSON.stringify(ce4)}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
