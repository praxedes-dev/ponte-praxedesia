/**
 * Teste de contrato da obra 20 (o modo somente leitura barra JS com efeito,
 * sem barrar JS de leitura) — docs/obra-20260904/20-javascript-fura-o-modo-somente-leitura.md
 *
 * Achado que motivou a obra: `cap_js` nunca declarou `altera`, entao
 * `document.querySelector('form').submit()` rodava liso na aba do Dr. Cezar
 * mesmo com o agente em modo leitura — o furo mais largo da barreira. A
 * capacidade continua sem `altera: true` (bloquear por NOME bloquearia
 * leitura legitima tambem); a decisao agora e por CONTEUDO, dentro de
 * `executarJs` (capacidades/js.ts), usando `throwOnSideEffect` do CDP.
 *
 * Por isso este teste NAO pode reaproveitar a sonda de `registro.js`: aquela
 * testa "esta capacidade e sempre barrada" (por nome); aqui a MESMA acao
 * (`cap_js`) ora passa (leitura), ora barra (efeito) — precisa do par.
 *
 * Segue o "Conserto 2" de registro.js: abre a PROPRIA aba-cobaia (nunca a do
 * Dr. Cezar), adota com browser_use_tab, e devolve para browser_use_own_tab
 * no finally antes de fechar a cobaia — mesmo em caso de falha no meio, para
 * nunca deixar a sessao presa em modo leitura nem a cobaia orfa.
 *
 * Dois casos de controle acrescentados em 05/09/2026 (achados do cetico por
 * mutation testing, item 3 do briefing desta obra):
 *
 *   - 2b: um erro REAL de script (`null.textContent`, variavel nao definida,
 *     JSON invalido) tem de voltar "erro no script:", nunca
 *     "[somente leitura]". Prova que `ehEfeitoColateralBarrado` (js.ts) nao
 *     virou `return true` disfarcado — essa mutacao mantinha a bateria
 *     inteira verde antes deste caso existir.
 *   - 3c/3d: codigo ASSINCRONO (com `await`) tambem tem que ser barrado, nao
 *     so escrita sincrona. Prova que a chamada ao CDP nao ganhou uma excecao
 *     tipo "so ligar throwOnSideEffect se o codigo nao tiver await" — essa
 *     mutacao tambem mantinha 12/12 verde e deixava o titulo da aba mudar
 *     de verdade.
 *     ⚠️ Isto NAO prova "escrita depois de await e capturada" (rotulo antigo
 *     deste caso, ERRADO): medido depois, num script SEM nenhuma escrita
 *     (`(async () => { const v = await Promise.resolve(7); return v; })()`),
 *     a mesma barreira dispara — quem aborta e o proprio `await`, antes de a
 *     escrita da linha seguinte sequer rodar. Ver o comentario de
 *     `executarJs` em `capacidades/js.ts` para o mecanismo real.
 *
 *   node test/js-somente-leitura.js
 */
import { startClient, esperarExtensao } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-js-somente-leitura');
try {
  await c.handshake();

  if (!(await esperarExtensao(c))) {
    check(false, 'extensao conectou');
  } else {
    await c.tool('browser_tab_open', { url: 'https://example.com/sonda-js-somente-leitura' });
    await c.tool('browser_wait_network', {}).catch(() => {});
    const cobaia = (await c.json('browser_tabs_list')).activeTabId;

    try {
      // ── 1. adotar a cobaia entra em modo somente leitura ──────────────────
      const adocao = (await c.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
      const entrouEmLeitura = /somente leitura/i.test(adocao);
      check(entrouEmLeitura, '1. browser_use_tab (cobaia) entra em modo somente leitura', adocao.slice(0, 90));
      if (!entrouEmLeitura) throw new Error('sem modo leitura, o resto do teste nao prova nada — abortando');

      // ── 2. JS de leitura continua funcionando em modo leitura ─────────────
      const leituras = [
        ['document.title', 'Example Domain'],
        ['location.href', 'https://example.com/sonda-js-somente-leitura'],
        ["document.querySelector('h1').textContent", 'Example Domain'],
      ];
      for (const [codigo, esperado] of leituras) {
        const resp = await c.call('tools/call', { name: 'browser_javascript', arguments: { codigo } });
        const texto = resp.result?.content?.[0]?.text ?? '';
        const ok = resp.result?.isError !== true && texto.includes(esperado);
        check(ok, `2. leitura pura passa em modo leitura: ${codigo}`, texto.slice(0, 90));
      }

      // ── 2b. caso de controle: erro REAL de script continua erro de script ──
      // Sem isto, trocar `ehEfeitoColateralBarrado` por `return true` (js.ts)
      // mantinha a bateria inteira verde: TODO erro de leitura — inclusive um
      // erro comum de digitacao do proprio agente — voltaria disfarcado de
      // "[somente leitura]", e o agente pediria permissao de ESCRITA ao Dr.
      // Cezar por causa do proprio bug, nunca por tentar alterar a aba dele.
      const errosReais = [
        ["document.querySelector('#elemento-que-nao-existe').textContent", 'querySelector nulo'],
        ['variavelQueNaoFoiDeclaradaEmLugarNenhum.propriedade', 'variavel nao definida'],
        ["JSON.parse('{')", 'JSON invalido'],
      ];
      for (const [codigo, rotulo] of errosReais) {
        const resp = await c.call('tools/call', { name: 'browser_javascript', arguments: { codigo } });
        const texto = resp.result?.content?.[0]?.text ?? '';
        const eErroDeScript = resp.result?.isError === true && /erro no script:/.test(texto);
        const naoFoiConfundidoComBarreira = !/\[somente leitura\]/.test(texto);
        check(eErroDeScript && naoFoiConfundidoComBarreira,
          `2b. erro real de script (${rotulo}) volta "erro no script:", nao "[somente leitura]"`,
          texto.slice(0, 160));
      }

      // ── 3. JS com efeito e barrado, com mensagem de remedio ───────────────
      const mutacoes = [
        ["document.title = 'sonda-js-somente-leitura-mutada'", 'title'],
        ["document.body.innerHTML = '<b>mutado</b>'", 'innerHTML'],
        ["fetch('https://example.com', {method:'POST'}).then(r => r.status)", 'fetch POST'],
      ];
      for (const [codigo, rotulo] of mutacoes) {
        const resp = await c.call('tools/call', { name: 'browser_javascript', arguments: { codigo } });
        const texto = resp.result?.content?.[0]?.text ?? '';
        const barrado = resp.result?.isError === true && /\[somente leitura\]/.test(texto);
        const dizORemedio = /permitir_acao/.test(texto) && /browser_use_own_tab/.test(texto);
        check(barrado && dizORemedio,
          `3. JS com efeito (${rotulo}) e barrado com mensagem que diz o remedio`, texto.slice(0, 160));
      }

      // Confirma que a mutacao NAO aconteceu de verdade (nao so que a
      // mensagem apareceu) — releitura por JS de leitura, ainda em modo leitura.
      const confereMutacaoNaoAplicada = await c.call('tools/call', {
        name: 'browser_javascript', arguments: { codigo: 'document.title' },
      });
      const tituloIntacto = confereMutacaoNaoAplicada.result?.content?.[0]?.text?.includes('Example Domain');
      check(tituloIntacto, '3b. o titulo da cobaia continua o original (a mutacao barrada nao rodou)',
        confereMutacaoNaoAplicada.result?.content?.[0]?.text);

      // ── 3c. codigo ASSINCRONO (com `await`) tambem e barrado ──────────────
      // Sem a excecao de `await` mandada ao CDP em `js.ts` (`throwOnSideEffect`
      // ligado enquanto a promise nao resolve), este script inteiro escaparia
      // da checagem e rodaria de verdade — foi assim que o cetico mediu o
      // furo: a chamada devolveu "rodei" e o titulo mudou.
      // ⚠️ Isto NAO prova "escrita depois de await e capturada especificamente":
      // quem aborta e o proprio `await 0`, ANTES de a linha seguinte
      // (`document.title = ...`) sequer rodar — nao ha como, so com este
      // script, distinguir "o await foi barrado" de "a escrita apos o await
      // foi barrada". Ver `capacidades/js.ts` (comentario de `executarJs`)
      // para o caso medido sem NENHUMA escrita que prova isso.
      const codigoAssincrono = "(async () => { await 0; document.title = 'FUROU-PELO-AWAIT'; return 'rodei'; })()";
      const respAssincrono = await c.call('tools/call', {
        name: 'browser_javascript', arguments: { codigo: codigoAssincrono },
      });
      const textoAssincrono = respAssincrono.result?.content?.[0]?.text ?? '';
      const barradoAssincrono = respAssincrono.result?.isError === true && /\[somente leitura\]/.test(textoAssincrono);
      check(barradoAssincrono, '3c. codigo assincrono (com `await`) tambem e barrado', textoAssincrono.slice(0, 160));

      const confereTituloIntactoDepoisDeAwait = await c.call('tools/call', {
        name: 'browser_javascript', arguments: { codigo: 'document.title' },
      });
      const tituloAindaIntacto = confereTituloIntactoDepoisDeAwait.result?.content?.[0]?.text?.includes('Example Domain');
      check(tituloAindaIntacto, '3d. o titulo continua o original depois da tentativa via await (nao rodou de verdade)',
        confereTituloIntactoDepoisDeAwait.result?.content?.[0]?.text);

      // ── 4. com permitir_acao, o MESMO js com efeito passa ─────────────────
      const liberou = (await c.tool('browser_use_tab', { tabId: cobaia, permitir_acao: true })).content[0].text;
      check(/acao|permit/i.test(liberou) || !/somente leitura/i.test(liberou),
        '4a. browser_use_tab com permitir_acao:true sai do modo leitura', liberou.slice(0, 90));

      const respLiberado = await c.call('tools/call', {
        name: 'browser_javascript', arguments: { codigo: "document.title = 'sonda-js-somente-leitura-mutada'" },
      });
      const passouAgora = respLiberado.result?.isError !== true;
      check(passouAgora, '4b. o mesmo JS com efeito do item 3 passa depois de permitir_acao: true',
        respLiberado.result?.content?.[0]?.text?.slice(0, 120) ?? '');

      const confereMutacaoAplicada = await c.call('tools/call', {
        name: 'browser_javascript', arguments: { codigo: 'document.title' },
      });
      const tituloMudou = confereMutacaoAplicada.result?.content?.[0]?.text?.includes('sonda-js-somente-leitura-mutada');
      check(tituloMudou, '4c. o titulo da cobaia realmente mudou depois de permitir_acao: true',
        confereMutacaoAplicada.result?.content?.[0]?.text);
    } finally {
      // Devolve o agente para a aba propria ANTES de fechar a cobaia (mesmo
      // padrao de registro.js — "Conserto 2"): sem isto a sessao fica presa
      // em modo leitura ate c.close() la embaixo soltar o workspace.
      const volta = (await c.tool('browser_use_own_tab')).content[0].text;
      check(/aba propria/.test(volta), '5. browser_use_own_tab devolve o agente para a aba dele');
      await c.tool('browser_tab_close', { tabId: cobaia }).catch(() => {});
    }
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
