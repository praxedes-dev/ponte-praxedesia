/**
 * Obra 24 (05/09/2026) — `browser_click` por `ref` inexistente devolvia
 * `ok:true` com `{ element: "backendNodeId:999999" }` mesmo sem ter clicado
 * em nada. `cdpClickByRef` (execution-engine/cdp-tools.ts) tinha `return;`
 * seco quando `DOM.resolveNode` nao achava o no, e um `catch` no fim que so
 * logava e engolia qualquer outra falha — o `case 'click':`
 * (execution-engine/index.ts) nunca olhava o retorno.
 *
 * Isto importa porque o Dr. Cezar opera o PJe (peticionamento) por protocolo
 * passo a passo: um agente que recebe `ok` de um clique que nao aconteceu
 * segue o protocolo em cima de um passo que nunca existiu.
 *
 * O caso que fecha a obra 24:
 *   1. `ref` que nao existe -> ERRO (isError), com mensagem que diz o que
 *      fazer (releia a pagina / browser_read_page), e SEM efeito colateral
 *      (o botao real nao foi clicado por tabela).
 *   2. `ref` legitimo -> continua clicando de verdade (prova por efeito
 *      colateral: contador incrementa), exatamente como antes.
 *   3. clique por coordenada (x/y, cap_click_xy — caminho que NAO foi tocado
 *      por esta obra) continua funcionando.
 *
 * Continuacao (05/09/2026, achado por um cetico) — sobrou o irmao mais caro
 * do mesmo defeito: `ref` COBERTO por outro elemento (mesma posicao, z-index
 * maior) tambem devolvia `ok:true`, mas o clique por coordenada caia no
 * cobridor, nao no pedido — medido ao vivo com dois contadores (cobridor=1,
 * pedido=0). `pontoPertenceAoElemento` (cdp-tools.ts) fecha isso conferindo
 * `document.elementFromPoint` contra o `ref` antes de aceitar o clique.
 *
 *   4. `ref` coberto por outro elemento (mesmo tamanho, mesma posicao,
 *      z-index maior) -> ERRO, com o cobridor identificado na mensagem, e
 *      SEM efeito colateral (nem no cobridor, nem no pedido: o clique nunca
 *      foi despachado).
 *   5. `ref` de tamanho zero (width=0, height=0) -> ERRO util.
 *   6. `ref` com `display:none` -> ERRO util (mesma mensagem do #5: sem
 *      posicao visivel — `getBoundingClientRect` e `DOM.getBoxModel` os dois
 *      devolvem vazio para um elemento fora do layout).
 *   7. `ref` de no DESANEXADO do DOM (removido depois da leitura da pagina)
 *      -> ERRO util, mesma familia do #6.
 *   8. Sem falso positivo: `<button><span>texto</span></button>` pedindo o
 *      `<button>` continua clicando de verdade (o clique cai dentro do
 *      proprio elemento — span e descendente do button); `<label>` sobre o
 *      proprio `<input>` idem.
 *
 * Continuacao (05/09/2026, medido duas vezes em build limpo por dois
 * auditores independentes) — o mesmo modo de falha ("clicou errado/em nada e
 * disse ok") sobrevivia por DUAS causas somadas em `cdp-tools.ts`: a guarda
 * de tamanho zero usava `&&` (so pegava 0x0 exato, um `<button>` de 200x0
 * escapava) e o ramo ASCENDENTE de `combina()` (`el.contains(alvo)`) aceitava
 * qualquer ancestral do alvo como "o clique cobriu o alvo" — mas
 * `elementFromPoint` so devolve um ancestral ESTRITO quando o ponto NAO caiu
 * no alvo, entao esse ramo aceitava exatamente os casos em que o clique
 * ERRA. Os dois foram consertados: guarda virou `||`, ramo ascendente foi
 * removido (o ramo DESCENDENTE, que cobre os casos legitimos do #8, ficou).
 *
 *   9.  `ref` de tamanho 200x0 (largura normal, altura zero) -> ERRO util,
 *       SEM efeito colateral. Este e o caso medido ao vivo pelos dois
 *       auditores: antes do conserto, devolvia `ok:true` sem clicar em nada.
 *   10. Simetrico: `ref` de tamanho 0x200 (altura normal, largura zero) ->
 *       ERRO util, mesma familia do #9.
 *   11. Cobertura PARCIAL: alvo de 300x80 com o CENTRO tapado por um `<div>`
 *       de 140x40 `z-index:9` (os cantos do alvo continuam livres) -> clica
 *       no alvo de verdade (a varredura dos 4 quadrantes acha um ponto livre
 *       nos cantos), NAO no cobridor. Prova que a varredura de quadrantes
 *       (nao so o centro) esta em uso — sem este teste, cortar a varredura
 *       nao deixava nenhum caso vermelho.
 *
 * MUTATION TESTING (mesma rodada, feito ao vivo, os dois com build+reload
 * reais): mutar so a guarda (voltar para `&&`) FAZ o caso 9 ficar vermelho
 * (a mensagem vira "coberto por outro elemento (html ...)" em vez de
 * "tamanho zero" — o ramo ascendente ja removido segura o clique de nao
 * acontecer, mas a mensagem piora). Mutar SO o ramo ascendente (recolocar
 * `el.contains(alvo)`, com a guarda `||` intacta) NAO deixa nenhum caso
 * vermelho — medido: a guarda ja lanca antes do codigo chegar no ramo
 * ascendente para QUALQUER elemento de dimensao zero, entao os casos 9/10
 * nunca exercitam esse ramo. Por isso o caso 12 existe: um elemento de
 * dimensao NORMAL (passa a guarda) que so pode ser clicado atraves do seu
 * proprio ramo ascendente indevido.
 *
 *   12. `pointer-events:none` no proprio alvo: um `<button>` de tamanho
 *       normal (nao pega a guarda de tamanho zero) dentro de um `<div>` PAI
 *       clicavel, mas o botao tem `pointer-events:none` — nenhum ponto
 *       testado NUNCA resolve para o proprio botao (o CSS faz o navegador
 *       pular o alvo no hit-test), so para o PAI (que e ancestral do alvo)
 *       -> ERRO util, SEM efeito colateral em nenhum dos dois. Se o ramo
 *       ascendente voltasse, a checagem aceitaria (pai e ancestral do
 *       botao) e o clique REAL cairia no pai, nao no botao pedido — a
 *       mesma familia de "clicou no errado e disse ok" que este conserto
 *       fecha, so que o "cobridor" e o proprio ancestral, nao um irmao.
 *
 *   node test/clique-que-nao-mente.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-clique-que-nao-mente');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliques = 0;
      document.body.innerHTML =
        '<button id="btn" aria-label="Botao de teste da obra 24" ' +
        'onclick="window.__cliques++">Clique aqui</button>';
      return 'montado';
    })()`,
  });
  await sleep(200);

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  // Helpers para os cenarios 4-8, que remontam o body a cada passo: precisam
  // reler a pagina depois de cada mutacao, em vez de reusar `pagina`/`refDe`
  // (que sao uma foto congelada da leitura inicial, para os cenarios 1-3).
  const paginaAtual = async () => (await c.tool('browser_read_page')).content[0].text;
  const refNaPagina = (rotulo, doc) => {
    const linha = doc.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  const refBotao = refDe('Botao de teste da obra 24');
  check(Number.isFinite(refBotao), 'achou o ref do botao na leitura da pagina', `ref=${refBotao}`);

  // ── 1. ref inexistente -> ERRO, nao ok:true mentiroso ──────────────────
  // Bem acima de qualquer backendNodeId real que esta pagina tenha gerado.
  const refFalso = (refBotao ?? 0) + 5_000_000;
  let capturou = null;
  try {
    await c.tool('browser_click', { ref: refFalso });
  } catch (err) {
    capturou = err;
  }
  check(capturou !== null, 'clique com ref inexistente voltou ERRO (isError), nao ok:true', String(capturou?.message).slice(0, 160));
  check(
    /releia|browser_read_page/i.test(String(capturou?.message)),
    'a mensagem de erro diz o que fazer (releia a pagina / browser_read_page)',
    String(capturou?.message).slice(0, 200),
  );

  const cliquesAposFalso = Number(await js('window.__cliques'));
  check(cliquesAposFalso === 0, 'o ref falso NAO teve efeito colateral (botao real nao foi clicado)', `cliques=${cliquesAposFalso}`);

  // ── 2. ref legitimo continua clicando de verdade (prova por efeito) ────
  await c.tool('browser_click', { ref: refBotao });
  const cliquesAposReal = Number(await js('window.__cliques'));
  check(cliquesAposReal === 1, 'clique por ref legitimo continua funcionando (contador incrementou)', `cliques=${cliquesAposReal}`);

  // ── 3. clique por coordenada (cap_click_xy) continua funcionando ───────
  // Este caminho nao foi tocado pela obra 24 (cdpClick / cap_click_xy);
  // confere-se aqui so para fechar o criterio de nao-regressao.
  const rect = JSON.parse(await js(
    "JSON.stringify((function(){ var r = document.getElementById('btn').getBoundingClientRect(); "
    + "return { x: r.x + r.width/2, y: r.y + r.height/2 }; })())",
  ));
  await c.tool('browser_click', { x: rect.x, y: rect.y });
  const cliquesAposXY = Number(await js('window.__cliques'));
  check(cliquesAposXY === 2, 'clique por coordenada (x/y) continua funcionando', `cliques=${cliquesAposXY}`);

  // ── 4. ref COBERTO por outro elemento -> ERRO, com dois contadores ─────
  // Reproduz a medicao do cetico: dois botoes exatamente na mesma posicao e
  // tamanho, o de cima (cobridor) com z-index maior. Antes do conserto, o
  // clique por coordenada caia no cobridor (cobridor=1, alvo=0) e a ponte
  // respondia ok:true. Depois: nem um nem outro recebe o clique, porque a
  // tool para ANTES de despachar (os dois ficam em 0).
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesAlvo = 0;
      window.__cliquesCobridor = 0;
      document.body.innerHTML =
        '<button id="alvo" style="position:absolute;left:50px;top:50px;width:120px;height:40px;z-index:1" ' +
        'aria-label="Botao alvo coberto" onclick="window.__cliquesAlvo++">Alvo</button>' +
        '<button id="cobridor" style="position:absolute;left:50px;top:50px;width:120px;height:40px;z-index:2" ' +
        'aria-label="Botao cobridor por cima" onclick="window.__cliquesCobridor++">Cobridor</button>';
      return 'montado';
    })()`,
  });
  await sleep(200);
  let doc = await paginaAtual();
  const refAlvo = refNaPagina('Botao alvo coberto', doc);
  check(Number.isFinite(refAlvo), 'achou o ref do botao alvo (coberto)', `ref=${refAlvo}`);

  let capturouCoberto = null;
  try {
    await c.tool('browser_click', { ref: refAlvo });
  } catch (err) {
    capturouCoberto = err;
  }
  check(
    capturouCoberto !== null,
    'clique em elemento COBERTO por outro voltou ERRO (isError), nao ok:true',
    String(capturouCoberto?.message).slice(0, 200),
  );
  check(
    /cobert/i.test(String(capturouCoberto?.message)),
    'a mensagem de erro diz que o elemento esta coberto',
    String(capturouCoberto?.message).slice(0, 200),
  );
  const cliquesAlvo = Number(await js('window.__cliquesAlvo'));
  const cliquesCobridor = Number(await js('window.__cliquesCobridor'));
  check(cliquesAlvo === 0, 'o elemento COBERTO (pedido) nao recebeu o clique', `cliquesAlvo=${cliquesAlvo}`);
  check(
    cliquesCobridor === 0,
    'o COBRIDOR tambem nao recebeu clique nenhum (a tool nao despachou o clique por coordenada)',
    `cliquesCobridor=${cliquesCobridor}`,
  );

  // ── 5. ref de TAMANHO ZERO -> ERRO util ─────────────────────────────────
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesZero = 0;
      document.body.innerHTML =
        '<button id="zero" style="position:absolute;left:80px;top:80px;width:0;height:0;padding:0;border:0;overflow:hidden" ' +
        'aria-label="Botao tamanho zero" onclick="window.__cliquesZero++">Z</button>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refZero = refNaPagina('Botao tamanho zero', doc);
  check(Number.isFinite(refZero), 'achou o ref do botao de tamanho zero', `ref=${refZero}`);

  let capturouZero = null;
  try {
    await c.tool('browser_click', { ref: refZero });
  } catch (err) {
    capturouZero = err;
  }
  check(
    capturouZero !== null,
    'clique em elemento de TAMANHO ZERO (0x0) voltou ERRO, nao ok:true',
    String(capturouZero?.message).slice(0, 200),
  );
  const cliquesZero = Number(await js('window.__cliquesZero'));
  check(cliquesZero === 0, 'o elemento de tamanho zero nao recebeu clique', `cliques=${cliquesZero}`);

  // ── 6. ref com display:none -> ERRO util ────────────────────────────────
  // Pega o ref ENQUANTO o elemento ainda esta visivel (senao a arvore de
  // acessibilidade nem lista o elemento oculto), so depois esconde por CSS —
  // o backendNodeId nao muda com a visibilidade.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesOculto = 0;
      document.body.innerHTML =
        '<button id="ficaraOculto" aria-label="Botao que vai ficar display none" ' +
        'onclick="window.__cliquesOculto++">Visivel por ora</button>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refOculto = refNaPagina('Botao que vai ficar display none', doc);
  check(Number.isFinite(refOculto), 'achou o ref do botao antes de esconde-lo', `ref=${refOculto}`);
  await js("(function(){ document.getElementById('ficaraOculto').style.display = 'none'; return 'escondido'; })()");
  await sleep(100);

  let capturouOculto = null;
  try {
    await c.tool('browser_click', { ref: refOculto });
  } catch (err) {
    capturouOculto = err;
  }
  check(
    capturouOculto !== null,
    'clique em ref que virou display:none voltou ERRO, nao ok:true',
    String(capturouOculto?.message).slice(0, 200),
  );
  const cliquesOculto = Number(await js('window.__cliquesOculto'));
  check(cliquesOculto === 0, 'o elemento com display:none nao recebeu clique', `cliques=${cliquesOculto}`);

  // ── 7. ref de no DESANEXADO do DOM -> ERRO util ─────────────────────────
  // Mesma logica do #6: pega o ref antes de desanexar, desanexa depois.
  // Rotulo neutro de proposito: nada de "remover/excluir/apagar" — o freio
  // de botao irreversivel (obra 02, policy.ts/TEXTOS_DESTRUTIVOS) bloquearia
  // o clique por esse motivo, mascarando o que este teste quer provar.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesEfemero = 0;
      document.body.innerHTML =
        '<button id="vaiSumir" aria-label="Botao efemero desanexado depois" ' +
        'onclick="window.__cliquesEfemero++">Efemero</button>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refRemovido = refNaPagina('Botao efemero desanexado depois', doc);
  check(Number.isFinite(refRemovido), 'achou o ref do botao antes de desanexa-lo', `ref=${refRemovido}`);
  await js("(function(){ var el = document.getElementById('vaiSumir'); if (el) el.remove(); return 'desanexado'; })()");
  await sleep(100);

  let capturouRemovido = null;
  try {
    await c.tool('browser_click', { ref: refRemovido });
  } catch (err) {
    capturouRemovido = err;
  }
  check(
    capturouRemovido !== null,
    'clique em ref de no DESANEXADO do DOM voltou ERRO, nao ok:true',
    String(capturouRemovido?.message).slice(0, 200),
  );
  check(
    !/\[bloqueado\]/i.test(String(capturouRemovido?.message)),
    'o erro veio do defeito de ref desanexado, nao do freio de botao irreversivel (rotulo neutro)',
    String(capturouRemovido?.message).slice(0, 200),
  );
  check(
    /nao existe mais|nao tem posicao visivel/i.test(String(capturouRemovido?.message)),
    'a mensagem identifica um dos dois motivos esperados (ref sumiu ou sem posicao)',
    String(capturouRemovido?.message).slice(0, 200),
  );
  const cliquesEfemero = Number(await js('window.__cliquesEfemero'));
  check(cliquesEfemero === 0, 'o botao desanexado nao recebeu clique', `cliques=${cliquesEfemero}`);

  // ── 8. SEM FALSO POSITIVO: filho/pai do alvo continua clicando ──────────
  // <button><span>texto</span></button> pedindo o <button>: o span e
  // descendente do alvo, entao a checagem tem de aceitar.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesSpanBtn = 0;
      document.body.innerHTML =
        '<button id="btnSpan" aria-label="Botao com span filho" onclick="window.__cliquesSpanBtn++">' +
        '<span id="spanFilho" style="padding:8px 16px">Texto dentro do span</span></button>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refBtnSpan = refNaPagina('Botao com span filho', doc);
  check(Number.isFinite(refBtnSpan), 'achou o ref do botao com span filho', `ref=${refBtnSpan}`);
  await c.tool('browser_click', { ref: refBtnSpan });
  const cliquesSpanBtn = Number(await js('window.__cliquesSpanBtn'));
  check(
    cliquesSpanBtn === 1,
    'SEM FALSO POSITIVO: <button><span> continua clicando (span e descendente do button pedido)',
    `cliques=${cliquesSpanBtn}`,
  );

  // <label> sobre o proprio <input>: o input e a propria checkbox marcada,
  // entao elementFromPoint no seu centro bate com o alvo diretamente.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesInput = 0;
      document.body.innerHTML =
        '<label style="display:block">Marque aqui' +
        '<input id="inputSobLabel" type="checkbox" onclick="window.__cliquesInput++" /></label>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refInput = refNaPagina('Marque aqui', doc);
  check(Number.isFinite(refInput), 'achou o ref do checkbox rotulado por label', `ref=${refInput}`);
  await c.tool('browser_click', { ref: refInput });
  const cliquesInput = Number(await js('window.__cliquesInput'));
  check(
    cliquesInput === 1,
    'SEM FALSO POSITIVO: <input> sob <label> continua clicando',
    `cliques=${cliquesInput}`,
  );

  // ── 9. ref de tamanho 200x0 (uma dimensao zero) -> ERRO util ────────────
  // O caso medido ao vivo pelos dois auditores: `&&` na guarda so pegava 0x0
  // exato; largura normal com altura zero escapava e "clicava" sem efeito.
  // Dimensao vai DIRETO no <button> (nao num <div> pai) — e o proprio
  // getBoundingClientRect do alvo que tem de sair 200x0, exatamente como a
  // medicao original.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliques200x0 = 0;
      document.body.innerHTML =
        '<div style="position:absolute;left:60px;top:60px">' +
        '<button id="largo200x0" aria-label="Botao 200 por 0" ' +
        'style="display:block;width:200px;height:0;padding:0;border:0;overflow:hidden" ' +
        'onclick="window.__cliques200x0++">Largo sem altura</button></div>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const ref200x0 = refNaPagina('Botao 200 por 0', doc);
  check(Number.isFinite(ref200x0), 'achou o ref do botao 200x0', `ref=${ref200x0}`);

  let capturou200x0 = null;
  try {
    await c.tool('browser_click', { ref: ref200x0 });
  } catch (err) {
    capturou200x0 = err;
  }
  check(
    capturou200x0 !== null,
    'clique em elemento 200x0 (uma dimensao zero) voltou ERRO, nao ok:true',
    String(capturou200x0?.message).slice(0, 200),
  );
  check(
    /tamanho zero/i.test(String(capturou200x0?.message)),
    'a mensagem de erro fala em tamanho zero',
    String(capturou200x0?.message).slice(0, 200),
  );
  const cliques200x0 = Number(await js('window.__cliques200x0'));
  check(cliques200x0 === 0, 'o elemento 200x0 NAO recebeu o clique (o defeito medido: antes ficava em 0 mas voltava ok:true)', `cliques=${cliques200x0}`);

  // ── 10. Simetrico: ref de tamanho 0x200 (a outra dimensao zero) ─────────
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliques0x200 = 0;
      document.body.innerHTML =
        '<div style="position:absolute;left:60px;top:60px">' +
        '<button id="alto0x200" aria-label="Botao 0 por 200" ' +
        'style="display:block;width:0;height:200px;padding:0;border:0;overflow:hidden" ' +
        'onclick="window.__cliques0x200++">Alto sem largura</button></div>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const ref0x200 = refNaPagina('Botao 0 por 200', doc);
  check(Number.isFinite(ref0x200), 'achou o ref do botao 0x200', `ref=${ref0x200}`);

  let capturou0x200 = null;
  try {
    await c.tool('browser_click', { ref: ref0x200 });
  } catch (err) {
    capturou0x200 = err;
  }
  check(
    capturou0x200 !== null,
    'clique em elemento 0x200 (a outra dimensao zero) voltou ERRO, nao ok:true',
    String(capturou0x200?.message).slice(0, 200),
  );
  const cliques0x200 = Number(await js('window.__cliques0x200'));
  check(cliques0x200 === 0, 'o elemento 0x200 NAO recebeu o clique', `cliques=${cliques0x200}`);

  // ── 11. COBERTURA PARCIAL: centro tapado, cantos livres -> clica no ALVO
  // Alvo de 300x80; um <div> de 140x40 com z-index maior cobre so o CENTRO
  // do alvo (140x40 cabe dentro de 300x80 sem tocar as bordas). A varredura
  // dos 4 quadrantes tem de achar um canto livre e clicar no alvo de
  // verdade — NAO no cobridor. Este e o teste que faltava: um cetico cortou
  // a varredura (deixou so o centro) e a bancada ficou toda verde porque
  // nada provava que os quadrantes estavam em uso.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesAlvoParcial = 0;
      window.__cliquesCobridorParcial = 0;
      document.body.innerHTML =
        '<button id="alvoParcial" style="position:absolute;left:40px;top:40px;width:300px;height:80px;z-index:1" ' +
        'aria-label="Botao alvo com centro coberto" onclick="window.__cliquesAlvoParcial++">Alvo grande</button>' +
        '<div id="cobridorParcial" style="position:absolute;left:120px;top:60px;width:140px;height:40px;z-index:9" ' +
        'onclick="window.__cliquesCobridorParcial++"></div>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refAlvoParcial = refNaPagina('Botao alvo com centro coberto', doc);
  check(Number.isFinite(refAlvoParcial), 'achou o ref do alvo com centro coberto', `ref=${refAlvoParcial}`);

  await c.tool('browser_click', { ref: refAlvoParcial });
  const cliquesAlvoParcial = Number(await js('window.__cliquesAlvoParcial'));
  const cliquesCobridorParcial = Number(await js('window.__cliquesCobridorParcial'));
  check(
    cliquesAlvoParcial === 1,
    'COBERTURA PARCIAL: clicou no ALVO de verdade (a varredura dos quadrantes achou um canto livre)',
    `cliquesAlvoParcial=${cliquesAlvoParcial}`,
  );
  check(
    cliquesCobridorParcial === 0,
    'COBERTURA PARCIAL: o cobridor do centro NAO recebeu o clique',
    `cliquesCobridorParcial=${cliquesCobridorParcial}`,
  );

  // ── 12. pointer-events:none no ALVO -> nenhum ponto resolve pro alvo,
  // so para o PAI (ancestral) -> ERRO, sem efeito colateral em nenhum dos
  // dois. Existe especificamente para matar a mutacao "recoloca o ramo
  // ascendente" isolada da guarda de tamanho zero: um botao de tamanho
  // NORMAL (passa a guarda) cujo unico jeito de "combinar" seria o ramo
  // ascendente, porque pointer-events:none faz TODOS os 5 pontos
  // testados (centro + 4 quadrantes) resolverem para o DIV pai, nunca
  // para o proprio botao.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesPaiPE = 0;
      window.__cliquesFilhoPE = 0;
      document.body.innerHTML =
        '<div id="paiPE" style="position:absolute;left:200px;top:200px;width:160px;height:50px" ' +
        'onclick="window.__cliquesPaiPE++">' +
        '<button id="filhoPE" aria-label="Botao filho sem eventos de ponteiro" ' +
        'style="width:160px;height:50px;pointer-events:none" ' +
        'onclick="window.__cliquesFilhoPE++">Filho</button></div>';
      return 'montado';
    })()`,
  });
  await sleep(150);
  doc = await paginaAtual();
  const refFilhoPE = refNaPagina('Botao filho sem eventos de ponteiro', doc);
  check(Number.isFinite(refFilhoPE), 'achou o ref do botao filho (pointer-events:none)', `ref=${refFilhoPE}`);

  let capturouFilhoPE = null;
  try {
    await c.tool('browser_click', { ref: refFilhoPE });
  } catch (err) {
    capturouFilhoPE = err;
  }
  check(
    capturouFilhoPE !== null,
    'clique em alvo com pointer-events:none (so o PAI resolve nos 5 pontos) voltou ERRO, nao ok:true',
    String(capturouFilhoPE?.message).slice(0, 220),
  );
  check(
    /cobert/i.test(String(capturouFilhoPE?.message)),
    'a mensagem de erro diz que o elemento esta coberto (pelo proprio pai)',
    String(capturouFilhoPE?.message).slice(0, 220),
  );
  const cliquesFilhoPE = Number(await js('window.__cliquesFilhoPE'));
  const cliquesPaiPE = Number(await js('window.__cliquesPaiPE'));
  check(cliquesFilhoPE === 0, 'o botao filho (pointer-events:none) nao recebeu clique', `cliquesFilhoPE=${cliquesFilhoPE}`);
  check(
    cliquesPaiPE === 0,
    'o PAI tambem nao recebeu clique nenhum (a tool nao despachou o clique por coordenada) — se o ramo ascendente voltasse, cairia aqui',
    `cliquesPaiPE=${cliquesPaiPE}`,
  );
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
