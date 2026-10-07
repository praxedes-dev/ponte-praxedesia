/**
 * Aba explicita por comando (26/09/2026). Subagentes da tool Agent herdam a
 * conexao da sessao-mae (mesmo clientId) e caiam todos na MESMA aba. Com o
 * parametro `aba`, cada um age na aba que abriu, so naquele comando.
 *
 * Casos:
 *   1. dois "subagentes" (mesmo cliente) abrem uma aba cada e navegam EM
 *      PARALELO, cada um com a sua `aba`: cada aba fica com a SUA url.
 *   2. javascript com `aba` le a aba certa (nao a ativa da sessao).
 *   3. a aba da sessao (sem `aba`) nao mudou por causa dos comandos com `aba`.
 *   4. `aba` que nao e desta sessao (inventada) e recusada, sem agir em nada.
 *
 *   node test/aba-explicita.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-aba-explicita');
const texto = (r) => r.result?.content?.[0]?.text ?? '';
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  const a = (await c.json('browser_tab_open', { url: 'https://example.com/?sessao' })).newTabId;
  await sleep(1500);
  const x = (await c.json('browser_tab_open', { url: 'about:blank' })).newTabId;
  const y = (await c.json('browser_tab_open', { url: 'about:blank' })).newTabId;
  // Depois de abrir y, a aba "da sessao" e y. Volta para a primeira.
  await c.tool('browser_tab_switch', { tabId: a });

  await Promise.all([
    c.call('tools/call', { name: 'browser_navigate', arguments: { url: 'https://example.com/?x', aba: x } }),
    c.call('tools/call', { name: 'browser_navigate', arguments: { url: 'https://example.org/?y', aba: y } }),
  ]);
  await sleep(1500);

  const href = async (aba) => texto(await c.call('tools/call', {
    name: 'browser_javascript', arguments: { codigo: 'location.href', ...(aba !== undefined ? { aba } : {}) },
  })).trim();

  const hx = await href(x);
  const hy = await href(y);
  check(hx.includes('example.com/?x'), '1/2. aba X ficou com a url dela', hx);
  check(hy.includes('example.org/?y'), '1/2. aba Y ficou com a url dela', hy);

  const hs = await href();
  check(hs.includes('example.com/?sessao'), '3. a aba da sessao nao mudou', hs);

  const r4 = await c.call('tools/call', { name: 'browser_navigate', arguments: { url: 'https://example.net/', aba: 999999999 } });
  check(r4.result?.isError === true && /\[aba\]/.test(texto(r4)), '4. aba inventada e recusada', texto(r4).slice(0, 140));
  check((await href()).includes('example.com/?sessao'), '4. e nada mudou na aba da sessao');

  for (const t of [x, y, a]) await c.call('tools/call', { name: 'browser_tab_close', arguments: { tabId: t } });
} catch (err) {
  check(false, 'o teste rodou ate o fim', err.message);
} finally {
  c.close();
  if (!falhou) console.log('\ntodos os casos passaram');
}
