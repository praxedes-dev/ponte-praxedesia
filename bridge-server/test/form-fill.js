/**
 * Obra 07 (docs/obra-20260904/07-form-fill.md) — `browser_form_fill`.
 *
 * Pagina de prova no molde de `digitacao-real.js`: texto, select nativo,
 * Select2 falso (span + <select> escondido, como o PJe monta de verdade) e
 * checkbox — mais um campo "teimoso" que reescreve o valor no `input`, para
 * provar que a falha de UM campo e reportada por campo, nunca engolida.
 *
 *   node test/form-fill.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-form-fill');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<input id="texto" type="text" aria-label="Campo texto lote">' +
        '<select id="cor" aria-label="Cor lote">' +
          '<option value="">Selecione</option><option value="azul">AZUL</option>' +
          '<option value="verde">VERDE</option></select>' +
        '<select id="materia" class="select2-hidden-accessible" aria-hidden="true">' +
          '<option value="">Selecione</option><option value="trib">DIREITO TRIBUTARIO</option>' +
          '<option value="civ">DIREITO CIVIL</option></select>' +
        '<span class="select2 select2-container"><span class="select2-selection" role="combobox" ' +
          'aria-label="Materia lote" tabindex="0">Selecione</span></span>' +
        '<input id="aceite" type="checkbox" aria-label="Aceite lote">' +
        '<input id="teimoso" type="text" aria-label="Campo teimoso lote">';
      // Feito de proposito para RECUSAR o valor escrito -- prova que a
      // falha de um campo aparece no relatorio, nao e engolida.
      document.getElementById('teimoso').addEventListener('input', function(e){ e.target.value = 'nao muda'; });
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

  const refTexto = refDe('Campo texto lote');
  const refCor = refDe('Cor lote');
  const refMateria = refDe('Materia lote');
  const refAceite = refDe('Aceite lote');
  const refTeimoso = refDe('Campo teimoso lote');
  check([refTexto, refCor, refMateria, refAceite, refTeimoso].every((r) => Number.isFinite(r)),
    'achou os 5 campos da pagina de prova',
    `texto=${refTexto} cor=${refCor} materia=${refMateria} aceite=${refAceite} teimoso=${refTeimoso}`);

  // ── 1. 4 campos validos: todos ok, ordem preservada, DOM confere ───────
  const r1 = await c.json('browser_form_fill', {
    campos: [
      { ref: refTexto, valor: 'Fulano de Tal' },
      { ref: refCor, valor: 'AZUL' },
      { ref: refMateria, valor: 'DIREITO TRIBUTARIO' },
      { ref: refAceite, valor: true },
    ],
  });
  check(r1.total === 4 && r1.preenchidos === 4, '4 campos validos: total e preenchidos batem', JSON.stringify(r1));
  check(r1.campos.every((c2) => c2.ok === true), 'todos os 4 vieram ok:true', JSON.stringify(r1.campos));
  check(r1.campos.map((c2) => c2.ref).join(',') === [refTexto, refCor, refMateria, refAceite].join(','),
    'ordem da resposta preserva a ordem enviada');
  check(r1.campos.every((c2) => typeof c2.detalhe === 'string' && c2.detalhe.length > 0),
    'cada campo devolveu o detalhe (o lido)', JSON.stringify(r1.campos.map((c2) => c2.detalhe)));

  const domDepois1 = JSON.parse(await js(`JSON.stringify({
    texto: document.getElementById('texto').value,
    cor: document.getElementById('cor').value,
    materia: document.getElementById('materia').value,
    aceite: document.getElementById('aceite').checked,
  })`));
  check(domDepois1.texto === 'Fulano de Tal' && domDepois1.cor === 'azul'
    && domDepois1.materia === 'trib' && domDepois1.aceite === true,
    'valores no DOM conferem por browser_javascript (inclusive Select2 -> select real)',
    JSON.stringify(domDepois1));

  // ── 2. 5 campos, teimoso em 3o, parar_no_erro padrao (true) ────────────
  const t2 = await c.call('tools/call', {
    name: 'browser_form_fill',
    arguments: {
      campos: [
        { ref: refTexto, valor: 'Beltrano' },
        { ref: refCor, valor: 'VERDE' },
        { ref: refTeimoso, valor: 'tentativa' },
        { ref: refMateria, valor: 'DIREITO CIVIL' },
        { ref: refAceite, valor: false },
      ],
    },
  });
  check(t2.result.isError === true, 'teimoso no meio: resposta vem como erro (isError)');
  const texto2 = t2.result.content[0].text;
  check(texto2.includes('2/5 campos preenchidos'), 'relatorio conta 2 preenchidos de 5', texto2.split('\n')[0]);
  check(/ref \d+: FALHOU — escrevi "tentativa" mas o campo ficou com "nao muda"/.test(texto2),
    'a falha do teimoso aparece com o valor escrito e o que ficou', texto2);
  check((texto2.match(/nao tentado/g) || []).length === 2,
    'os 2 campos depois do teimoso ficam "nao tentado"', texto2);
  check(texto2.includes('releia a pagina'), 'o texto traz a instrucao "releia a pagina"');

  // Campos depois do teimoso (materia, aceite) NAO foram tocados: continuam
  // com o valor que o passo 1 deixou.
  const domDepois2 = JSON.parse(await js(`JSON.stringify({
    materia: document.getElementById('materia').value,
    aceite: document.getElementById('aceite').checked,
  })`));
  check(domDepois2.materia === 'trib' && domDepois2.aceite === true,
    'parar_no_erro (padrao) realmente parou: campos depois do teimoso ficaram intocados', JSON.stringify(domDepois2));

  // ── 3. Mesmo caso, parar_no_erro:false: 4 ok, 1 falha, AINDA isError ───
  const t3 = await c.call('tools/call', {
    name: 'browser_form_fill',
    arguments: {
      campos: [
        { ref: refTexto, valor: 'Ciclano' },
        { ref: refCor, valor: 'VERDE' },
        { ref: refTeimoso, valor: 'tentativa 2' },
        { ref: refMateria, valor: 'DIREITO CIVIL' },
        { ref: refAceite, valor: false },
      ],
      parar_no_erro: false,
    },
  });
  check(t3.result.isError === true, 'parar_no_erro:false com 1 falha: AINDA vem como erro (nao mentiu ok)');
  const texto3 = t3.result.content[0].text;
  check(texto3.includes('4/5 campos preenchidos'), 'com parar_no_erro:false: 4 ok, 1 falha', texto3.split('\n')[0]);
  check(!texto3.includes('nao tentado'), 'sem "nao tentado": todos foram tentados desta vez', texto3);

  const domDepois3 = JSON.parse(await js(`JSON.stringify({
    materia: document.getElementById('materia').value,
    aceite: document.getElementById('aceite').checked,
  })`));
  check(domDepois3.materia === 'civ' && domDepois3.aceite === false,
    'parar_no_erro:false realmente seguiu: campos depois do teimoso FORAM aplicados', JSON.stringify(domDepois3));

  // ── 4. campos: [] -> erro claro, sem tocar a pagina ────────────────────
  const antesDoVazio = await js("document.getElementById('texto').value");
  const t4 = await c.call('tools/call', { name: 'browser_form_fill', arguments: { campos: [] } });
  check(t4.result.isError === true, 'campos:[] vem como erro');
  check(t4.result.content[0].text.includes('informe'), 'a mensagem pede para informar os campos',
    t4.result.content[0].text);
  const depoisDoVazio = await js("document.getElementById('texto').value");
  check(antesDoVazio === depoisDoVazio, 'campos:[] nao tocou a pagina (validado antes de qualquer CDP)',
    `antes="${antesDoVazio}" depois="${depoisDoVazio}"`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
