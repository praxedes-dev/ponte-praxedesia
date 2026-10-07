/**
 * Teste da obra 16 — docs/obra-20260904/16-timeout-configuravel.md
 *
 * Cobre o criterio de pronto do briefing:
 *
 *   1-2. `browser_javascript` com `timeout_ms` curto estoura numa promise
 *        longa (isError, mensagem casa /estourou|timed out|tempo/i, < 4 s);
 *        com `timeout_ms` folgado, a mesma promise resolve normalmente.
 *   3.   `tools/list`: `timeout_ms` presente em `browser_navigate`,
 *        `browser_click`, `browser_type`, `browser_press_key`,
 *        `browser_javascript`.
 *   4.   Descricoes de `browser_tab_open`, `browser_tab_switch`,
 *        `browser_tabs_list` nao contem mais "grupo".
 *   5.   `browser_navigate` com `timeout_ms: 30000` funciona.
 *   6.   `browser_click` com `esperar_ms` alto e `timeout_ms` justo NAO
 *        estoura no transporte -- prova que o teto soma `esperar_ms` por
 *        cima do teto do clique em si (achado do cetico: um mutante que
 *        troca `return base + esperarMs` por `return base` em
 *        `tools/interacao.js` nao derrubava teste nenhum, so o schema era
 *        conferido).
 *
 * Os testes 1-2 sao tambem a MEDICAO pedida pelo briefing (secao "Armadilhas
 * conhecidas"): `Runtime.evaluate.timeout` e experimental no protocolo CDP,
 * e MEDIDO (tres vezes, ao vivo, 05-06/09/2026) ele NAO ABORTA nesta versao
 * do Chrome -- uma promise de 3000ms com `timeout_ms:1000` corre os 3000ms
 * inteiros e volta SUCESSO com o valor, sem excecao. Por isso o teto real
 * (ver `entrypoints/background/bridge/capacidades/js.ts`,
 * `comTemporizadorDeAbandono`) e um `setTimeout` do lado da EXTENSAO, que
 * rejeita a promise do agente perto do teto pedido -- o script em si
 * continua rodando na pagina ate terminar sozinho (nao ha como matar via
 * CDP), so o agente para de esperar por ele. Os testes 1a-1c abaixo
 * verificam exatamente isso: erro NA HORA (< 4s), nao so depois do script
 * inteiro (era o defeito que reprovou a primeira versao desta obra).
 *
 *   node test/timeouts.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-timeouts');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste trabalharia na aba que o Dr. Cezar esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  // ── 1. timeout_ms curto numa promise longa: tem que estourar rapido ──────
  const inicio1 = Date.now();
  const resp1 = await c.call('tools/call', {
    name: 'browser_javascript',
    arguments: { codigo: 'new Promise(r => setTimeout(() => r(1), 3000))', timeout_ms: 1000 },
  });
  const levou1 = Date.now() - inicio1;
  const texto1 = resp1.result?.content?.[0]?.text ?? '';
  console.log(`      [medicao] timeout_ms:1000 numa promise de 3000ms -> isError=${resp1.result?.isError} `
    + `em ${levou1}ms, texto: ${texto1.slice(0, 140)}`);
  check(resp1.result?.isError === true, '1a. timeout_ms:1000 numa promise de 3000ms volta isError', texto1.slice(0, 140));
  check(/estourou|timed out|tempo/i.test(texto1), '1b. a mensagem casa /estourou|timed out|tempo/i', texto1.slice(0, 140));
  check(levou1 < 4000, `1c. levou menos de 4s (levou ${levou1}ms)`);

  // ── 2. timeout_ms folgado: a mesma promise resolve normalmente ───────────
  const inicio2 = Date.now();
  const valor2 = (await c.tool('browser_javascript', {
    codigo: 'new Promise(r => setTimeout(() => r(1), 3000))', timeout_ms: 6000,
  })).content[0].text;
  const levou2 = Date.now() - inicio2;
  check(valor2.trim() === '1', '2. timeout_ms:6000 na mesma promise resolve com o valor (1)', `${valor2.trim()} em ${levou2}ms`);

  // ── 3. timeout_ms aparece no schema das 5 tools ──────────────────────────
  const list = await c.call('tools/list', {});
  const porNome = new Map(list.result.tools.map((t) => [t.name, t]));
  for (const nome of ['browser_navigate', 'browser_click', 'browser_type', 'browser_press_key', 'browser_javascript']) {
    const tool = porNome.get(nome);
    const tem = Boolean(tool?.inputSchema?.properties?.timeout_ms);
    check(tem, `3. ${nome} expoe timeout_ms no schema`);
  }

  // ── 4. descricoes sem "grupo" ─────────────────────────────────────────────
  for (const nome of ['browser_tab_open', 'browser_tab_switch', 'browser_tabs_list']) {
    const tool = porNome.get(nome);
    const semGrupo = !/grupo/i.test(tool?.description ?? '');
    check(semGrupo, `4. ${nome} nao cita mais "grupo"`, tool?.description ?? '(tool nao encontrada)');
  }

  // ── 5. browser_navigate com timeout_ms funciona ──────────────────────────
  const navResp = await c.tool('browser_navigate', { url: 'https://example.com/timeouts-obra16', timeout_ms: 30_000 });
  check(!navResp.isError, '5. browser_navigate com timeout_ms:30000 funciona', navResp.content?.[0]?.text?.slice(0, 120));
  await sleep(300);
  const titulo = (await c.tool('browser_javascript', { codigo: 'document.title' })).content[0].text;
  check(titulo.includes('Example Domain'), '5b. a pagina realmente navegou', titulo.trim());

  // ── 6. browser_click: o teto do transporte SOMA esperar_ms ──────────────
  // Monta um botao cujo clique dispara uma conexao que fica pendurada (IP
  // nao roteavel: nunca conecta nem falha rapido) -- isso mantem "emVoo > 0"
  // pelo tempo que quisermos, de forma deterministica, sem depender da
  // latencia real de nenhum servidor de terceiro. Com esperar_ms grande e
  // nenhum outro sinal de rede acalmando, o gancho "assentar"
  // (capacidades/assentar.ts) ESGOTA o teto inteiro -- exatamente o cenario
  // que precisa do teto do transporte somado por cima do teto do clique.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML = '<button id="btnPendurado" aria-label="Botao com rede pendurada">Rede pendurada</button>';
      document.getElementById('btnPendurado').onclick = function() {
        // 10.255.255.1 nao roteia: a conexao fica pendurada por bem mais que
        // o esperar_ms deste teste -- garante emVoo > 0 pelo teto inteiro.
        fetch('https://10.255.255.1/', { mode: 'no-cors' }).catch(function () {});
      };
      return 'montado';
    })()`,
  });
  await sleep(200);
  const docPendurado = (await c.tool('browser_read_page')).content[0].text;
  const linhaPendurado = docPendurado.split('\n').find((l) => l.toLowerCase().includes('botao com rede pendurada'));
  const refPendurado = linhaPendurado ? Number(linhaPendurado.match(/\[(\d+)\]/)?.[1]) : undefined;
  check(Number.isFinite(refPendurado), '6. achou o ref do botao de rede pendurada', `ref=${refPendurado}`);

  const ESPERAR_MS_6 = 5000;
  const TIMEOUT_MS_6 = 1000; // teto do clique em si, SEM contar esperar_ms
  const inicio6 = Date.now();
  let r6;
  let erro6 = null;
  try {
    r6 = JSON.parse((await c.tool('browser_click', {
      ref: refPendurado, esperar_ms: ESPERAR_MS_6, timeout_ms: TIMEOUT_MS_6,
    })).content[0].text);
  } catch (err) {
    erro6 = err;
  }
  const levou6 = Date.now() - inicio6;
  console.log(`      [medicao] click com esperar_ms:${ESPERAR_MS_6} e timeout_ms:${TIMEOUT_MS_6} `
    + `levou ${levou6}ms -> ${erro6 ? `ERRO: ${erro6.message}` : JSON.stringify(r6)}`);
  check(
    erro6 === null,
    '6a. clique com esperar_ms grande e timeout_ms justo NAO estoura no transporte (o teto soma esperar_ms)',
    erro6 ? erro6.message.slice(0, 160) : '',
  );
  check(
    r6?.esgotou === true,
    '6b. a espera de rede realmente esgotou o esperar_ms pedido (a rede pendurada nunca acalmou)',
    JSON.stringify(r6),
  );
  check(
    typeof r6?.assentou_ms === 'number' && r6.assentou_ms >= ESPERAR_MS_6 - 100,
    '6c. assentou_ms bate com o esperar_ms pedido (o transporte esperou o ciclo inteiro, nao cortou antes)',
    `assentou_ms=${r6?.assentou_ms}`,
  );
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  try {
    const cobaia = (await c.json('browser_tabs_list')).activeTabId;
    if (cobaia) await c.tool('browser_tab_close', { tabId: cobaia }).catch(() => {});
  } catch { /* melhor esforco */ }
  c.close();
}
