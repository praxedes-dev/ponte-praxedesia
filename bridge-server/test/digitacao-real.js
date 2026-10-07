/**
 * Os achados do HANDOFF-DIGITACAO-REAL-20260819 e da memoria de 03/09/2026:
 *
 *   1. form_input mentia em Select2 (alterava o span, dizia ok, valor nao gravado)
 *   2. type nao digitava: setava .value (nao serve para campo que escuta tecla)
 *   3. press_key nao inseria caractere
 *   4. toda escrita tem de devolver o valor LIDO de volta, e falhar se nao bater
 *   5. extract devolvia a CAUDA da pagina em vez do comeco
 *   6. click precisa aceitar coordenada, para alvo sem ref
 *
 *   node test/digitacao-real.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-digitacao');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  // Pagina de prova. O "Select2" e uma imitacao fiel do DOM que a biblioteca
  // monta: <select class="select2-hidden-accessible"> seguido de um <span
  // class="select2"> com role=combobox, que e o que a arvore de acessibilidade ve.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<p id="inicio">PRIMEIRA LINHA DA PAGINA</p>' +
        '<input id="campo" type="text" aria-label="Campo de texto">' +
        '<input id="teclado" type="text" aria-label="Campo que escuta tecla">' +
        '<input id="teimoso" type="text" aria-label="Campo teimoso">' +
        '<select id="materia" class="select2-hidden-accessible" aria-hidden="true">' +
          '<option value="">Selecione</option><option value="trib">DIREITO TRIBUTARIO</option>' +
          '<option value="civ">DIREITO CIVIL</option></select>' +
        '<span class="select2 select2-container"><span class="select2-selection" role="combobox" ' +
          'aria-label="Materia" tabindex="0">Selecione</span></span>' +
        '<button id="alvo" aria-label="Botao alvo">Alvo</button>' +
        '<div style="height:2000px"></div><p id="fim">ULTIMA LINHA DA PAGINA</p>';
      window.__teclas = 0;
      document.getElementById('teclado').addEventListener('keydown', function(){ window.__teclas++; });
      document.getElementById('teimoso').addEventListener('input', function(e){ e.target.value = 'x'; });
      window.__cliques = 0;
      document.getElementById('alvo').addEventListener('click', function(e){ window.__cliques += e.isTrusted ? 1 : 100; });
      return 'montado';
    })()`,
  });
  await sleep(400);

  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();

  // ── 3. press_key insere caractere ─────────────────────────────────────
  const refCampo = refDe('Campo de texto');
  check(Boolean(refCampo), `achou o campo de texto (ref ${refCampo})`);
  await c.tool('browser_click', { ref: refCampo });
  await c.tool('browser_press_key', { key: '7' });
  check((await js("document.getElementById('campo').value")) === '7', 'press_key "7" INSERIU o caractere');

  // ── 4. type devolve o valor lido ──────────────────────────────────────
  const r = await c.tool('browser_type', { ref: refCampo, text: 'abc', clear: true });
  const lido = JSON.parse(r.content[0].text).lido;
  check(lido === 'abc', 'type devolve o valor lido de volta', `lido="${lido}"`);

  // ── 2. type modo teclado dispara keydown de verdade ───────────────────
  const refTeclado = refDe('escuta tecla');
  const t = await c.tool('browser_type', { ref: refTeclado, text: 'PJe', modo: 'teclado', delay_ms: 30 });
  const rt = JSON.parse(t.content[0].text);
  check(rt.lido === 'PJe', 'modo teclado escreveu o texto', `lido="${rt.lido}"`);
  check((await js('window.__teclas')) === '3', 'e disparou um keydown por tecla', `keydowns=${await js('window.__teclas')}`);

  // ── 1. form_input em Select2 grava no <select> REAL ───────────────────
  const refCombo = refDe('Materia');
  check(Boolean(refCombo), `achou o combobox do Select2 (ref ${refCombo})`);
  const f = (await c.tool('browser_form_input', { ref: refCombo, valor: 'DIREITO TRIBUTARIO' })).content[0].text;
  check((await js("document.getElementById('materia').value")) === 'trib',
    'form_input subiu do span para o <select> real e gravou', f.trim());

  // ── 4b. form_input FALHA ALTO quando o valor nao fica ─────────────────
  const refTeimoso = refDe('teimoso');
  const teimoso = await c.call('tools/call', { name: 'browser_form_input', arguments: { ref: refTeimoso, valor: 'abc' } });
  check(teimoso.result.isError === true, 'form_input devolve ERRO quando o campo nao fica com o valor',
    teimoso.result.content[0].text.slice(0, 70));

  // ── 5. extract le do COMECO por padrao ────────────────────────────────
  const ex = (await c.tool('browser_extract', { max_chars: 40 })).content[0].text;
  check(ex.startsWith('PRIMEIRA LINHA'), 'extract comeca do inicio da pagina', ex.slice(0, 30));
  const cauda = (await c.tool('browser_extract', { max_chars: 40, from_length: -1 })).content[0].text;
  check(cauda.includes('ULTIMA LINHA'), 'extract com from_length negativo traz a cauda', cauda.slice(-25));

  // ── 6. click por coordenada e mouse de verdade ────────────────────────
  const rect = JSON.parse(await js("(function(){var r=document.getElementById('alvo').getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()"));
  const cx = (await c.tool('browser_click', { x: rect.x, y: rect.y })).content[0].text;
  check((await js('window.__cliques')) === '1', 'click por coordenada chegou com isTrusted', cx.slice(0, 50));
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
