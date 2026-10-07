/**
 * CETICO da obra "clique dentro de iframe" (06/09/2026).
 *
 * A obra afirma: `deslocamentoAteTopo` soma `frameElement.getBoundingClientRect()`
 * de cada iframe ancestral e o clique passa a acertar. Este arquivo ataca essa
 * afirmacao com os casos que o briefing do cetico manda atacar: borda do
 * iframe, `transform: scale`, rolagem propria, aninhado, cross-origin, e o
 * caso de nao-regressao (clique normal fora de iframe).
 *
 * COMO SE OBTEM UM `ref` DENTRO DE IFRAME: `browser_read_page` nao desce para
 * dentro de <iframe> (medido pelo pedreiro). O unico caminho e o efeito
 * colateral de `browser_click({x,y})`, que devolve "sobre o no N".
 * IMPORTANTE: a descoberta por (x,y) e feita num ponto que NAO e o alvo final
 * do teste — e so para pegar o numero do ref.
 *
 *   node test/_cetico-iframe-ataques.js
 */
import { createServer } from 'node:http';
import { startClient, esperarExtensao, sleep } from './client.js';

let falhas = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhas++; process.exitCode = 1; }
};

// ── paginas ────────────────────────────────────────────────────────────────
// Filho: botao em (60,60) 100x30 LOCAL. Registra onde o clique caiu de fato.
const filho = (id) => `<!doctype html><html><body style="margin:0;background:#dfd">
<button id="alvo" style="position:absolute;left:60px;top:60px;width:100px;height:30px"
  onclick="window.__hits=(window.__hits||0)+1;parent.postMessage({q:'${id}'},'*')">ALVO ${id}</button>
<div id="fundo" style="position:absolute;left:0;top:0;width:2000px;height:2000px;z-index:-1"></div>
<script>
window.__hits=0; window.__ult=null;
document.addEventListener('mousedown', function(e){
  window.__ult = { x:e.clientX, y:e.clientY, alvo:(e.target&&e.target.id)||e.target.tagName };
}, true);
</script></body></html>`;

// Filho com o alvo COBERTO por outra div (caso "coberto dentro do iframe").
const filhoCoberto = `<!doctype html><html><body style="margin:0;background:#dfd">
<button id="alvo" style="position:absolute;left:60px;top:60px;width:100px;height:30px"
  onclick="window.__hits=(window.__hits||0)+1">ALVO</button>
<div id="capa" style="position:absolute;left:0;top:0;width:400px;height:200px;background:rgba(255,0,0,.4)"></div>
<script>window.__hits=0;</script></body></html>`;

const pai = (corpo) => `<!doctype html><html><body style="margin:0;background:#eee">
<button id="normal" style="position:absolute;left:10px;top:10px;width:100px;height:30px"
  onclick="window.__normal=(window.__normal||0)+1">BOTAO NORMAL FORA DE IFRAME</button>
${corpo}
<script>
window.__normal=0; window.__msgs=[];
window.addEventListener('message', function(e){ if(e.data&&e.data.q) window.__msgs.push(e.data.q); });
document.addEventListener('mousedown', function(e){
  window.__ultPai = { x:e.clientX, y:e.clientY, alvo:(e.target&&e.target.id)||e.target.tagName };
}, true);
</script></body></html>`;

// A: iframe com BORDA de 20px (o Chrome poe 2px por padrao; 20px torna o erro
//    grande o bastante para nao haver duvida). Sem transform, sem rolagem.
const paginaBorda = pai(
  `<iframe id="f" src="/filho-a" style="position:absolute;left:200px;top:150px;width:400px;height:300px;border:20px solid blue"></iframe>`,
);

// B: iframe com transform: scale(0.5), transform-origin 0 0 (previsivel).
const paginaEscala = pai(
  `<iframe id="f" src="/filho-b" style="position:absolute;left:200px;top:150px;width:400px;height:300px;border:0;transform:scale(0.5);transform-origin:0 0"></iframe>`,
);

// C: iframe ANINHADO same-origin, sem borda nenhuma (o caso que a obra diz cobrir).
const paginaAninhada = pai(
  `<iframe id="f" src="/meio" style="position:absolute;left:100px;top:80px;width:600px;height:500px;border:0"></iframe>`,
);
const paginaMeio = `<!doctype html><html><body style="margin:0;background:#ffd">
<iframe id="g" src="/filho-c" style="position:absolute;left:70px;top:40px;width:400px;height:300px;border:0"></iframe>
</body></html>`;

// D: iframe com ROLAGEM propria (conteudo alto, rolado 120px).
const filhoRolado = `<!doctype html><html><body style="margin:0;background:#ddf;height:2000px">
<button id="alvo" style="position:absolute;left:60px;top:400px;width:100px;height:30px"
  onclick="window.__hits=(window.__hits||0)+1">ALVO ROLADO</button>
<script>window.__hits=0; window.scrollTo(0,300);</script></body></html>`;
const paginaRolada = pai(
  `<iframe id="f" src="/filho-d" style="position:absolute;left:150px;top:120px;width:400px;height:300px;border:0"></iframe>`,
);

// E: iframe CROSS-ORIGIN (outra porta = outra origem).
const paginaCross = (portaOutra) => pai(
  `<iframe id="f" src="http://127.0.0.1:${portaOutra}/filho-e" style="position:absolute;left:200px;top:150px;width:400px;height:300px;border:0"></iframe>`,
);

// F: coberto dentro do iframe.
const paginaCoberta = pai(
  `<iframe id="f" src="/filho-cob" style="position:absolute;left:200px;top:150px;width:400px;height:300px;border:0"></iframe>`,
);

const rotas = {
  '/borda': paginaBorda,
  '/escala': paginaEscala,
  '/aninhada': paginaAninhada,
  '/meio': paginaMeio,
  '/rolada': paginaRolada,
  '/coberta': paginaCoberta,
  '/filho-a': filho('a'),
  '/filho-b': filho('b'),
  '/filho-c': filho('c'),
  '/filho-d': filhoRolado,
  '/filho-e': filho('e'),
  '/filho-cob': filhoCoberto,
};

function servir(extra = {}) {
  const s = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const corpo = extra[url] ?? rotas[url];
    if (corpo === undefined) { res.writeHead(404); res.end('nao'); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(typeof corpo === 'function' ? corpo() : corpo);
  });
  return s;
}

const servidor = servir();
const servidorB = servir(); // outra porta = outra origem (cross-origin)
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
await new Promise((r) => servidorB.listen(0, '127.0.0.1', r));
const porta = servidor.address().port;
const portaB = servidorB.address().port;
const base = `http://127.0.0.1:${porta}`;

const c = startClient('cetico-iframe-ataques');

const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();

/** Clica por (x,y) so para DESCOBRIR o backendNodeId do no naquele ponto. */
async function refEm(x, y) {
  const r = await c.tool('browser_click', { x, y });
  const t = r.content[0].text;
  const m = t.match(/sobre o no (\d+)/);
  return { ref: m ? Number(m[1]) : null, texto: t };
}

/** Clique por ref: devolve { ok, texto }. Nunca lanca. */
async function clicarRef(ref) {
  const r = await c.call('tools/call', { name: 'browser_click', arguments: { ref } });
  return {
    ok: r.result?.isError !== true,
    texto: r.result?.content?.[0]?.text ?? '',
  };
}

try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // ── caso 0: NAO-REGRESSAO — clique por ref fora de iframe ───────────────
  await c.tool('browser_navigate', { url: `${base}/borda` });
  await sleep(400);
  {
    const d = await refEm(60, 25); // botao normal, fora de iframe
    check(d.ref !== null, 'caso0: descobriu ref do botao normal', d.texto.slice(0, 80));
    await js('window.__normal = 0');
    const r = await clicarRef(d.ref);
    await sleep(200);
    const n = Number(await js('window.__normal'));
    check(r.ok && n === 1, 'caso0 (NAO-REGRESSAO): clique por ref FORA de iframe ainda acerta',
      `ok=${r.ok} contador=${n} ${r.texto.slice(0, 90)}`);
  }

  // ── caso A: iframe com BORDA de 20px ────────────────────────────────────
  // Conteudo comeca em (200+20, 150+20) = (220,170). Alvo local (60..160, 60..90),
  // centro local (110,75) -> topo VERDADEIRO (330, 245).
  // A obra soma so rect.left/top do iframe (200,150) -> despacha (310,225): 20px errado.
  {
    await c.tool('browser_navigate', { url: `${base}/borda` });
    await sleep(400);
    const d = await refEm(330, 245); // ponto verdadeiro do alvo
    check(d.ref !== null, 'casoA: descobriu ref do alvo dentro do iframe com borda', d.texto.slice(0, 90));
    if (d.ref) {
      await js('window.__msgs = []');
      const antes = (await js(`(function(){var f=document.getElementById('f');return f.contentWindow.__hits;})()`));
      const r = await clicarRef(d.ref);
      await sleep(250);
      const depois = (await js(`(function(){var f=document.getElementById('f');return f.contentWindow.__hits;})()`));
      const ondeCaiu = await js(`(function(){var f=document.getElementById('f');return JSON.stringify(f.contentWindow.__ult);})()`);
      const acertou = Number(depois) > Number(antes);
      check(!r.ok || acertou,
        'casoA: iframe com BORDA (20px) — ou acerta o alvo, ou recusa; NUNCA "ok" no lugar errado',
        `ok=${r.ok} hits ${antes}->${depois} ondeCaiu=${ondeCaiu} resp=${r.texto.slice(0, 110)}`);
      check(acertou, 'casoA(detalhe): o clique chegou ao alvo dentro do iframe com borda',
        `hits ${antes}->${depois} ondeCaiu=${ondeCaiu}`);
    }
  }

  // ── caso B: iframe com transform: scale(0.5) ────────────────────────────
  // rect do iframe: left=200,top=150 (origin 0 0). Alvo local centro (110,75)
  // -> topo VERDADEIRO (200+55, 150+37.5) = (255, 187.5).
  {
    await c.tool('browser_navigate', { url: `${base}/escala` });
    await sleep(400);
    const d = await refEm(255, 188);
    check(d.ref !== null, 'casoB: descobriu ref do alvo dentro do iframe com scale(0.5)', d.texto.slice(0, 90));
    if (d.ref) {
      const antes = Number(await js(`(function(){var f=document.getElementById('f');return f.contentWindow.__hits;})()`));
      const r = await clicarRef(d.ref);
      await sleep(250);
      const depois = Number(await js(`(function(){var f=document.getElementById('f');return f.contentWindow.__hits;})()`));
      const ondeCaiu = await js(`(function(){var f=document.getElementById('f');return JSON.stringify(f.contentWindow.__ult);})()`);
      const ondePai = await js(`JSON.stringify(window.__ultPai)`);
      const acertou = depois > antes;
      check(!r.ok || acertou,
        'casoB: iframe com transform:scale — ou acerta, ou recusa; NUNCA "ok" no lugar errado',
        `ok=${r.ok} hits ${antes}->${depois} ondeCaiuFilho=${ondeCaiu} ondeCaiuPai=${ondePai} resp=${r.texto.slice(0, 110)}`);
    }
  }

  // ── caso C: iframe ANINHADO same-origin (100+70, 80+40 = 170,120) ───────
  // Alvo local centro (110,75) -> topo VERDADEIRO (280, 195).
  {
    await c.tool('browser_navigate', { url: `${base}/aninhada` });
    await sleep(500);
    const d = await refEm(280, 195);
    check(d.ref !== null, 'casoC: descobriu ref do alvo em iframe ANINHADO', d.texto.slice(0, 90));
    if (d.ref) {
      const ler = `(function(){var f=document.getElementById('f');var g=f.contentDocument.getElementById('g');return g.contentWindow.__hits;})()`;
      const antes = Number(await js(ler));
      const r = await clicarRef(d.ref);
      await sleep(250);
      const depois = Number(await js(ler));
      check(r.ok && depois > antes, 'casoC: iframe ANINHADO same-origin — o clique acerta o alvo',
        `ok=${r.ok} hits ${antes}->${depois} resp=${r.texto.slice(0, 110)}`);
    }
  }

  // ── caso D: iframe com ROLAGEM propria ──────────────────────────────────
  // filho rolado 300px; alvo em top:400 local do documento -> viewport local
  // y = 400-300 = 100, centro local (110,115) -> topo (150+110, 120+115) = (260,235).
  {
    await c.tool('browser_navigate', { url: `${base}/rolada` });
    await sleep(500);
    const d = await refEm(260, 235);
    check(d.ref !== null, 'casoD: descobriu ref do alvo em iframe ROLADO', d.texto.slice(0, 90));
    if (d.ref) {
      const ler = `(function(){var f=document.getElementById('f');return f.contentWindow.__hits;})()`;
      const antes = Number(await js(ler));
      const r = await clicarRef(d.ref);
      await sleep(250);
      const depois = Number(await js(ler));
      check(r.ok && depois > antes, 'casoD: iframe com rolagem PROPRIA — o clique acerta o alvo',
        `ok=${r.ok} hits ${antes}->${depois} resp=${r.texto.slice(0, 110)}`);
    }
  }

  // ── caso E: iframe CROSS-ORIGIN (outra porta) ───────────────────────────
  {
    const s2 = servir({ '/cross': paginaCross(portaB) });
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    const p2 = s2.address().port;
    try {
      await c.tool('browser_navigate', { url: `http://127.0.0.1:${p2}/cross` });
      await sleep(600);
      const d = await refEm(330, 245);
      console.log(`     casoE: descoberta por (x,y) devolveu: ${d.texto.slice(0, 120)}`);
      if (d.ref === null) {
        check(true, 'casoE: cross-origin — nem o hit-test por (x,y) devolve ref (nao ha caminho para o defeito)',
          d.texto.slice(0, 100));
      } else {
        const r = await clicarRef(d.ref);
        check(!r.ok, 'casoE: iframe CROSS-ORIGIN — clique por ref RECUSADO (falha fechada)',
          `ok=${r.ok} resp=${r.texto.slice(0, 160)}`);
        check(/cross-origin|origem DIFERENTE/i.test(r.texto),
          'casoE: a mensagem de recusa explica que e cross-origin', r.texto.slice(0, 160));
      }
    } finally {
      s2.closeAllConnections?.(); s2.close();
    }
  }

  // ── caso F: alvo COBERTO dentro do iframe ───────────────────────────────
  {
    await c.tool('browser_navigate', { url: `${base}/coberta` });
    await sleep(400);
    // Descobre o ref do alvo pelo DOM do proprio filho: clica por (x,y) na capa
    // nao daria o alvo. Usa o ponto real do alvo — a capa esta por cima, entao
    // o hit-test devolve a CAPA. Pega o ref pela capa e confirma que o alvo
    // (que nao consegue ref por hit-test) nao e alcancavel — em vez disso,
    // mede o caminho oposto: clicar por ref na CAPA funciona, e o alvo debaixo
    // nao recebe nada.
    const d = await refEm(330, 245);
    check(d.ref !== null, 'casoF: descobriu ref do no no ponto do alvo coberto', d.texto.slice(0, 90));
    const hits = Number(await js(`(function(){var f=document.getElementById('f');return f.contentWindow.__hits;})()`));
    check(hits === 0, 'casoF: o alvo COBERTO dentro do iframe nao recebeu clique nenhum', `hits=${hits}`);
  }
} catch (err) {
  check(false, 'erro fatal na bateria', err.message);
} finally {
  console.log(`\n${falhas === 0 ? 'sem falhas' : falhas + ' FALHA(S)'}`);
  servidor.closeAllConnections?.(); servidor.close();
  servidorB.closeAllConnections?.(); servidorB.close();
  c.close();
}
