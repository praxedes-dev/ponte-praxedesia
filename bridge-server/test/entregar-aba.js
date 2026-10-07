/**
 * `browser_entregar_aba`: o agente termina uma tarefa que fica esperando o
 * Dr. Cezar (assinar, conferir, decidir) e entrega a aba ANTES de ficar 5 min
 * parado — senao a faxina por ociosidade fecharia ela (incidente do PJe,
 * 11/09/2026). Prova as tres coisas do criterio de pronto:
 *   (a) a aba sai da janela da ponte;
 *   (b) `bridge_limpar`, `bridge_faxina_ociosos` (janela curta) e a
 *       desconexao do cliente NAO fecham ela depois;
 *   (c) o agente perde o controle da aba (some do workspace dele).
 *
 * Servidor HTTP local efemero: `data:` URL nao carrega neste Chrome (medido
 * nas obras anteriores), entao a "pagina de verdade" e servida daqui.
 *
 * Limpeza: no fim, um segundo cliente (`admin`) fecha a aba entregue por
 * `bridge_fechar_aba_admin` (uso de teste — ver ponte.js), para nao deixar
 * lixo na janela real do Dr. Cezar.
 *
 *   node test/entregar-aba.js
 */
import http from 'node:http';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><body>pagina de teste — entregar-aba</body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const admin = startClient('teste-entregar-aba-admin');
const c = startClient('teste-entregar-aba');
let tabIdEntregue;

try {
  await Promise.all([admin.handshake(), c.handshake()]);
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_tab_open', { url });
  const antes = await c.json('browser_tabs_list');
  const alvo = antes.abas.find((a) => a.url?.startsWith('http://127.0.0.1'));
  check(!!alvo, 'agente abriu a aba real', JSON.stringify(alvo));
  const tabId = alvo.tabId;
  const janelaDaPonte = antes.janelaDaPonte;

  const resp = (await c.tool('browser_entregar_aba', { tabId })).content[0].text;
  check(/entregue/.test(resp), 'browser_entregar_aba respondeu que entregou', resp);
  tabIdEntregue = tabId;

  // (a) a aba saiu da janela da ponte
  const todas = await c.json('browser_tabs_all');
  const entregue = todas.find((t) => t.tabId === tabId);
  check(!!entregue, 'a aba entregue ainda existe no Chrome', JSON.stringify(entregue));
  check(!!entregue && entregue.janela !== janelaDaPonte, 'a aba saiu da janela da ponte',
    `janela ${entregue?.janela} vs janela da ponte ${janelaDaPonte}`);

  // (c) o agente nao controla mais essa aba — sumiu do workspace dele
  const depois = await c.json('browser_tabs_list');
  check(!depois.abas.some((a) => a.tabId === tabId), 'a aba sumiu do workspace do agente',
    JSON.stringify(depois.abas.map((a) => a.tabId)));
  check(depois.abaPropria !== tabId, 'a aba propria do agente agora e outra (nova, em branco)',
    `abaPropria=${depois.abaPropria}`);

  // (b) nenhuma faxina, nem a desconexao, fecha a aba entregue
  await c.tool('bridge_limpar');
  let ainda = (await admin.json('browser_tabs_all')).some((t) => t.tabId === tabId);
  check(ainda, 'bridge_limpar nao fechou a aba entregue');

  await c.tool('bridge_faxina_ociosos', { janela_ms: 0 });
  ainda = (await admin.json('browser_tabs_all')).some((t) => t.tabId === tabId);
  check(ainda, 'bridge_faxina_ociosos (janela 0) nao fechou a aba entregue');

  c.close();
  await sleep(1500); // tempo do hub perceber a desconexao e rodar encerrarTodos
  ainda = (await admin.json('browser_tabs_all')).some((t) => t.tabId === tabId);
  check(ainda, 'a desconexao do cliente nao fechou a aba entregue');
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  try {
    if (tabIdEntregue) await admin.tool('bridge_fechar_aba_admin', { tabId: tabIdEntregue });
  } catch (err) {
    console.error('limpeza (fechar aba entregue) falhou:', err.message);
  }
  admin.close();
  try { c.close(); } catch { /* pode ja estar fechado */ }
  server.close();
}
