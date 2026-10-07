/**
 * Obra 05/09/2026 (conserto avulso, mesmo desenho da 06-autocomplete-richfaces)
 * — `cap_click_xy` (`entrypoints/background/bridge/capacidades/clique.ts`,
 * o `browser_click { x, y }` por coordenada) tinha o MESMO defeito que estava
 * desligando o freio do autocomplete: `DOM.getNodeForLocation` exige `x`/`y`
 * **inteiros** (int32 — devtools-protocol, `GetNodeForLocationRequest`).
 * Coordenada fracionaria (ex.: `getBoundingClientRect().x + width/2`, a mesma
 * conta que qualquer agente faz para mirar o centro de um elemento) fazia o
 * CDP recusar (`BINDINGS: int32 value expected`), e o `.catch(() => null)`
 * cego engolia o erro: `no` virava `null`, `if (no?.backendNodeId)` nunca
 * entrava, e `avaliar()` — o freio — NUNCA rodava. O clique acontecia assim
 * mesmo, sem freio.
 *
 * MEDIDO ao vivo (05/09/2026), com o codigo ainda sem conserto: clique em
 * (299.55, 107.15) sobre um botao "Excluir conta" passou direto, sem erro
 * nenhum, e o `onclick` disparou (`_medicao-clique-xy-temp.js`, apagado
 * depois de confirmar).
 *
 * Diferenca em relacao ao autocomplete: la a coordenada vinha SEMPRE
 * fracionaria (100% do freio desligado); aqui `x`/`y` vem do proprio agente,
 * que costuma mandar inteiro — entao o freio funcionava na maioria das vezes
 * e falhava so quando chegava fracionario (medido: com coordenada JA
 * inteira, o freio sempre funcionou).
 *
 * O conserto replica o de `autocomplete.ts`: `Math.round` antes de
 * `DOM.getNodeForLocation`, e o `.catch` cego virou `try/catch` que
 * distingue os dois casos — `/no node/i` e legitimo (nao ha no ali, segue
 * sem freio, como sempre foi) e qualquer OUTRO erro falha FECHADO (aborta
 * antes do clique, em vez de clicar sem avaliar).
 *
 * Casos:
 *   1/2 — clique em texto destrutivo ("Excluir conta") e BLOQUEADO, tanto
 *         com coordenada fracionaria (o caso que estava furado) quanto
 *         inteira (o caso que ja funcionava — nao pode regredir).
 *   3/4 — clique comum (nao destrutivo) continua funcionando, fracionario e
 *         inteiro — sem falso positivo do freio mais rigoroso.
 *   5   — coordenada absurda (fora do alcance int32, ex.: um agente que
 *         calculou a conta errada) produz um erro do CDP que NAO e "no
 *         node" — o freio tem de falhar FECHADO (abortar) em vez de tratar
 *         como "sem no aqui" e clicar sem avaliar. Mata a mutacao que volta
 *         o `try/catch` para `.catch(() => null)`: com o catch cego, esta
 *         coordenada vira "sem no", o clique acontece sem avaliar, e ficaria
 *         verde mesmo com o freio desligado para qualquer erro genuino do
 *         CDP (nao so o de arredondamento).
 *   6   — coordenada fora do documento (mas dentro do int32) e o caso "sem
 *         no" LEGITIMO: continua passando sem freio, exatamente como sempre
 *         foi (nao pode virar bloqueio por engano).
 *
 *   node test/freio-clique-xy.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-freio-clique-xy');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste mexeria na aba que o Dr. Cezar esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<button id="destrutivo" onclick="window.__d=(window.__d||0)+1">Excluir conta</button>' +
        '<button id="normal" onclick="window.__n=(window.__n||0)+1">Ver detalhes</button>';
      window.__d = 0;
      window.__n = 0;
      return 'montado';
    })()`,
  });
  await sleep(200);

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const contador = async (nome) => Number(await js(`window.__${nome} || 0`));
  const rectDoCentro = async (id) => JSON.parse(await js(
    `JSON.stringify((function(){ var r = document.getElementById('${id}').getBoundingClientRect(); `
    + `return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })())`,
  ));

  const clicar = (x, y) => c.call('tools/call', { name: 'browser_click', arguments: { x, y } });

  // ── 1/2. destrutivo: BLOQUEADO com coordenada fracionaria e inteira ─────
  const rd = await rectDoCentro('destrutivo');
  const fracionaria = !Number.isInteger(rd.x) || !Number.isInteger(rd.y);
  check(fracionaria, '1. o centro do botao "Excluir conta" saiu fracionario (o caso que estava furado)', JSON.stringify(rd));

  const r1 = await clicar(rd.x, rd.y);
  const texto1 = r1.result?.content?.[0]?.text ?? '';
  check(r1.result?.isError === true, '1. clique destrutivo, coordenada FRACIONARIA, e bloqueado', texto1.slice(0, 160));
  check(texto1.includes('[bloqueado]') && texto1.toLowerCase().includes('excluir'), '1. mensagem nomeia o bloqueio e o gatilho "excluir"', texto1.slice(0, 160));
  check((await contador('d')) === 0, '1. o clique NUNCA chegou no botao (onclick nao disparou)');

  const r2 = await clicar(Math.round(rd.x), Math.round(rd.y));
  const texto2 = r2.result?.content?.[0]?.text ?? '';
  check(r2.result?.isError === true, '2. clique destrutivo, coordenada INTEIRA, continua bloqueado (nao pode regredir)', texto2.slice(0, 160));
  check((await contador('d')) === 0, '2. o clique NUNCA chegou no botao');

  // ── 3/4. normal: continua funcionando, fracionario e inteiro ───────────
  const rn = await rectDoCentro('normal');
  const antesN1 = await contador('n');
  const r3 = await clicar(rn.x, rn.y);
  check(r3.result?.isError !== true, '3. clique comum, coordenada fracionaria, NAO e bloqueado (sem falso positivo)', (r3.result?.content?.[0]?.text ?? '').slice(0, 160));
  check((await contador('n')) === antesN1 + 1, '3. o clique comum chegou de verdade no botao');

  const antesN2 = await contador('n');
  const r4 = await clicar(Math.round(rn.x), Math.round(rn.y));
  check(r4.result?.isError !== true, '4. clique comum, coordenada inteira, continua funcionando', (r4.result?.content?.[0]?.text ?? '').slice(0, 160));
  check((await contador('n')) === antesN2 + 1, '4. o clique comum chegou de verdade no botao');

  // ── 5. erro genuino do CDP (fora do int32) falha FECHADO ────────────────
  // Mata a mutacao que volta o try/catch para `.catch(() => null)`: com o
  // catch cego, este erro tambem viraria "sem no aqui" (backendNodeId
  // undefined) e o clique aconteceria sem passar por avaliar() — mesmo
  // classe de furo do defeito original, so que por outra causa.
  const antesD = await contador('d');
  const antesN = await contador('n');
  const r5 = await clicar(99_999_999_999, 100);
  const texto5 = r5.result?.content?.[0]?.text ?? '';
  check(r5.result?.isError === true, '5. coordenada fora do int32 (erro genuino do CDP) e ABORTADA, nao tratada como "sem no"', texto5.slice(0, 220));
  check(!/\[bloqueado\]/.test(texto5), '5. nao e o bloqueio da policy (nao ha elemento nessa coordenada) — e o freio falhando fechado', texto5.slice(0, 220));
  check((await contador('d')) === antesD && (await contador('n')) === antesN, '5. nenhum dos dois botoes recebeu clique');

  // ── 6. "sem no" LEGITIMO (fora do documento, mas dentro do int32) ───────
  // Continua passando sem freio, como sempre foi — nao pode virar bloqueio
  // por engano so porque o freio ficou mais rigoroso.
  const r6 = await clicar(9999, 9999);
  const texto6 = r6.result?.content?.[0]?.text ?? '';
  check(r6.result?.isError !== true, '6. coordenada fora do documento (sem no legitimo) nao e bloqueada', texto6.slice(0, 160));
  check(!texto6.includes('sobre o no'), '6. nao achou no nenhum ali (seguiu sem freio, como sempre foi)', texto6.slice(0, 160));
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
