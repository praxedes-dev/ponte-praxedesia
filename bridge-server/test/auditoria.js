/**
 * Obra 10 — auditoria: quem fez o que, em que aba
 * (docs/obra-20260904/10-auditoria-quem-fez-o-que.md).
 *
 * Criterio de pronto do briefing, item por item:
 *   1/2 — dois agentes nomeados; A navega example.com, B navega
 *         iana.org/help/example-domains, A monta um botao "Excluir
 *         processo" e clica nele (freio barra). bridge_auditoria de A
 *         (limite 30) contem os tres eventos, cruzando agente, com
 *         agente/clientId/acao/aba/url/ok/erro/ms corretos.
 *   3   — so_meus:true de A esconde tudo que e de agente-B.
 *   4   — o resumo do navigate carrega a url; o do click nao tem base64 nem
 *         passa de 200 caracteres.
 *
 * Casos 5/6 (fora da lista literal do briefing, adicionados aqui): provam
 * que a truncagem de `codigo` (120) e de `valor` (60) CORTA de verdade um
 * valor comprido — sem isto, uma mutacao que apague o `.slice(...)` passaria
 * incolume, porque nenhum parametro do item 1-4 e comprido o bastante para
 * estourar o teto por acaso.
 *
 *   node test/auditoria.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const a = startClient('agente-A');
const b = startClient('agente-B');

try {
  await a.handshake();
  if (!(await esperarExtensao(a))) throw new Error('extensao nao conectou');
  await b.handshake();

  // Abas proprias: sem isto os testes mexeriam na aba que o Dr. Cezar esta usando.
  await a.tool('browser_tab_open', {});
  await a.tool('browser_navigate', { url: 'https://example.com' });
  await a.tool('browser_wait_network', {});

  await b.tool('browser_tab_open', {});
  await b.tool('browser_navigate', { url: 'https://www.iana.org/help/example-domains' });
  await b.tool('browser_wait_network', {});

  const infoA = await a.json('browser_tabs_list');
  const abaA = infoA.activeTabId;

  // Pagina de prova de A: botao destrutivo (freio barra) + campo de texto
  // (para o caso 6, truncagem de `valor`).
  await a.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<button id="del">Excluir processo</button>' +
        '<input id="alvo" type="text" placeholder="campotruncagem">';
      return 'montado';
    })()`,
  });
  await sleep(300);

  const pagina = (await a.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };

  const refBotao = refDe('excluir');
  check(Boolean(refBotao), 'achou a ref do botao "Excluir processo"', String(refBotao));

  const rClique = await a.call('tools/call', { name: 'browser_click', arguments: { ref: refBotao } });
  const textoClique = rClique.result?.content?.[0]?.text ?? '';
  check(rClique.result?.isError === true, '1. clique em "Excluir processo" foi bloqueado', textoClique.slice(0, 120));
  check(/bloqueado/i.test(textoClique), '1. a mensagem nomeia o bloqueio', textoClique.slice(0, 120));

  // Caso 5: codigo comprido (bem > 120 chars) — prova que o corte de
  // resumoDe() em auditoria.ts realmente corta, e nao so cabe por acaso.
  const codigoComprido = `(function(){ return ${'1+'.repeat(150)}1; })()`;
  check(codigoComprido.length > 120, 'setup do caso 5: o codigo de prova e mesmo maior que 120', String(codigoComprido.length));
  await a.tool('browser_javascript', { codigo: codigoComprido });

  // Caso 6: valor comprido (100 chars) no campo de texto — mesma logica para o corte em 60.
  const refAlvo = refDe('campotruncagem');
  check(Boolean(refAlvo), 'setup do caso 6: achou a ref do campo de texto', String(refAlvo));
  const valorComprido = 'x'.repeat(100);
  if (refAlvo) await a.tool('browser_form_input', { ref: refAlvo, valor: valorComprido });

  await sleep(400); // margem para o gancho "depois" terminar de gravar no IndexedDB

  // ── itens 1/2: bridge_auditoria de A ve os proprios eventos e os de B ───
  const listaA = await a.json('bridge_auditoria', { limite: 30 });
  check(Array.isArray(listaA) && listaA.length > 0, 'bridge_auditoria devolveu uma lista', `len=${listaA?.length}`);

  const navA = listaA.find((e) => e.acao === 'navigate' && e.agente === 'agente-A');
  check(Boolean(navA), '2. achou o navigate de agente-A', JSON.stringify(navA)?.slice(0, 160));
  check(navA?.ok === true, '2. o navigate de A esta marcado ok:true');

  const navB = listaA.find((e) => e.acao === 'navigate' && e.agente === 'agente-B');
  check(Boolean(navB), '2. achou o navigate de agente-B (A ve o de B tambem)', JSON.stringify(navB)?.slice(0, 160));
  check(typeof navB?.url === 'string' && navB.url.includes('iana.org'), '2. a url do navigate de B e a da iana', navB?.url);

  const cliqueLog = listaA.find((e) => e.acao === 'click' && e.agente === 'agente-A' && e.ok === false);
  check(Boolean(cliqueLog), '2. achou o click bloqueado de agente-A, ok:false', JSON.stringify(cliqueLog)?.slice(0, 200));
  check(/bloqueado/i.test(cliqueLog?.erro ?? ''), '2. o erro gravado diz "bloqueado"', cliqueLog?.erro);
  check(typeof navA?.ms === 'number' && Number.isFinite(navA.ms), '2. ms do navigate e numerico', String(navA?.ms));
  check(typeof cliqueLog?.ms === 'number' && Number.isFinite(cliqueLog.ms), '2. ms do click e numerico', String(cliqueLog?.ms));
  check(navA?.aba === abaA, '2. a aba do navigate de A bate com browser_tabs_list', `${navA?.aba} vs ${abaA}`);

  // ── item 3: so_meus:true de A nao traz nada de agente-B ──────────────────
  const soMeus = await a.json('bridge_auditoria', { limite: 30, so_meus: true });
  const vazamentoDeB = soMeus.filter((e) => e.agente === 'agente-B');
  check(vazamentoDeB.length === 0, '3. so_meus:true de A nao contem nenhum evento de agente-B', JSON.stringify(vazamentoDeB).slice(0, 160));
  check(soMeus.some((e) => e.agente === 'agente-A'), '3. so_meus:true de A ainda traz os proprios eventos');

  // ── item 4: resumo do navigate tem a url; o do click nao tem base64/gigante
  const resumoNav = navA?.resumo ?? '';
  check(resumoNav.includes('example.com'), '4. resumo do navigate contem a url', resumoNav);

  const resumoClique = cliqueLog?.resumo ?? '';
  check(!/[A-Za-z0-9+/]{100,}={0,2}/.test(resumoClique), '4. resumo do click nao parece base64', resumoClique.slice(0, 60));
  check(resumoClique.length <= 200, '4. resumo do click nao passa de 200 caracteres', String(resumoClique.length));

  // ── caso 5: resumo de cap_js corta o `codigo` em 120 de verdade ──────────
  const logJs = listaA.find((e) => e.acao === 'cap_js' && typeof e.resumo === 'string' && e.resumo.startsWith('codigo='));
  check(Boolean(logJs), '5. achou o log do browser_javascript com codigo comprido', JSON.stringify(logJs)?.slice(0, 160));
  const codigoNoResumo = logJs ? logJs.resumo.slice('codigo='.length) : '';
  check(codigoNoResumo.length > 0 && codigoNoResumo.length <= 120, '5. o codigo dentro do resumo foi cortado em ate 120', String(codigoNoResumo.length));

  // ── caso 6: resumo de cap_form_input corta o `valor` em 60 de verdade ────
  if (refAlvo) {
    const logValor = listaA.find((e) => e.acao === 'cap_form_input');
    check(Boolean(logValor), '6. achou o log do browser_form_input', JSON.stringify(logValor)?.slice(0, 160));
    check((logValor?.resumo ?? '').includes(`valor=${'x'.repeat(60)}`), '6. o valor dentro do resumo foi cortado em 60', logValor?.resumo);
    check(!(logValor?.resumo ?? '').includes('x'.repeat(61)), '6. nao sobraram 61+ "x" seguidos (prova que cortou, nao coincidiu)', logValor?.resumo);
  } else {
    check(false, '6. achou a ref do campo de texto para testar a truncagem de valor');
  }
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  a.close();
  b.close();
}
