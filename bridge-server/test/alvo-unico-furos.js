/**
 * ALVO UNICO — furos 7 (tres faces) e 8, medidos AO VIVO no Chrome
 * (obra 25, 06/09/2026).
 *
 * Os quatro casos abaixo foram medidos ABERTOS neste mesmo Chrome antes do
 * conserto (ver `test/cetico-setimo-furo.js`, a sonda do cetico, e o placar de
 * baseline no relatorio da obra):
 *
 *  7-A  `type` com alvo semantico que NAO RESOLVE. O freio devolvia
 *       `undefined` para "que tipo e o alvo?" e `undefined !== 'password'`
 *       LIBERAVA, enquanto o motor, sem coordenada, nao clicava em nada e
 *       chamava `cdpType(..., undefined)`, que digita no
 *       `document.activeElement`. MEDIDO antes: senha focada, `ok=true`,
 *       `document.getElementById('senha').value === 'segredo123'`.
 *
 *  7-B  `type` DESPACHA CLIQUE REAL antes de digitar, e a regra 4 so rodava
 *       para `action.type === 'click'`. MEDIDO antes: `window.__cliques`
 *       do botao "Protocolar inicial" foi de 0 para 1.
 *
 *  7-C  `type` por ref de WRAPPER: o freio SUBIA ate o ancestral clicavel e o
 *       `cdpType` DESCIA por `findRealInput`, escrevendo no
 *       `<input type=password>` de dentro.
 *
 *  8    `cap_autocomplete` digitava ANTES de qualquer `avaliar()` — irmao
 *       exato do furo 5, que so tinha sido fechado em `cap_digitar`.
 *
 * Mede tambem as tres defesas novas que sairam da mesma resolucao unica
 * (`press_key` que ativa o controle focado, `drag` com from == to, e o freio
 * falhando FECHADO quando nao da para saber quem esta no ponto), o achado do
 * `document.elementFromPoint` redefinido pela pagina, e a lista de casos
 * legitimos que NAO podem ter virado falso positivo.
 *
 * Aba-cobaia propria. Nunca a aba do Dr. Cezar.
 *   node test/alvo-unico-furos.js
 */
import { WebSocket } from 'ws';
import { getToken } from '../src/token.js';
import { HOST, PORT } from '../src/hub.js';
import { startClient, esperarExtensao, sleep } from './client.js';
import { TOOL_BY_NAME } from '../src/tools/index.js';

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

// ── 0. Contrato da tool (sem Chrome): `text` de browser_type nunca vira busca ─
//
// Raiz alcancavel do 7-A: `buildTarget` usava `input.text` como TEXTO DO
// ELEMENTO, e em `browser_type` `text` e o texto A DIGITAR. MEDIDO antes:
// no mesmo `<input type=password placeholder="Senha de acesso">`,
// `text:'Senha'` (substring do placeholder) era BLOQUEADO e `text:'SEGREDO1'`
// PASSAVA e escrevia — o freio so enxergava o campo quando o segredo digitado
// por acaso casava com o rotulo dele.
{
  const t = TOOL_BY_NAME.get('browser_type');
  const semAlvo = t.build({ text: 'SEGREDO1' });
  check(semAlvo.target === undefined,
    '0a. browser_type({text}) NAO monta alvo semantico com o texto digitado (cai no campo focado)',
    JSON.stringify(semAlvo.target));

  const porPlaceholder = t.build({ text: 'SEGREDO1', placeholder: 'Senha de acesso' });
  check(porPlaceholder.target?.strategy === 'semantic' && porPlaceholder.target.text === undefined
    && porPlaceholder.target.placeholder === 'Senha de acesso',
    '0b. o segredo digitado nao entra no criterio de busca do elemento',
    JSON.stringify(porPlaceholder.target));

  const porTexto = t.build({ text: 'valor', texto_do_elemento: 'Nome completo' });
  check(porTexto.target?.text === 'Nome completo',
    '0c. quem quer buscar o campo pelo rotulo tem campo proprio (texto_do_elemento)',
    JSON.stringify(porTexto.target));

  const porRef = t.build({ text: 'x', ref: 42 });
  check(porRef.target?.strategy === 'agent-id' && porRef.target.agentId === 42,
    '0d. ref continua vencendo tudo', JSON.stringify(porRef.target));
}

const MONTAR = [
  'window.__cliques = 0; window.__excluiu = 0;',
  'document.body.innerHTML = "'
    + '<label id=rotulo for=senha>Senha <input id=senha type=password placeholder=\\"Senha de acesso\\"></label>'
    + ' <div id=caixa role=textbox aria-label=\\"Caixa da confirmacao\\"><input id=senha2 type=password placeholder=\\"Confirme a senha\\"></div>'
    + ' <input id=nome placeholder=\\"Nome completo\\">'
    + ' <button id=protocolar>Protocolar inicial</button>'
    + ' <button id=excluir>Excluir conta</button>'
    + ' <div style=\\"height:2000px\\"></div>'
    + ' <button id=fundo>Excluir tudo agora</button>'
    + '";',
  'document.getElementById("protocolar").addEventListener("click", function(){ window.__cliques++; });',
  'document.getElementById("excluir").addEventListener("click", function(){ window.__excluiu++; });',
  'document.getElementById("fundo").addEventListener("click", function(){ window.__excluiu++; });',
  '"montado"',
].join('\n');

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => r.result);
const valor = (m, id) => js(m, `document.getElementById('${id}').value`);
const zerar = (m) => js(m, "document.getElementById('senha').value=''; document.getElementById('senha2').value='';"
  + " document.getElementById('nome').value=''; window.__cliques=0; window.__excluiu=0; 'reset'");

const sonda = startClient('sonda-alvo-unico');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('alvo-unico-furos');
try {
  await m.cmd('open_tab', { params: { url: 'https://example.com' } });
  await sleep(800);
  console.log('montagem:', JSON.stringify(await js(m, MONTAR)));

  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  console.log('elementos:', els.map((e) => `${e.agentId}:${e.role}:${e.text}`).join(' | '));
  const refDe = (teste) => els.find(teste)?.agentId;

  // ── 7-A ────────────────────────────────────────────────────────────────
  await zerar(m);
  await js(m, "document.getElementById('senha').focus(); 'focado'");
  const r1 = await m.cmd('type', {
    target: { strategy: 'semantic', text: 'segredo123' },
    params: { text: 'segredo123' },
  });
  const v1 = await valor(m, 'senha');
  console.log(`[7-A] ok=${r1.ok} erro=${(r1.error || '').slice(0, 70)} | senha=${JSON.stringify(v1)}`);
  check(r1.ok === false && /senha/i.test(r1.error || '') && !v1,
    '7-A: type com alvo semantico que NAO resolve, senha focada -> BARRADO e nada escrito',
    `ok=${r1.ok} valor=${JSON.stringify(v1)}`);

  // ── 7-B ────────────────────────────────────────────────────────────────
  await zerar(m);
  const r2 = await m.cmd('type', {
    target: { strategy: 'semantic', text: 'Protocolar inicial' },
    params: { text: 'x' },
  });
  const cliques = Number(await js(m, 'window.__cliques'));
  console.log(`[7-B] ok=${r2.ok} erro=${(r2.error || '').slice(0, 70)} | cliques=${cliques}`);
  check(r2.ok === false && /irreversivel|protocolar/i.test(r2.error || '') && cliques === 0,
    '7-B: type em botao destrutivo e BARRADO pela regra 4 e NAO clica',
    `ok=${r2.ok} cliques=${cliques}`);

  const r2b = await m.cmd('click', { target: { strategy: 'semantic', text: 'Protocolar inicial' } });
  check(r2b.ok === false && /irreversivel|protocolar/i.test(r2b.error || ''),
    '7-B (contraprova): o MESMO alvo, como `click`, continua BARRADO',
    (r2b.error || '').slice(0, 70));

  // ── 7-C ────────────────────────────────────────────────────────────────
  await zerar(m);
  const refCaixa = refDe((e) => /Caixa da confirmacao/i.test(e.text || '') || /Caixa da confirmacao/i.test(e.ariaLabel || ''));
  if (refCaixa !== undefined) {
    const r3 = await m.cmd('type', {
      target: { strategy: 'agent-id', agentId: refCaixa },
      params: { text: 'VAZOU-PELO-WRAPPER' },
    });
    const v3 = await valor(m, 'senha2');
    console.log(`[7-C] ref=${refCaixa} ok=${r3.ok} erro=${(r3.error || '').slice(0, 70)} | senha2=${JSON.stringify(v3)}`);
    check(r3.ok === false && /senha/i.test(r3.error || '') && !v3,
      '7-C: ref de WRAPPER (<div role=textbox>) e BARRADO — o freio julga o <input type=password> de dentro',
      `ok=${r3.ok} valor=${JSON.stringify(v3)}`);
  } else {
    check(false, '7-C: nao achei a ref do wrapper no read_page (fixture/ax-tree)');
  }

  // ── FURO 8 ─────────────────────────────────────────────────────────────
  await zerar(m);
  const refSenha = refDe((e) => /^Senha$/i.test((e.text || '').trim()) || /Senha de acesso/i.test(e.placeholder || ''));
  if (refSenha !== undefined) {
    const r4 = await m.cmd('cap_autocomplete', {
      target: { strategy: 'agent-id', agentId: refSenha },
      params: { ref: refSenha, texto: 'segredo', escolher: 'segredo', timeout_ms: 1500, delay_ms: 10 },
    }, 30000);
    const v4 = await valor(m, 'senha');
    console.log(`[8] ok=${r4.ok} erro=${(r4.error || '').slice(0, 80)} | senha=${JSON.stringify(v4)}`);
    check(r4.ok === false && /bloqueado/i.test(r4.error || '') && /senha/i.test(r4.error || '') && !v4,
      'FURO 8: cap_autocomplete e BARRADO ANTES de digitar (nada escrito no campo de senha)',
      `valor=${JSON.stringify(v4)} erro=${(r4.error || '').slice(0, 60)}`);
  } else {
    check(false, 'FURO 8: nao achei a ref do campo de senha no read_page');
  }

  // ── DEFESA NOVA: press_key que ATIVA o controle focado ─────────────────
  await zerar(m);
  await js(m, "document.getElementById('excluir').focus(); 'focado'");
  const r5 = await m.cmd('press_key', { params: { key: 'space' } });
  const ex5 = Number(await js(m, 'window.__excluiu'));
  console.log(`[press_key space] ok=${r5.ok} erro=${(r5.error || '').slice(0, 70)} | excluiu=${ex5}`);
  check(r5.ok === false && /irreversivel|excluir/i.test(r5.error || '') && ex5 === 0,
    'NOVA: press_key "space" com botao "Excluir conta" focado e BARRADO e o botao NAO e ativado',
    `ok=${r5.ok} excluiu=${ex5}`);

  // ── DEFESA NOVA: drag com from == to e clique disfarcado ───────────────
  await zerar(m);
  const cxExcluir = await js(m, "(function(){var r=document.getElementById('excluir').getBoundingClientRect();"
    + ' return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});})()');
  const pt = JSON.parse(cxExcluir);
  const r6 = await m.cmd('drag', { params: { fromX: pt.x, fromY: pt.y, toX: pt.x, toY: pt.y } });
  const ex6 = Number(await js(m, 'window.__excluiu'));
  console.log(`[drag from==to] ok=${r6.ok} erro=${(r6.error || '').slice(0, 70)} | excluiu=${ex6}`);
  check(r6.ok === false && /irreversivel|excluir/i.test(r6.error || '') && ex6 === 0,
    'NOVA: browser_drag com from == to sobre "Excluir conta" e BARRADO (era clique real sem freio)',
    `ok=${r6.ok} excluiu=${ex6}`);

  // ── ACHADO A4: pagina que redefine document.elementFromPoint ───────────
  //
  // MEDIDO antes do conserto: com `document.elementFromPoint = () => <div
  // inofensivo>`, o mesmo `click{text:'Excluir conta'}` que era bloqueado
  // passou a responder ok E o botao foi realmente clicado. O freio julgava o
  // div; o motor clicava no botao. Agora quem responde "quem esta neste ponto"
  // e o CDP (`DOM.getNodeForLocation`), que a pagina nao alcanca.
  await zerar(m);
  await js(m, "window.__epReal = document.elementFromPoint;"
    + " document.elementFromPoint = function(){ return document.getElementById('nome'); }; 'trocado'");
  const r7 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Excluir conta' } });
  const ex7 = Number(await js(m, 'window.__excluiu'));
  await js(m, 'document.elementFromPoint = window.__epReal; "restaurado"');
  console.log(`[elementFromPoint trocado] ok=${r7.ok} erro=${(r7.error || '').slice(0, 70)} | excluiu=${ex7}`);
  check(r7.ok === false && /irreversivel|excluir/i.test(r7.error || '') && ex7 === 0,
    'A4: pagina que redefine document.elementFromPoint NAO engana mais o freio',
    `ok=${r7.ok} excluiu=${ex7}`);

  // ── ACHADO A3: alvo abaixo da dobra (freio liberava no escuro) ─────────
  await zerar(m);
  const r8 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Excluir tudo agora' } });
  const ex8 = Number(await js(m, 'window.__excluiu'));
  console.log(`[abaixo da dobra] ok=${r8.ok} erro=${(r8.error || '').slice(0, 90)} | excluiu=${ex8}`);
  check(r8.ok === false && ex8 === 0,
    'A3: clique semantico em elemento FORA da viewport nao responde mais "ok" no escuro',
    `ok=${r8.ok} erro=${(r8.error || '').slice(0, 70)}`);

  // ── SEM FALSO POSITIVO ─────────────────────────────────────────────────
  await zerar(m);
  const r9 = await m.cmd('type', {
    target: { strategy: 'semantic', placeholder: 'Nome completo' },
    params: { text: 'Fulano de Tal', clear: true },
  });
  const v9 = await valor(m, 'nome');
  check(r9.ok === true && v9 === 'Fulano de Tal',
    'sem falso positivo: digitar em campo normal por busca semantica continua funcionando',
    `ok=${r9.ok} valor=${JSON.stringify(v9)}`);

  await zerar(m);
  await js(m, "document.getElementById('nome').focus(); 'focado'");
  const r10 = await m.cmd('type', { target: { strategy: 'semantic', text: 'texto qualquer' }, params: { text: 'texto qualquer' } });
  const v10 = await valor(m, 'nome');
  check(r10.ok === true && v10 === 'texto qualquer',
    'sem falso positivo: digitar no campo NORMAL ja focado (mesmo caminho do 7-A) continua funcionando',
    `ok=${r10.ok} valor=${JSON.stringify(v10)}`);

  await zerar(m);
  const refNome = refDe((e) => /Nome completo/i.test(e.text || '') || /Nome completo/i.test(e.placeholder || ''));
  const r11 = await m.cmd('type', { target: { strategy: 'agent-id', agentId: refNome }, params: { text: 'Ciclano', clear: true } });
  const v11 = await valor(m, 'nome');
  check(r11.ok === true && v11 === 'Ciclano' && r11.result?.lido === 'Ciclano',
    'sem falso positivo: digitar por ref continua funcionando e o "lido" bate com o campo',
    `ok=${r11.ok} valor=${JSON.stringify(v11)} lido=${JSON.stringify(r11.result?.lido)}`);

  await zerar(m);
  const r12 = await m.cmd('cap_form_input', {
    target: { strategy: 'agent-id', agentId: refNome }, params: { ref: refNome, valor: 'Beltrano' },
  });
  const v12 = await valor(m, 'nome');
  check(r12.ok === true && v12 === 'Beltrano',
    'sem falso positivo: browser_form_input em campo comum continua preenchendo',
    `ok=${r12.ok} valor=${JSON.stringify(v12)}`);

  await zerar(m);
  await js(m, "document.getElementById('nome').focus(); 'focado'");
  const r13 = await m.cmd('press_key', { params: { key: '7' } });
  const v13 = await valor(m, 'nome');
  check(r13.ok === true && v13 === '7',
    'sem falso positivo: press_key de caractere em campo comum continua inserindo',
    `ok=${r13.ok} valor=${JSON.stringify(v13)}`);

  await zerar(m);
  const r14 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Nome completo' } });
  check(r14.ok === true, 'sem falso positivo: clique semantico em elemento inocente continua funcionando',
    (r14.error || '').slice(0, 70));

  await zerar(m);
  const r15 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Excluir conta' }, confirm: true });
  const ex15 = Number(await js(m, 'window.__excluiu'));
  check(r15.ok === true && ex15 === 1,
    'sem falso positivo: clique destrutivo COM confirm:true passa e clica de verdade',
    `ok=${r15.ok} excluiu=${ex15}`);
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  m.fechar();
}
