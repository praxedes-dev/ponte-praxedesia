/**
 * Obra 21 (05/09/2026) — `browser_press_key` quebrado para edicao de texto.
 *
 * PARTE 1 (regressao de 03/09, MEDIDA contra https://example.com pelo
 * pedreiro da obra 06 e reconferida aqui antes do conserto):
 *
 *   1. `Ctrl+A` num campo com "LIXO" **inseria a letra "a"** ("LIXO" virou
 *      "LIXOa") em vez de selecionar tudo. O conserto do press_key que nao
 *      inseria caractere mandava `text` sempre que a tecla tinha 1
 *      caractere, sem excluir o caso em que ha modificador de comando
 *      (Control/Meta/Alt).
 *   2. `Backspace` nao apagava nada — o evento chegava no campo (rawKeyDown)
 *      mas sem `windowsVirtualKeyCode`/`nativeVirtualKeyCode`/`code`, o
 *      Chrome nao executa a acao nativa de edicao.
 *
 * PARTE 2 (05/09/2026, mesma obra — o cetico provou que a parte 1 so parou
 * de SUJAR o campo, sem fazer o atalho SELECIONAR de verdade):
 *
 *   MEDIDO (cetico-obra21-confirma.js): campo "PROCESSO-ANTIGO-0001",
 *   Ctrl+A, digitar "X99" tecla a tecla -> "PROCESSO-X99ANTIGO-0001". O
 *   texto novo foi INSERIDO no meio do antigo, nao substituiu nada, e a
 *   tool nao devolveu erro nenhum. `selectionStart/End` apos Ctrl+A ficava
 *   em {8, 8} (cursor no fim, campo de 8 chars) em vez de {0, 8}.
 *
 *   CAUSA: `TECLA_DE_CONTROLE` (cdp-tools.ts) so tinha entradas para
 *   Backspace/Tab/Enter/Escape/PageUp/PageDown/End/Home/setas/Delete —
 *   nenhuma letra. Para Ctrl+A, `imprimivel` era `false` (parou de sujar),
 *   mas `infoControle` tambem era `undefined` (nunca mandava `code`/
 *   `windowsVirtualKeyCode`), entao o Chrome recebia o keyDown sem o trio
 *   que ele exige para reconhecer o atalho nativo — e nao fazia nada.
 *
 *   CONSERTO: letra unica (a-z) COM modificador de comando (Ctrl/Alt/Meta)
 *   agora tambem gera `code: 'Key'+letra` e `keyCode: charCode da letra
 *   maiuscula` — regra geral por A-Z, nao lista chumbada, entao cobre
 *   Ctrl+C/V/Z/Y/etc sem precisar prever cada atalho. So entra quando HA
 *   modificador de comando, pra nao mexer no caminho de digitacao normal
 *   (que ja funciona via `text` e e provado por digitacao-real.js e
 *   autocomplete.js).
 *
 * O caso que fecha a obra: campo com texto -> Ctrl+A -> UM Backspace ->
 * campo VAZIO (nao um laco de ate 10 tentativas — ver nota no checkpoint
 * 2, era esse laco que escondia o Ctrl+A quebrado). Mais: Ctrl+A + digitar
 * tecla a tecla SUBSTITUI (nao insere no meio); Shift+a escreve "A"; Alt+
 * letra e Meta+letra continuam sem sujar (os dois bits do
 * MODIFICADOR_DE_COMANDO que a parte 1 nao testava sozinhos); Delete/Home/
 * End/setas (sozinhas e com Shift) editam e selecionam de verdade; PageUp/
 * PageDown movem cursor e rolam numa area que realmente rola; Enter/Tab
 * continuam funcionando.
 *
 * COBERTURA QUE FALTAVA (achado do cetico por mutacao — remover cada uma
 * do codigo mantinha a bancada verde): Delete, Home, End, PageUp, PageDown
 * e as 4 setas (sozinhas e com Shift), e os bits Alt/Meta do
 * MODIFICADOR_DE_COMANDO. Ponto de partida: `test/cetico-obra21.js` e
 * `test/cetico-obra21-confirma.js` (sondas do cetico, nao fazem parte desta
 * bateria — nao apagar).
 *
 * NOTA sobre PageUp/PageDown: MEDIDO que num <input> de uma linha eles sao
 * no-op no Chrome com OU sem o par code/keyCode (nao ha o que rolar) — um
 * teste ali nao pegaria mutacao nenhuma. Por isso os checks de PageUp/
 * PageDown usam a <textarea> `areaGrande` (200 linhas, altura fixa menor
 * que o conteudo), onde o par faz cursor E scrollTop mudarem de verdade.
 *
 * PARTE 3 (05/09/2026, achado de um cetico por mutation testing): a secao 7
 * cobre uma lacuna que sobrou nas partes 1 e 2 — a generalizacao A-Z do mapa
 * de teclas de controle (`LETRA_UNICA.test(key)` em cdp-tools.ts) so tinha
 * prova para a letra 'a' (todo caso de letra+comando ate aqui era Ctrl+A).
 * Um cetico trocou a regra geral por `key === 'a'` e a bancada ficou 27/27
 * verde. NAO e defeito vivo — o cetico mediu que Ctrl+C/Ctrl+V e Ctrl+Z ja
 * funcionam de verdade hoje ("alfa beta gama" copiado inteiro; "abc" desfeito
 * para "" com um Ctrl+Z) — e lacuna de COBERTURA: o comentario do codigo
 * promete "cobre Y, X e qualquer outro atalho de letra", mas nenhuma letra
 * alem de 'a' tinha teste amarrado. A secao 7 fecha com Ctrl+Z.
 *
 *   node test/press-key-edicao.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-press-key-edicao');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      var linhas = [];
      for (var i = 0; i < 200; i++) linhas.push('linha' + i);
      document.body.innerHTML =
        '<input id="campo" type="text" aria-label="Campo de edicao" value="LIXO1234">' +
        '<input id="tabAlvo" type="text" aria-label="Alvo do Tab">' +
        '<textarea id="area" aria-label="Area de Enter"></textarea>' +
        '<textarea id="areaGrande" aria-label="Area de paginacao" rows="10" cols="40" style="height:150px"></textarea>';
      document.getElementById('campo').value = 'LIXO1234';
      document.getElementById('areaGrande').value = linhas.join(String.fromCharCode(10));
      return 'montado';
    })()`,
  });
  await sleep(200);

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const jsonJs = async (codigo) => JSON.parse(await js(codigo));
  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  const refCampo = refDe('Campo de edicao');
  const refAreaEnter = refDe('Area de Enter');
  const refAreaGrande = refDe('Area de paginacao');

  const valCampo = () => js("document.getElementById('campo').value");
  const selCampo = () => jsonJs("JSON.stringify({start: document.getElementById('campo').selectionStart, end: document.getElementById('campo').selectionEnd})");

  // Reseta o campo para um valor conhecido, com CLIQUE REAL (isTrusted)
  // para focar — .focus() via JS nao basta para as acoes NATIVAS de edicao
  // (Ctrl+A/Backspace/setas) chegarem na aba certa; padrao da casa
  // (digitacao-real.js) ja usa clique antes de press_key. `pos`, se dado,
  // fixa selectionStart/End por JS depois do clique (so posiciona o
  // cursor para o teste; o que esta sob teste e o press_key que vem
  // depois, nao este posicionamento).
  const resetCampo = async (valor = 'LIXO1234', pos) => {
    await c.tool('browser_javascript', { codigo: `document.getElementById('campo').value = ${JSON.stringify(valor)};` });
    await c.tool('browser_click', { ref: refCampo });
    if (pos) {
      await c.tool('browser_javascript', {
        codigo: `var el=document.getElementById('campo'); el.selectionStart=${pos[0]}; el.selectionEnd=${pos[1]};`,
      });
    }
  };

  // ══ 1. Ctrl+A / Backspace / digitar — o caso que fecha a obra ══════════

  await resetCampo('LIXO1234');

  // Ctrl+A SELECIONA de verdade (nao so "nao suja"). Medido ANTES de
  // qualquer Backspace — e o proprio checkpoint que o cetico provou ser
  // teatro no laco de Backspace do teste antigo (10 tentativas escondiam
  // um Ctrl+A que nao selecionava nada). Campo de 8 caracteres: selecao
  // real tem de ser {0, 8}, nao {8, 8} (cursor jogado no fim, zero
  // selecao — o defeito medido na parte 2 da obra).
  await c.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
  const selCtrlA = await selCampo();
  check(selCtrlA.start === 0 && selCtrlA.end === 8, 'Ctrl+A seleciona o campo inteiro (selectionStart/End)', JSON.stringify(selCtrlA));
  const depoisCtrlA = await valCampo();
  check(depoisCtrlA === 'LIXO1234', 'Ctrl+A nao sujou o campo (nao inseriu "a")', `valor="${depoisCtrlA}"`);

  // UM Backspace apaga a selecao inteira — prova real, sem laco. O teste
  // antigo repetia Backspace ate 10x, o que passava MESMO com Ctrl+A
  // quebrado (apagava caractere por caractere e o check via so o campo
  // vazio no final). Com a selecao real provada acima, um UNICO Backspace
  // tem de esvaziar o campo.
  await c.tool('browser_press_key', { key: 'Backspace' });
  const vazio = await valCampo();
  check(vazio === '', 'Ctrl+A + UM Backspace esvaziou o campo (selecao real, nao laco)', `valor="${vazio}"`);

  // Digitar depois escreve SO o texto novo
  const rNovo = await c.tool('browser_type', { ref: refCampo, text: 'NOVO', clear: false });
  const lidoNovo = JSON.parse(rNovo.content[0].text).lido;
  check(lidoNovo === 'NOVO', 'depois de vazio, digitar escreve SO o texto novo', `lido="${lidoNovo}"`);

  // Consequencia pratica do defeito da parte 2: Ctrl+A + digitar tecla a
  // tecla tem de SUBSTITUIR, nao inserir no meio (o caso medido pelo
  // cetico: "PROCESSO-ANTIGO-0001" virava "PROCESSO-X99ANTIGO-0001").
  await resetCampo('PROCESSO-ANTIGO-0001');
  await c.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
  for (const ch of 'X99') {
    await c.tool('browser_press_key', { key: ch });
  }
  const valorSubstituido = await valCampo();
  check(valorSubstituido === 'X99', 'Ctrl+A + digitar tecla a tecla SUBSTITUI (nao insere no meio)', `valor="${valorSubstituido}"`);

  // Shift+a escreve "A" (a correcao do Ctrl+A nao pode quebrar digitacao
  // legitima com Shift)
  await resetCampo('');
  await c.tool('browser_press_key', { key: 'a', modifiers: ['Shift'] });
  const comShift = await valCampo();
  check(comShift === 'A', 'Shift+a escreveu "A" (digitacao legitima preservada)', `valor="${comShift}"`);

  // ══ 2. Os dois bits do MODIFICADOR_DE_COMANDO que a parte 1 nao testava
  //      sozinhos: Alt e Meta (so Control tinha teste ate aqui) ══════════
  // Achado do cetico: remover o bit do Alt do bitmask (1|2|4) mantinha a
  // bancada 100% verde, porque nada testava Alt isoladamente — a mesma
  // lacuna vale para Meta.

  await resetCampo('LIXO1234');
  await c.tool('browser_press_key', { key: 'd', modifiers: ['Alt'] });
  const depoisAlt = await valCampo();
  check(depoisAlt === 'LIXO1234', 'Alt+d nao insere "d" no campo (bit Alt do MODIFICADOR_DE_COMANDO)', `valor="${depoisAlt}"`);

  await resetCampo('LIXO1234');
  await c.tool('browser_press_key', { key: 'k', modifiers: ['Meta'] });
  await sleep(150);
  const depoisMeta = await valCampo();
  check(depoisMeta === 'LIXO1234', 'Meta+k nao insere "k" no campo (bit Meta do MODIFICADOR_DE_COMANDO)', `valor="${depoisMeta}"`);

  // ══ 3. Delete/Home/End/setas sozinhas — cobertura que faltava ══════════
  // Um cetico provou por mutacao que nenhuma delas tinha teste amarrado:
  // remover a entrada do TECLA_DE_CONTROLE mantinha a bancada verde.

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'Delete' });
  const depoisDelete = await valCampo();
  check(depoisDelete === 'LIXO234', 'Delete apaga o caractere a frente do cursor', `valor="${depoisDelete}"`);

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'Home' });
  const selHome = await selCampo();
  check(selHome.start === 0 && selHome.end === 0, 'Home move o cursor para o inicio', JSON.stringify(selHome));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'End' });
  const selEnd = await selCampo();
  check(selEnd.start === 8 && selEnd.end === 8, 'End move o cursor para o fim', JSON.stringify(selEnd));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowLeft' });
  const selLeft = await selCampo();
  check(selLeft.start === 3 && selLeft.end === 3, 'ArrowLeft move o cursor um caractere para tras', JSON.stringify(selLeft));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowRight' });
  const selRight = await selCampo();
  check(selRight.start === 5 && selRight.end === 5, 'ArrowRight move o cursor um caractere para frente', JSON.stringify(selRight));

  // MEDIDO: num campo de uma linha, ArrowUp/ArrowDown pulam para o inicio/
  // fim (nao ha linha de cima/baixo pra ir) — comportamento nativo do
  // Chrome, com ou sem o campo, mas so acontece com o trio code/keyCode
  // presente (sem ele o evento nao produz nenhuma acao, como o Backspace
  // da parte 1).
  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowUp' });
  const selUp = await selCampo();
  check(selUp.start === 0 && selUp.end === 0, 'ArrowUp move o cursor para o inicio (campo de uma linha)', JSON.stringify(selUp));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowDown' });
  const selDown = await selCampo();
  check(selDown.start === 8 && selDown.end === 8, 'ArrowDown move o cursor para o fim (campo de uma linha)', JSON.stringify(selDown));

  // ══ 4. As mesmas teclas com Shift — ESTENDEM a selecao de verdade ══════
  // (nao so "nao sujam"; e a mesma logica do cetico para o proprio Ctrl+A:
  // provar a selecao real, nao so a ausencia de lixo no campo.)

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'Home', modifiers: ['Shift'] });
  const selShiftHome = await selCampo();
  check(selShiftHome.start === 0 && selShiftHome.end === 4, 'Shift+Home estende a selecao ate o inicio', JSON.stringify(selShiftHome));

  await resetCampo('LIXO1234', [0, 0]);
  await c.tool('browser_press_key', { key: 'End', modifiers: ['Shift'] });
  const selShiftEnd = await selCampo();
  check(selShiftEnd.start === 0 && selShiftEnd.end === 8, 'Shift+End estende a selecao ate o fim', JSON.stringify(selShiftEnd));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowLeft', modifiers: ['Shift'] });
  const selShiftLeft = await selCampo();
  check(selShiftLeft.start === 3 && selShiftLeft.end === 4, 'Shift+ArrowLeft estende a selecao 1 caractere para tras', JSON.stringify(selShiftLeft));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowRight', modifiers: ['Shift'] });
  const selShiftRight = await selCampo();
  check(selShiftRight.start === 4 && selShiftRight.end === 5, 'Shift+ArrowRight estende a selecao 1 caractere para frente', JSON.stringify(selShiftRight));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowUp', modifiers: ['Shift'] });
  const selShiftUp = await selCampo();
  check(selShiftUp.start === 0 && selShiftUp.end === 4, 'Shift+ArrowUp estende a selecao ate o inicio', JSON.stringify(selShiftUp));

  await resetCampo('LIXO1234', [4, 4]);
  await c.tool('browser_press_key', { key: 'ArrowDown', modifiers: ['Shift'] });
  const selShiftDown = await selCampo();
  check(selShiftDown.start === 4 && selShiftDown.end === 8, 'Shift+ArrowDown estende a selecao ate o fim', JSON.stringify(selShiftDown));

  // ══ 5. PageUp/PageDown — precisam de campo que role de verdade ═════════
  // MEDIDO: num <input> de uma linha, PageUp/PageDown sao no-op no Chrome
  // com OU sem o par code/keyCode (nao ha "pagina" pra rolar) — testar la
  // nao pega mutacao nenhuma (confirmado experimentalmente: removi as duas
  // entradas do TECLA_DE_CONTROLE e o resultado no <input> foi identico).
  // Na <textarea> `areaGrande` (200 linhas, altura fixa bem menor que o
  // conteudo) o mesmo par faz cursor E scrollTop mudarem de verdade —
  // e o que prova que a entrada do mapa esta mesmo em uso.
  const selArea = () => jsonJs("JSON.stringify({start: document.getElementById('areaGrande').selectionStart, end: document.getElementById('areaGrande').selectionEnd})");
  const scrollArea = async () => Number(await js("document.getElementById('areaGrande').scrollTop"));
  const resetArea = async (pos, scrollTop = 0) => {
    await c.tool('browser_click', { ref: refAreaGrande });
    await c.tool('browser_javascript', {
      codigo: `var el=document.getElementById('areaGrande'); el.selectionStart=${pos[0]}; el.selectionEnd=${pos[1]}; el.scrollTop=${scrollTop};`,
    });
  };

  await resetArea([0, 0], 0);
  await c.tool('browser_press_key', { key: 'PageDown' });
  await sleep(80);
  const selPgDown = await selArea();
  const scrollPgDown = await scrollArea();
  check(selPgDown.start > 0 && scrollPgDown > 0, 'PageDown move o cursor e rola a area (nao e no-op)', `sel=${JSON.stringify(selPgDown)} scrollTop=${scrollPgDown}`);

  await resetArea([100, 100], 300);
  await c.tool('browser_press_key', { key: 'PageUp' });
  await sleep(80);
  const selPgUp = await selArea();
  const scrollPgUp = await scrollArea();
  check(selPgUp.start < 100 && scrollPgUp < 300, 'PageUp move o cursor para tras e rola a area de volta', `sel=${JSON.stringify(selPgUp)} scrollTop=${scrollPgUp}`);

  await resetArea([0, 0], 0);
  await c.tool('browser_press_key', { key: 'PageDown', modifiers: ['Shift'] });
  await sleep(80);
  const selShiftPgDown = await selArea();
  check(selShiftPgDown.start === 0 && selShiftPgDown.end > 0, 'Shift+PageDown estende a selecao (nao so move o cursor)', JSON.stringify(selShiftPgDown));

  // ══ 6. Enter e Tab continuam funcionando (nao sao tecla de comando) ════
  // Enter nunca inseriu quebra de linha por este caminho (nem antes nem
  // depois do conserto: e tecla de 1+ caracteres, sempre foi rawKeyDown sem
  // `text` — CDP so insere texto de verdade com o campo `text` presente, e
  // isso e pre-existente, fora do escopo da obra 21). O que a obra pede e
  // "continuar funcionando": nao virar lixo no campo e continuar disparando
  // o evento de tecla real que um listener (autocomplete, RichFaces, form)
  // usa para reagir — e o caminho que `digitarTeclaATecla` usa para o Enter.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      window.__enterViu = null;
      document.getElementById('area').addEventListener('keydown', function(e){
        if (e.key === 'Enter') window.__enterViu = { key: e.key, isTrusted: e.isTrusted };
      });
      return 'ok';
    })()`,
  });
  await c.tool('browser_click', { ref: refAreaEnter });
  await c.tool('browser_press_key', { key: 'x' });
  await c.tool('browser_press_key', { key: 'Enter' });
  await c.tool('browser_press_key', { key: 'y' });
  const areaValor = await js("document.getElementById('area').value");
  check(areaValor.replace(/\r?\n/g, '') === 'xy', 'Enter nao insere caractere de lixo no textarea', `valor=${JSON.stringify(areaValor)}`);
  const enterViu = await jsonJs('JSON.stringify(window.__enterViu)');
  check(Boolean(enterViu) && enterViu.key === 'Enter' && enterViu.isTrusted === true,
    'Enter chega como evento de tecla real (isTrusted), do jeito que digitarTeclaATecla depende', JSON.stringify(enterViu));

  await c.tool('browser_javascript', {
    codigo: "window.__focoAntesTab = document.activeElement && document.activeElement.id",
  });
  await c.tool('browser_press_key', { key: 'Tab' });
  await sleep(100);
  const mudouFoco = await js("document.activeElement && document.activeElement.id !== window.__focoAntesTab ? 'sim' : 'nao'");
  check(mudouFoco === 'sim', 'Tab continua movendo o foco', `mudou=${mudouFoco}`);

  // ══ 7. Ctrl+Z — letra DIFERENTE de 'a', cobertura que faltava ══════════
  // Achado do cetico (05/09/2026): a generalizacao A-Z do mapa de teclas de
  // controle (`LETRA_UNICA.test(key)` em cdp-tools.ts) so tinha prova para a
  // letra 'a' (Ctrl+A, secoes 1 e 2 acima). Um cetico trocou a regra geral
  // por `key === 'a'` e a bancada inteira ficou 27/27 verde — nenhum caso
  // exercitava Ctrl com outra letra. O comentario do codigo promete que a
  // regra "cobre Y, X e qualquer outro atalho de letra"; nenhuma dessas era
  // testada. MEDIDO (cetico): Ctrl+C num campo + Ctrl+V noutro levou "alfa
  // beta gama" inteiro, e Ctrl+Z depois de digitar "abc" devolveu "" — os
  // dois funcionam de verdade hoje. Este caso cobre o segundo (mais simples,
  // sem depender de permissao de clipboard): sem o trio code/keyCode que
  // `LETRA_UNICA` gera para QUALQUER letra com modificador de comando, o
  // Chrome recebe o keyDown de Ctrl+Z mas nao executa o undo nativo — o
  // MESMO sintoma do Backspace/Ctrl+A quebrados no inicio desta obra.
  await resetCampo('');
  for (const ch of 'abc') {
    await c.tool('browser_press_key', { key: ch });
  }
  const antesDoUndo = await valCampo();
  check(antesDoUndo === 'abc', 'digitou "abc" tecla a tecla, ponto de partida do Ctrl+Z', `valor="${antesDoUndo}"`);

  await c.tool('browser_press_key', { key: 'z', modifiers: ['Control'] });
  const depoisDoUndo = await valCampo();
  check(depoisDoUndo === '',
    'Ctrl+Z (letra "z", nao "a") desfaz a digitacao — prova que a generalizacao A-Z cobre outra letra',
    `valor="${depoisDoUndo}"`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
