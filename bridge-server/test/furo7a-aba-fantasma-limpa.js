/**
 * FURO 7a (achado do cetico, 06/09/2026 -- ja investigado ao vivo em
 * `cetico-aba-fantasma.js`, que fica FORA de `npm test` por medir um furo
 * NAO consertado): `abasCriadasPelaPonte` (bridge/index.ts) so perdia um id
 * em `encerrar()` e `limparAbasOrfas()` -- os dois caminhos que a propria
 * ponte controla. Aba fechada por fora (usuario, outro agente, o proprio
 * `close_tab`) NUNCA saia do conjunto: nao havia listener de
 * `chrome.tabs.onRemoved` nenhum nesta classe. O Chrome REUSA id de aba
 * fechada -- enquanto o id fantasma ficasse la, o freio de `close_tab`
 * confundia uma aba NOVA e ALHEIA, que por acaso nascesse com o mesmo
 * numero, com "aba minha".
 *
 * Prova DETERMINISTICA (sem depender de o Chrome de fato reciclar o numero):
 * fechar a MESMA aba, pela ponte, duas vezes seguidas.
 *
 *   - 1o close_tab: sucesso de verdade, a aba morre.
 *   - 2o close_tab, MESMO id: se o conjunto ainda guarda o id (bug), o freio
 *     deixa passar e o MOTOR tenta `chrome.tabs.remove` de novo -- Chrome
 *     recusa com um erro NATIVO ("No tab with id..."). Se o conjunto foi
 *     limpo (conserto), o freio recusa PRIMEIRO, com a mensagem propria
 *     "[aba do usuario] ... nao foi aberta pela ponte" -- e o motor nem roda.
 *
 * E a mesma distincao de MOTIVO que `close-tab-alvo.js` (FURO do close_tab
 * por `target.agentId`) ja usa para nao aceitar "deu erro" como prova: tem
 * de ser o erro CERTO.
 *
 *   node test/furo7a-aba-fantasma-limpa.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-furo7a-fantasma');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  const rAbriu = await c.tool('browser_tab_open', { url: 'https://example.com/furo7a-cobaia' });
  const tab = JSON.parse(rAbriu.content[0].text).newTabId;
  check(Boolean(tab), 'abriu aba-cobaia propria pela ponte', `tab=${tab}`);

  // Uma SEGUNDA aba propria, que fica ATIVA a partir daqui -- assim, quando
  // `tab` morrer, a aba ATIVA do agente (checada por `resolveWorkspace()`
  // antes de qualquer coisa) continua viva, e o comando seguinte cai de
  // verdade no freio de `close_tab`, em vez de ser interceptado antes por
  // "[aba trocou]" (a auto-cura de `resolveWorkspace` para a PROPRIA aba
  // ativa do agente -- um mecanismo diferente, ja coberto por aba-sumiu.js).
  const rSegunda = await c.tool('browser_tab_open', { url: 'https://example.com/furo7a-ativa' });
  check(Boolean(JSON.parse(rSegunda.content[0].text).newTabId), 'abriu uma segunda aba propria (fica ativa)');
  await sleep(500);

  const r1 = await c.call('tools/call', { name: 'browser_tab_close', arguments: { tabId: tab } });
  console.log(`1o close_tab (tabId=${tab}) -> isError=${r1.result?.isError} | ${(r1.result?.content?.[0]?.text || '').slice(0, 80)}`);
  check(r1.result?.isError !== true, '1o close_tab fecha a aba de verdade');
  await sleep(500);

  const r2 = await c.call('tools/call', { name: 'browser_tab_close', arguments: { tabId: tab } });
  const erro2 = r2.result?.content?.[0]?.text || '';
  console.log(`2o close_tab, MESMO tabId=${tab} (ja morta) -> isError=${r2.result?.isError} | ${erro2.slice(0, 140)}`);
  check(r2.result?.isError === true, '2o close_tab (id ja morto) e recusado');
  check(/nao foi aberta pela ponte/i.test(erro2),
    'a recusa e do FREIO ("nao foi aberta pela ponte"), prova de que o id saiu de abasCriadasPelaPonte -- '
    + 'NAO um erro generico do Chrome ("No tab with id...", que e o que aparece com o bug: o freio deixa '
    + 'passar e o motor tenta remover de novo)',
    erro2.slice(0, 140));
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
