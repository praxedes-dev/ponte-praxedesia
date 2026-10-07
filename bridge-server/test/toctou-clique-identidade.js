/**
 * TOCTOU do clique semantico (06/09/2026) — o freio julga o elemento NUM
 * INSTANTE, o motor clica NOUTRO. No ramo `ref` o motor reconfere a
 * IDENTIDADE (`cdpClickByRefOrThrow`) antes de clicar; no ramo `semantico`
 * ele descartava a identidade e despachava a COORDENADA CRUA
 * (`cdpClick(alvo.ponto.x, alvo.ponto.y)`) — `execution-engine/index.ts`,
 * `case 'click'` (~1049) e o clique-para-focar do `case 'type'` (~1066).
 *
 * O gatilho do re-render nao precisa de pagina hostil: e a PROPRIA PONTE,
 * quando reativa a aba (`comAbaPronta`, `bridge/index.ts`) — exatamente o
 * padrao do PJe, que re-renderiza por AJAX o tempo todo. A janela do golpe:
 *
 *   1. `resolverAlvoDaAcao` roda ANTES de `comAbaPronta` (bridge/index.ts
 *      ~725-755) — o freio julga o botao INOFENSIVO e calcula `ponto` com a
 *      aba ainda em SEGUNDO PLANO (a resolucao funciona em aba nao pintada).
 *   2. `comAbaPronta` reativa a aba (`chrome.tabs.update(...,{active:true})`)
 *      porque outro agente (peer B, abaixo) tinha roubado o "active" dela —
 *      so pode haver UMA aba ativa por janela. A pagina recebe
 *      `visibilitychange` -> 'visible' e RE-RENDERIZA: troca o botao
 *      inofensivo por um destrutivo, NA MESMA COORDENADA.
 *   3. O motor despacha o clique. Coordenada crua acerta o destrutivo.
 *      Identidade (`cdpClickByRefOrThrow`) reconfere o no antes de clicar —
 *      ele sumiu (foi removido do DOM no re-render) — e FALHA FECHADO.
 *
 * Fixture servida por HTTP LOCAL EFEMERO (porta 0 = o SO escolhe uma livre):
 * `data:` nao carrega neste Chrome. Aba-cobaia propria (peer A) + uma
 * segunda aba de OUTRO peer (B) so para roubar o "active" da janela da
 * ponte — nunca a aba do Dr. Cezar.
 *
 * Serve tanto para medir o defeito quanto para mutation testing: o MESMO
 * arquivo, rodado contra o codigo com e sem o conserto, precisa inverter o
 * veredito (ver relatorio da obra).
 *
 *   node test/toctou-clique-identidade.js
 */
import http from 'node:http';
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

// Fixture: um botao inofensivo, absoluto, numa coordenada fixa. Ao reganhar
// visibilidade (a aba volta a ficar ativa), troca TODO o corpo por um botao
// destrutivo NA MESMA coordenada — exatamente o padrao de re-render de uma
// SPA/biblioteca moderna (e do PJe, por AJAX).
const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>fixture-toctou</title></head>
<body>
<button id="alvo" style="position:absolute;left:120px;top:120px;width:260px;height:56px;font-size:16px;">Ver detalhes do processo</button>
<script>
  window.__cliques = { inofensivo: 0, perigoso: 0 };
  window.__trocado = false;
  document.getElementById('alvo').addEventListener('click', function () { window.__cliques.inofensivo++; });
  function trocarParaPerigoso() {
    if (window.__trocado) return;
    window.__trocado = true;
    document.body.innerHTML = '<button id="perigo" style="position:absolute;left:120px;top:120px;width:260px;height:56px;font-size:16px;">Excluir processo definitivamente</button>';
    document.getElementById('perigo').addEventListener('click', function () { window.__cliques.perigoso++; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') trocarParaPerigoso();
  });
<\/script>
</body></html>`;

// Fixture do `type`: um CAMPO inofensivo na mesma coordenada fixa. Ao
// reganhar visibilidade, vira um botao destrutivo — mede a OUTRA metade do
// mesmo furo, o clique-para-focar de `case 'type'` (~1066), que despacha
// CLIQUE REAL (nao so foco) na coordenada crua.
const FIXTURE_HTML_TYPE = `<!doctype html>
<html><head><meta charset="utf-8"><title>fixture-toctou-type</title></head>
<body>
<input id="campo" placeholder="Nome do requerente" style="position:absolute;left:120px;top:220px;width:260px;height:40px;font-size:16px;">
<script>
  window.__cliques2 = { perigoso: 0 };
  window.__trocado2 = false;
  function trocarParaPerigoso2() {
    if (window.__trocado2) return;
    window.__trocado2 = true;
    document.body.innerHTML = '<button id="perigo2" style="position:absolute;left:120px;top:220px;width:260px;height:40px;font-size:16px;">Excluir processo definitivamente</button>';
    document.getElementById('perigo2').addEventListener('click', function () { window.__cliques2.perigoso++; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') trocarParaPerigoso2();
  });
<\/script>
</body></html>`;

function iniciarServidorFixture() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const html = req.url && req.url.startsWith('/type') ? FIXTURE_HTML_TYPE : FIXTURE_HTML;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => r.result);

const sonda = startClient('sonda-toctou');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const servidor = await iniciarServidorFixture();
const porta = servidor.address().port;
const urlFixture = `http://127.0.0.1:${porta}/`;
console.log('fixture servida em', urlFixture);

const a = await peer('toctou-clique-a');
let b;
try {
  await a.cmd('open_tab', { params: { url: urlFixture } });
  await sleep(700); // carrega a pagina e liga o listener de visibilitychange

  const pg = await a.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  console.log('elementos (antes da troca):', els.map((e) => `${e.agentId}:${e.text}`).join(' | '));
  const alvo = els.find((e) => /Ver detalhes do processo/i.test(e.text || ''));
  if (!alvo) throw new Error('fixture nao montou: nao achei o botao inofensivo no read_page');

  const antesTroca = await js(a, 'window.__trocado');
  check(antesTroca === false, '[sanidade] a pagina ainda NAO trocou antes do golpe (freio vai julgar o inofensivo de verdade)', `trocado=${antesTroca}`);

  // Rouba o "active" da aba-fixture: so pode haver UMA aba ativa por janela,
  // e a janela da ponte e UNICA para todos os agentes. Isso poe a aba-fixture
  // em segundo plano SEM tocar no DOM dela (so dispara visibilitychange
  // 'hidden' — nao 'visible', entao nao ha troca ainda).
  b = await peer('toctou-clique-b');
  await b.cmd('read_page', {}).catch(() => {}); // so para criar a aba propria (active:true) e roubar o foco

  const contadoresAntes = JSON.parse(await js(a, 'JSON.stringify(window.__cliques)'));
  console.log('contadores antes do clique:', JSON.stringify(contadoresAntes));

  // O golpe: clique semantico no botao INOFENSIVO. O freio vai julgar a aba
  // (ainda em 2o plano, DOM intacto); `comAbaPronta` vai REATIVAR a aba antes
  // do motor disparar — e e ali, no meio do caminho, que a pagina troca.
  const r = await a.cmd('click', { target: { strategy: 'semantic', text: 'Ver detalhes do processo' } });
  await sleep(500);
  const contadoresDepois = JSON.parse(await js(a, 'JSON.stringify(window.__cliques)'));
  const trocou = await js(a, 'window.__trocado');
  console.log(`click -> ok=${r.ok} erro=${(r.error || '').slice(0, 140)} | contadores=${JSON.stringify(contadoresDepois)} | trocou=${trocou}`);

  check(trocou === true,
    '[sanidade] o cenario REPRODUZIU: a pagina re-renderizou ao reganhar foco entre o freio e o motor',
    `trocado=${trocou}`);

  // O criterio que importa: o elemento TROCADO (destrutivo) NUNCA pode ser
  // clicado de verdade — nem em silencio (era o defeito), nem depois do
  // conserto (que tem de falhar fechado ou acertar o elemento certo).
  check(contadoresDepois.perigoso === 0,
    'o motor NUNCA clicou no elemento TROCADO (destrutivo) que apareceu na MESMA coordenada',
    `perigoso=${contadoresDepois.perigoso} ok=${r.ok} erro=${(r.error || '').slice(0, 90)}`);

  if (r.ok === true) {
    check(contadoresDepois.inofensivo === 1,
      'clique respondeu ok=true: acertou o elemento CERTO (identidade), nao a coordenada crua',
      `inofensivo=${contadoresDepois.inofensivo}`);
  } else {
    check(/nao existe mais na pagina|resolveNode|nao resolveu|coberto por outro elemento|nao tem posicao visivel|no target for click/i.test(r.error || ''),
      'clique respondeu ok=false: falhou FECHADO com mensagem de identidade (nao um erro generico)',
      (r.error || '').slice(0, 140));
  }
} catch (e) {
  console.error('ERRO:', e.message);
  process.exitCode = 1;
} finally {
  a.fechar();
  if (b) b.fechar();
}

// ── CENARIO 2: mesma TOCTOU, no clique-para-focar de `case 'type'` ─────────
//
// Aqui o clique nao e a ACAO (e so para focar o campo antes de escrever) —
// por isso o motor usa a versao de MELHOR ESFORCO (`cdpClickByRef`, que
// engolia a falha mesmo antes desta obra) e nao a que lanca
// (`cdpClickByRefOrThrow`, usada em `case 'click'`). O que muda com o
// conserto e SO a base: `cdpClickByRef` passou a reconferir a IDENTIDADE
// (mesma `resolverEClicarPorRef` de tras do `OrThrow`) antes de clicar, em
// vez de despachar a coordenada crua — entao o clique-para-focar tambem deixa
// de poder acertar um botao destrutivo que apareceu na mesma coordenada.
const c = await peer('toctou-type-c');
let d;
try {
  await c.cmd('open_tab', { params: { url: urlFixture + 'type' } });
  await sleep(700);

  const pg2 = await c.cmd('read_page', {});
  const els2 = pg2.result?.interactiveElements ?? [];
  console.log('elementos (antes da troca, campo):', els2.map((e) => `${e.agentId}:${e.role}:${e.placeholder || e.text}`).join(' | '));
  const campo = els2.find((e) => /Nome do requerente/i.test(e.placeholder || e.text || ''));
  if (!campo) throw new Error('fixture (type) nao montou: nao achei o campo no read_page');

  const antesTroca2 = await js(c, 'window.__trocado2');
  check(antesTroca2 === false, '[sanidade] campo ainda NAO trocou antes do golpe', `trocado2=${antesTroca2}`);

  d = await peer('toctou-type-d');
  await d.cmd('read_page', {}).catch(() => {}); // rouba o "active" da aba-fixture, como no cenario 1

  const r2 = await c.cmd('type', {
    target: { strategy: 'semantic', placeholder: 'Nome do requerente' },
    params: { text: 'Fulano de Tal' },
  });
  await sleep(500);
  const perigoso2 = Number(await js(c, 'window.__cliques2.perigoso'));
  const trocou2 = await js(c, 'window.__trocado2');
  console.log(`type -> ok=${r2.ok} erro=${(r2.error || '').slice(0, 140)} | perigoso=${perigoso2} | trocou=${trocou2}`);

  check(trocou2 === true,
    '[sanidade] cenario 2 REPRODUZIU: o campo re-renderizou (virou botao) entre o freio e o motor',
    `trocado2=${trocou2}`);

  check(perigoso2 === 0,
    'o clique-para-focar de `type` NUNCA ativou o botao destrutivo que apareceu na MESMA coordenada do campo',
    `perigoso=${perigoso2} ok=${r2.ok} erro=${(r2.error || '').slice(0, 90)}`);
} catch (e) {
  console.error('ERRO (cenario 2):', e.message);
  process.exitCode = 1;
} finally {
  c.fechar();
  if (d) d.fechar();
  // `close()` sozinho NAO derruba conexao keep-alive: ele so completa quando a
  // ultima fechar, e o socket vivo segura o processo node de pe — o teste
  // imprime tudo e nunca volta ao prompt, e quem espera por ele espera para
  // sempre. Mesmo defeito ja corrigido hoje em `download-somente-leitura.js`.
  servidor.closeAllConnections?.();
  servidor.close();
}
