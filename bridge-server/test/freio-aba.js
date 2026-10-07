/**
 * Freio (entrypoints/background/bridge/policy.ts, regra 4): aba de conferencia
 * do PJe ("PROTOCOLAR INICIAL") nao pode ser barrada como se fosse o botao que
 * protocola de verdade — e o contrario tambem: nada que prove ser um controle
 * de acao real pode escapar so por estar perto de uma aba, ter href decorativo
 * ou disparar por addEventListener em vez de onclick inline.
 *
 * Casos 1, 2, 3, 5, 6 sao o par original (aba passa / botao barra) do criterio
 * de pronto do briefing. Os demais fecham os buracos achados pelo cetico:
 *
 *   4  — <a href="#" onclick> dentro de <form> ("Excluir anexo")
 *   7  — <a> sem onclick-atributo, com addEventListener DIRETO ("Excluir
 *        conta") — achado A2: nenhuma SPA moderna usa onclick inline.
 *   8  — role=tab COM onclick real — achado A1: prova por ancestral nao podia
 *        vencer onclick no proprio clicavel, so a prova por <a> pedia isso.
 *   9  — RichFaces (td.rich-tab-header > a) COM onclick real — reproducao
 *        EXATA do incidente de 04/09, trocando o href="#" decorativo por
 *        onclick de verdade (achado A1, o mais citado pelo cetico).
 *   10 — <a href="javascript:...">  — achado A3: href que executa codigo no
 *        clique, sem passar por onclick nem por form.
 *   11 — role="menuitem" com classe rich-tab-header, sem <a> e sem role=tab —
 *        so passa pela classe RichFaces, nunca pela regra do <a> nem pela do
 *        role=tab/tablist. Existe para matar a mutacao que zera
 *        `temClasseDeHeaderDeAba` sem que nenhum outro caso perceba (o caso 2
 *        passa pela regra do <a>, nao pela classe — o cetico provou isso
 *        mutando o codigo). Nao e <td>/<li> puro porque o browser_read_page
 *        desta ponte so lista um conjunto fixo de roles "interativos" (ver
 *        `execution-engine/ax-tree.ts`), e "cell"/"listitem" ficam de fora —
 *        sem ref, o teste nao consegue clicar (medido nesta obra).
 *   12 — <a role="button" class="rich-tab-header"> — achado do cetico: apagar
 *        `ehControleDeAcaoReal` nao derrubava nenhum caso existente porque
 *        nenhum deles era, ao mesmo tempo, controle de acao real E teria
 *        alguma prova de aba (via <a> ou via classe) se essa exclusao sumisse.
 *
 * Cada caso conta o clique real (e.isTrusted) que chegou no DOM. A contagem e
 * feita por UM listener no `document`, em fase de captura — nunca por
 * addEventListener no proprio elemento do caso, porque isso contaminaria
 * exatamente o que o caso 7 precisa medir (o freio agora enxerga listener via
 * addEventListener no elemento). Delegar no document tambem prova, na
 * pratica, a lacuna que o briefing pediu para medir: DOMDebugger.
 * getEventListeners no objectId do elemento NAO enxerga esse listener
 * delegado (e o mesmo motivo pelo qual um listener de delegacao ligado por
 * um framework na raiz da arvore escapa desta defesa — risco residual, ver
 * relatorio da obra). Os casos 8 e 9 provam onclick por ATRIBUTO (onclick=
 * "acaoReal()", que ja era detectado antes desta obra); so o caso 7 precisa
 * de um handler de verdade ligado por addEventListener DIRETO no elemento
 * (achado A2) — os dois marcam `window.__acaoRealDisparou` quando disparam.
 * O caso 12 nao ganha handler nenhum de proposito: e barrado so por ser
 * role=button, para isolar a mutacao que apaga `ehControleDeAcaoReal`.
 *
 * Ver docs/obra-20260904/02-freio-aba-nao-e-botao.md
 *
 *   node test/freio-aba.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-freio-aba');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste mexeria na aba que o usuario esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        // 1. ARIA: <li role="tab"> dentro de [role=tablist] -> deve PASSAR.
        '<ul role="tablist">' +
          '<li id="caso1" data-caso="caso1" role="tab" tabindex="0">PROTOCOLAR INICIAL</li>' +
        '</ul>' +
        // 2. RichFaces 3, href decorativo: <td class="rich-tab-header"><a
        //    href="#">...</a></td> -> deve PASSAR (a aba real do PJe que
        //    gerou o incidente de 04/09, antes do onclick real do caso 9).
        '<table class="rich-tabpanel"><tr>' +
          '<td class="rich-tab-header"><a id="caso2" data-caso="caso2" href="#">PROTOCOLAR INICIAL</a></td>' +
        '</tr></table>' +
        // 3. Botao de verdade -> deve BARRAR.
        '<button id="caso3" data-caso="caso3">Protocolar</button>' +
        // 4. Defeito irmao do briefing: <a href="#" onclick> dentro de <form>
        //    fingindo ser link -> deve continuar BARRADO.
        '<form>' +
          '<a id="caso4" data-caso="caso4" href="#" onclick="">Excluir anexo</a>' +
        '</form>' +
        // 5. input[type=submit] -> deve BARRAR.
        '<input id="caso5" data-caso="caso5" type="submit" value="Assinar e protocolar">' +
        // 6. Link comum de navegacao fora de form -> decisao do capataz: PASSA.
        '<a id="caso6" data-caso="caso6" href="/pje/ajuda">Protocolar: como funciona</a>' +
        // 7. Achado A2: <a> sem onclick-atributo, so com addEventListener
        //    DIRETO no proprio elemento -> deve BARRAR (o texto casa com
        //    "excluir", igual ao "Excluir conta" que passou ao vivo no Nubank).
        '<a id="caso7" data-caso="caso7" href="#">Excluir conta</a>' +
        // 8. Achado A1: role=tab, mas com onclick REAL no proprio clicavel ->
        //    deve BARRAR (a prova por ancestral nao pode vencer onclick).
        '<div id="caso8" data-caso="caso8" role="tab" tabindex="0" onclick="acaoReal()">Protocolar processo direto</div>' +
        // 9. Achado A1, reproducao EXATA do incidente de 04/09: RichFaces com
        //    onclick REAL em vez do href="#" decorativo -> deve BARRAR.
        '<table class="rich-tabpanel"><tr>' +
          '<td class="rich-tab-header"><a id="caso9" data-caso="caso9" href="#" onclick="acaoReal()">Protocolar processo REAL</a></td>' +
        '</tr></table>' +
        // 10. Achado A3: href="javascript:..." executa codigo no clique, sem
        //     onclick nem form -> deve BARRAR.
        '<a id="caso10" data-caso="caso10" href="javascript:acaoReal()">Excluir conta via javascript</a>' +
        // 11. So passa pela CLASSE RichFaces (nao e <a>, nao e role=tab nem
        //     tablist, entao nenhuma outra prova poderia salvar este caso) ->
        //     deve PASSAR. Mata a mutacao que zera temClasseDeHeaderDeAba sem
        //     o caso 2 perceber. role="menuitem" (nao <td>/<li> puros): o
        //     browser_read_page desta ponte (ax-tree.ts, INTERACTIVE_ROLES)
        //     so lista um conjunto fixo de roles como clicaveis — "cell" e
        //     "listitem" nao estao nele, entao <td>/<li> sem role explicito
        //     nunca ganham ref e o teste nao consegue clicar (medido nesta
        //     obra). "menuitem" esta na lista E nao aciona a prova por role
        //     de aba (so "tab"/"tablist" acionam), isolando so a classe.
        '<div id="caso11" data-caso="caso11" role="menuitem" tabindex="0" class="rich-tab-header">Protocolar aba interna</div>' +
        // 12. Controle de acao real disfarcado de aba: <a role="button"> com
        //     classe de header RichFaces -> deve BARRAR. Mata a mutacao que
        //     apaga ehControleDeAcaoReal (nenhum caso acima e, ao mesmo
        //     tempo, controle de acao real E teria prova de aba se a exclusao
        //     sumisse).
        '<a id="caso12" data-caso="caso12" href="#" role="button" class="rich-tab-header">Protocolar via role button disfarcado</a>';

      // onclick="acaoReal()" dos casos 8 e 9 precisa existir para nao gerar
      // ReferenceError (silencioso, mas polui o console) — e serve de prova
      // extra: se o handler disparar de verdade, este flag acusa.
      window.__acaoRealDisparou = false;
      window.acaoReal = function () { window.__acaoRealDisparou = true; };

      // Contagem de clique por UM listener no document (fase de captura) —
      // nunca addEventListener direto no elemento do caso (contaminaria o
      // proprio mecanismo que o caso 7 precisa medir). preventDefault trava a
      // navegacao real dos <a> com href e o "submit" do input (casos 2, 5, 6,
      // 7, 9, 10), que senao trocariam a pagina do teste ou, no caso 10,
      // chegariam a EXECUTAR o javascript: se o freio falhar.
      window.__cliques = {};
      document.addEventListener('click', function (e) {
        e.preventDefault();
        var alvo = e.target.closest && e.target.closest('[data-caso]');
        if (!alvo) return;
        var id = alvo.dataset.caso;
        window.__cliques[id] = (window.__cliques[id] || 0) + (e.isTrusted ? 1 : 100);
      }, true);

      // Handler "de producao" ligado DIRETO no elemento (nao no document) —
      // e o que o caso 7 precisa para provar addEventListener (achado A2).
      // O caso 12 NAO ganha addEventListener nem onclick-atributo de proposito:
      // se ganhasse, ficaria barrado por temOnclick mesmo com a mutacao B
      // (apagar ehControleDeAcaoReal) aplicada, e deixaria de matar essa
      // mutacao — o caso 12 tem de ser barrado SO por ser role=button.
      document.getElementById('caso7').addEventListener('click', function () { window.__acaoRealDisparou = true; });

      return 'montado';
    })()`,
  });
  await sleep(400);

  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  const cliquesDe = async (id) => Number(
    (await c.tool('browser_javascript', { codigo: `window.__cliques['${id}'] || 0` })).content[0].text.trim(),
  );
  const acaoRealDisparou = async () => (
    (await c.tool('browser_javascript', { codigo: `window.__acaoRealDisparou` })).content[0].text.trim() === 'true'
  );
  const resetarAcaoReal = () => c.tool('browser_javascript', { codigo: `window.__acaoRealDisparou = false` });

  /** Caso que tem de PASSAR sem confirm, com o clique chegando de verdade no DOM. */
  const esperaPassar = async (casoId, rotuloBusca, descricao) => {
    const ref = refDe(rotuloBusca);
    check(Boolean(ref), `achou ${casoId} (${descricao}), ref ${ref}`);
    if (!ref) return;
    await c.tool('browser_click', { ref });
    check((await cliquesDe(casoId)) === 1, `${casoId} (${descricao}) PASSOU sem confirm, e o clique chegou no DOM`);
  };

  /** Caso que tem de continuar BARRADO, sem o clique nunca chegar no DOM nem disparar o handler real. */
  const esperaBarrar = async (casoId, rotuloBusca, descricao, { motivoContem } = {}) => {
    const ref = refDe(rotuloBusca);
    check(Boolean(ref), `achou ${casoId} (${descricao}), ref ${ref}`);
    if (!ref) return;
    await resetarAcaoReal();
    const r = await c.call('tools/call', { name: 'browser_click', arguments: { ref } });
    check(r.result.isError === true, `${casoId} (${descricao}) continua BARRADO`, r.result.content[0].text.slice(0, 140));
    if (motivoContem) {
      check(r.result.content[0].text.toLowerCase().includes(motivoContem.toLowerCase()),
        `${casoId}: motivo cita "${motivoContem}"`, r.result.content[0].text.slice(0, 140));
    }
    check((await cliquesDe(casoId)) === 0, `${casoId}: o clique NUNCA chegou no DOM`);
    check((await acaoRealDisparou()) === false, `${casoId}: o handler real NUNCA disparou`);
  };

  // ── par original do criterio de pronto ──────────────────────────────────
  await esperaPassar('caso1', 'tab "protocolar inicial"', 'li role=tab');
  await esperaPassar('caso2', 'link "protocolar inicial"', 'header RichFaces, href decorativo');
  await esperaBarrar('caso3', 'button "protocolar"', 'botao real "Protocolar"', { motivoContem: 'casou com' });
  await esperaBarrar('caso4', 'link "excluir anexo"', 'a href=# onclick dentro de form');
  await esperaBarrar('caso5', 'button "assinar e protocolar"', 'input type=submit');
  await esperaPassar('caso6', 'link "protocolar: como funciona"', 'link comum fora de form');

  // ── achado A2: addEventListener direto, sem onclick-atributo ────────────
  await esperaBarrar('caso7', '"excluir conta"', 'a sem onclick-atributo, com addEventListener direto',
    { motivoContem: 'onclick=sim' });

  // ── achado A1: prova por ancestral nao pode vencer onclick no clicavel ──
  await esperaBarrar('caso8', '"protocolar processo direto"', 'role=tab COM onclick real');
  await esperaBarrar('caso9', '"protocolar processo real"', 'RichFaces COM onclick real (reproducao do incidente de 04/09)',
    { motivoContem: 'casou com' });

  // ── achado A3: href="javascript:..." ────────────────────────────────────
  await esperaBarrar('caso10', '"excluir conta via javascript"', 'a href="javascript:..."');

  // ── so passa pela classe RichFaces (mata a mutacao C) ───────────────────
  await esperaPassar('caso11', '"protocolar aba interna"', 'role=menuitem com classe rich-tab-header, sem <a> e sem role=tab');

  // ── controle de acao real disfarcado de aba (mata a mutacao B) ──────────
  await esperaBarrar('caso12', '"protocolar via role button disfarcado"', 'a role=button com classe RichFaces');

  // Nota sobre o que este arquivo NAO cobre: um link de acao por GET
  // (`<a href="/protocolar?id=123" target="_blank">`) e indistinguivel, so
  // pelo DOM, do caso 6 (link legitimo de navegacao) — nenhuma heuristica foi
  // acrescentada para isso; ver relatorio da obra.
  //
  // Nota sobre delegacao de evento: um listener ligado num ANCESTRAL (ex.:
  // React que liga o listener na raiz da arvore, nao no <a> clicado) tambem
  // nao e visto por este freio — DOMDebugger.getEventListeners so enxerga
  // listener no proprio objectId consultado. O listener de contagem deste
  // proprio arquivo, ligado no `document`, e prova viva disso: TODOS os doze
  // casos tem esse listener delegado e nenhum e contado como "onclick" pelo
  // freio por causa dele — so o caso 7, que ganha um SEGUNDO listener ligado
  // DIRETO no elemento, e pego.
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
