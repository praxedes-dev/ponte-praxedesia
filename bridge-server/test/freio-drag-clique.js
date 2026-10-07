/**
 * B2 — `browser_drag` como porta de fuga do freio de clique destrutivo.
 *
 * O `case 'drag'` do motor (execution-engine/index.ts) despacha
 * `Input.dispatchMouseEvent` mousePressed + mouseMoved* + mouseReleased com
 * `clickCount: 1`. Quando o ponto de partida e o de chegada caem no MESMO
 * elemento, o Chrome sintetiza o evento `click` normalmente — ou seja,
 * `browser_drag` E um clique, so que com outro nome. A regra 4 do freio
 * (`policy.ts`, acao irreversivel) so rodava para `action.type === 'click'`,
 * entao bastava embrulhar o clique num drag para o botao "Excluir conta" ser
 * apertado sem ninguem olhar — a mesma familia do furo 7-B (`type` que clica).
 *
 * Conserto: `drag` entrou em `ACOES_QUE_CLICAM` (policy.ts) e em
 * `ACOES_COM_ALVO_UNICO` (execution-engine), e `origemDaAcao` resolve o alvo
 * do drag pelo ponto de PARTIDA (fromX/fromY) — o mesmo no que vai receber o
 * mousePressed.
 *
 * ⚠️ POR QUE O FREIO NAO OLHA "from == to", E SIM SEMPRE A ORIGEM: o clique
 * sintetizado nao exige coordenada identica. Ele nasce sempre que mousedown e
 * mouseup caem no mesmo elemento — dois pixels de diferenca DENTRO do mesmo
 * botao continuam sendo um clique de verdade. Um freio que so olhasse
 * `from == to` seria furado por `toX = fromX + 2`, e o caso 2 abaixo existe
 * exatamente para matar essa mutacao.
 *
 * Casos:
 *   1 — drag com from == to sobre "Excluir conta" e BLOQUEADO, e o onclick
 *       do botao nao dispara.
 *   2 — drag com destino 2px ao lado (ainda dentro do mesmo botao) tambem e
 *       bloqueado — mata a mutacao "so barrar quando from == to".
 *   3 — drag com from == to sobre um botao COMUM passa e o onclick dispara.
 *       E a medicao do mecanismo: prova que drag com origem e destino no mesmo
 *       elemento e, de fato, um clique — sem isto os casos 1 e 2 poderiam estar
 *       verdes por o drag simplesmente nao funcionar.
 *   4 — drag LEGITIMO (from != to, elementos diferentes) continua funcionando:
 *       o movimento acontece, o mouseup cai no destino e o botao de origem NAO
 *       recebe clique. Mata a mutacao "barrar todo drag".
 *   5 — o MESMO drag do caso 1, agora com `confirm: true`, passa e o onclick
 *       dispara. Prova que o freio e a unica coisa entre o drag e o botao
 *       irreversivel (a medicao do estrago) e que a porta e a mesma das outras
 *       acoes: confirmar, nao proibir.
 *
 *   node test/freio-drag-clique.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-freio-drag-clique');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba PROPRIA: sem isto o teste arrastaria coisas na aba do Dr. Cezar.
  await c.tool('browser_tab_open', { url: 'https://example.com/sonda-freio-drag' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<button id="destrutivo" style="position:fixed;left:30px;top:30px;width:220px;height:44px" '
        + 'onclick="window.__d=(window.__d||0)+1">Excluir conta</button>'
        + '<button id="normal" style="position:fixed;left:30px;top:120px;width:220px;height:44px" '
        + 'onclick="window.__n=(window.__n||0)+1">Ver detalhes</button>'
        + '<div id="solto" style="position:fixed;left:30px;top:230px;width:220px;height:44px;background:#ddd">solta aqui</div>';
      window.__d = 0; window.__n = 0; window.__mv = 0; window.__up = '';
      document.addEventListener('mousemove', function(){ window.__mv++; }, true);
      document.addEventListener('mouseup', function(e){ window.__up = (e.target && e.target.id) || ''; }, true);
      return 'montado';
    })()`,
  });
  await sleep(200);

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const contador = async (nome) => Number(await js(`window.__${nome} || 0`));
  const centro = async (id) => JSON.parse(await js(
    `JSON.stringify((function(){ var r = document.getElementById('${id}').getBoundingClientRect(); `
    + `return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })())`,
  ));

  const arrastar = (args) => c.call('tools/call', { name: 'browser_drag', arguments: args });

  const d = await centro('destrutivo');
  const n = await centro('normal');
  const s = await centro('solto');

  // ── 1. from == to sobre botao destrutivo: BLOQUEADO ────────────────────
  const r1 = await arrastar({ fromX: d.x, fromY: d.y, toX: d.x, toY: d.y });
  const t1 = r1.result?.content?.[0]?.text ?? '';
  check(r1.result?.isError === true, '1. drag com from == to sobre "Excluir conta" e bloqueado', t1.slice(0, 180));
  check(/\[bloqueado\]/.test(t1) && /excluir/i.test(t1),
    '1. a mensagem nomeia o bloqueio e o gatilho "excluir"', t1.slice(0, 180));
  check((await contador('d')) === 0, '1. o onclick do botao destrutivo NAO disparou');

  // ── 2. destino 2px ao lado, ainda dentro do mesmo botao: BLOQUEADO ─────
  // Mata a mutacao "so tratar como clique quando from == to".
  const r2 = await arrastar({ fromX: d.x, fromY: d.y, toX: d.x + 2, toY: d.y });
  const t2 = r2.result?.content?.[0]?.text ?? '';
  check(r2.result?.isError === true,
    '2. drag de 2px DENTRO do mesmo botao destrutivo tambem e bloqueado (from != to nao salva)',
    t2.slice(0, 180));
  check((await contador('d')) === 0, '2. o onclick do botao destrutivo continua sem disparar');

  // ── 3. mecanismo: from == to sobre botao COMUM e um clique de verdade ──
  const antesN = await contador('n');
  const r3 = await arrastar({ fromX: n.x, fromY: n.y, toX: n.x, toY: n.y });
  check(r3.result?.isError !== true, '3. drag com from == to sobre botao comum NAO e bloqueado',
    (r3.result?.content?.[0]?.text ?? '').slice(0, 180));
  await sleep(150);
  check((await contador('n')) === antesN + 1,
    '3. e ele CLICOU de verdade — drag com origem e destino no mesmo elemento e um clique');

  // ── 4. drag legitimo (elementos diferentes) continua funcionando ────────
  await js('window.__mv = 0; window.__up = ""; 1');
  const antesN2 = await contador('n');
  const r4 = await arrastar({ fromX: n.x, fromY: n.y, toX: s.x, toY: s.y, steps: 8 });
  check(r4.result?.isError !== true, '4. drag legitimo (de um elemento para outro) nao e bloqueado',
    (r4.result?.content?.[0]?.text ?? '').slice(0, 180));
  await sleep(200);
  check((await contador('mv')) > 0, '4. o movimento do mouse aconteceu de verdade (mousemove > 0)');
  check((await js('window.__up')) === 'solto', '4. o mouseup caiu no elemento de DESTINO',
    await js('window.__up'));
  check((await contador('n')) === antesN2,
    '4. o botao de ORIGEM nao recebeu clique (foi arrasto, nao clique)');

  // ── 5. com confirm: true o drag destrutivo passa — e clica de verdade ───
  const antesD = await contador('d');
  const r5 = await arrastar({ fromX: d.x, fromY: d.y, toX: d.x, toY: d.y, confirm: true });
  check(r5.result?.isError !== true, '5. com confirm: true o mesmo drag passa (porta igual a das outras acoes)',
    (r5.result?.content?.[0]?.text ?? '').slice(0, 180));
  await sleep(150);
  check((await contador('d')) === antesD + 1,
    '5. e ele CLICOU o botao "Excluir conta" — prova que so o freio estava entre o drag e o estrago');
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
