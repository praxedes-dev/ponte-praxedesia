/**
 * MEDICAO do defeito de conversao de coordenadas em clique-por-ref DENTRO de
 * <iframe> (briefing "conserta a checagem de clique DENTRO DE IFRAME",
 * 06/09/2026). Corrida ao vivo, contra o codigo ANTES do conserto em
 * `cdp-tools.ts` (o conserto foi escrito na mesma sessao, mas o build+reload
 * ficou bloqueado — a trava `.obra-lock` ficou presa com "obra-alvo-unico"
 * pelos 5 ciclos de 60s que o briefing permite. Isto e MEDICAO, nao e ainda
 * o teste de regressao do criterio de pronto — quem retomar precisa: (1)
 * pegar a trava, (2) `npm run build` + `npm run reload`, (3) rodar este
 * arquivo nele mesmo (deve virar OK em vez de reproduzir o defeito, ja que o
 * conserto ja esta escrito), (4) so entao escrever/expandir o teste de
 * regressao formal com os casos cobertos/aninhado/cross-origin do criterio
 * de pronto (ver ESTADO no relatorio do pedreiro).
 *
 * DESENHO: iframe deslocado 220px (esquerda) x 300px (topo) da pagina PAI.
 * Botao dentro do iframe tem rect LOCAL (relativo ao PROPRIO documento do
 * iframe) em x=50,y=50,w=120,h=40 -> centro local (110,70). Um "decoy" na
 * pagina PAI fica posicionado exatamente nesse ponto — (50,50) a (170,90) —
 * em coordenada de VIEWPORT DO TOPO. Dois contadores independentes:
 *   - decoy incrementa por onclick DIRETO nele (na pagina pai)
 *   - iframe incrementa por postMessage que SO o botao de verdade dispara
 * Se o clique despachar a coordenada LOCAL do frame sem converter, cai no
 * decoy. Se converter certo (soma o deslocamento do iframe: 220+110,
 * 300+70 = 330,370), cai no botao de verdade.
 *
 * COMO OBTER UM `ref` (backendNodeId) DENTRO DO IFRAME: `browser_read_page`
 * (Accessibility.getFullAXTree, ax-tree.ts) NAO desce para dentro de
 * <iframe> nesta versao do Chrome — MEDIDO separadamente (nao neste
 * arquivo): uma pagina com um botao FORA do iframe e outro DENTRO so lista o
 * de fora. Isto e comportamento pre-existente do modulo ax-tree.ts (fora do
 * escopo deste conserto — so cdp-tools.ts pode ser tocado aqui) e significa
 * que a UNICA leitura normal da pagina nunca entrega ao agente um `ref` para
 * conteudo de iframe hoje. MAS `browser_click({x,y})` (cap_click_xy) usa
 * `DOM.getNodeForLocation`, que FAZ hit-test atraves do iframe corretamente
 * (coordenada de entrada e de TOPO, que e o sistema certo para hit-test) — e
 * a mensagem de retorno da tool inclui o backendNodeId resolvido
 * ("...sobre o no N"). Um agente real chega nesse numero clicando por
 * coordenada uma vez (ex.: durante exploracao) e reusando o ref depois — e
 * exatamente o que este script faz para obter um `ref` de verdade sem tocar
 * ax-tree.ts.
 *
 * RESULTADO MEDIDO (06/09/2026, contra o codigo ANTES do conserto):
 *   (a) clicar por ref no botao dentro do iframe FUNCIONA sem lancar erro.
 *   (b) a checagem de cobertura (`pontoPertenceAoElemento`) APROVA (nao
 *       lanca "coberto") — porque `elementFromPoint` roda DENTRO do
 *       documento do iframe, no MESMO sistema de coordenadas LOCAL que o
 *       rect do alvo, entao os dois batem e a checagem confirma "certo".
 *   (c) o clique REAL cai no elemento ERRADO: o decoy da pagina pai
 *       incrementa (0 -> 1), o botao de verdade dentro do iframe NAO recebe
 *       o segundo clique (fica em 1, o mesmo valor de quando foi clicado por
 *       x/y na etapa de descoberta). Zero incompatibilidade com a hipotese
 *       do briefing: aprova o que deveria barrar (ou, mais preciso aqui,
 *       aprova e clica no lugar errado sem avisar).
 *
 *   node test/medicao-clique-iframe.js
 */
import { createServer } from 'node:http';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const paginaPai = `<!doctype html><html><body style="margin:0;background:#eee">
<div id="decoy" style="position:fixed;left:50px;top:50px;width:120px;height:40px;background:orange;color:#000"
  onclick="window.__decoyClicks=(window.__decoyClicks||0)+1">DECOY (fora do iframe)</div>
<iframe id="frame1" src="/filho" style="position:absolute;left:220px;top:300px;width:400px;height:300px;border:2px solid blue"></iframe>
<script>
window.__decoyClicks = 0;
window.__iframeClicks = 0;
window.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'iframe-click') window.__iframeClicks++;
});
</script>
</body></html>`;

const paginaFilho = `<!doctype html><html><body style="margin:0">
<button id="btn-iframe" aria-label="Botao dentro do iframe medicao"
  style="position:absolute;left:50px;top:50px;width:120px;height:40px"
  onclick="parent.postMessage({tipo:'iframe-click'}, '*')">Clique aqui (iframe)</button>
</body></html>`;

const servidor = createServer((req, res) => {
  if (req.url === '/pai') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(paginaPai); return; }
  if (req.url === '/filho') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(paginaFilho); return; }
  res.writeHead(404); res.end('nao encontrado');
});

await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const porta = servidor.address().port;
const urlPai = `http://127.0.0.1:${porta}/pai`;

const c = startClient('medicao-clique-iframe');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: urlPai });
  await c.tool('browser_wait_network', {}).catch(() => {});
  await sleep(300);

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();

  // ── Descoberta do ref: clique por (x,y) no ponto de TOPO onde o botao do
  // iframe realmente esta na tela (220+110, 300+70) = (330,370). Isto usa
  // `DOM.getNodeForLocation` (cap_click_xy), que hit-testa corretamente
  // atraves do iframe, e devolve o backendNodeId na mensagem.
  const respXY = await c.tool('browser_click', { x: 330, y: 370 });
  const textoXY = respXY.content[0].text;
  console.log('resposta do clique por (x,y) [descoberta do ref]:', textoXY);
  const m = textoXY.match(/sobre o no (\d+)/);
  check(m !== null, 'o clique por (x,y) devolveu um backendNodeId (formato "sobre o no N")', textoXY.slice(0, 160));
  if (!m) throw new Error('sem backendNodeId — nao da para prosseguir com a medicao');
  const ref = Number(m[1]);

  await sleep(200);
  const decoyAposXY = Number(await js('window.__decoyClicks'));
  const iframeAposXY = Number(await js('window.__iframeClicks'));
  check(decoyAposXY === 0, 'o clique por (x,y) NAO caiu no decoy (hit-test por coordenada ja funciona certo)', `decoy=${decoyAposXY}`);
  check(iframeAposXY === 1, 'o clique por (x,y) caiu no botao de verdade dentro do iframe', `iframe=${iframeAposXY}`);

  // ── A MEDICAO: reusar o MESMO backendNodeId agora com browser_click({ref}) ──
  console.log(`\nreusando o ref=${ref} (agora conhecido) com browser_click({ref})...`);
  let erro = null;
  try {
    const respRef = await c.tool('browser_click', { ref });
    console.log('resposta:', JSON.stringify(respRef.content?.[0]?.text ?? respRef).slice(0, 200));
  } catch (err) {
    erro = err;
    console.log('lancou erro:', err.message.slice(0, 300));
  }

  await sleep(200);
  const decoyFinal = Number(await js('window.__decoyClicks'));
  const iframeFinal = Number(await js('window.__iframeClicks'));

  console.log('\n=== RESUMO DA MEDICAO (contra o codigo sem o conserto) ===');
  console.log('(a) funcionou sem lancar excecao?', erro === null);
  console.log('(b) a checagem aprovou ou barrou?', erro === null ? 'APROVOU (ok:true)' : `BARROU: ${erro.message.slice(0, 120)}`);
  console.log('(c) o clique caiu no elemento CERTO (iframe, nao decoy)?', iframeFinal > iframeAposXY && decoyFinal === decoyAposXY);
  console.log(`contadores: decoy ${decoyAposXY} -> ${decoyFinal} | iframe ${iframeAposXY} -> ${iframeFinal}`);

  // NAO e um check() de pass/fail — este arquivo e MEDICAO, e o mesmo
  // arquivo roda tanto ANTES quanto DEPOIS do conserto (e deve rodar de
  // novo, contra o build novo, assim que a trava liberar). O veredito muda
  // de sentido conforme o codigo:
  //   ANTES do conserto (medido nesta sessao): decoyFinal > decoyAposXY E
  //     iframeFinal === iframeAposXY -> confirma o defeito.
  //   DEPOIS do conserto (esperado, AINDA NAO VERIFICADO — trava presa):
  //     decoyFinal === decoyAposXY E iframeFinal > iframeAposXY -> conserto
  //     funcionando (segundo clique, por ref, tambem acerta o botao).
  const decoyGanhouClique = decoyFinal > decoyAposXY;
  const iframeGanhouSegundoClique = iframeFinal > iframeAposXY;
  console.log('\nVEREDITO:');
  if (erro === null && decoyGanhouClique && !iframeGanhouSegundoClique) {
    console.log('DEFEITO CONFIRMADO — clique por ref aprovou e caiu no elemento ERRADO (decoy), nao no botao dentro do iframe.');
  } else if (erro === null && !decoyGanhouClique && iframeGanhouSegundoClique) {
    console.log('CONSERTO CONFIRMADO — clique por ref aprovou e caiu no elemento CERTO (o botao dentro do iframe).');
  } else if (erro !== null) {
    console.log(`clique por ref foi BARRADO (erro): ${erro.message.slice(0, 200)}`);
  } else {
    console.log('padrao INESPERADO — nem o decoy nem o iframe registraram o clique novo (ou os dois registraram). Investigar manualmente.');
  }
} catch (err) {
  console.error('ERRO GERAL:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
  servidor.closeAllConnections?.();
  servidor.close();
}
