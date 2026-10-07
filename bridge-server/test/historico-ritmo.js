/**
 * Obra 12 — voltar/avancar no historico (`browser_back`/`browser_forward`) e
 * ritmo de navegacao por host de tribunal/JusBrasil.
 * (docs/obra-20260904/12-navegacao-voltar-e-ritmo-por-host.md)
 *
 * Nota sobre o caso 3 do criterio de pronto do briefing: ele pede
 * `browser_use_current_tab`. Trocado por `browser_use_tab` numa cobaia
 * ABERTA PELO PROPRIO TESTE — regra de ferro #6 desta obra proibe
 * `browser_use_current_tab` (a aba que o Dr. Cezar tem aberta agora e de
 * trabalho real, "Jus IA", e a bancada depende dela). As duas tools chamam o
 * MESMO `adotarAbaDoUsuario()` (bridge/index.ts:689) e alimentam o MESMO Set
 * `somenteLeitura` (bridge/index.ts:396) — a cobaia prova a barreira sem
 * tocar na aba de verdade. Mesma tecnica de `test/download-somente-leitura.js`.
 *
 *   node test/historico-ritmo.js
 */
import { startClient, esperarExtensao } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c1 = startClient('teste-historico-voltar');
const c2 = startClient('teste-historico-sem-historico');
const c3 = startClient('teste-historico-somente-leitura');
const c4 = startClient('teste-ritmo');

try {
  await c1.handshake();
  if (!(await esperarExtensao(c1))) throw new Error('extensao nao conectou');
  await c2.handshake();
  await c3.handshake();
  await c4.handshake();

  // ── 1. voltar/avancar navega pelo historico da PROPRIA aba ────────────────
  await c1.tool('browser_navigate', { url: 'https://example.com' });
  await c1.tool('browser_navigate', { url: 'https://www.iana.org/help/example-domains' });

  const voltou = await c1.json('browser_back');
  check(typeof voltou.url === 'string' && voltou.url.includes('example.com'),
    '1a. browser_back devolve a URL da pagina anterior', String(voltou.url));

  const primeiraLinhaVolta = (await c1.tool('browser_read_page')).content[0].text.split('\n')[0];
  check(primeiraLinhaVolta.includes('example.com') && !primeiraLinhaVolta.includes('iana'),
    '1b. depois do browser_back, read_page mostra example.com', primeiraLinhaVolta.slice(0, 80));

  const avancou = await c1.json('browser_forward');
  check(typeof avancou.url === 'string' && avancou.url.includes('iana.org'),
    '1c. browser_forward devolve a URL seguinte', String(avancou.url));

  const primeiraLinhaAvanco = (await c1.tool('browser_read_page')).content[0].text.split('\n')[0];
  check(primeiraLinhaAvanco.includes('iana.org'),
    '1d. depois do browser_forward, read_page mostra iana.org', primeiraLinhaAvanco.slice(0, 80));

  // ── 2. aba nova (about:blank) nao tem historico ────────────────────────────
  if (!(await esperarExtensao(c2))) throw new Error('extensao (c2) nao conectou');
  await c2.tool('browser_tab_open', {});
  const semHistorico = await c2.call('tools/call', { name: 'browser_back', arguments: {} });
  const msgSemHistorico = semHistorico.result?.content?.[0]?.text ?? '';
  check(semHistorico.result?.isError === true && /historico/i.test(msgSemHistorico),
    '2. browser_back numa aba sem historico erra citando "historico"', msgSemHistorico.slice(0, 140));

  // ── 3. modo somente leitura barra cap_back ANTES do chrome.tabs.goBack ────
  if (!(await esperarExtensao(c3))) throw new Error('extensao (c3) nao conectou');
  const cobaia = (await c3.json('browser_tabs_list')).activeTabId;
  const adocao = (await c3.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
  check(/somente leitura/i.test(adocao), '3a. browser_use_tab entra em modo somente leitura', adocao.slice(0, 90));

  const backBarrado = await c3.call('tools/call', { name: 'browser_back', arguments: {} });
  const msgBarrado = backBarrado.result?.content?.[0]?.text ?? '';
  check(backBarrado.result?.isError === true && /\[somente leitura\]/.test(msgBarrado),
    '3b. browser_back e barrado com "[somente leitura]" na aba do usuario', msgBarrado.slice(0, 140));

  const volta = (await c3.tool('browser_use_own_tab')).content[0].text;
  check(/aba propria/.test(volta), '3c. browser_use_own_tab devolve o agente para a aba dele', volta.slice(0, 80));

  // ── 4. ritmo: mesmo host de tribunal duas vezes seguidas espera >= 4s ─────
  if (!(await esperarExtensao(c4))) throw new Error('extensao (c4) nao conectou');
  const t0 = Date.now();
  await c4.tool('browser_navigate', { url: 'https://www.tjro.jus.br/' });
  await c4.tool('browser_navigate', { url: 'https://www.tjro.jus.br/' });
  const decorridoTribunal = Date.now() - t0;
  check(decorridoTribunal >= 4000, '4a. duas navegacoes seguidas ao mesmo host de tribunal levam >= 4000ms',
    `${decorridoTribunal}ms`);

  // Registrado, sem assercao (instrucao do briefing: nao asserte, e instavel
  // por depender da rede real de example.com).
  const t1 = Date.now();
  await c4.tool('browser_navigate', { url: 'https://example.com' });
  await c4.tool('browser_navigate', { url: 'https://example.com' });
  const decorridoComum = Date.now() - t1;
  console.log(`      (referencia, sem assercao) duas navegacoes seguidas a example.com: ${decorridoComum}ms`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c1.close();
  c2.close();
  c3.close();
  c4.close();
}
