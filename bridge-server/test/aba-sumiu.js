/**
 * HANDOFF-ABA-SUMIU-E-EXTRACT-CAUDA-20260903, item 1.
 *
 * Em 03/09/2026 a aba propria de um agente sumiu e a ponte, calada, passou a
 * responder com a aba do Cezar — um cadastro do PJe em andamento. Um navigate
 * teria destruido o cadastro. Este teste garante tres coisas:
 *
 *   (a) aba do agente fechada por fora → o comando seguinte FALHA ALTO dizendo
 *       qual aba morreu e qual foi aberta, em vez de trocar em silencio;
 *   (b) a aba nova e da janela da ponte, nunca a do usuario;
 *   (c) bridge_limpar de um agente nao fecha a aba de outro agente vivo.
 *
 *   node test/aba-sumiu.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const a = startClient('agente-A');
const b = startClient('agente-B');

try {
  await a.handshake();
  if (!(await esperarExtensao(a))) throw new Error('extensao nao conectou');
  await b.handshake();

  await a.tool('browser_navigate', { url: 'https://example.com' });
  await a.tool('browser_wait_for_text', { text: 'Example Domain', timeout_ms: 20_000 });
  const infoA = await a.json('browser_tabs_list');
  const abaA = infoA.activeTabId;
  const janelaDaPonte = infoA.janelaDaPonte;

  const antes = JSON.parse((await a.tool('browser_tabs_all')).content[0].text);
  const doUsuario = antes.filter((t) => t.janela !== janelaDaPonte);
  const ativaDoUsuario = doUsuario.find((t) => t.ativa);

  // B fecha a aba de A "por fora" — e o que outro agente, o usuario ou um reload fariam.
  await b.tool('browser_tab_close', { tabId: abaA });
  await sleep(800);

  // (a) o comando seguinte de A tem de falhar ALTO
  const r = await a.call('tools/call', { name: 'browser_read_page', arguments: {} });
  const texto = r.result.content[0].text;
  check(r.result.isError === true, 'primeiro comando apos a aba sumir FALHA', texto.slice(0, 60));
  check(/aba trocou/.test(texto) && texto.includes(String(abaA)),
    'o erro diz qual aba morreu e que abriu outra', texto.slice(0, 110));

  // (b) o comando seguinte funciona, numa aba nova, na janela da ponte
  const depois = await a.json('browser_tabs_list');
  check(depois.activeTabId !== abaA, 'A esta numa aba nova', `${abaA} -> ${depois.activeTabId}`);
  const todas = JSON.parse((await a.tool('browser_tabs_all')).content[0].text);
  const novaDeA = todas.find((t) => t.tabId === depois.activeTabId);
  check(novaDeA?.janela === janelaDaPonte, 'a aba nova e da janela da ponte, nao do usuario');
  const ativaAgora = todas.find((t) => t.tabId === ativaDoUsuario?.tabId);
  check(ativaAgora?.url === ativaDoUsuario?.url && ativaAgora?.ativa === true,
    'a aba do usuario nao foi tocada', ativaAgora?.url?.slice(0, 50));

  // (c) bridge_limpar de B nao pode fechar a aba nova de A
  await a.tool('browser_navigate', { url: 'https://example.com' });
  const limpeza = (await b.tool('bridge_limpar')).content[0].text;
  await sleep(500);
  const aindaViva = JSON.parse((await b.tool('browser_tabs_all')).content[0].text)
    .some((t) => t.tabId === depois.activeTabId);
  check(aindaViva, 'bridge_limpar de B NAO fechou a aba de A', limpeza);
  const aLeu = (await a.tool('browser_read_page')).content[0].text.split('\n')[0];
  check(aLeu.includes('example.com'), 'A continua trabalhando normalmente', aLeu);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  a.close();
  b.close();
}
