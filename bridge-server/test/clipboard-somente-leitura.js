/**
 * B3 — `copy_to_clipboard` (`browser_clipboard_copy`) rodava na aba do
 * Dr. Cezar em modo SOMENTE LEITURA.
 *
 * A acao nao estava em `ACOES_QUE_ALTERAM_MOTOR` (bridge/index.ts), entao
 * `alteraAPagina('copy_to_clipboard')` respondia `false` e o gate de nome nunca
 * a barrava. E ela nao e leitura:
 *
 *   1. sobrescreve a AREA DE TRANSFERENCIA do Windows — estado da maquina do
 *      usuario, nao da pagina. "Olha isso aqui" nao pode apagar o que ele
 *      tinha copiado.
 *   2. quando `navigator.clipboard.writeText` falha, o fallback CRIA um
 *      `<textarea>`, ANEXA em `document.body`, chama `select()` (destroi a
 *      selecao e o foco do usuario) e remove — mexe no DOM da pagina em que
 *      ele esta trabalhando. E esse fallback nao e caso raro: `writeText`
 *      recusa em documento sem foco, que e a situacao NORMAL de uma aba que o
 *      agente esta lendo em segundo plano.
 *
 * A incoerencia que o mapa apontou: `scroll` — que nem muda dado nenhum da
 * pagina — ja estava barrado, e isto nao estava.
 *
 * CONSERTO ESCOLHIDO: `copy_to_clipboard` entrou em `ACOES_QUE_ALTERAM_MOTOR`,
 * a mesma porta de `navigate`/`click`/`type`/`scroll`/`drag`. Na aba propria do
 * agente ela continua livre; na aba do usuario passa a exigir `permitir_acao`.
 *
 * POR QUE NAO "barrar so o fallback que mexe no DOM": (a) deixaria a copia
 * NAO-DETERMINISTICA — funcionaria com a aba em foco e falharia sem foco, que e
 * o caso comum; (b) nao protegeria a area de transferencia, que e metade do
 * dano; (c) a decisao moraria dentro da funcao injetada na pagina, um SEGUNDO
 * ponto de politica fora do freio — exatamente o desenho que criou a familia de
 * furos desta obra.
 *
 * Casos:
 *   1 — na aba PROPRIA do agente a copia funciona (nao viramos "sempre barra").
 *   2 — adotada a cobaia em modo leitura, a copia por `text` e barrada, com a
 *       mensagem que diz o remedio.
 *   3 — a copia por `selector` (o caminho que le da pagina) tambem e barrada:
 *       o gate e por NOME de acao, nao pelo formato do argumento.
 *   4 — o DOM da cobaia nao foi tocado (MutationObserver instalado antes da
 *       adocao nao registrou nada) — prova que a acao nao rodou, e nao apenas
 *       que a mensagem apareceu.
 *   5 — com `permitir_acao: true` na MESMA aba, a MESMA copia passa.
 *
 *   node test/clipboard-somente-leitura.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-clipboard-somente-leitura');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_tab_open', { url: 'https://example.com/sonda-clipboard-leitura' });
  await c.tool('browser_wait_network', {}).catch(() => {});
  const cobaia = (await c.json('browser_tabs_list')).activeTabId;

  try {
    // Observador do DOM instalado AGORA, com o agente ainda em modo acao na
    // propria aba — depois da adocao em leitura nao daria: instalar observer e
    // efeito colateral e o `cap_js` recusa (e com razao).
    await c.tool('browser_javascript', {
      codigo: `(function(){
        window.__mut = 0;
        new MutationObserver(function(regs){ window.__mut += regs.length; })
          .observe(document.body, { childList: true, subtree: true });
        return 'observando';
      })()`,
    });
    await sleep(150);

    // ── 1. aba propria do agente: a copia funciona ──────────────────────
    const r1 = await c.call('tools/call', {
      name: 'browser_clipboard_copy', arguments: { text: 'sonda-clipboard-aba-propria' },
    });
    check(r1.result?.isError !== true, '1. na aba propria do agente a copia funciona (sem falso positivo)',
      (r1.result?.content?.[0]?.text ?? '').slice(0, 160));

    // ── 2. adotada em modo leitura, a copia por texto e barrada ─────────
    const adocao = (await c.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
    const entrouEmLeitura = /somente leitura/i.test(adocao);
    check(entrouEmLeitura, '2a. browser_use_tab (cobaia) entra em modo somente leitura', adocao.slice(0, 90));
    if (!entrouEmLeitura) throw new Error('sem modo leitura o resto nao prova nada — abortando');

    await c.tool('browser_javascript', { codigo: 'window.__mut' }); // zera ruido de leitura
    const mutAntes = Number((await c.tool('browser_javascript', { codigo: 'window.__mut' })).content[0].text.trim());

    const r2 = await c.call('tools/call', {
      name: 'browser_clipboard_copy', arguments: { text: 'SENTINELA-QUE-NAO-PODE-SER-COPIADA' },
    });
    const t2 = r2.result?.content?.[0]?.text ?? '';
    check(r2.result?.isError === true && /\[somente leitura\]/.test(t2),
      '2b. copiar por `text` na aba do usuario em modo leitura e BARRADO', t2.slice(0, 180));
    check(/permitir_acao/.test(t2) && /browser_use_own_tab/.test(t2),
      '2c. a mensagem diz o remedio (permitir_acao ou voltar para a aba propria)', t2.slice(0, 180));

    // ── 3. copiar por `selector` tambem e barrado ───────────────────────
    const r3 = await c.call('tools/call', {
      name: 'browser_clipboard_copy', arguments: { selector: 'h1' },
    });
    const t3 = r3.result?.content?.[0]?.text ?? '';
    check(r3.result?.isError === true && /\[somente leitura\]/.test(t3),
      '3. copiar por `selector` tambem e barrado (o gate e por nome de acao)', t3.slice(0, 180));

    // ── 4. o DOM da cobaia continua intacto ─────────────────────────────
    const mutDepois = Number((await c.tool('browser_javascript', { codigo: 'window.__mut' })).content[0].text.trim());
    check(mutDepois === mutAntes,
      '4. nenhuma mutacao no DOM da aba do usuario (o fallback do <textarea> nao rodou)',
      `antes=${mutAntes} depois=${mutDepois}`);

    // ── 5. com permitir_acao: true a MESMA copia passa ──────────────────
    const liberou = (await c.tool('browser_use_tab', { tabId: cobaia, permitir_acao: true })).content[0].text;
    check(!/somente leitura/i.test(liberou), '5a. browser_use_tab com permitir_acao: true sai do modo leitura',
      liberou.slice(0, 90));

    const r5 = await c.call('tools/call', {
      name: 'browser_clipboard_copy', arguments: { text: 'SENTINELA-AGORA-PODE' },
    });
    check(r5.result?.isError !== true, '5b. a MESMA copia passa depois de permitir_acao: true',
      (r5.result?.content?.[0]?.text ?? '').slice(0, 160));
  } finally {
    const volta = (await c.tool('browser_use_own_tab')).content[0].text;
    check(/aba propria/.test(volta), '6. browser_use_own_tab devolve o agente para a aba dele');
    await c.tool('browser_tab_close', { tabId: cobaia }).catch(() => {});
  }
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
