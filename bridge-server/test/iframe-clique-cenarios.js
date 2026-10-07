/**
 * REGRESSAO do conserto "clique por ref DENTRO de iframe" (2a versao,
 * 07/09/2026 — ver o comentario "CONSERTO, 2a VERSAO" no topo de
 * `entrypoints/background/execution-engine/cdp-tools.ts`). Diferente de
 * `medicao-clique-iframe.js` (que so MEDE um caso simples e imprime
 * "DEFEITO"/"CONSERTO CONFIRMADO"), este arquivo e teste de regressao
 * pass/fail (`check()`) para os cenarios do criterio de pronto que o caso
 * simples nao cobre:
 *
 *   1. IFRAME ANINHADO (2 niveis, same-origin) — prova que
 *      `confirmarCadeiaAteTopo` soma profundidade > 1 corretamente e que
 *      `DOM.getBoxModel` do elemento mais interno ja da a coordenada de
 *      TOPO certa atravessando os dois niveis numa unica chamada.
 *   2. COBERTURA PARCIAL dentro de iframe (centro tapado, canto livre) —
 *      prova que `mapearLocalParaTopo` mapeia corretamente um ponto
 *      OFF-CENTER (fx/fy != 0.5), nao so o centro do elemento. Este e o
 *      caso mais importante para a interpolacao afim: se o mapeamento so
 *      funcionasse para o centro (ex.: um bug que sempre usasse fx=fy=0.5),
 *      este teste pegaria — o clique cairia fora do alvo real.
 *   3. COBERTURA TOTAL dentro de iframe — prova que a checagem de cobertura
 *      (LOCAL, `pontoPertenceAoElemento`, inalterada por este conserto)
 *      continua barrando corretamente mesmo quando o alvo esta num iframe.
 *   4. IFRAME COM ROLAGEM PROPRIA — o alvo comeca fora da area visivel do
 *      proprio iframe (abaixo da dobra do CONTEUDO do iframe, nao da pagina
 *      pai), e so fica clicavel depois de rolar o iframe por dentro. Prova
 *      que tanto `getBoundingClientRect` (para a checagem local) quanto
 *      `DOM.getBoxModel` (para o mapeamento final) refletem a rolagem
 *      atual no momento do clique, nao uma posicao capturada antes.
 *
 * NAO cobre cross-origin (ver a nota extensa no fim deste arquivo sobre por
 * que um teste AO VIVO desse caminho, usando so o tool surface da ponte,
 * nao prova o que promete — e o que fazer a respeito).
 *
 * PRE-REQUISITO PARA RODAR: `.obra-lock` livre, build atual (com o conserto
 * de `cdp-tools.ts`) + `npm run reload` feitos ANTES de chamar este arquivo
 * — ver protocolo em `docs/obra-20260904/00-PLANO-DE-OBRA.md` §4. Esta
 * sessao NAO conseguiu rodar este arquivo (a trava nunca liberou); fica
 * pronto para quem pegar a trava livre.
 *
 *   node test/iframe-clique-cenarios.js
 */
import { createServer } from 'node:http';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

// ── Paginas servidas ────────────────────────────────────────────────────

// Cenario 1: iframe ANINHADO, 2 niveis. Pagina raiz -> iframe "meio" (offset
// 80,60) -> iframe "interno" (offset LOCAL ao meio: 40,30) -> botao (LOCAL
// ao interno: left=20,top=15,w=100,h=36). Top esperado do centro do botao:
// (80+40+20+50, 60+30+15+18) = (190,123). Decoy fica no ponto que uma soma
// de SO 1 nivel (bug de profundidade) produziria: (80+20+50,60+15+18) =
// (150,93) — se `confirmarCadeiaAteTopo`/mapeamento parasse cedo, o clique
// cairia ali.
const paginaRaizAninhado = `<!doctype html><html><body style="margin:0;background:#eee">
<div id="decoyProfundidade" style="position:fixed;left:100px;top:63px;width:100px;height:60px;background:orange"
  onclick="window.__decoyProfundidade=(window.__decoyProfundidade||0)+1"></div>
<iframe id="meio" src="/meio" style="position:absolute;left:80px;top:60px;width:300px;height:250px;border:0"></iframe>
<script>
window.__decoyProfundidade = 0;
window.__botaoAninhadoClicks = 0;
window.addEventListener('message', (e) => {
  if (e.data && e.data.tipo === 'botao-aninhado') window.__botaoAninhadoClicks++;
});
</script>
</body></html>`;

const paginaMeio = `<!doctype html><html><body style="margin:0">
<iframe id="interno" src="/interno" style="position:absolute;left:40px;top:30px;width:200px;height:180px;border:0"></iframe>
</body></html>`;

const paginaInterno = `<!doctype html><html><body style="margin:0">
<button id="btnAninhado" aria-label="Botao aninhado 2 niveis"
  style="position:absolute;left:20px;top:15px;width:100px;height:36px"
  onclick="parent.parent.postMessage({tipo:'botao-aninhado'}, '*')">Aninhado</button>
</body></html>`;

// Cenario 2/3: iframe simples (offset 150,100) com um botao alvo de 240x60
// em LOCAL (30,30). Um "cobridor" de tamanho ajustavel via query string cobre
// so o centro (parcial, cenario 2) ou o retangulo inteiro (total, cenario 3).
const paginaRaizCobertura = `<!doctype html><html><body style="margin:0">
<iframe id="frameCobertura" src="/cobertura" style="position:absolute;left:150px;top:100px;width:350px;height:200px;border:0"></iframe>
</body></html>`;

const paginaCobertura = `<!doctype html><html><body style="margin:0">
<button id="alvoCoberto" aria-label="Botao alvo dentro de iframe com cobertura"
  style="position:absolute;left:30px;top:30px;width:240px;height:60px;z-index:1"
  onclick="window.__cliquesAlvo=(window.__cliquesAlvo||0)+1">Alvo</button>
<div id="cobridor" style="position:absolute;z-index:9;background:red"
  onclick="window.__cliquesCobridor=(window.__cliquesCobridor||0)+1"></div>
<script>window.__cliquesAlvo = 0; window.__cliquesCobridor = 0;</script>
</body></html>`;

// Cenario 4: iframe (offset 200,150, tamanho 300x200) cujo PROPRIO documento
// e mais alto que a area visivel (800px de altura) — o botao esta a
// scrollTop=500 dentro do iframe, fora da vista ate rolar.
const paginaRaizRolagem = `<!doctype html><html><body style="margin:0">
<iframe id="frameRolagem" src="/rolagem" style="position:absolute;left:200px;top:150px;width:300px;height:200px;border:0"></iframe>
</body></html>`;

const paginaRolagem = `<!doctype html><html><body style="margin:0;height:900px">
<button id="btnRolado" aria-label="Botao abaixo da dobra do iframe"
  style="position:absolute;left:40px;top:520px;width:180px;height:44px"
  onclick="window.__cliquesRolado=(window.__cliquesRolado||0)+1">Rolado</button>
<script>window.__cliquesRolado = 0;</script>
</body></html>`;

const servidor = createServer((req, res) => {
  const rotas = {
    '/raiz-aninhado': paginaRaizAninhado,
    '/meio': paginaMeio,
    '/interno': paginaInterno,
    '/raiz-cobertura': paginaRaizCobertura,
    '/cobertura': paginaCobertura,
    '/raiz-rolagem': paginaRaizRolagem,
    '/rolagem': paginaRolagem,
  };
  const corpo = rotas[req.url];
  if (corpo) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(corpo); return; }
  res.writeHead(404); res.end('nao encontrado');
});

await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const porta = servidor.address().port;
const url = (caminho) => `http://127.0.0.1:${porta}${caminho}`;

const c = startClient('iframe-clique-cenarios');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  // Descobre um `ref` por hit-test de coordenada (mesma tecnica de
  // `medicao-clique-iframe.js` — `browser_read_page` nao desce em iframe).
  const refPorXY = async (x, y) => {
    const resp = await c.tool('browser_click', { x, y });
    const texto = resp.content[0].text;
    const m = texto.match(/sobre o no (\d+)/);
    if (!m) throw new Error(`hit-test em (${x},${y}) nao devolveu backendNodeId: ${texto.slice(0, 200)}`);
    return Number(m[1]);
  };

  // ══════════════════════════════════════════════════════════════════════
  // CENARIO 1 — iframe ANINHADO, 2 niveis
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n=== CENARIO 1: iframe aninhado (2 niveis) ===');
  await c.tool('browser_navigate', { url: url('/raiz-aninhado') });
  await c.tool('browser_wait_network', {}).catch(() => {});
  await sleep(400);

  const refAninhado = await refPorXY(190, 123);
  const decoyAntes = Number(await js('window.__decoyProfundidade'));
  const aninhadoAntes = Number(await js('window.__botaoAninhadoClicks'));
  check(decoyAntes === 0, 'descoberta por (x,y) nao caiu no decoy de profundidade', `decoy=${decoyAntes}`);
  check(aninhadoAntes === 1, 'descoberta por (x,y) achou o botao aninhado de verdade', `aninhado=${aninhadoAntes}`);

  await c.tool('browser_click', { ref: refAninhado });
  await sleep(200);
  const decoyDepois = Number(await js('window.__decoyProfundidade'));
  const aninhadoDepois = Number(await js('window.__botaoAninhadoClicks'));
  check(decoyDepois === decoyAntes, 'clique por REF (2 niveis de iframe) nao caiu no decoy', `decoy ${decoyAntes}->${decoyDepois}`);
  check(aninhadoDepois === aninhadoAntes + 1, 'clique por REF (2 niveis de iframe) acertou o botao real', `aninhado ${aninhadoAntes}->${aninhadoDepois}`);

  // ══════════════════════════════════════════════════════════════════════
  // CENARIO 2 — cobertura PARCIAL dentro de iframe (ponto OFF-CENTER)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n=== CENARIO 2: cobertura parcial dentro de iframe (mapeamento off-center) ===');
  await c.tool('browser_navigate', { url: url('/raiz-cobertura') });
  await c.tool('browser_wait_network', {}).catch(() => {});
  await sleep(400);

  // Cobridor cobre so o CENTRO do alvo (alvo LOCAL 30,30,240x60 -> centro
  // local 150,60). Cobridor de 80x30 centralizado nesse ponto: LOCAL
  // (110,45) a (190,75). Top do alvo = iframe(150,100) + local(30,30..270,90)
  // = topo (180,130) a (420,190); centro top (300,160).
  await js(`(function(){
    var f = document.getElementById('frameCobertura');
    var d = f.contentDocument;
    var cob = d.getElementById('cobridor');
    cob.style.left = '110px'; cob.style.top = '45px';
    cob.style.width = '80px'; cob.style.height = '30px';
    return 'ok';
  })()`);
  await sleep(150);

  const refCobParcial = await refPorXY(300, 160); // centro do alvo, em TOPO
  const alvoAntesP = Number(await js('window.__cliquesAlvo'));
  const cobridorAntesP = Number(await js('window.__cliquesCobridor'));

  await c.tool('browser_click', { ref: refCobParcial });
  await sleep(200);
  const alvoDepoisP = Number(await js('window.__cliquesAlvo'));
  const cobridorDepoisP = Number(await js('window.__cliquesCobridor'));
  check(
    alvoDepoisP === alvoAntesP + 1,
    'COBERTURA PARCIAL em iframe: clicou no ALVO (canto livre, ponto off-center mapeado certo)',
    `alvo ${alvoAntesP}->${alvoDepoisP}`,
  );
  check(cobridorDepoisP === cobridorAntesP, 'COBERTURA PARCIAL em iframe: cobridor do centro NAO recebeu o clique', `cobridor ${cobridorAntesP}->${cobridorDepoisP}`);

  // ══════════════════════════════════════════════════════════════════════
  // CENARIO 3 — cobertura TOTAL dentro de iframe -> ERRO
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n=== CENARIO 3: cobertura total dentro de iframe -> erro ===');
  await js(`(function(){
    var f = document.getElementById('frameCobertura');
    var d = f.contentDocument;
    var cob = d.getElementById('cobridor');
    cob.style.left = '30px'; cob.style.top = '30px';
    cob.style.width = '240px'; cob.style.height = '60px';
    window.__cliquesAlvo = 0; window.__cliquesCobridor = 0;
    return 'ok';
  })()`);
  await sleep(150);

  let erroCobTotal = null;
  try {
    await c.tool('browser_click', { ref: refCobParcial }); // mesmo ref, alvo continua o mesmo elemento
  } catch (err) {
    erroCobTotal = err;
  }
  check(erroCobTotal !== null, 'COBERTURA TOTAL em iframe: clique voltou ERRO (nao ok:true)', String(erroCobTotal?.message).slice(0, 200));
  check(/cobert/i.test(String(erroCobTotal?.message)), 'a mensagem diz que esta coberto', String(erroCobTotal?.message).slice(0, 200));
  const alvoAposTotal = Number(await js('window.__cliquesAlvo'));
  const cobridorAposTotal = Number(await js('window.__cliquesCobridor'));
  check(alvoAposTotal === 0 && cobridorAposTotal === 0, 'nenhum dos dois recebeu clique (tool nao despachou)', `alvo=${alvoAposTotal} cobridor=${cobridorAposTotal}`);

  // ══════════════════════════════════════════════════════════════════════
  // CENARIO 4 — iframe com ROLAGEM PROPRIA
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n=== CENARIO 4: iframe com rolagem propria ===');
  await c.tool('browser_navigate', { url: url('/raiz-rolagem') });
  await c.tool('browser_wait_network', {}).catch(() => {});
  await sleep(400);

  // Antes de rolar, o botao (top local 520px) esta fora da area visivel do
  // iframe (altura 200px) — hit-test no ponto onde ELE apareceria depois de
  // rolar (mas antes de rolar) deve achar OUTRO elemento (o body do iframe,
  // vazio ali), nunca o botao. Prova que o teste nao esta testando um
  // elemento que ja estava visivel por acidente.
  const antesDeRolar = await c.tool('browser_click', { x: 330, y: 260 }).catch((e) => e);
  const textoAntesDeRolar = antesDeRolar?.content?.[0]?.text ?? String(antesDeRolar?.message ?? '');
  check(
    !/Botao abaixo da dobra/i.test(textoAntesDeRolar),
    'ANTES de rolar, o ponto onde o botao vai aparecer nao e o botao (ele esta fora da vista)',
    textoAntesDeRolar.slice(0, 160),
  );

  // Rola o CONTEUDO do iframe (scrollTop = 500) — o botao (top local 520,
  // altura 44) fica visivel entre local-y 20 e 64 dentro da area do iframe.
  await js(`(function(){
    var f = document.getElementById('frameRolagem');
    f.contentWindow.scrollTo(0, 500);
    return 'rolado';
  })()`);
  await sleep(200);

  // Iframe em (200,150,300x200). Botao local: left=40,top=520,w=180,h=44 ->
  // apos scrollTop=500, top visivel local = 520-500 = 20. Centro local:
  // (40+90, 20+22) = (130,42). Centro em TOPO: (200+130, 150+42) = (330,192).
  const refRolado = await refPorXY(330, 192);
  const rolAntes = Number(await js('window.__cliquesRolado'));
  await c.tool('browser_click', { ref: refRolado });
  await sleep(200);
  const rolDepois = Number(await js('window.__cliquesRolado'));
  check(
    rolDepois === rolAntes + 1,
    'DEPOIS de rolar o iframe por dentro, clique por REF acerta o botao que estava fora da vista',
    `cliques ${rolAntes}->${rolDepois}`,
  );
} catch (err) {
  console.error('ERRO GERAL:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
  servidor.closeAllConnections?.();
  servidor.close();
}

/**
 * NOTA SOBRE CROSS-ORIGIN (por que nao ha um cenario 5 "ao vivo" aqui):
 *
 * MEDIDO nesta sessao (`_medir-boxmodel-crossorigin-standalone.mjs`, Chrome
 * isolado): `DOM.getNodeForLocation` — o UNICO jeito que esta ponte tem hoje
 * de descobrir um `backendNodeId` dentro de um iframe (`browser_read_page`
 * nao desce em NENHUM iframe, same-origin ou nao) — PARA exatamente na
 * fronteira cross-origin: o hit-test devolve o proprio elemento `<iframe>`
 * (que pertence ao documento PAI, same-origin), nunca um no de DENTRO do
 * documento cross-origin. Ou seja: com o tool surface desta ponte hoje, NAO
 * HA COMO um agente real chegar a um `backendNodeId` que esteja
 * genuinamente dentro de um iframe cross-origin — a protecao em
 * `confirmarCadeiaAteTopo` (bloqueado:true, motivo:'cross-origin') e defesa
 * em profundidade para um caminho que o resto do sistema ja fecha antes.
 *
 * Um teste "ao vivo" que forcasse esse `backendNodeId` (por exemplo, via uma
 * sessao CDP separada anexada ao ALVO do iframe filho, contornando o
 * `chrome.debugger.attach({tabId})` que so anexa ao nivel da aba) provaria
 * outra coisa: que o PRIMEIRO passo de `resolverEClicarPorRef`
 * (`DOM.resolveNode({backendNodeId})`, na sessao do TOPO) ja rejeita um
 * `backendNodeId` que pertence ao target/processo de OUTRO frame — isso e
 * bloqueio por ARQUITETURA do `chrome.debugger`, nao pelo `frameElement`
 * que este conserto acrescentou, e portanto nao seria teste do CONSERTO
 * desta obra especificamente.
 *
 * PENDENTE para quem continuar: se algum dia `browser_read_page` (ou outra
 * capacidade) passar a descer em iframe cross-origin (ex.: via
 * `Target.setAutoAttach` + sessao por frame), ESTE teste de cross-origin
 * passa a ser exercitavel de verdade e devia ser escrito — hoje seria teatro
 * (provaria uma barreira que nao e a deste conserto).
 */
