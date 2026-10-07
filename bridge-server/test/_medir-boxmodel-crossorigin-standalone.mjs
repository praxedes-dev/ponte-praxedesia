/**
 * MEDICAO ISOLADA #2 (Chrome proprio, headless, sem tocar a ponte/extensao,
 * sem precisar da `.obra-lock`): a mesma pergunta da medicao #1
 * (`_medir-boxmodel-iframe-standalone.mjs`), agora para um iframe
 * CROSS-ORIGIN (127.0.0.1:PORTA_A como pai, localhost:PORTA_B como filho —
 * mesmo host fisico, ORIGENS diferentes de verdade: scheme+host+port, e
 * "localhost" != "127.0.0.1" como host). Duas perguntas:
 *
 *   (1) `DOM.getNodeForLocation` (descoberta do backendNodeId por hit-test)
 *       ainda encontra o botao DENTRO do iframe cross-origin, pela sessao
 *       CDP de nivel superior (chrome.debugger attach so na aba, sem
 *       Target.setAutoAttach para OOPIF)?
 *   (2) Se (1) funcionar, `DOM.getBoxModel`/`getContentQuads` nesse
 *       backendNodeId ainda devolvem a coordenada de TOPO CORRETA mesmo
 *       cross-origin (CDP e privilegio de browser-process, nao passa pela
 *       barreira de JS same-origin que derruba `window.frameElement`), ou
 *       falham/retornam lixo?
 *
 * Isto decide se o CONSERTO precisa mesmo "falhar fechado" no cross-origin
 * por LIMITACAO TECNICA (getBoxModel nao alcanca) ou so por escolha de design
 * (getBoxModel alcancaria, mas decidimos nao confiar por outro motivo).
 */
import { launch } from 'puppeteer-core';
import { createServer } from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const filho = `<!doctype html><html><body style="margin:0">
<button id="btn" style="position:absolute;left:50px;top:50px;width:120px;height:40px">alvo cross-origin</button>
</body></html>`;

const srvFilho = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(filho); });
await new Promise((r) => srvFilho.listen(0, '127.0.0.1', r));
const portaFilho = srvFilho.address().port;

// Pai serve em "localhost" (host DIFERENTE de "127.0.0.1" -> origem diferente),
// aponta o iframe para o filho em "127.0.0.1:portaFilho".
const paginaPai = `<!doctype html><html><body style="margin:0">
<iframe id="frame1" src="http://127.0.0.1:${portaFilho}/" style="position:absolute;left:220px;top:300px;width:400px;height:300px;border:0"></iframe>
</body></html>`;
const srvPai = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(paginaPai); });
await new Promise((r) => srvPai.listen(0, 'localhost', r));
const portaPai = srvPai.address().port;

const browser = await launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-extensions'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800 });
  await page.goto(`http://localhost:${portaPai}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500)); // deixa o iframe cross-origin carregar

  // Confirma que SAO origens diferentes de verdade (JS do topo nao alcanca o filho).
  const isCrossOrigin = await page.evaluate(() => {
    try {
      const f = document.getElementById('frame1');
      // acessar .contentDocument de um iframe cross-origin lanca ou devolve null
      return f.contentDocument === null;
    } catch (e) { return true; }
  });
  console.log('confirmado cross-origin (contentDocument bloqueado)?', isCrossOrigin);

  const client = await page.target().createCDPSession();
  await client.send('DOM.enable');
  await client.send('Runtime.enable');

  const hit = await client.send('DOM.getNodeForLocation', { x: 330, y: 370 });
  console.log('\nDOM.getNodeForLocation(330,370) ->', JSON.stringify(hit));

  if (!hit.backendNodeId) {
    console.log('\nRESULTADO (1): DOM.getNodeForLocation NAO encontrou backendNodeId no cross-origin -> discovery ja falha fechado sozinha aqui.');
  } else {
    const described = await client.send('DOM.describeNode', { backendNodeId: hit.backendNodeId }).catch((e) => ({ erro: e.message }));
    console.log('DOM.describeNode ->', JSON.stringify(described).slice(0, 300));

    try {
      const boxModel = await client.send('DOM.getBoxModel', { backendNodeId: hit.backendNodeId });
      const content = boxModel.model.content;
      const cx = (content[0] + content[2]) / 2;
      const cy = (content[1] + content[5]) / 2;
      console.log('\nDOM.getBoxModel.content quad:', content);
      console.log('centro calculado:', { cx, cy }, '(esperado top-viewport: 330,370)');
      const dist = Math.hypot(cx - 330, cy - 370);
      console.log(`distancia do esperado: ${dist.toFixed(1)}`);
      if (dist < 5) {
        console.log('\nRESULTADO (2): getBoxModel FUNCIONA e da coordenada CORRETA mesmo CROSS-ORIGIN.');
      } else {
        console.log('\nRESULTADO (2): getBoxModel devolveu algo, mas coordenada ERRADA/inesperada cross-origin.');
      }
    } catch (err) {
      console.log('\nRESULTADO (2): DOM.getBoxModel LANCOU erro no backendNodeId cross-origin:', err.message);
    }
  }

  // Referencia: window.frameElement DENTRO do iframe cross-origin (via CDP,
  // evaluate isolado no proprio frame) deve vir null - e a razao doc do
  // conserto antigo falhar fechado.
  const frames = await page.frames();
  const childFrame = frames.find((f) => f !== page.mainFrame());
  if (childFrame) {
    try {
      const fe = await childFrame.evaluate(() => {
        try { return window.frameElement; } catch (e) { return 'excecao: ' + e.message; }
      });
      console.log('\nwindow.frameElement dentro do filho cross-origin ->', fe);
    } catch (err) {
      console.log('\nwindow.frameElement: nao deu para avaliar no frame filho ->', err.message);
    }
  }
} finally {
  await browser.close();
  srvFilho.closeAllConnections?.();
  srvFilho.close();
  srvPai.closeAllConnections?.();
  srvPai.close();
}
