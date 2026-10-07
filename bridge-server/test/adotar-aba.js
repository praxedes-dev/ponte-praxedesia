/**
 * Testa adotar uma aba que ja estava aberta, sem fechar ela ao sair.
 *
 *   node test/adotar-aba.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

// Primeiro agente faz o papel do usuario: deixa uma aba aberta com conteudo.
const dono = startClient('dono-da-aba');
const agente = startClient('agente-que-adota');

try {
  await dono.handshake();
  if (!(await esperarExtensao(dono))) throw new Error('extensao nao conectou');
    // Aba propria: sem isto o teste navegaria na aba que o usuario esta usando,
  // porque a ponte trabalha na aba corrente por padrao.
await dono.tool('browser_tab_open', { url: 'https://example.com' });
  await dono.tool('browser_wait_network', {});
  const abaDoDono = (await dono.json('browser_tabs_list')).activeTabId;

  await agente.handshake();
  const todas = JSON.parse((await agente.tool('browser_tabs_all')).content[0].text);
  check(Array.isArray(todas) && todas.length > 0, `browser_tabs_all listou ${todas.length} abas`);
  check(todas.some((t) => t.tabId === abaDoDono), 'a aba do outro agente aparece na lista');

  const adocao = (await agente.tool('browser_use_tab', { tabId: abaDoDono })).content[0].text;
  check(adocao.includes('Example Domain'), 'adotou a aba existente', adocao.slice(0, 70));

  const pagina = (await agente.tool('browser_read_page')).content[0].text;
  check(pagina.includes('Example Domain'), 'le a pagina da aba adotada');

  // Ao sair, a aba adotada tem de continuar viva.
  agente.close();
  await sleep(4000);
  const aindaExiste = JSON.parse((await dono.tool('browser_tabs_all')).content[0].text)
    .some((t) => t.tabId === abaDoDono);
  check(aindaExiste, 'aba adotada sobreviveu a saida do agente');
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  dono.close();
  agente.close();
}
