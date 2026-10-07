/**
 * Obra 19 (docs/obra-20260904/00-PLANO-DE-OBRA.md §15) — a ponte nao pode
 * adotar `chrome://`, `edge://`, `about:` (fora de about:blank) ou
 * `chrome-extension://`: o CDP responde `Cannot access a chrome:// URL` e a
 * ponte travava (`isolamento.js` falhava intermitente quando o Cezar estava
 * numa "Nova guia"). `abaCorrenteDoUsuario()` e `cap_use_tab` (bridge/index.ts)
 * agora recusam ANTES de tentar anexar, com mensagem que diz o que fazer.
 *
 * Este teste cobre `cap_use_tab` (browser_use_tab) de ponta a ponta, usando
 * SO uma aba que a propria ponte abriu (`browser_tab_open`) — nunca uma
 * janela real do usuario. Decisao deliberada, registrada no relatorio: nao
 * existe jeito seguro de testar `abaCorrenteDoUsuario` (browser_use_current_tab)
 * ao vivo neste Chrome compartilhado sem risco de ADOTAR a aba real do Dr.
 * Cezar (a criacao de uma janela nova de fora nao garante foco do SO, e o
 * fallback de abaCorrenteDoUsuario cai para "primeira janela normal" quando
 * nenhuma esta focada — a regra do briefing e clara: "nao a adote"). As duas
 * funcoes chamam a MESMA `ehPaginaInterna()` no mesmo arquivo, no mesmo lugar
 * relativo (antes de qualquer attach/adocao) — provar o guard aqui prova a
 * funcao; a colocacao em abaCorrenteDoUsuario foi conferida por leitura direta
 * do codigo (bridge/index.ts, bloco logo apos resolver `ativa`).
 *
 *   node test/pagina-interna.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const a = startClient('agente-A-pagina-interna');
const b = startClient('agente-B-pagina-interna');

let tabInterna;
try {
  await a.handshake();
  if (!(await esperarExtensao(a))) throw new Error('extensao nao conectou');
  await b.handshake();

  // A abre, na SUA PROPRIA aba (janela da ponte), uma pagina interna do
  // Chrome. E uma aba da ponte (abasCriadasPelaPonte) — nunca do usuario —
  // por isso pode ser fechada no fim pelo proprio A.
  const abriu = await a.json('browser_tab_open', { url: 'chrome://version' });
  tabInterna = abriu.newTabId;
  check(typeof tabInterna === 'number', 'abriu a aba interna (chrome://version)', `tabId=${tabInterna}`);
  await sleep(600);

  // B tenta adotar essa mesma aba por tabId — o caminho de cap_use_tab.
  const tentativa = await b.call('tools/call', {
    name: 'browser_use_tab', arguments: { tabId: tabInterna },
  });
  const texto = tentativa.result.content[0].text;
  check(tentativa.result.isError === true, 'browser_use_tab numa pagina chrome:// e recusado', texto.slice(0, 140));
  check(/\[pagina interna\]/.test(texto), 'a recusa usa o marcador [pagina interna]', texto.slice(0, 140));
  check(texto.includes('chrome://version'), 'a recusa cita a URL da aba', texto.slice(0, 160));
  check(!/Cannot access/i.test(texto), 'a recusa NAO deixa vazar o erro cru do CDP', texto.slice(0, 160));

  // B continua exatamente como estava: nao entrou em somente-leitura, nao
  // trocou de aba. Sem isto, uma recusa mal encanada poderia deixar o agente
  // "meio adotado" (workspace apontando para a aba errada apesar do erro).
  const infoB = await b.json('browser_tabs_list');
  check(infoB.modo !== 'somente leitura (aba do usuario)', 'B nao ficou em modo somente leitura', infoB.modo);
  check(infoB.activeTabId !== tabInterna, 'B nao ficou apontando para a aba interna', `activeTabId=${infoB.activeTabId}`);

  // Controle: uma aba NORMAL continua sendo adotada sem problema — a recusa e
  // so para pagina interna, nao para tudo. Sem este controle, um bug que
  // barrasse QUALQUER tabId passaria despercebido.
  const abriuNormal = await a.json('browser_tab_open', { url: 'https://example.com' });
  await sleep(600);
  const adotouNormal = await b.tool('browser_use_tab', { tabId: abriuNormal.newTabId });
  check(!adotouNormal.isError, 'controle: uma aba NORMAL continua sendo adotada sem recusa',
    adotouNormal.content[0].text.slice(0, 100));
  await b.tool('browser_use_own_tab'); // solta a adocao antes de sair
  await a.tool('browser_tab_close', { tabId: abriuNormal.newTabId });
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  // Limpeza: a aba interna e da ponte (abasCriadasPelaPonte) — A pode fecha-la.
  if (typeof tabInterna === 'number') {
    await a.tool('browser_tab_close', { tabId: tabInterna }).catch(() => {});
  }
  a.close();
  b.close();
}
