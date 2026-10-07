/**
 * Obra 13 (docs/obra-20260904/13-clique-destaque-e-assentar.md) — todo clique
 * da ponte ganha dois ganchos novos:
 *
 *   1. DESTAQUE: contorno visivel de 300ms no elemento antes do clique
 *      acontecer (capacidades/destaque.ts), para o Dr. Cezar ver na tela dele
 *      o que o agente vai fazer.
 *   2. ASSENTAR: depois do clique, espera a rede acalmar de VERDADE (teto
 *      curto, 2500ms por padrao) antes de responder — para o agente nao ler
 *      a tela do PJe cedo demais (capacidades/assentar.ts). `esperar: false`
 *      desliga.
 *
 * Casos:
 *   1. clique num botao cujo onclick faz fetch() + muda o titulo -- SEM
 *      nenhuma espera explicita do agente, o titulo ja mudou quando a tool
 *      responde; resposta traz assentou_ms < 2500 e requisicoes >= 1.
 *   2. clique num botao SEM rede -- assentou_ms fica perto do "quieto"
 *      (~400-600ms), nao gasta o teto inteiro de 2500ms; requisicoes = 0.
 *   3. clique com esperar:false -- resposta NAO tem assentou_ms nem
 *      requisicoes (o modulo assentar nem arma).
 *   4. toda resposta de clique traz "destacado" (true|false) e o clique
 *      continua sendo um clique de VERDADE (isTrusted, via addEventListener).
 *      Com Overlay recusado pelo chrome.debugger nesta maquina, destacado
 *      vem false — e o clique funciona igual (medido e reportado, nao
 *      assertido: depende do que o chrome.debugger desta versao permite).
 *   5. clique barrado pelo freio (texto destrutivo, "Excluir conta") -- vem
 *      ERRO (isError), o botao NAO recebe o clique de verdade, e nenhum
 *      listener do assentar vaza: o clique SEGUINTE conta so a propria
 *      requisicao (nao soma nada do clique barrado nem de cliques
 *      anteriores).
 *
 *   node test/clique-assentar.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-clique-assentar');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste mexeria na aba que o Dr. Cezar esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const clickJson = async (args) => JSON.parse((await c.tool('browser_click', args)).content[0].text);
  const paginaAtual = async () => (await c.tool('browser_read_page')).content[0].text;
  const refNaPagina = (doc, rotulo) => {
    const linha = doc.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };

  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__cliquesExcluir = 0;
      document.body.innerHTML =
        '<button id="btnFetch" aria-label="Botao com fetch de verdade">Com rede</button>' +
        '<button id="btnSoTitulo" aria-label="Botao so muda titulo">Sem rede</button>' +
        '<button id="btnEsperarFalse" aria-label="Botao esperar false">Esperar false</button>' +
        '<button id="btnTrusted" aria-label="Botao para medir isTrusted">Trusted</button>' +
        '<button id="btnExcluir" aria-label="Excluir conta">Excluir conta</button>' +
        '<button id="btnControle" aria-label="Botao de controle apos o bloqueio">Controle pos-bloqueio</button>';

      document.getElementById('btnFetch').onclick = function() {
        // mode:no-cors -- o site alvo nao manda cabecalho de CORS para
        // origens arbitrarias (medido ao vivo, 05/09/2026: sem isto o fetch
        // REJEITA com "Failed to fetch" e o .then() nunca roda). A requisicao
        // de rede acontece do mesmo jeito (o CDP conta normalmente); so a
        // resposta vira opaca, o que nao importa aqui -- o teste so precisa
        // de uma requisicao de rede de verdade que termine.
        // cache-busting: sem isto, fetches repetidos ao MESMO recurso ao
        // longo do teste podem vir do cache do Chrome e terminar rapido
        // demais para provar nada sobre tempo de rede real.
        fetch('https://www.iana.org/help/example-domains?cb=' + Date.now() + Math.random(), { mode: 'no-cors' })
          .then(function () { document.title = 'pronto'; });
      };
      document.getElementById('btnSoTitulo').onclick = function() {
        document.title = 'so-titulo';
      };
      document.getElementById('btnEsperarFalse').onclick = function() {
        document.title = 'mudou-com-esperar-false';
      };
      document.getElementById('btnTrusted').addEventListener('click', function (e) {
        window.__trustedCount = (window.__trustedCount || 0) + (e.isTrusted ? 1 : 0);
      });
      document.getElementById('btnExcluir').onclick = function() { window.__cliquesExcluir++; };
      document.getElementById('btnControle').onclick = function() {
        fetch('https://www.iana.org/help/example-domains?cb=' + Date.now() + Math.random(), { mode: 'no-cors' });
      };
      return 'montado';
    })()`,
  });
  await sleep(200);

  const doc = await paginaAtual();
  const refFetch = refNaPagina(doc, 'Botao com fetch de verdade');
  const refSoTitulo = refNaPagina(doc, 'Botao so muda titulo');
  const refEsperarFalse = refNaPagina(doc, 'Botao esperar false');
  const refTrusted = refNaPagina(doc, 'Botao para medir isTrusted');
  const refExcluir = refNaPagina(doc, 'Excluir conta');
  const refControle = refNaPagina(doc, 'Botao de controle apos o bloqueio');
  check(Number.isFinite(refFetch), 'achou o ref do botao com fetch', `ref=${refFetch}`);
  check(Number.isFinite(refSoTitulo), 'achou o ref do botao so titulo', `ref=${refSoTitulo}`);
  check(Number.isFinite(refEsperarFalse), 'achou o ref do botao esperar false', `ref=${refEsperarFalse}`);
  check(Number.isFinite(refTrusted), 'achou o ref do botao de isTrusted', `ref=${refTrusted}`);
  check(Number.isFinite(refExcluir), 'achou o ref do botao Excluir conta', `ref=${refExcluir}`);
  check(Number.isFinite(refControle), 'achou o ref do botao de controle pos-bloqueio', `ref=${refControle}`);

  // ── 1. clique com rede (fetch) -- sem espera explicita do agente ────────
  const r1 = await clickJson({ ref: refFetch });
  const tituloAposFetch = await js('document.title');
  check(
    tituloAposFetch === 'pronto',
    'depois do clique (SEM esperar explicito do agente) o titulo ja mudou -- o fetch assentou sozinho',
    tituloAposFetch,
  );
  check(typeof r1.assentou_ms === 'number' && r1.assentou_ms < 2500, 'clique 1: resposta trouxe assentou_ms < 2500', `assentou_ms=${r1.assentou_ms}`);
  check(typeof r1.requisicoes === 'number' && r1.requisicoes >= 1, 'clique 1: resposta trouxe requisicoes >= 1', `requisicoes=${r1.requisicoes}`);
  check(r1.esgotou !== true, 'clique 1: assentou de verdade (nao esgotou o teto)', `esgotou=${r1.esgotou}`);

  // ── 1b. esperar_ms MENOR que o tempo real da rede -- tem de ESGOTAR
  // (assentou_ms === o teto pedido, esgotou:true) e nunca falhar por isso ──
  const r1b = await clickJson({ ref: refFetch, esperar_ms: 50 });
  check(r1b.esgotou === true, 'clique 1b (esperar_ms:50, rede real leva mais que isso): esgotou o teto', `esgotou=${r1b.esgotou}`);
  check(r1b.assentou_ms === 50, 'clique 1b: assentou_ms devolvido e EXATAMENTE o teto pedido (50)', `assentou_ms=${r1b.assentou_ms}`);
  check(typeof r1b.requisicoes === 'number' && r1b.requisicoes >= 1, 'clique 1b: mesmo esgotando, contou a requisicao', `requisicoes=${r1b.requisicoes}`);

  // ── 2. clique sem rede -- assentou_ms perto do quieto, nao do teto ──────
  const r2 = await clickJson({ ref: refSoTitulo });
  check(
    typeof r2.assentou_ms === 'number' && r2.assentou_ms >= 350 && r2.assentou_ms <= 900,
    'clique 2 (sem rede): assentou_ms perto do quieto (~400-600ms), nao gastou o teto de 2500ms',
    `assentou_ms=${r2.assentou_ms}`,
  );
  check(r2.requisicoes === 0, 'clique 2 (sem rede): nao registrou nenhuma requisicao', `requisicoes=${r2.requisicoes}`);

  // ── 3. esperar:false -- sem assentou_ms/requisicoes na resposta ─────────
  const r3 = await clickJson({ ref: refEsperarFalse, esperar: false });
  check(r3.assentou_ms === undefined, 'clique 3 (esperar:false): resposta NAO tem assentou_ms', JSON.stringify(r3));
  check(r3.requisicoes === undefined, 'clique 3 (esperar:false): resposta NAO tem requisicoes', JSON.stringify(r3));

  // ── 4. destaque: campo "destacado" em toda resposta de clique, e o clique
  // continua sendo um clique de VERDADE (isTrusted) ───────────────────────
  check(typeof r1.destacado === 'boolean', 'clique 1: resposta trouxe "destacado" (true|false)', `destacado=${r1.destacado}`);
  check(typeof r2.destacado === 'boolean', 'clique 2: resposta trouxe "destacado" (true|false)', `destacado=${r2.destacado}`);
  check(typeof r3.destacado === 'boolean', 'clique 3 (esperar:false): "destacado" tambem presente (independe do assentar)', `destacado=${r3.destacado}`);

  const r4 = await clickJson({ ref: refTrusted });
  const trustedCount = Number(await js('window.__trustedCount || 0'));
  check(trustedCount === 1, 'clique por ref continua sendo um clique de VERDADE (isTrusted=1 no listener da pagina)', `trustedCount=${trustedCount}`);
  console.log(
    `MEDIDO: Overlay permitido pelo chrome.debugger nesta maquina? destacado=${r1.destacado} `
    + `(cliques 1/2/4 concordam: ${r1.destacado === r2.destacado && r2.destacado === r4.destacado})`,
  );

  // ── 5. clique barrado pelo freio -- isError, sem efeito colateral, e SEM
  // vazamento de listener do assentar para o clique seguinte ─────────────
  let capturouExcluir = null;
  try {
    await c.tool('browser_click', { ref: refExcluir });
  } catch (err) {
    capturouExcluir = err;
  }
  check(
    capturouExcluir !== null,
    'clique em "Excluir conta" foi BARRADO pelo freio (isError), nao ok:true',
    String(capturouExcluir?.message).slice(0, 160),
  );
  check(
    /bloqueado/i.test(String(capturouExcluir?.message)),
    'a mensagem de erro diz que foi bloqueado',
    String(capturouExcluir?.message).slice(0, 160),
  );
  const cliquesExcluir = Number(await js('window.__cliquesExcluir'));
  check(cliquesExcluir === 0, 'o botao Excluir NAO recebeu o clique de verdade (freio bloqueou antes do dispatch)', `cliques=${cliquesExcluir}`);

  const r5 = await clickJson({ ref: refControle });
  check(
    typeof r5.requisicoes === 'number' && r5.requisicoes === 1,
    'clique SEGUINTE ao barrado conta SO a propria requisicao -- nenhum listener vazou do clique barrado (nem de cliques anteriores)',
    `requisicoes=${r5.requisicoes}`,
  );

  // ── 6. "defeito irmao 2" do briefing: loadingFinished de uma requisicao
  // iniciada ANTES do armar (nao contada) nao pode zerar o contador para
  // NEGATIVO. Dispara um fetch de latencia CONHECIDA (httpbin.org/delay/1 --
  // medido ao vivo, 05/09/2026: termina em ~1180ms, bem mais prevesivel que
  // um recurso comum) por fora do assentar (browser_javascript, sem passar
  // por click nenhum), espera quase o tempo todo (850ms, sobrando ~330ms de
  // voo), e SO ENTAO clica num botao SEM rede propria -- o `loadingFinished`
  // orfao desse fetch chega DENTRO da janela de "quieto" (400ms) deste
  // clique (o assentar nunca viu o "+1" dele, so vai ver o "-1"). Sem o
  // clamp (Math.max(0, emVoo-1)), emVoo fica em -1 para sempre (nenhum outro
  // evento chega para compensar), "emVoo === 0" nunca mais bate, e o clique
  // fica preso ate ESGOTAR o teto inteiro. Com o clamp, o clique assenta
  // normal (bem abaixo do teto) assim que passar o "quieto" depois do orfao
  // chegar. ────────────────────────────────────────────────────────────────
  await js("fetch('https://httpbin.org/delay/1', { mode: 'no-cors' }); 'disparado'");
  await sleep(850); // deixa o fetch "orfao" quase terminar, fora do alcance do proximo armar()
  const r6 = await clickJson({ ref: refSoTitulo, esperar_ms: 3000 });
  check(
    r6.esgotou !== true && typeof r6.assentou_ms === 'number' && r6.assentou_ms < 2000,
    'clique 6 (com requisicao ORFA em voo, iniciada antes do armar): assentou bem antes do teto -- o clamp segurou o contador em 0, nao deixou "emVoo" ficar negativo para sempre',
    `assentou_ms=${r6.assentou_ms} esgotou=${r6.esgotou}`,
  );
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
if (falhou) process.exitCode = 1;
