/**
 * Dois defeitos confirmados por auditoria em capacidades/formulario.ts (05/09/2026):
 *
 * 1. "Campo fantasma": o CDP resolve o backendNodeId de um no DESANEXADO
 *    (removido do DOM, mas ainda vivo em memoria) e devolve objectId valido.
 *    `preencherCampo` escrevia e RELIA do mesmo no fantasma -- a releitura
 *    que devia ser a prova confirmava contra si mesma, nao contra a pagina
 *    viva. Resultado: `browser_form_input`/`browser_form_fill` respondiam
 *    ok:true para um campo que nao existe mais. No PJe (RichFaces re-renderiza
 *    campo por AJAX o tempo todo) isto e o caso NORMAL, nao o exotico.
 *
 * 2. O freio da ponte (`avaliar()`, policy.ts, regra 1: "campo de senha: a
 *    ponte nao preenche credencial") nunca era chamado por `cap_form_input`
 *    nem `cap_form_fill` -- o despacho de bridge/index.ts so roda o freio
 *    para acoes que NAO comecam com `cap_`, e cada capacidade tem de chama-lo
 *    por conta propria (como `clique.ts`/`autocomplete.ts` ja fazem). A ponte
 *    escrevia senha de verdade num <input type="password"> sem bloqueio nenhum.
 *
 * Casos deste teste:
 *   1a. browser_form_input com ref de campo removido -> ERRO, nunca ok:true.
 *   1b. browser_form_fill com ref de campo apos innerHTML='' (reproducao
 *       EXATA do auditor) -> ERRO, relatorio mostra FALHOU, nunca "ok".
 *   2a. browser_form_input em <input type="password"> -> bloqueado, mesmo
 *       com confirm:true (regra 1 do freio nao aceita confirmacao). Campo
 *       continua vazio.
 *   2b. browser_form_fill com senha no meio do lote -> bloqueada; o campo
 *       normal ANTES dela no lote e preenchido do mesmo jeito (o freio nao
 *       vira um botao de "tudo ou nada" para os campos legitimos).
 *   4.  Falso positivo do freio: texto, select, checkbox e radio comuns
 *       continuam passando (form_input e form_fill), sem bloqueio nenhum.
 *
 *   node test/form-fantasma-e-senha.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-form-fantasma-e-senha');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: nunca a do usuario.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  const montarPagina = () => c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<input id="fantasma1" type="text" aria-label="Campo fantasma um">' +
        '<input id="fantasma2" type="text" aria-label="Campo fantasma dois">' +
        '<input id="texto" type="text" aria-label="Campo normal texto">' +
        '<select id="cor" aria-label="Campo normal select">' +
          '<option value="">Selecione</option><option value="azul">AZUL</option></select>' +
        '<input id="aceite" type="checkbox" aria-label="Campo normal checkbox">' +
        '<input id="r1" type="radio" name="genero" value="m" aria-label="Campo normal radio">' +
        '<input id="senha" type="password" aria-label="Campo de senha teste">';
      return "montado";
    })()`,
  });

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const lerPagina = async () => (await c.tool('browser_read_page')).content[0].text;
  const refDe = (pagina, rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };

  await montarPagina();
  await sleep(300);

  let pagina = await lerPagina();
  const refFantasma1 = refDe(pagina, 'Campo fantasma um');
  const refFantasma2 = refDe(pagina, 'Campo fantasma dois');
  const refTexto = refDe(pagina, 'Campo normal texto');
  check(
    [refFantasma1, refFantasma2, refTexto].every((r) => Number.isFinite(r)),
    'achou os refs iniciais da pagina de prova',
    `fantasma1=${refFantasma1} fantasma2=${refFantasma2} texto=${refTexto}`,
  );

  // ── 1a. campo removido do DOM -> browser_form_input nunca mente ───────
  await js("document.getElementById('fantasma1').remove()");
  const sumiu1 = await js("document.getElementById('fantasma1') === null ? 'sumiu' : 'ainda-esta'");
  check(sumiu1 === 'sumiu', 'campo fantasma1 realmente saiu do DOM antes do form_input', sumiu1);

  const t1 = await c.call('tools/call', {
    name: 'browser_form_input',
    arguments: { ref: refFantasma1, valor: 'ESCRITO NO FANTASMA' },
  });
  check(t1.result.isError === true, 'campo removido: browser_form_input vem como ERRO, nunca ok:true',
    JSON.stringify(t1.result));
  const texto1 = t1.result.content?.[0]?.text ?? '';
  check(!/ok["\s:]*true/i.test(texto1), 'a resposta nao contem um "ok:true" escondido', texto1);
  check(/nao existe mais na pagina|releia a pagina|browser_read_page/i.test(texto1),
    'a mensagem diz o que fazer (reler a pagina)', texto1);

  // ── 1b. reproducao EXATA do auditor: innerHTML='' antes do form_fill ──
  await js("document.body.innerHTML = ''");
  const vazio = JSON.parse(await js(
    "JSON.stringify({ vazio: document.body.innerHTML === '', semInputs: document.querySelectorAll('input').length === 0 })",
  ));
  check(vazio.vazio === true && vazio.semInputs === true,
    'pagina inteira ficou vazia antes do form_fill (mesma reproducao do auditor)', JSON.stringify(vazio));

  const t2 = await c.call('tools/call', {
    name: 'browser_form_fill',
    arguments: { campos: [{ ref: refFantasma2, valor: 'ESCRITO NO FANTASMA' }] },
  });
  check(t2.result.isError === true, 'pagina vazia: browser_form_fill vem como ERRO, nunca ok para o fantasma',
    JSON.stringify(t2.result));
  const texto2 = t2.result.content?.[0]?.text ?? '';
  check(texto2.includes('0/1 campos preenchidos'), 'relatorio mostra 0 de 1 preenchidos (nao mentiu sucesso)',
    texto2.split('\n')[0]);
  check(/FALHOU/.test(texto2) && !/ref \d+: ok/.test(texto2),
    'o campo fantasma aparece como FALHOU no relatorio, nunca como "ok"', texto2);

  // ── remonta a pagina para os casos de freio (2a, 2b, 4) ────────────────
  await montarPagina();
  await sleep(300);
  pagina = await lerPagina();
  const refTexto2 = refDe(pagina, 'Campo normal texto');
  const refCor2 = refDe(pagina, 'Campo normal select');
  const refAceite2 = refDe(pagina, 'Campo normal checkbox');
  const refRadio2 = refDe(pagina, 'Campo normal radio');
  const refSenha2 = refDe(pagina, 'Campo de senha teste');
  check(
    [refTexto2, refCor2, refAceite2, refRadio2, refSenha2].every((r) => Number.isFinite(r)),
    'achou os refs depois de remontar a pagina',
    `texto=${refTexto2} cor=${refCor2} aceite=${refAceite2} radio=${refRadio2} senha=${refSenha2}`,
  );

  // ── 2a. senha via browser_form_input: barrada, mesmo com confirm:true ──
  const t3 = await c.call('tools/call', {
    name: 'browser_form_input',
    arguments: { ref: refSenha2, valor: 'MinhaSenhaSecreta123' },
  });
  check(t3.result.isError === true, 'browser_form_input em <input type=password> vem como ERRO (freio)',
    JSON.stringify(t3.result));
  const texto3 = t3.result.content?.[0]?.text ?? '';
  check(/bloqueado/i.test(texto3) && /senha/i.test(texto3), 'a mensagem cita o bloqueio de senha', texto3);
  const senhaDepoisT3 = await js("document.getElementById('senha').value");
  check(senhaDepoisT3 === '', 'o campo de senha continua vazio -- a ponte NAO escreveu nada', `valor="${senhaDepoisT3}"`);

  const t3b = await c.call('tools/call', {
    name: 'browser_form_input',
    arguments: { ref: refSenha2, valor: 'MinhaSenhaSecreta123', confirm: true },
  });
  check(t3b.result.isError === true,
    'senha continua barrada mesmo com confirm:true (regra 1 do freio nao aceita confirmacao)',
    JSON.stringify(t3b.result));
  const senhaDepoisT3b = await js("document.getElementById('senha').value");
  check(senhaDepoisT3b === '', 'campo de senha continua vazio mesmo com confirm:true', `valor="${senhaDepoisT3b}"`);

  // ── 2b. senha no meio de um browser_form_fill: barrada; o campo normal
  //        ANTES dela no lote continua sendo aplicado normalmente ────────
  const t4 = await c.call('tools/call', {
    name: 'browser_form_fill',
    arguments: {
      campos: [
        { ref: refTexto2, valor: 'Fulano de Tal' },
        { ref: refSenha2, valor: 'MinhaSenhaSecreta123' },
      ],
    },
  });
  check(t4.result.isError === true, 'lote com senha no meio vem como ERRO', JSON.stringify(t4.result));
  const texto4 = t4.result.content?.[0]?.text ?? '';
  check(texto4.includes('1/2 campos preenchidos'), 'relatorio: 1 preenchido (texto), 1 falhou (senha)',
    texto4.split('\n')[0]);
  check(/bloqueado/i.test(texto4) && /senha/i.test(texto4), 'a falha da senha no lote cita o bloqueio', texto4);
  const senhaDepoisLote = await js("document.getElementById('senha').value");
  check(senhaDepoisLote === '', 'senha continua vazia depois do lote (nunca escreveu)', `valor="${senhaDepoisLote}"`);
  const textoDepoisLote = await js("document.getElementById('texto').value");
  check(textoDepoisLote === 'Fulano de Tal',
    'o campo normal ANTES da senha no lote foi preenchido normalmente (freio nao virou tudo-ou-nada)',
    `valor="${textoDepoisLote}"`);

  // ── 4. falso positivo: texto/select/checkbox/radio comuns NAO sao
  //      barrados pelo freio (nem por form_input nem por form_fill) ──────
  await c.tool('browser_form_input', { ref: refTexto2, valor: 'Ciclano' });
  const textoComum = await js("document.getElementById('texto').value");
  check(textoComum === 'Ciclano', 'texto comum continua preenchido via form_input (sem falso positivo)',
    `valor="${textoComum}"`);

  await c.tool('browser_form_input', { ref: refCor2, valor: 'AZUL' });
  const corComum = await js("document.getElementById('cor').value");
  check(corComum === 'azul', 'select comum continua preenchido via form_input (sem falso positivo)',
    `valor="${corComum}"`);

  await c.tool('browser_form_input', { ref: refAceite2, valor: true });
  const aceiteComum = await js("document.getElementById('aceite').checked");
  check(aceiteComum === 'true', 'checkbox comum continua preenchido via form_input (sem falso positivo)',
    `valor=${aceiteComum}`);

  await c.tool('browser_form_input', { ref: refRadio2, valor: true });
  const radioComum = await js("document.getElementById('r1').checked");
  check(radioComum === 'true', 'radio comum continua preenchido via form_input (sem falso positivo)',
    `valor=${radioComum}`);

  const t5 = await c.json('browser_form_fill', {
    campos: [
      { ref: refCor2, valor: 'AZUL' },
      { ref: refAceite2, valor: false },
    ],
  });
  check(t5.total === 2 && t5.preenchidos === 2,
    'lote so com campos comuns (select+checkbox) passa 2/2 via form_fill (sem falso positivo)', JSON.stringify(t5));
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
  falhou = true;
} finally {
  c.close();
}

if (falhou) process.exitCode = 1;
