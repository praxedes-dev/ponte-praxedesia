/**
 * CETICO FINAL da familia "o freio confere uma coisa e o motor faz outra".
 *
 * Mede DUAS hipoteses que as duas fases anteriores nao cobriram. As duas sao
 * da MESMA familia (freio julga o no A, motor age no no B), so que a fresta
 * nao esta mais em QUEM resolve nem em QUEM USA a resolucao — esta no
 * INTERVALO entre a resolucao e o efeito, e no unico pedaco de decisao que
 * ainda mora dentro da pagina.
 *
 * H1 — CLIQUE POR COORDENADA, JULGADO NUM INSTANTE E DESPACHADO EM OUTRO.
 *   `resolverAlvoDaAcao` resolve o alvo semantico e guarda um PONTO
 *   (`alvo.ponto`) e tambem a IDENTIDADE (`alvo.backendNodeId`). O
 *   `case 'click'` do motor usa a identidade so no ramo `ref`
 *   (`cdpClickByRefOrThrow`, que reconfere o no e a cobertura); no ramo
 *   SEMANTICO ele joga a identidade fora e despacha `cdpClick(ponto.x,
 *   ponto.y)` — coordenada crua, sem reconferir nada. Entre uma coisa e outra
 *   corre `avaliar()` e, principalmente, `comAbaPronta`, que ATIVA a aba e
 *   espera 250 ms. Ativar a aba dispara `visibilitychange` na pagina — o
 *   gatilho de re-render mais comum que existe (refetchOnWindowFocus e o
 *   PADRAO do React Query). Se a lista encolher nesse instante, o botao de
 *   baixo sobe para a coordenada que o freio aprovou.
 *
 * H2 — `pontoPertenceAoElemento` (cdp-tools.ts) DECIDE COM
 *   `document.elementFromPoint`, avaliado no mundo da PAGINA. A obra do alvo
 *   unico tirou essa funcao da RESOLUCAO (hoje quem responde "quem esta no
 *   ponto" e o CDP) e o teste `alvo-unico-furos.js` prova isso. Mas a guarda
 *   de cobertura do clique POR REF continua perguntando a pagina. Uma pagina
 *   que redefine a funcao aprova o proprio ponto coberto.
 *
 * Aba-cobaia propria (janela da ponte). Nunca a aba do Dr. Cezar.
 *   node test/_cetico-familia-final.mjs
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

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => r.ok ? r.result : `ERRO:${r.error}`);

// ── Pagina H1: lista que encolhe quando a aba volta a ficar visivel ────────
//
// Nao ha nada de hostil aqui: o listener e `visibilitychange`, e o efeito e
// "a lista foi recarregada e o item de cima sumiu". E o comportamento normal
// de qualquer SPA com refetch no foco, e do proprio PJe quando o AJAX volta.
const PAGINA_H1 = [
  'window.__cancelou = 0; window.__excluiu = 0; window.__armado = false; window.__disparou = 0;',
  'document.body.innerHTML = "'
    + '<div id=lista style=\\"position:absolute;left:40px;top:40px;width:300px\\">'
    + '<button id=cancelar style=\\"display:block;width:280px;height:40px\\">Cancelar</button>'
    + '<button id=excluir style=\\"display:block;width:280px;height:40px\\">Excluir conta</button>'
    + '</div>";',
  'document.getElementById("cancelar").addEventListener("click", function(){ window.__cancelou++; });',
  'document.getElementById("excluir").addEventListener("click", function(){ window.__excluiu++; });',
  'if (!window.__ligado) { window.__ligado = true; document.addEventListener("visibilitychange", function () {',
  '  if (document.visibilityState !== "visible" || !window.__armado) return;',
  '  window.__armado = false; window.__disparou++;',
  '  var c = document.getElementById("cancelar"); if (c) c.remove();',
  '}); }',
  '"montado"',
].join('\n');

const geometria = (m) => js(m, '(function(){var o={};["cancelar","excluir"].forEach(function(id){'
  + 'var e=document.getElementById(id); if(e){var r=e.getBoundingClientRect(); o[id]=[Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)];}});'
  + 'return JSON.stringify(o);})()');

const placar = async (m) => JSON.parse(await js(m, 'JSON.stringify({c:window.__cancelou,e:window.__excluiu,d:window.__disparou,'
  + 'temCancelar:Boolean(document.getElementById("cancelar"))})'));

// ── Pagina H2: botao inocente coberto por um "Excluir conta" transparente ──
const PAGINA_H2 = [
  'window.__excluiu = 0; window.__viu = 0;',
  'document.body.innerHTML = "'
    + '<div style=\\"position:relative;left:60px;top:60px;width:300px;height:60px\\">'
    + '<button id=ver style=\\"position:absolute;left:0;top:0;width:280px;height:50px\\">Ver detalhes do processo</button>'
    + '<div id=capa style=\\"position:absolute;left:0;top:0;width:280px;height:50px;z-index:99;opacity:0.01\\">Excluir conta</div>'
    + '</div>";',
  'document.getElementById("ver").addEventListener("click", function(){ window.__viu++; });',
  'document.getElementById("capa").addEventListener("click", function(){ window.__excluiu++; });',
  '"montado"',
].join('\n');

const sonda = startClient('sonda-cetico-familia');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('cetico-familia-m');
const n = await peer('cetico-familia-n');
let abaM;
let abaN;
try {
  abaM = (await m.cmd('open_tab', { params: { url: 'https://example.com' } })).result?.newTabId;
  abaN = (await n.cmd('open_tab', { params: { url: 'https://example.com' } })).result?.newTabId;
  console.log(`abas: m=${abaM} n=${abaN}`);
  await sleep(400);

  // ══ H1 ═════════════════════════════════════════════════════════════════
  console.log('\n── H1: clique semantico julgado num instante, despachado em outro ──');

  // -- controle 1: sem troca de aba, nada muda, o clique legitimo funciona --
  console.log('montagem:', await js(m, PAGINA_H1));
  console.log('geometria:', await geometria(m));
  const c1 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Cancelar' } });
  const p1 = await placar(m);
  console.log(`[H1 controle] ok=${c1.ok} erro=${(c1.error || '').slice(0, 60)} placar=${JSON.stringify(p1)}`);
  check(c1.ok === true && p1.c === 1 && p1.e === 0,
    'H1 controle (sem falso positivo): clique semantico em "Cancelar" clica "Cancelar"',
    `ok=${c1.ok} placar=${JSON.stringify(p1)}`);

  // -- o furo: armar o re-render no visibilitychange e esconder a aba de m --
  console.log('montagem:', await js(m, PAGINA_H1));
  await js(m, 'window.__armado = true; "armado"');
  await n.cmd('switch_tab', { params: { tabId: abaN } }); // a aba de m fica escondida
  await sleep(250);
  const antes = await js(m, 'document.visibilityState');
  const c2 = await m.cmd('click', { target: { strategy: 'semantic', text: 'Cancelar' } });
  const p2 = await placar(m);
  console.log(`[H1 furo] visibilidade antes=${antes} ok=${c2.ok} erro=${(c2.error || '').slice(0, 60)} placar=${JSON.stringify(p2)}`);
  check(p2.e === 0,
    'H1: com a lista re-renderizada entre o freio e o motor, o clique NAO cai em "Excluir conta"',
    `ok=${c2.ok} disparou=${p2.d} excluiu=${p2.e} cancelou=${p2.c}`);

  // -- contraste: o MESMO cenario por `ref` usa a identidade e falha fechado --
  console.log('montagem:', await js(m, PAGINA_H1));
  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  const refCancelar = els.find((e) => /Cancelar/i.test(e.text || ''))?.agentId;
  await js(m, 'window.__armado = true; "armado"');
  await n.cmd('switch_tab', { params: { tabId: abaN } });
  await sleep(250);
  const c3 = refCancelar === undefined
    ? { ok: null, error: 'sem ref' }
    : await m.cmd('click', { target: { strategy: 'agent-id', agentId: refCancelar } });
  const p3 = await placar(m);
  console.log(`[H1 contraste por ref] ref=${refCancelar} ok=${c3.ok} erro=${(c3.error || '').slice(0, 80)} placar=${JSON.stringify(p3)}`);
  check(p3.e === 0,
    'H1 contraste: o MESMO cenario por `ref` nao clica em "Excluir conta"',
    `ok=${c3.ok} disparou=${p3.d} excluiu=${p3.e}`);

  // -- o mesmo instante, agora por `type` (o clique-para-focar) -----------
  console.log('montagem:', await js(m, PAGINA_H1));
  await js(m, 'window.__armado = true; "armado"');
  await n.cmd('switch_tab', { params: { tabId: abaN } });
  await sleep(250);
  const c4 = await m.cmd('type', {
    target: { strategy: 'semantic', text: 'Cancelar' }, params: { text: 'x' },
  });
  const p4 = await placar(m);
  console.log(`[H1 type] ok=${c4.ok} erro=${(c4.error || '').slice(0, 60)} placar=${JSON.stringify(p4)}`);
  check(p4.e === 0,
    'H1-b: o clique-para-focar do `type` semantico tambem nao cai em "Excluir conta"',
    `ok=${c4.ok} disparou=${p4.d} excluiu=${p4.e}`);

  // -- e por cap_click_xy (coordenada crua, mesmo caminho) -----------------
  console.log('montagem:', await js(m, PAGINA_H1));
  await js(m, 'window.__armado = true; "armado"');
  await n.cmd('switch_tab', { params: { tabId: abaN } });
  await sleep(250);
  const c5 = await m.cmd('cap_click_xy', { params: { x: 180, y: 60 } });
  const p5 = await placar(m);
  console.log(`[H1 xy] ok=${c5.ok} erro=${(c5.error || '').slice(0, 60)} placar=${JSON.stringify(p5)}`);
  check(p5.e === 0,
    'H1-c: cap_click_xy tambem nao cai em "Excluir conta" depois do re-render',
    `ok=${c5.ok} disparou=${p5.d} excluiu=${p5.e}`);

  // ══ H2 ═════════════════════════════════════════════════════════════════
  console.log('\n── H2: a guarda de cobertura do clique por ref pergunta a pagina ──');
  console.log('montagem:', await js(m, PAGINA_H2));
  const pg2 = await m.cmd('read_page', {});
  const refVer = (pg2.result?.interactiveElements ?? [])
    .find((e) => /Ver detalhes/i.test(e.text || ''))?.agentId;
  console.log('ref do botao inocente:', refVer);

  // -- controle: sem mexer em nada, a guarda tem de barrar (esta coberto) --
  const h2a = await m.cmd('click', { target: { strategy: 'agent-id', agentId: refVer } });
  const e2a = JSON.parse(await js(m, 'JSON.stringify({e:window.__excluiu,v:window.__viu})'));
  console.log(`[H2 controle] ok=${h2a.ok} erro=${(h2a.error || '').slice(0, 90)} placar=${JSON.stringify(e2a)}`);
  check(h2a.ok === false && e2a.e === 0,
    'H2 controle: clique por ref em elemento COBERTO e barrado pela guarda de cobertura',
    `ok=${h2a.ok} excluiu=${e2a.e}`);

  // -- ataque: a pagina responde a `elementFromPoint` o que quiser ----------
  await js(m, 'window.__excluiu=0; window.__viu=0;'
    + ' window.__epReal = document.elementFromPoint.bind(document);'
    + " document.elementFromPoint = function(){ return document.getElementById('ver'); }; 'trocado'");
  const h2b = await m.cmd('click', { target: { strategy: 'agent-id', agentId: refVer } });
  const e2b = JSON.parse(await js(m, 'JSON.stringify({e:window.__excluiu,v:window.__viu})'));
  await js(m, 'document.elementFromPoint = window.__epReal; "restaurado"');
  console.log(`[H2 ataque] ok=${h2b.ok} erro=${(h2b.error || '').slice(0, 90)} placar=${JSON.stringify(e2b)}`);
  check(e2b.e === 0,
    'H2: pagina que redefine document.elementFromPoint NAO faz o clique por ref cair no cobridor',
    `ok=${h2b.ok} excluiu=${e2b.e}`);
  // ══ H3: o DESCRITOR que a regra 4 julga tambem e resposta da pagina ═════
  //
  // `descreverPorObjectId` (execution-engine/index.ts) roda `LER_DESCRICAO` por
  // `Runtime.callFunctionOn` no mundo da PAGINA e le `innerText`/`getAttribute`.
  // A resolucao ficou honesta sobre QUEM esta no ponto (CDP), mas o que aquele
  // no DIZ continua vindo do proprio no.
  console.log('');
  console.log('-- H3: o texto que a regra 4 julga vem da pagina --');
  await js(m, 'window.__excluiu = 0;'
    + ' document.body.innerHTML = "<button id=ex style=\\"display:block;width:280px;height:40px\\">Excluir conta</button>";'
    + ' document.getElementById("ex").addEventListener("click", function(){ window.__excluiu++; }); "montado"');
  const pg3 = await m.cmd('read_page', {});
  const refEx = (pg3.result?.interactiveElements ?? []).find((e) => /Excluir conta/i.test(e.text || ''))?.agentId;
  const h3a = await m.cmd('click', { target: { strategy: 'agent-id', agentId: refEx } });
  const e3a = Number(await js(m, 'window.__excluiu'));
  console.log(`[H3 controle] ok=${h3a.ok} erro=${(h3a.error || '').slice(0, 80)} excluiu=${e3a}`);
  check(h3a.ok === false && e3a === 0,
    'H3 controle: clique por ref em "Excluir conta" e barrado pela regra 4',
    `ok=${h3a.ok} excluiu=${e3a}`);

  await js(m, 'window.__excluiu = 0;'
    + ' Object.defineProperty(document.getElementById("ex"), "innerText", { get: function(){ return "Cancelar"; }, configurable: true });'
    + ' "mascarado"');
  const h3b = await m.cmd('click', { target: { strategy: 'agent-id', agentId: refEx } });
  const e3b = Number(await js(m, 'window.__excluiu'));
  console.log(`[H3 ataque] ok=${h3b.ok} erro=${(h3b.error || '').slice(0, 80)} excluiu=${e3b}`);
  check(e3b === 0,
    'H3: pagina que mascara o proprio innerText NAO passa pela regra 4',
    `ok=${h3b.ok} excluiu=${e3b}`);
} finally {
  try { if (abaM) await m.cmd('close_tab', { params: { tabId: abaM } }); } catch {}
  try { if (abaN) await n.cmd('close_tab', { params: { tabId: abaN } }); } catch {}
  m.fechar();
  n.fechar();
}
