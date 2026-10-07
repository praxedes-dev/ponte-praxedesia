/**
 * MEDICAO ISOLADA #3 (Chrome proprio, headless, sem lock): `DOM.getBoxModel`/
 * `getContentQuads` continuam corretos quando o <iframe> tem BORDER+PADDING
 * (desloca o inicio do documento filho em relacao a borda externa do
 * elemento) e quando ha um `transform: scale()` num ANCESTRAL do iframe?
 *
 * Caso A — border+padding: iframe com border=10px, padding=15px. O
 * documento filho comeca visualmente em (outerLeft+25, outerTop+25), NAO em
 * (outerLeft, outerTop) como a soma ingenua de `getBoundingClientRect()` do
 * proprio `<iframe>` assumiria (essa e a lacuna que o cetico apontou:
 * `frameElement.getBoundingClientRect()` da a BORDER-BOX externa, sem somar
 * clientLeft/clientTop nem padding).
 *
 * Caso B — transform: scale(1.5) num DIV que envolve o iframe. O botao real
 * na tela fica maior E deslocado por causa do scale. Uma soma aditiva de
 * retangulos (dx,dy fixos) erraria; queremos saber se `getBoxModel` ja
 * devolve a posicao FINAL pos-transform corretamente.
 */
import { launch } from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function medir(nome, htmlPai, htmlFilho, esperado) {
  console.log(`\n\n########## ${nome} ##########`);
  const browser = await launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-extensions'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setContent(htmlPai, { waitUntil: 'load' });
    const frameHandle = await page.$('#frame1');
    const frame = await frameHandle.contentFrame();
    await frame.setContent(htmlFilho, { waitUntil: 'load' });

    const client = await page.target().createCDPSession();
    await client.send('DOM.enable');
    await client.send('Runtime.enable');

    // Descobre o backendNodeId do botao por hit-test no ponto ESPERADO.
    const hit = await client.send('DOM.getNodeForLocation', { x: Math.round(esperado.x), y: Math.round(esperado.y) });
    console.log('hit-test em', esperado, '->', JSON.stringify(hit));
    if (!hit.backendNodeId) { console.log('NAO achou node no ponto esperado — layout diferente do previsto, investigar manualmente.'); return; }
    const described = await client.send('DOM.describeNode', { backendNodeId: hit.backendNodeId });
    console.log('describeNode:', described.node.nodeName, described.node.attributes?.slice(0, 4));

    const boxModel = await client.send('DOM.getBoxModel', { backendNodeId: hit.backendNodeId });
    const c = boxModel.model.content;
    const cx = (c[0] + c[2]) / 2, cy = (c[1] + c[5]) / 2;
    console.log('content quad:', c);
    console.log('centro:', { cx, cy }, 'esperado:', esperado);
    const dist = Math.hypot(cx - esperado.x, cy - esperado.y);
    console.log(`distancia do esperado: ${dist.toFixed(1)}px -> ${dist < 3 ? 'BATE (getBoxModel correto)' : 'NAO BATE'}`);

    // Lado do quad (para detectar escala/rotacao): comprimento top-edge e left-edge.
    const topEdge = Math.hypot(c[2] - c[0], c[3] - c[1]);
    const leftEdge = Math.hypot(c[6] - c[0], c[7] - c[1]);
    console.log('comprimento da aresta superior do quad:', topEdge.toFixed(1), '| lateral esquerda:', leftEdge.toFixed(1));
  } finally {
    await browser.close();
  }
}

// ── Caso A: border + padding no proprio <iframe> ──────────────────────────
// iframe: left=220,top=300, border=10px solid, padding=15px -> conteudo do
// filho comeca visualmente em (220+10+15, 300+10+15) = (245,325).
// Botao dentro do filho: left=50,top=50,w=120,h=40 (LOCAL) -> centro local (110,70).
// Centro esperado em TOPO: (245+110, 325+70) = (355, 395).
await medir(
  'CASO A: iframe com border(10px)+padding(15px)',
  `<!doctype html><html><body style="margin:0">
    <iframe id="frame1" src="about:blank" style="position:absolute;left:220px;top:300px;width:400px;height:300px;border:10px solid red;padding:15px;box-sizing:border-box"></iframe>
  </body></html>`,
  `<!doctype html><html><body style="margin:0">
    <button id="btn" style="position:absolute;left:50px;top:50px;width:120px;height:40px">alvo</button>
  </body></html>`,
  { x: 355, y: 395 },
);

// ── Caso B: transform:scale(1.5) num DIV ancestral do iframe ─────────────
// wrapper: position absolute left=100,top=100, transform-origin 0 0, scale(1.5).
// Dentro do wrapper (espaco NAO escalado), iframe em left=0,top=0,w=400,h=300.
// Apos scale(1.5) a partir de (100,100): um ponto (px,py) DENTRO do wrapper
// (relativo ao wrapper, ANTES do transform) aparece na tela em
// (100 + px*1.5, 100 + py*1.5).
// Botao local no filho: left=50,top=50,w=120,h=40 -> centro local (110,70).
// Centro do botao no espaco NAO escalado do wrapper (iframe em 0,0): (110,70).
// Centro na TELA apos scale 1.5 a partir de (100,100): (100+110*1.5, 100+70*1.5)
//   = (100+165, 100+105) = (265, 205).
await medir(
  'CASO B: transform:scale(1.5) num ancestral do iframe',
  `<!doctype html><html><body style="margin:0">
    <div style="position:absolute;left:100px;top:100px;width:400px;height:300px;transform:scale(1.5);transform-origin:0 0">
      <iframe id="frame1" src="about:blank" style="position:absolute;left:0;top:0;width:400px;height:300px;border:0"></iframe>
    </div>
  </body></html>`,
  `<!doctype html><html><body style="margin:0">
    <button id="btn" style="position:absolute;left:50px;top:50px;width:120px;height:40px">alvo</button>
  </body></html>`,
  { x: 265, y: 205 },
);
