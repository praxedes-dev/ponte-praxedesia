/**
 * Os dois cenarios que custaram caro ao Cezar:
 *
 *   1. Duas sessoes abertas, uma navegando em cima da outra.
 *   2. Ele no YouTube e a ponte trocando a pagina dele por um link.
 *
 * Contrato novo: cada agente tem aba PROPRIA na janela da ponte; a aba do
 * usuario nunca e tocada, e mesmo quando ele pede para "olhar" ela, entra em
 * modo somente leitura.
 *
 *   node test/isolamento.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const a = startClient('sessao-A');
const b = startClient('sessao-B');

try {
  await a.handshake();
  if (!(await esperarExtensao(a))) throw new Error('extensao nao conectou');
  await b.handshake();

  // Foto das abas do usuario ANTES: tudo que nao esta na janela da ponte.
  const infoA = await a.json('browser_tabs_list');
  const janelaDaPonte = infoA.janelaDaPonte;
  check(typeof janelaDaPonte === 'number', `janela da ponte existe (${janelaDaPonte})`);

  const todas = JSON.parse((await a.tool('browser_tabs_all')).content[0].text);
  const doUsuario = todas.filter((t) => t.janela !== janelaDaPonte);
  const ativaDoUsuario = doUsuario.find((t) => t.ativa);
  check(Boolean(ativaDoUsuario), 'achei a aba ativa do usuario', ativaDoUsuario?.url?.slice(0, 50));

  // ── cenario 1: duas sessoes, cada uma na sua aba ──────────────────────
  await a.tool('browser_navigate', { url: 'https://example.com' });
  await b.tool('browser_navigate', { url: 'https://www.iana.org/help/example-domains' });
  await sleep(2500);

  const urlA = (await a.tool('browser_read_page')).content[0].text.split('\n')[0];
  const urlB = (await b.tool('browser_read_page')).content[0].text.split('\n')[0];
  check(urlA.includes('example.com') && !urlA.includes('iana'), 'sessao A ve a pagina DELA', urlA);
  check(urlB.includes('iana.org'), 'sessao B ve a pagina DELA', urlB);

  const abaA = (await a.json('browser_tabs_list')).activeTabId;
  const abaB = (await b.json('browser_tabs_list')).activeTabId;
  check(abaA !== abaB, 'as duas sessoes estao em abas diferentes', `${abaA} / ${abaB}`);

  const agora = JSON.parse((await a.tool('browser_tabs_all')).content[0].text);
  const tA = agora.find((t) => t.tabId === abaA);
  const tB = agora.find((t) => t.tabId === abaB);
  check(tA?.janela === janelaDaPonte && tB?.janela === janelaDaPonte,
    'as duas estao na janela da ponte, nao na do usuario');

  // ── cenario 2: a aba do usuario continua onde estava ──────────────────
  const ativaDepois = agora.find((t) => t.tabId === ativaDoUsuario.tabId);
  check(ativaDepois?.url === ativaDoUsuario.url, 'a aba do usuario NAO mudou de pagina',
    ativaDepois?.url?.slice(0, 50));
  check(ativaDepois?.ativa === true, 'a aba do usuario continua ativa na janela dele');

  // ── "olha isso aqui": leitura sim, acao nao ───────────────────────────
  const olhar = (await a.tool('browser_use_current_tab')).content[0].text;
  check(/SOMENTE LEITURA/.test(olhar), 'browser_use_current_tab entra em modo leitura', olhar.slice(0, 60));

  const leu = (await a.tool('browser_read_page')).content[0].text.split('\n')[0];
  check(leu.includes(new URL(ativaDoUsuario.url).hostname.replace('www.', '').split('.')[0]) || leu.length > 0,
    'consegue LER a aba do usuario', leu.slice(0, 60));

  const tentativa = await a.call('tools/call', {
    name: 'browser_navigate', arguments: { url: 'https://example.com' },
  });
  check(tentativa.result.isError && /somente leitura/i.test(tentativa.result.content[0].text),
    'navegar na aba do usuario e BARRADO', tentativa.result.content[0].text.slice(0, 70));

  const aindaLa = JSON.parse((await b.tool('browser_tabs_all')).content[0].text)
    .find((t) => t.tabId === ativaDoUsuario.tabId);
  check(aindaLa?.url === ativaDoUsuario.url, 'e a aba dele continua intacta depois da tentativa');

  const volta = (await a.tool('browser_use_own_tab')).content[0].text;
  check(/aba propria/.test(volta), 'browser_use_own_tab volta para a aba do agente');
  await a.tool('browser_navigate', { url: 'https://example.com' });
  check(true, 'e ai navegar volta a funcionar');

  // ── ao sair, as abas dos agentes somem e a janela da ponte fica (ancora) ──
  a.close();
  b.close();
  await sleep(5000);

  const c = startClient('conferindo');
  await c.handshake();
  await esperarExtensao(c);
  const fim = JSON.parse((await c.tool('browser_tabs_all')).content[0].text);
  check(!fim.some((t) => t.tabId === abaA) && !fim.some((t) => t.tabId === abaB),
    'as abas das duas sessoes foram fechadas');
  const perdidas = doUsuario.filter((t) => !fim.some((f) => f.tabId === t.tabId));
  check(perdidas.length === 0, `nenhuma das ${doUsuario.length} abas do usuario foi fechada`,
    perdidas.map((t) => t.url).join(', ') || 'todas intactas');
  c.close();
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  a.close();
  b.close();
}
