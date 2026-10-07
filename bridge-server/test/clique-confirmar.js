/**
 * Teste da obra "verdade pos-acao" (15/09/2026) — item 4 do briefing:
 * `browser_click` com `esperar_texto`/`esperar_url`/`confirmar_ms`
 * (capacidades/confirmar.ts).
 *
 * O problema que isto prova: numa SPA que troca de tela so por HASH
 * (`#/rota`), sem nenhuma requisicao de rede, `requisicoes: 0` (assentar.ts)
 * e uma resposta LEGITIMA — e antes desta obra o agente nao tinha como
 * distinguir "cliquei e a tela mudou sem rede" de "cliquei e nada aconteceu".
 *
 * Casos:
 *   1. clique que muda `location.hash` (SEM nenhuma rede) com
 *      `esperar_url: "#/destino"` -- `resultado.confirmado === true`,
 *      `url_final` contem o hash.
 *   2. clique com `esperar_texto` de um texto que NUNCA aparece --
 *      `resultado.confirmado === false`, a tool NAO lanca excecao (o clique
 *      aconteceu, so a tela nao chegou onde se esperava) e o motivo NAO fala
 *      como se o clique tivesse falhado.
 *   3. clique SEM nenhum dos dois params novos -- resposta continua sem
 *      "resultado" (aditivo: comportamento identico ao de antes desta obra).
 *
 *   node test/clique-confirmar.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-clique-confirmar');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste mexeria na aba que o Dr. Cezar esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  const clickJson = async (args) => JSON.parse((await c.tool('browser_click', args)).content[0].text);
  const paginaAtual = async () => (await c.tool('browser_read_page')).content[0].text;
  const refNaPagina = (doc, rotulo) => {
    const linha = doc.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<button id="btnHash" aria-label="Botao que troca a URL por hash, sem rede">Navega por hash</button>' +
        '<button id="btnMudo" aria-label="Botao que nao muda nada">Nao faz nada</button>' +
        '<button id="btnSemParam" aria-label="Botao sem parametro de confirmacao">Sem confirmacao pedida</button>';
      document.getElementById('btnHash').onclick = function() {
        location.hash = '#/destino-confirmado';
      };
      document.getElementById('btnMudo').onclick = function() {};
      document.getElementById('btnSemParam').onclick = function() {};
      return 'montado';
    })()`,
  });
  await sleep(150);

  const doc = await paginaAtual();
  const refHash = refNaPagina(doc, 'Botao que troca a URL por hash');
  const refMudo = refNaPagina(doc, 'Botao que nao muda nada');
  const refSemParam = refNaPagina(doc, 'Botao sem parametro de confirmacao');
  check(Number.isFinite(refHash), 'achou o ref do botao de hash', `ref=${refHash}`);
  check(Number.isFinite(refMudo), 'achou o ref do botao mudo', `ref=${refMudo}`);
  check(Number.isFinite(refSemParam), 'achou o ref do botao sem parametro', `ref=${refSemParam}`);

  // ── 1. esperar_url numa SPA por hash, SEM rede nenhuma ──────────────────
  const r1 = await clickJson({ ref: refHash, esperar_url: '#/destino-confirmado', confirmar_ms: 3000 });
  check(r1.resultado?.confirmado === true, '1. esperar_url confirma o clique de hash (sem rede)', JSON.stringify(r1.resultado));
  check(
    typeof r1.resultado?.url_final === 'string' && r1.resultado.url_final.includes('#/destino-confirmado'),
    '1b. url_final devolvida contem o hash esperado',
    r1.resultado?.url_final,
  );

  // ── 2. esperar_texto que NUNCA aparece -- confirmado:false, SEM excecao ──
  let erro2 = null;
  let r2;
  try {
    r2 = await clickJson({ ref: refMudo, esperar_texto: 'texto que nunca vai aparecer nesta pagina', confirmar_ms: 1500 });
  } catch (err) {
    erro2 = err;
  }
  check(erro2 === null, '2. clique com esperar_texto que nunca aparece NAO lanca excecao (o clique aconteceu)', erro2?.message);
  check(r2?.resultado?.confirmado === false, '2b. resultado.confirmado e false (nao confirmou)', JSON.stringify(r2?.resultado));
  check(
    /nao chegou/i.test(r2?.resultado?.motivo ?? '') && !/bloqueado/i.test(r2?.resultado?.motivo ?? ''),
    '2c. o motivo fala em "nao chegou onde era esperado", nunca em bloqueio (o clique NAO falhou)',
    r2?.resultado?.motivo,
  );

  // ── 3. sem esperar_texto/esperar_url -- ADITIVO, sem campo "resultado" ──
  const r3 = await clickJson({ ref: refSemParam });
  check(r3.resultado === undefined, '3. clique sem os params novos NAO tem campo "resultado" (aditivo)', JSON.stringify(r3));
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
if (falhou) process.exitCode = 1;
