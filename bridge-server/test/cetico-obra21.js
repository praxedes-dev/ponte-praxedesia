/**
 * AUDITORIA CETICA da obra 21 (05/09/2026) — combinacoes que o teste da obra
 * (press-key-edicao.js) NAO cobre: Alt, Meta, Ctrl+C/V/Z, Shift+Home/End/Arrow
 * (selecao real, nao so ausencia de lixo), Delete, Ctrl+Arrow, Shift+digito.
 *
 * Este arquivo e do CETICO, nao da obra. Roda contra o codigo tal como esta
 * (nao mexe em producao).
 *
 *   node test/cetico-obra21.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-cetico-obra21');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<input id="campo" type="text" aria-label="Campo de edicao" value="LIXO">';
      document.getElementById('campo').value = 'LIXO1234';
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
  const refCampo = refDe('Campo de edicao');
  const resetar = async (valor = 'LIXO1234') => {
    await c.tool('browser_javascript', { codigo: `document.getElementById('campo').value = ${JSON.stringify(valor)}` });
    await c.tool('browser_click', { ref: refCampo });
  };

  // ── 0. Ctrl+A de fato SELECIONA (nao so "nao suja")? ───────────────────
  // O checkpoint 2 do teste da obra (Ctrl+A + Backspace = vazio) passa
  // mesmo que Ctrl+A NAO selecione nada, porque o loop de backspace insiste
  // caractere por caractere ate esvaziar. Aqui mede-se a SELECAO real.
  await resetar('LIXO1234');
  await c.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
  await sleep(80);
  const selecao = JSON.parse(await js(
    "JSON.stringify({start: document.getElementById('campo').selectionStart, end: document.getElementById('campo').selectionEnd})",
  ));
  check(selecao.start === 0 && selecao.end === 8, 'Ctrl+A realmente seleciona o campo inteiro (nao so evita lixo)', JSON.stringify(selecao));

  // ── 1. Alt+letra nao suja o campo ───────────────────────────────────────
  await resetar('LIXO1234');
  await c.tool('browser_press_key', { key: 'd', modifiers: ['Alt'] });
  const depoisAlt = await js("document.getElementById('campo').value");
  check(depoisAlt === 'LIXO1234', 'Alt+d nao inseriu "d" no campo', `valor="${depoisAlt}"`);

  // ── 2. Meta+letra nao suja o campo ──────────────────────────────────────
  await resetar('LIXO1234');
  await c.tool('browser_press_key', { key: 'k', modifiers: ['Meta'] });
  await sleep(150);
  const depoisMeta = await js("document.getElementById('campo').value");
  check(depoisMeta === 'LIXO1234', 'Meta+k nao inseriu "k" no campo', `valor="${depoisMeta}"`);

  // ── 3. Ctrl+Shift+seta (selecionar palavra) nao suja ────────────────────
  await resetar('LIXO1234');
  await c.tool('browser_press_key', { key: 'ArrowLeft', modifiers: ['Control', 'Shift'] });
  const depoisCtrlShiftSeta = await js("document.getElementById('campo').value");
  check(depoisCtrlShiftSeta === 'LIXO1234', 'Ctrl+Shift+ArrowLeft nao suja o campo', `valor="${depoisCtrlShiftSeta}"`);

  // ── 4. Ctrl+C / Ctrl+V / Ctrl+Z nao inserem "c"/"v"/"z" ────────────────
  await resetar('LIXO1234');
  await c.tool('browser_press_key', { key: 'c', modifiers: ['Control'] });
  await c.tool('browser_press_key', { key: 'v', modifiers: ['Control'] });
  await c.tool('browser_press_key', { key: 'z', modifiers: ['Control'] });
  const depoisCCVZ = await js("document.getElementById('campo').value");
  check(depoisCCVZ === 'LIXO1234', 'Ctrl+C / Ctrl+V / Ctrl+Z nao inseriram letra nenhuma', `valor="${depoisCCVZ}"`);

  // ── 5. Shift+Home de fato ESTENDE selecao ate o inicio ──────────────────
  await resetar('LIXO1234');
  await c.tool('browser_javascript', {
    codigo: "var el=document.getElementById('campo'); el.selectionStart=8; el.selectionEnd=8;",
  });
  await c.tool('browser_press_key', { key: 'Home', modifiers: ['Shift'] });
  await sleep(80);
  const selHome = JSON.parse(await js(
    "JSON.stringify({start: document.getElementById('campo').selectionStart, end: document.getElementById('campo').selectionEnd})",
  ));
  check(selHome.start === 0 && selHome.end === 8, 'Shift+Home estendeu a selecao ate o inicio', JSON.stringify(selHome));

  // ── 6. Shift+ArrowRight estende selecao em 1 caractere ──────────────────
  await resetar('LIXO1234');
  await c.tool('browser_javascript', {
    codigo: "var el=document.getElementById('campo'); el.selectionStart=0; el.selectionEnd=0;",
  });
  await c.tool('browser_press_key', { key: 'ArrowRight', modifiers: ['Shift'] });
  await sleep(80);
  const selArrow = JSON.parse(await js(
    "JSON.stringify({start: document.getElementById('campo').selectionStart, end: document.getElementById('campo').selectionEnd})",
  ));
  check(selArrow.start === 0 && selArrow.end === 1, 'Shift+ArrowRight estendeu a selecao em 1 caractere', JSON.stringify(selArrow));

  // ── 7. Delete apaga o caractere A FRENTE do cursor ──────────────────────
  await resetar('LIXO1234');
  await c.tool('browser_javascript', {
    codigo: "var el=document.getElementById('campo'); el.selectionStart=0; el.selectionEnd=0;",
  });
  await c.tool('browser_press_key', { key: 'Delete' });
  await sleep(80);
  const depoisDelete = await js("document.getElementById('campo').value");
  check(depoisDelete === 'IXO1234', 'Delete apagou o "L" (caractere a frente do cursor)', `valor="${depoisDelete}"`);

  // ── 8. Shift+1 deveria dar "!" (documenta o defeito, sem exigir conserto) ─
  await resetar('');
  await c.tool('browser_press_key', { key: '1', modifiers: ['Shift'] });
  const shiftUm = await js("document.getElementById('campo').value");
  console.log(`INFO  Shift+1 produziu "${shiftUm}" (esperado de teclado fisico: "!") — documentado, nao e regressao da obra 21`);

  // ── 9. Sequencia: Ctrl+A, Backspace, digitar — igual ao "caso que fecha
  //      a obra", mas repetido 3x para pegar bug que so aparece na 2a rodada.
  for (let i = 0; i < 3; i++) {
    await resetar('REPETICAO' + i);
    await c.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
    await c.tool('browser_press_key', { key: 'Backspace' });
    const meioCaminho = await js("document.getElementById('campo').value");
    if (meioCaminho !== '') {
      // fallback como o teste da obra, mas SEM mascarar: reporta se precisou
      console.log(`INFO  rodada ${i}: apos Ctrl+A+1 Backspace sobrou "${meioCaminho}" (Ctrl+A pode nao ter selecionado tudo)`);
    }
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
