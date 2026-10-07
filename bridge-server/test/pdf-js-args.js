/**
 * Teste da obra 15 — docs/obra-20260904/15-pdf-e-js-com-argumentos.md
 *
 * Cobre os dois itens do briefing:
 *
 *   1-3. `browser_save_pdf` ganha `paginas` (filtra paginas), `rodape`/
 *        `cabecalho` (HTML com as classes do CDP) e `margens_cm` — e um
 *        intervalo invalido (`paginas: "9-7"`) volta `isError` com a
 *        mensagem do proprio CDP, sem reinvencao nossa.
 *   4-8. `browser_javascript` ganha `args`: com `args`, `codigo` vira o
 *        CORPO de uma funcao (`Runtime.callFunctionOn`) e os valores chegam
 *        pelo array `args` em vez de interpolados na string do script —
 *        prova com aspas/quebra de linha, com `await` no corpo, com erro, e
 *        que o caminho SEM `args` continua identico a antes (regra ADITIVA).
 *   9.   `node test/capabilities.js` roda a parte (nao neste arquivo) como
 *        regressao — ele ja usa `browser_javascript`/`browser_save_pdf` sem
 *        os campos novos.
 *   10.  Alem do criterio de pronto do briefing: `args` NAO pode abrir um
 *        segundo caminho para furar o modo somente leitura. `executarJs`
 *        ganhou uma trilha nova (`executarComArgs`, via `callFunctionOn`) —
 *        se essa trilha nao repassar `throwOnSideEffect` do mesmo jeito que
 *        a trilha sem `args` (`executarSemArgs`, via `evaluate`), JS com
 *        efeito colateral passando `args` escaparia da barreira mesmo na aba
 *        do Dr. Cezar. Mesmo padrao de `test/js-somente-leitura.js`: abre a
 *        PROPRIA aba-cobaia (nunca a dele) e adota com `browser_use_tab`
 *        para cair no mesmo caminho que a aba dele cairia.
 *
 *   node test/pdf-js-args.js
 */
import { existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const PDF_INTEIRO = join(tmpdir(), 'ponte-pdf-js-args-inteiro.pdf');
const PDF_PAGINA1 = join(tmpdir(), 'ponte-pdf-js-args-pagina1.pdf');
const PDF_RODAPE = join(tmpdir(), 'ponte-pdf-js-args-rodape.pdf');
const PDF_INVALIDO = join(tmpdir(), 'ponte-pdf-js-args-invalido.pdf');
for (const f of [PDF_INTEIRO, PDF_PAGINA1, PDF_RODAPE, PDF_INVALIDO]) if (existsSync(f)) rmSync(f);

const c = startClient('teste-pdf-js-args');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste trabalharia na aba que o Dr. Cezar esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  // Pagina de 30 paragrafos, um por pagina impressa (page-break-after força
  // a quebra independente de margem, entao a contagem de paginas fica
  // previsivel mesmo quando o teste 2 muda margens_cm).
  await c.tool('browser_javascript', {
    codigo: `(function () {
      document.body.style.margin = '0';
      document.body.innerHTML = Array.from({ length: 30 }, function (_, i) {
        return '<div style="page-break-after: always; font-size: 20px;">Paragrafo ' + (i + 1) +
          ' — obra 15, teste de paginacao do PDF (bridge-server/test/pdf-js-args.js). Texto de ' +
          'preenchimento para dar altura de sobra e forcar a quebra de pagina de verdade no CDP.</div>';
      }).join('');
      return document.querySelectorAll('div').length;
    })()`,
  });
  await sleep(300);

  // ── 1. `paginas` filtra o PDF — o recorte fica menor que o inteiro ────────
  await c.tool('browser_save_pdf', { caminho: PDF_INTEIRO });
  const s1 = existsSync(PDF_INTEIRO) ? statSync(PDF_INTEIRO).size : 0;
  check(s1 > 1000, '1a. browser_save_pdf sem "paginas" gravou o PDF inteiro (30 paginas)', `${s1} bytes`);

  await c.tool('browser_save_pdf', { caminho: PDF_PAGINA1, paginas: '1' });
  const s2 = existsSync(PDF_PAGINA1) ? statSync(PDF_PAGINA1).size : 0;
  check(s2 > 1000, '1b. browser_save_pdf com paginas: "1" gravou o PDF', `${s2} bytes`);
  check(s2 < s1, '1c. o PDF de 1 pagina e menor que o PDF inteiro (paginas realmente filtrou)', `${s2} < ${s1} ?`);

  // ── 2. `rodape` + `margens_cm` mudam o arquivo, sem erro ──────────────────
  await c.tool('browser_save_pdf', {
    caminho: PDF_RODAPE,
    rodape: '<div style="font-size:9px;width:100%;text-align:right;padding-right:1cm">Pag. '
      + '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    margens_cm: { cima: 2, baixo: 2 },
  });
  const s3 = existsSync(PDF_RODAPE) ? statSync(PDF_RODAPE).size : 0;
  check(s3 > 1000, '2a. browser_save_pdf com rodape+margens_cm gravou sem erro', `${s3} bytes`);
  check(s3 !== s1, '2b. o PDF com rodape tem tamanho diferente do PDF sem rodape', `${s3} vs ${s1}`);

  // ── 3. `paginas` invalido -> isError com a mensagem do proprio CDP ────────
  const respInvalido = await c.call('tools/call', {
    name: 'browser_save_pdf',
    arguments: { caminho: PDF_INVALIDO, paginas: '9-7' },
  });
  const textoInvalido = respInvalido.result?.content?.[0]?.text ?? '';
  check(respInvalido.result?.isError === true, '3. paginas: "9-7" volta isError com mensagem do CDP',
    textoInvalido.slice(0, 160));
  check(!existsSync(PDF_INVALIDO), '3b. nada foi gravado em disco para o intervalo invalido');

  // ── 4. args chegam pelo array `args`, nao interpolados ────────────────────
  const soma = (await c.tool('browser_javascript', {
    codigo: 'return args[0] + args[1]', args: [1, 2],
  })).content[0].text;
  check(soma.trim() === '3', '4. browser_javascript com args soma args[0]+args[1] (1+2=3)', soma.trim());

  // ── 5. aspas e quebra de linha sobrevivem inteiras (o motivo da obra) ─────
  const textoComAspas = 'um "texto" com \'aspas\' e\nquebra';
  const tamanho = (await c.tool('browser_javascript', {
    codigo: 'return args[0].length', args: [textoComAspas],
  })).content[0].text;
  check(Number(tamanho.trim()) === textoComAspas.length,
    '5. texto com aspas/quebra de linha chega com o tamanho exato (nao quebrou o script)',
    `devolveu ${tamanho.trim()}, esperado ${textoComAspas.length}`);

  // ── 6. `await` funciona dentro do corpo, com args (fora de somente leitura) ─
  const via = (await c.tool('browser_javascript', {
    codigo: 'return await new Promise(r => setTimeout(() => r(args[0]), 100))', args: ['ok'],
  })).content[0].text;
  check(via.trim() === 'ok', '6. await no corpo (com args) resolve a promise', via.trim());

  // ── 7. sem `args`, nada mudou (regra ADITIVA) ─────────────────────────────
  const titulo = (await c.tool('browser_javascript', { codigo: 'document.title' })).content[0].text;
  check(titulo.includes('Example Domain'), '7. browser_javascript sem args continua igual a antes', titulo.trim());

  // ── 8. erro dentro do corpo com args ainda vira "erro no script" ─────────
  const respErro = await c.call('tools/call', {
    name: 'browser_javascript',
    arguments: { codigo: 'throw new Error("x")', args: [] },
  });
  const textoErro = respErro.result?.content?.[0]?.text ?? '';
  check(respErro.result?.isError === true && /erro no script/.test(textoErro),
    '8. erro lancado dentro do corpo (com args: []) vira isError "erro no script"', textoErro.slice(0, 120));

  // ── 10. `args` nao abre um segundo caminho para furar o modo leitura ──────
  // (item 9 do criterio de pronto — node test/capabilities.js — roda a parte,
  // como regressao; nao repetido aqui.)
  await c.tool('browser_tab_open', { url: 'https://example.com/sonda-pdf-js-args' });
  // Sem isto, `browser_use_tab` podia adotar a cobaia ainda em "about:blank"
  // (navegacao em voo) e 10b/10d liam titulo vazio — falso negativo do TESTE,
  // nao do mecanismo (mesmo padrao de test/js-somente-leitura.js).
  await c.tool('browser_wait_network', {}).catch(() => {});
  const cobaia = (await c.json('browser_tabs_list')).activeTabId;
  try {
    const adocao = (await c.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
    const emLeitura = /somente leitura/i.test(adocao);
    check(emLeitura, '10a. adotar a cobaia entra em modo somente leitura', adocao.slice(0, 90));
    if (!emLeitura) throw new Error('sem modo leitura, o resto do bloco 10 nao prova nada — abortando');

    const leituraComArgs = await c.call('tools/call', {
      name: 'browser_javascript',
      arguments: { codigo: 'return document.title + args[0]', args: ['-sufixo'] },
    });
    const textoLeitura = leituraComArgs.result?.content?.[0]?.text ?? '';
    check(leituraComArgs.result?.isError !== true && textoLeitura.includes('Example Domain-sufixo'),
      '10b. leitura pura com args continua passando em modo somente leitura', textoLeitura.slice(0, 90));

    const escritaComArgs = await c.call('tools/call', {
      name: 'browser_javascript',
      arguments: { codigo: 'document.title = args[0]; return "mudei"', args: ['MUTADO-VIA-ARGS'] },
    });
    const textoEscrita = escritaComArgs.result?.content?.[0]?.text ?? '';
    check(escritaComArgs.result?.isError === true && /\[somente leitura\]/.test(textoEscrita),
      '10c. escrita com args e barrada em modo somente leitura, igual ao caminho sem args',
      textoEscrita.slice(0, 160));

    const confereIntacto = await c.call('tools/call', {
      name: 'browser_javascript', arguments: { codigo: 'document.title' },
    });
    const intacto = confereIntacto.result?.content?.[0]?.text?.includes('Example Domain')
      && !confereIntacto.result?.content?.[0]?.text?.includes('MUTADO-VIA-ARGS');
    check(intacto, '10d. o titulo da cobaia continua o original (a escrita com args nao rodou de verdade)',
      confereIntacto.result?.content?.[0]?.text);
  } finally {
    const volta = (await c.tool('browser_use_own_tab')).content[0].text;
    check(/aba propria/.test(volta), '10e. browser_use_own_tab devolve o agente para a aba dele');
    await c.tool('browser_tab_close', { tabId: cobaia }).catch(() => {});
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
