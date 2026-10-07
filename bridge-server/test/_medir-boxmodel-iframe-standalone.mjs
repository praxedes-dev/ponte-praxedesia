/**
 * MEDICAO ISOLADA (Chrome PROPRIO, headless, via puppeteer-core — NAO toca o
 * Chrome do Dr. Cezar nem a ponte/extensao, nao precisa da `.obra-lock`):
 * testa a hipotese do briefing — `DOM.getBoxModel` / `DOM.getContentQuads`
 * para um elemento DENTRO de um <iframe> ja devolvem coordenada de viewport
 * do TOPO da pagina, ou devolvem coordenada LOCAL ao proprio iframe (que
 * exigiria a soma manual que `deslocamentoAteTopo` faz)?
 *
 * DESENHO identico ao teste da bancada (medicao-clique-iframe.js): iframe
 * deslocado left=220,top=300,w=400,h=300; botao dentro do iframe em
 * left=50,top=50,w=120,h=40 (LOCAL ao proprio documento do iframe) -> centro
 * local (110,70); centro em coordenada de TOPO esperado (220+110,300+70) =
 * (330,370).
 *
 * METODO: usa APENAS a sessao CDP de NIVEL SUPERIOR (a mesma topologia do
 * `chrome.debugger.attach({tabId})` da extensao real — um unico anexo por
 * ABA, nao por frame) para descobrir o backendNodeId via
 * `DOM.getNodeForLocation` (hit-test por coordenada de TOPO, o mesmo caminho
 * que `medicao-clique-iframe.js` usa para "descobrir" o ref sem depender do
 * ax-tree, que nao desce em iframe). NAO usa `frame.$()`/`ElementHandle` do
 * puppeteer para o alvo em si, porque o Puppeteer autoanexa uma sessao CDP
 * SEPARADA por frame (confirmado nesta sessao: objectId de `frame.$()` tem
 * formato "sessao.contexto.objeto" e `DOM.describeNode` na sessao do TOPO
 * rejeita com "Could not find object with given id" — objectId e escopado
 * por sessao). Isso teria confundido a medicao (erro de sessao, nao de
 * coordenada). O caminho por `DOM.getNodeForLocation` bate exatamente com o
 * que a producao faz.
 */
import { launch } from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const paginaPai = `<!doctype html><html><body style="margin:0">
<iframe id="frame1" src="about:blank" style="position:absolute;left:220px;top:300px;width:400px;height:300px;border:0"></iframe>
</body></html>`;

const browser = await launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-extensions'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800 });
  await page.setContent(paginaPai, { waitUntil: 'load' });

  const frameHandle = await page.$('#frame1');
  const frame = await frameHandle.contentFrame();
  await frame.setContent(`<!doctype html><html><body style="margin:0">
    <button id="btn" style="position:absolute;left:50px;top:50px;width:120px;height:40px">alvo</button>
  </body></html>`, { waitUntil: 'load' });

  // Sessao CDP UNICA, de nivel superior — igual ao chrome.debugger.attach({tabId}).
  const client = await page.target().createCDPSession();
  await client.send('DOM.enable');
  await client.send('Runtime.enable');

  // Hit-test por coordenada de TOPO no centro esperado do botao (330,370).
  const hit = await client.send('DOM.getNodeForLocation', { x: 330, y: 370 });
  console.log('DOM.getNodeForLocation(330,370) ->', JSON.stringify(hit));
  const backendNodeId = hit.backendNodeId;
  if (!backendNodeId) throw new Error('hit-test nao devolveu backendNodeId');

  // Confirma que achou o botao certo (nao o body/html/iframe).
  const described = await client.send('DOM.describeNode', { backendNodeId });
  console.log('DOM.describeNode ->', JSON.stringify(described.node).slice(0, 200));

  const boxModel = await client.send('DOM.getBoxModel', { backendNodeId });
  const content = boxModel.model.content;
  const cx = (content[0] + content[2]) / 2;
  const cy = (content[1] + content[5]) / 2;
  console.log('\nDOM.getBoxModel.content quad:', content);
  console.log('centro calculado do quad (getBoxModel):', { cx, cy });

  const cq = await client.send('DOM.getContentQuads', { backendNodeId });
  console.log('\nDOM.getContentQuads:', JSON.stringify(cq.quads));
  const q = cq.quads[0];
  const cx2 = (q[0] + q[2]) / 2;
  const cy2 = (q[1] + q[5]) / 2;
  console.log('centro calculado do quad (getContentQuads):', { cx: cx2, cy: cy2 });

  const esperadoTopo = { x: 220 + 50 + 60, y: 300 + 50 + 20 }; // (330,370)
  const esperadoLocal = { x: 110, y: 70 };

  console.log('\n=== VEREDITO ===');
  for (const [nome, [px, py]] of [['getBoxModel', [cx, cy]], ['getContentQuads', [cx2, cy2]]]) {
    const distTopo = Math.hypot(px - esperadoTopo.x, py - esperadoTopo.y);
    const distLocal = Math.hypot(px - esperadoLocal.x, py - esperadoLocal.y);
    console.log(`\n${nome}: centro (${px}, ${py})`);
    console.log(`  distancia do esperado-TOPO (330,370): ${distTopo.toFixed(1)}`);
    console.log(`  distancia do esperado-LOCAL (110,70): ${distLocal.toFixed(1)}`);
    if (distTopo < 5) {
      console.log(`  -> ${nome} JA DEVOLVE coordenada de VIEWPORT DO TOPO. Soma manual DESNECESSARIA.`);
    } else if (distLocal < 5) {
      console.log(`  -> ${nome} devolve coordenada LOCAL ao iframe. Soma manual NECESSARIA.`);
    } else {
      console.log(`  -> INESPERADO, nao bate com nenhuma hipotese.`);
    }
  }
} finally {
  await browser.close();
}
