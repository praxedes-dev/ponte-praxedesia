/**
 * Teste da obra "verdade pos-acao" (15/09/2026) — item 3 do briefing:
 * `browser_wait_for_text` com `incluir_oculto` (execution-engine/index.ts,
 * `sondaDeTexto`/`lerTextoDaPagina`).
 *
 * Casos:
 *   1. texto em `display:none` -- SEM `incluir_oculto` (padrao, innerText)
 *      a espera ESGOTA o timeout (timedOut:true): o texto existe no DOM mas
 *      nao esta renderizado, e `innerText` e cego a isso.
 *   2. o MESMO texto, MESMA pagina, com `incluir_oculto: true` -- acha na
 *      hora (found:true), porque `textContent` enxerga o DOM inteiro.
 *   3. controle: texto realmente VISIVEL continua sendo achado com
 *      `incluir_oculto` no valor padrao (false) -- prova que o param novo
 *      nao troca o comportamento de quem nao pede.
 *
 *   node test/wait-for-text-oculto.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-wait-for-text-oculto');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<div style="display:none">texto-escondido-oculto-123</div>' +
        '<div>texto-visivel-normal-456</div>';
      return 'montado';
    })()`,
  });
  await sleep(150);

  // ── 1. SEM incluir_oculto -- innerText nao enxerga display:none, esgota ──
  const r1 = await c.json('browser_wait_for_text', {
    text: 'texto-escondido-oculto-123', timeout_ms: 2000, interval_ms: 300,
  });
  check(r1.timedOut === true, '1. sem incluir_oculto, texto em display:none NAO e achado (esgota o teto)', JSON.stringify(r1));

  // ── 2. COM incluir_oculto:true -- textContent enxerga, acha na hora ─────
  const inicio2 = Date.now();
  const r2 = await c.json('browser_wait_for_text', {
    text: 'texto-escondido-oculto-123', incluir_oculto: true, timeout_ms: 5000, interval_ms: 300,
  });
  const levou2 = Date.now() - inicio2;
  check(r2.found === true, '2. com incluir_oculto:true, o mesmo texto (display:none) e achado', JSON.stringify(r2));
  check(levou2 < 4000, '2b. achou rapido, nao gastou o teto de 5000ms', `levou=${levou2}ms`);

  // ── 3. controle: texto VISIVEL continua sendo achado sem incluir_oculto ──
  const r3 = await c.json('browser_wait_for_text', {
    text: 'texto-visivel-normal-456', timeout_ms: 2000, interval_ms: 300,
  });
  check(r3.found === true, '3. controle: texto visivel continua sendo achado com incluir_oculto padrao (false)', JSON.stringify(r3));
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
if (falhou) process.exitCode = 1;
