/**
 * Teste da obra "verdade pos-acao" (15/09/2026) — item 1 do briefing:
 * conferencia de execucao de `browser_javascript` depois de um ESTOURO de
 * `timeout_ms` (capacidades/js.ts: `marcarExecucao`/`conferirExecucaoJs`,
 * tool nova `browser_javascript_conferir`).
 *
 * Contexto (ja documentado em test/timeouts.js): o parametro nativo do CDP
 * para timeout NAO aborta a avaliacao nesta versao do Chrome -- quando
 * `browser_javascript` estoura, e so a EXTENSAO que desiste de esperar; o
 * script continua rodando na pagina ate terminar sozinho. Antes desta obra o
 * agente ficava cego depois de um estouro: nao dava para saber se o script
 * tinha sequer comecado, nem o que aconteceu com ele depois.
 *
 * Casos:
 *   1. script de ~3s com timeout_ms:500 -- estoura rapido (isError, < 2s), e
 *      a mensagem de erro traz um id_exec e diz que o script CHEGOU A INICIAR.
 *   2. conferir esse id_exec LOGO APOS o estouro (script ainda rodando os ~2,5s
 *      restantes) -- status "ainda_rodando".
 *   3. esperar o script terminar de verdade e conferir de novo -- status
 *      "terminou_ok".
 *   4. o MESMO desenho, mas o script termina em ERRO (throw) -- depois de
 *      terminar, status "terminou_com_erro" com o detalhe do erro.
 *   5. conferir um id_exec que nunca existiu -- status "nunca_comecou", sem
 *      lancar excecao.
 *
 *   node test/js-conferir.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-js-conferir');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  // ── 1. estouro: script de 3s com timeout_ms:500 ──────────────────────────
  const inicio1 = Date.now();
  const resp1 = await c.call('tools/call', {
    name: 'browser_javascript',
    arguments: { codigo: 'new Promise(r => setTimeout(() => r(1), 3000))', timeout_ms: 500 },
  });
  const levou1 = Date.now() - inicio1;
  const texto1 = resp1.result?.content?.[0]?.text ?? '';
  check(resp1.result?.isError === true, '1. timeout_ms:500 numa promise de 3000ms volta isError', texto1.slice(0, 160));
  check(levou1 < 2000, `1b. o erro chega rapido (perto do teto pedido), levou ${levou1}ms`);
  check(/CHEGOU A INICIAR/.test(texto1), '1c. a mensagem diz que o script CHEGOU A INICIAR', texto1.slice(0, 200));
  const idExec1 = texto1.match(/id_exec="([^"]+)"/)?.[1];
  check(typeof idExec1 === 'string' && idExec1.length > 0, '1d. a mensagem traz um id_exec extraivel', idExec1);

  // ── 2. conferir LOGO APOS o estouro -- o script real ainda tem ~2,5s ────
  const conf2 = await c.json('browser_javascript_conferir', { id_exec: idExec1 });
  check(conf2.status === 'ainda_rodando', '2. logo apos o estouro, conferir devolve "ainda_rodando"', JSON.stringify(conf2));

  // ── 3. espera o script de verdade terminar, confere de novo ─────────────
  await sleep(3000 - levou1 + 500); // folga sobre o que falta dos 3000ms originais
  const conf3 = await c.json('browser_javascript_conferir', { id_exec: idExec1 });
  check(conf3.status === 'terminou_ok', '3. depois do script realmente terminar, conferir devolve "terminou_ok"', JSON.stringify(conf3));

  // ── 4. mesmo desenho, script termina em ERRO ─────────────────────────────
  const resp4 = await c.call('tools/call', {
    name: 'browser_javascript',
    arguments: {
      codigo: 'new Promise((_, rej) => setTimeout(() => rej(new Error("falha-proposital-js-conferir")), 3000))',
      timeout_ms: 500,
    },
  });
  const texto4 = resp4.result?.content?.[0]?.text ?? '';
  const idExec4 = texto4.match(/id_exec="([^"]+)"/)?.[1];
  check(typeof idExec4 === 'string' && idExec4.length > 0, '4. estouro do script que vai falhar tambem traz id_exec', idExec4);

  await sleep(3300);
  const conf4 = await c.json('browser_javascript_conferir', { id_exec: idExec4 });
  check(conf4.status === 'terminou_com_erro', '4b. depois de terminar com erro, conferir devolve "terminou_com_erro"', JSON.stringify(conf4));
  check(
    /falha-proposital-js-conferir/.test(conf4.detalhe ?? ''),
    '4c. o detalhe do erro menciona a mensagem original do script',
    conf4.detalhe,
  );

  // ── 5. id_exec que nunca existiu -- "nunca_comecou", sem excecao ────────
  let erro5 = null;
  let conf5;
  try {
    conf5 = await c.json('browser_javascript_conferir', { id_exec: 'js_nunca_existiu_000' });
  } catch (err) {
    erro5 = err;
  }
  check(erro5 === null, '5. conferir id_exec inexistente NAO lanca excecao', erro5?.message);
  check(conf5?.status === 'nunca_comecou', '5b. id_exec inexistente devolve status "nunca_comecou"', JSON.stringify(conf5));
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
if (falhou) process.exitCode = 1;
