/**
 * Rede de seguranca da faxina por ociosidade (obra "entregar aba",
 * 11/09/2026, incidente do PJe): agente com uma aba REAL e uma aba EM
 * BRANCO, faxina com janela curtissima — a real tem de ser ENTREGUE (nao
 * fechada), a branca continua sendo fechada como sempre.
 *
 * So a faxina por OCIOSIDADE entrega. `bridge_close_workspace`/desconexao
 * continua fechando tudo — ver test/entregar-aba.js (b) e o comentario em
 * `encerrar()` (bridge/index.ts).
 *
 *   node test/faxina-entrega.js
 */
import http from 'node:http';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><body>pagina de teste — faxina-entrega</body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const admin = startClient('teste-faxina-entrega-admin');
const c = startClient('teste-faxina-entrega');
let tabIdReal;

try {
  await Promise.all([admin.handshake(), c.handshake()]);
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_tab_open', { url });
  await sleep(700); // deixa a navegacao terminar antes da faxina medir a url da aba
  await c.tool('browser_tab_open', {});

  const antes = await c.json('browser_tabs_list');
  // Nao fixa o numero: criarWorkspace ja abre uma aba propria em branco antes
  // deste teste pedir a real e a branca — o que importa e achar as duas.
  check(antes.abas.length >= 2, `agente com ${antes.abas.length} aba(s)`,
    JSON.stringify(antes.abas.map((a) => a.url)));
  const real = antes.abas.find((a) => a.url?.startsWith('http://127.0.0.1'));
  const branca = antes.abas.find((a) => a.url === 'about:blank');
  check(!!real && !!branca, 'achei a aba real e a aba em branco', JSON.stringify(antes.abas));
  tabIdReal = real?.tabId;
  const tabIdBranco = branca?.tabId;

  await admin.tool('bridge_faxina_ociosos', { janela_ms: 1 });
  await sleep(500);

  const todas = await admin.json('browser_tabs_all');
  check(todas.some((t) => t.tabId === tabIdReal), 'a aba REAL foi entregue — continua existindo, fora da ponte');
  check(!todas.some((t) => t.tabId === tabIdBranco), 'a aba EM BRANCO foi fechada, nao entregue');
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  try {
    if (tabIdReal) await admin.tool('bridge_fechar_aba_admin', { tabId: tabIdReal });
  } catch (err) {
    console.error('limpeza (fechar aba entregue) falhou:', err.message);
  }
  admin.close();
  try { c.close(); } catch { /* pode ja ter sido encerrado pela faxina */ }
  server.close();
}
