/**
 * O teste que decide se precisa do fallback de foco.
 *
 * Se a janela do usuario estiver MAXIMIZADA por cima da janela da ponte, o
 * Windows pode marcar a de baixo como ocluida e o Chrome suspende a pintura.
 * Aba nao pintada ignora clique. Este teste clica com a janela coberta e diz o
 * que aconteceu.
 *
 * Como rodar: deixe a janela da ponte ABERTA e cubra-a inteira com a sua janela
 * maximizada (a do Chrome ou de qualquer outro programa). Entao:
 *
 *   node test/janela-coberta.js
 *
 * Se falhar, ligue o fallback e rode de novo:
 *   (no console do service worker) chrome.storage.local.set({ focarParaClicar: true })
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-janela-coberta');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_for_text', { text: 'Example Domain', timeout_ms: 20_000 });

  const info = await c.json('browser_tabs_list');
  console.log(`\nA aba do agente e ${info.activeTabId}, na janela da ponte ${info.janelaDaPonte}.`);
  console.log('Cubra a janela da ponte com a sua janela maximizada. Clicando em 8 segundos...\n');
  await sleep(8000);

  const achados = (await c.tool('browser_find', { query: 'learn more' })).content[0].text;
  const ref = Number(achados.match(/\[(\d+)\] link/)?.[1]);
  check(Boolean(ref), `achou o link (ref ${ref})`);

  await c.tool('browser_click', { ref });
  await sleep(4000);
  const url = (await c.tool('browser_read_page')).content[0].text.split('\n')[0];
  const clicou = url.includes('iana.org');
  check(clicou, 'clicou com a janela da ponte COBERTA', url);

  if (!clicou) {
    console.log('\n=> Janela coberta nao pinta. Duas saidas, a testar nesta ordem:');
    console.log('   1. Janela da ponte pequena num canto, com viewport emulado (nao fica coberta).');
    console.log('   2. Fallback focarParaClicar: foco so durante o clique, devolvido em seguida.');
  } else {
    console.log('\n=> Janela coberta continua pintando. Nenhum fallback necessario.');
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
