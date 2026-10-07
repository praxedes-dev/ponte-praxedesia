/**
 * Testa browser_network_requests e browser_network_body (obra 11).
 * Ver entrypoints/background/bridge/capacidades/rede-inspecao.ts para o desenho.
 *
 *   node test/rede-inspecao.js
 *
 * NOTA sobre a sequencia abaixo (achado medido, nao suposto): abre a aba
 * PROPRIA em branco (`browser_tab_open` sem url) e so DEPOIS navega com
 * `browser_navigate`. Medido nesta obra: `browser_tab_open` com `url` direto
 * passa a URL para `chrome.tabs.create` (`workspace-manager/index.ts:184`),
 * que comeca a carregar a pagina ANTES do `debuggerManager.attach()` da linha
 * seguinte rodar `Network.enable` e os ganchos `aoAnexar` — o documento
 * principal se perde, silenciosamente, sem nenhum sinal de erro. Depois que a
 * aba ja esta anexada, um `browser_navigate` na MESMA aba roda com os
 * listeners ja no ar e captura o documento normalmente. Ver o comentario "⚠️
 * ARMADILHA MEDIDA" em rede-inspecao.ts para o relato completo.
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-rede-inspecao');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria em branco primeiro (attach roda aqui, sem corrida com navegacao
  // nenhuma) — nunca mexer na aba que o Dr. Cezar esta usando.
  await c.tool('browser_tab_open', {});
  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  // ── 1. Documento principal listado com status 200; corpo legivel ───────
  const lista1 = await c.json('browser_network_requests', {});
  const doc = lista1.find((e) => e.tipo === 'Document' && e.url.includes('example.com'));
  check(Boolean(doc) && doc.status === 200, 'Document aparece com status 200', JSON.stringify(doc));

  const corpoDoc = (await c.tool('browser_network_body', { filtro_url: 'example.com' })).content[0].text;
  check(corpoDoc.includes('Example Domain'), 'browser_network_body leu o corpo do documento', corpoDoc.slice(0, 60));

  // ── 2. fetch aparece como Fetch/XHR, com corpo legivel ──────────────────
  await c.tool('browser_javascript', {
    codigo: "fetch('https://example.com/?x=1').then(function(r){ return r.status; })",
  });
  await sleep(800);
  const lista2 = await c.json('browser_network_requests', { filtro_url: 'x=1' });
  const fetchEntry = lista2[0];
  check(
    Boolean(fetchEntry) && fetchEntry.status === 200 && ['Fetch', 'XHR'].includes(fetchEntry.tipo),
    'fetch aparece como Fetch/XHR com 200',
    JSON.stringify(fetchEntry),
  );
  const corpoFetch = (await c.tool('browser_network_body', { filtro_url: 'x=1' })).content[0].text;
  check(corpoFetch.includes('Example Domain'), 'corpo do fetch legivel', corpoFetch.slice(0, 60));

  // ── 3. Falha de rede (DNS) aparece com so_falhas ────────────────────────
  await c.tool('browser_javascript', {
    codigo: "fetch('https://nao-existe.invalid/').catch(function(e){ return 'falhou: ' + e.message; })",
  });
  await sleep(1500);
  const falhas = await c.json('browser_network_requests', { so_falhas: true });
  const falhaEntry = falhas.find((e) => e.url.includes('nao-existe.invalid'));
  check(
    Boolean(falhaEntry) && Boolean(falhaEntry.falha),
    'falha de DNS aparece com so_falhas preenchendo "falha"',
    JSON.stringify(falhaEntry),
  );
  // Sem isto o filtro pode virar no-op (devolve tudo) sem o teste perceber:
  // ate aqui ja passaram varias requisicoes de sucesso (documento, fetch x=1).
  check(
    falhas.every((e) => Boolean(e.falha)),
    'so_falhas EXCLUI as que nao falharam (nao e so-op que devolve tudo)',
    `${falhas.length} entrada(s), ${falhas.filter((e) => !e.falha).length} sem "falha"`,
  );

  // ── 4. Corpo antigo, apos navegar, da erro de cache — nao mente "vazio" ─
  await c.tool('browser_navigate', { url: 'https://example.org' });
  await c.tool('browser_wait_network', {});
  const rCache = await c.call('tools/call', {
    name: 'browser_network_body',
    arguments: { requestId: doc?.requestId },
  });
  check(
    rCache.result.isError === true && rCache.result.content[0].text.includes('nao esta mais em cache'),
    'corpo de requisicao antiga, apos navegar, da erro de cache (nao inventa vazio)',
    rCache.result.content[0].text.slice(0, 100),
  );

  // ── 5. limite devolve exatamente N, do mais novo ────────────────────────
  const doisMaisNovos = await c.json('browser_network_requests', { limite: 2 });
  check(doisMaisNovos.length === 2, 'limite:2 devolve exatamente 2 entradas', String(doisMaisNovos.length));

  // ── 6. Corpo binario NUNCA volta em base64 no texto ─────────────────────
  // favicon.ico do Google: recurso binario estavel havia decadas, bom alvo de
  // teste que nao depende de eu controlar o servidor. Rede real (nao mock):
  // se a extensao/maquina estiver sem saida para a internet publica, este
  // teste falha por ambiente, nao por defeito — o sinal fica no proprio log.
  // mode: 'no-cors' de proposito: sem isso o Chrome bloqueia a resposta
  // cross-origin no CORS check e o CDP ve o pedido como falha (net::ERR_FAILED),
  // nao como 200 — medido nesta obra. Em no-cors a pagina nao le o corpo (Response
  // opaco), mas o CDP ve a transacao de rede real por baixo, que e o que importa aqui.
  await c.tool('browser_javascript', {
    codigo: "fetch('https://www.google.com/favicon.ico', { mode: 'no-cors' }).catch(function(){ return 'ignorado'; })",
  });
  await sleep(1200);
  const listaFavicon = await c.json('browser_network_requests', { filtro_url: 'favicon.ico' });
  const faviconEntry = listaFavicon[0];
  if (faviconEntry?.status === 200) {
    const corpoFavicon = await c.json('browser_network_body', { filtro_url: 'favicon.ico' });
    check(
      corpoFavicon?.binario === true && typeof corpoFavicon.aviso === 'string',
      'corpo binario nao vaza em base64 no texto (vem {binario:true, aviso})',
      JSON.stringify(corpoFavicon),
    );
  } else {
    check(false, 'buscou favicon.ico do Google para testar corpo binario', JSON.stringify(faviconEntry));
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
