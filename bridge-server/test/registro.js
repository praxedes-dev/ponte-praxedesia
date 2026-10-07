/**
 * Teste de contrato da obra 01 (refatoracao de registro e ganchos).
 *
 * Nao testa a implementacao (onde cada capacidade mora agora); testa que o
 * CONJUNTO exposto e identico ao de antes da refatoracao: nenhuma tool sumiu,
 * nenhuma ganhou nem perdeu `confirm`, e os conjuntos calculados (quem altera a
 * pagina, quem exige a aba pintada) batem com os `Set` fixos de antes.
 *
 *   node test/registro.js
 */
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startClient, esperarExtensao } from './client.js';
import { TOOLS } from '../src/tools.js';

// Um caminho de arquivo que existe DE VERDADE, para a sonda de cap_upload_lote.
// browser_upload_batch confere o disco no proprio servidor (tools/upload-lote.js)
// e lanca antes de falar com a extensao — com caminho inexistente a sonda
// receberia "arquivo nao encontrado" em vez do "[somente leitura]" que ela
// existe para exigir, e passaria a medir a coisa errada. Este arquivo serve
// porque e o proprio teste: existe sempre, em qualquer maquina.
const ARQUIVO_QUE_EXISTE = fileURLToPath(import.meta.url);

// Destino da sonda de cap_download. Nunca chega a ser escrito: a sonda existe
// para ser BARRADA pelo freio, e o freio roda antes do download. Fica no temp
// do sistema para nao sujar o repo se um dia vazar.
const DESTINO_DESCARTAVEL = join(tmpdir(), 'praxedes-sonda-registro.bin');

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const TOOLS_ESPERADAS = [
  'browser_status', 'browser_read_page', 'browser_find', 'browser_screenshot', 'browser_navigate',
  'browser_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_drag',
  'browser_extract', 'browser_wait', 'browser_wait_for_text', 'browser_wait_for_change',
  'browser_console_logs', 'browser_tab_open', 'browser_tab_switch', 'browser_tab_close',
  'browser_clipboard_copy', 'browser_javascript', 'browser_form_input', 'browser_save_pdf',
  'browser_wait_network', 'browser_upload_file', 'browser_download', 'browser_cookies',
  'browser_emulate_device', 'bridge_limpar', 'bridge_faxina_ociosos', 'browser_use_current_tab',
  'browser_use_own_tab', 'browser_tabs_all', 'browser_use_tab', 'browser_tabs_list',
  'bridge_reload_extension', 'bridge_capacidades',
  // Lote A (05/09/2026) — 7 tools novas, uma linha por obra que as criou:
  'browser_dialog',                                   // obra 04
  'browser_upload_batch', 'browser_upload_verify',    // obra 05
  'browser_autocomplete',                             // obra 06
  'browser_form_fill',                                // obra 07
  'bridge_feedback', 'bridge_feedback_ler',           // obra 22
  // Fiacao da bancada final (06/09/2026) — tools que ja estavam wireadas em
  // tools/index.js mas nunca tinham entrado nesta baseline fixa (§19 do
  // plano: quem atualiza esta lista e a conferencia de escopo, nunca o
  // pedreiro). Conferido rodando `node -e` sobre src/tools/index.js contra
  // bridge_capacidades — nenhuma tool "sobrando" alem destas 8:
  'browser_wait_new_tab',                             // obra 08
  'browser_download_arm', 'browser_download_wait',    // obra 08 (download nativo
  // nao funciona nesta maquina — CDP recusa Browser/Page.setDownloadBehavior
  // por sessao de aba, ver relatorio da obra 08 — mas a tool esta exposta e
  // falha alto, honestamente; tirar do catalogo e decisao do Cezar, nao da
  // bancada)
  'browser_network_requests', 'browser_network_body', // obra 11
  'browser_back', 'browser_forward',                  // obra 12
  'bridge_auditoria',                                 // obra 10
  // Obra "entregar aba" (11/09/2026, incidente do PJe):
  'browser_entregar_aba',                             // tool principal
  'bridge_fechar_aba_admin',                          // uso de teste, ver ponte.js
  // Obra "verdade pos-acao" (15/09/2026): confere se um browser_javascript
  // que ESTOUROU o timeout_ms chegou a terminar (bem, com erro, ou ainda
  // esta rodando) — ver capacidades/js.ts (conferirExecucaoJs).
  'browser_javascript_conferir',
  // Obra "varios perfis" (11/09/2026): troca o Chrome (perfil) desta sessao.
  'browser_usar_perfil',
  // Roteiro (16/09/2026): varios passos numa chamada — ver src/roteiro.js.
  'browser_roteiro',
];

const TOOLS_CONFIRMAVEIS_ESPERADAS = [
  'browser_click', 'browser_type', 'browser_press_key', 'browser_drag', 'browser_navigate',
  // Obra 06: decisao documentada no briefing (06-autocomplete-richfaces.md), nao
  // vazamento — escolher item de lista no PJe e acao que compromete formulario.
  'browser_autocomplete',
];

const ALTERAM_ESPERADO = [
  'navigate', 'click', 'type', 'press_key', 'scroll', 'drag',
  'cap_form_input', 'cap_upload', 'cap_emular', 'cap_digitar', 'cap_click_xy',
  // Lote A. `cap_upload_conferir` (obra 05) fica DE FORA de proposito: conferir
  // anexo e leitura, nao alteracao — esta no briefing da propria obra.
  'cap_autocomplete', 'cap_dialogo', 'cap_form_fill', 'cap_upload_lote',
  // `copy_to_clipboard` entrou na obra B3: o fallback dela CRIA um <textarea>,
  // anexa ao body, seleciona e remove — ou seja, mexe no DOM da aba do usuario.
  // Rodava em modo somente leitura enquanto `scroll` ja era barrado ali.
  'copy_to_clipboard',
  // `cap_download` ganhou `altera: true` na obra da barreira de somente leitura.
  // Nao e que baixar "altere a pagina": e que ele roda script NA aba do usuario
  // com a sessao dela, e foi medido disparando GET autenticado com o cookie do
  // Dr. Cezar numa aba em modo somente leitura. Entrar aqui e o que faz o gate
  // de NOME barra-lo; com `permitir_acao` ele passa, como as demais.
  'cap_download',
  // Fiacao da bancada final (06/09/2026), conferido lendo `altera: true` na
  // fonte de cada capacidade (nao por suposicao):
  'cap_download_armar', // obra 08 (download-nativo.ts) — desvia o destino do
  // download nesta aba; se rodasse na aba do usuario em leitura, mudaria o
  // comportamento dela sem ele pedir.
  'cap_back', 'cap_forward', // obra 12 (historico.ts) — navegar e navegar,
  // mesmo voltando: sem isto, `browser_back`/`browser_forward` na aba do
  // usuario passariam batido pelo modo somente leitura.
];

const INPUT_ESPERADO = [
  'click', 'type', 'press_key', 'scroll', 'drag', 'cap_form_input', 'cap_digitar', 'cap_click_xy',
  // So estas duas do Lote A exigem a aba pintada: `cap_dialogo` responde um
  // dialogo nativo (que nao e da pagina) e `cap_upload_lote` anexa por CDP.
  'cap_autocomplete', 'cap_form_fill',
];

/**
 * Resolve toda `action` que uma tool pode assumir. A maioria e string fixa;
 * browser_click e browser_type decidem por funcao conforme o input (clique por
 * coordenada, digitacao tecla a tecla) — chama com algumas variantes e junta
 * o que sair, sem precisar saber de antemao quais tools fazem isso.
 */
function resolveActions(tool) {
  if (typeof tool.action === 'string') return [tool.action];
  // `{ ref: 1 }` fecha o achado do cetico da obra 18 (05/09/2026):
  // browser_screenshot so vira `cap_screenshot_ref` quando `ref` ou `regiao`
  // vem preenchido (tools/diagnostico.js) — sem esta variante a acao nunca
  // era descoberta, e um nome trocado entre a tool e a capacidade escaparia
  // deste contrato (so seria pego pelo teste proprio da obra, no caso 5).
  const variantes = [{}, { x: 0, y: 0 }, { modo: 'teclado' }, { ref: 1 }];
  return [...new Set(variantes.map((i) => tool.action(i)))];
}

const c = startClient('teste-registro');
try {
  await c.handshake();

  // ── 1. o conjunto de tools e exatamente o esperado ──────────────────────
  const list = await c.call('tools/list', {});
  const tools = list.result.tools;
  const nomes = tools.map((t) => t.name);

  const faltando = TOOLS_ESPERADAS.filter((n) => !nomes.includes(n));
  const sobrando = nomes.filter((n) => !TOOLS_ESPERADAS.includes(n));
  check(faltando.length === 0 && sobrando.length === 0,
    `tools/list devolve exatamente as ${TOOLS_ESPERADAS.length} tools esperadas`,
    [faltando.length ? `faltando: ${faltando.join(', ')}` : '',
      sobrando.length ? `sobrando: ${sobrando.join(', ')}` : ''].filter(Boolean).join(' | '));

  // ── 2. confirm existe exatamente nas 5 confirmaveis ─────────────────────
  const comConfirm = tools.filter((t) => t.inputSchema?.properties?.confirm).map((t) => t.name);
  check(sameSet(comConfirm, TOOLS_CONFIRMAVEIS_ESPERADAS),
    'confirm existe exatamente nas 5 tools confirmaveis',
    comConfirm.join(', '));

  // O resto do teste precisa da extensao (cap_listar roda dentro dela).
  if (!(await esperarExtensao(c))) {
    check(false, 'extensao conectou para testar bridge_capacidades e os conjuntos calculados');
  } else {
    // ── 3. bridge_capacidades responde e cobre todo cap_* das tools ───────
    const diag = await c.json('bridge_capacidades');
    check(Array.isArray(diag.capacidades) && Array.isArray(diag.internas),
      'bridge_capacidades devolve capacidades[] e internas[]',
      `${diag.capacidades?.length ?? 0} capacidades, ${diag.internas?.length ?? 0} internas`);

    // Conserto 1 (2a vistoria, 05/09/2026): nome duplicado ou sem prefixo cap_
    // nao pode mais derrubar o service worker no boot (capacidades/index.ts
    // agora captura e junta aqui). Vazio e o unico estado bom — um erro aqui
    // e vermelho nomeando o modulo culpado, em vez de silencio na extensao.
    check(Array.isArray(diag.erros) && diag.erros.length === 0,
      'bridge_capacidades nao reporta erro de registro (nenhum modulo colidiu)',
      (diag.erros ?? []).join(' | '));

    const registradas = new Set([
      ...(diag.capacidades ?? []).map((c2) => c2.nome),
      ...(diag.internas ?? []),
    ]);

    // Toda action `cap_*` que alguma tool pode gerar — direta ou por funcao
    // (cap_click_xy em browser_click com x/y; cap_digitar em browser_type
    // com modo "teclado").
    const capsDasTools = new Set(
      TOOLS.flatMap(resolveActions).filter((a) => a.startsWith('cap_')),
    );
    const semCobertura = [...capsDasTools].filter((nome) => !registradas.has(nome));
    check(semCobertura.length === 0,
      `toda action cap_* das tools existe no registro (${capsDasTools.size} conferidas: ${[...capsDasTools].join(', ')})`,
      semCobertura.join(', '));

    // ── 4. os conjuntos calculados batem com os literais de antes da obra ──
    check(sameSet(diag.alteram ?? [], ALTERAM_ESPERADO),
      'conjunto "alteram" bate com o Set fixo de antes da refatoracao',
      (diag.alteram ?? []).join(', '));
    check(sameSet(diag.input ?? [], INPUT_ESPERADO),
      'conjunto "input" bate com o Set fixo de antes da refatoracao',
      (diag.input ?? []).join(', '));

    // ── 5. sonda viva: a barreira de somente leitura de VERDADE bloqueia cada
    //      nome do conjunto "alteram" — nao so o diagnostico dizendo que bloqueia.
    //
    // Achado F1 do cetico (05/09/2026): ate esta obra, `cap_listar` RECALCULAVA
    // a mesma expressao de `alteraAPagina()` em vez de CHAMAR essa funcao — um
    // espelho. O cetico mediu: trocando `alteraAPagina` para so
    // `ACOES_QUE_ALTERAM_MOTOR.has(acao)` (perdendo `nomesQueAlteram()`), quem
    // barra na pratica afrouxava, mas a secao 4 acima continuava verde porque
    // `diag.alteram` era calculado por fora, do zero.
    //
    // IMPORTANTE: a sonda itera sobre `ALTERAM_ESPERADO` (o contrato fixo, no
    // topo deste arquivo) e NAO sobre `diag.alteram`. Na primeira versao deste
    // teste ela usava `diag.alteram` e a mutacao acima ainda escapava: com
    // `cap_listar` ja consertado para perguntar a funcao real, um
    // `alteraAPagina` quebrado faz `cap_form_input` (por exemplo) SUMIR de
    // `diag.alteram` — e a sonda, se seguisse essa lista, simplesmente parava
    // de tentar a acao que mais importava testar, "passando" por omissao. Com
    // a lista fixa, a sonda tenta `cap_form_input` de verdade mesmo que o
    // diagnostico jure que ele nao altera mais nada — e e isso que pega a
    // barreira afrouxada na pratica, nao so no relatorio.
    const MAPA_ACAO_PARA_TOOL = {
      navigate: { tool: 'browser_navigate', args: { url: 'https://example.com' } },
      click: { tool: 'browser_click', args: {} },
      type: { tool: 'browser_type', args: { text: 'sonda-registro' } },
      press_key: { tool: 'browser_press_key', args: { key: 'a' } },
      scroll: { tool: 'browser_scroll', args: {} },
      drag: { tool: 'browser_drag', args: { fromX: 0, fromY: 0, toX: 1, toY: 1 } },
      cap_form_input: { tool: 'browser_form_input', args: { ref: 1, valor: 'sonda-registro' } },
      cap_upload: {
        tool: 'browser_upload_file',
        args: { ref: 1, caminhos: ['C:\\nao-existe-sonda-registro.txt'] },
      },
      cap_emular: { tool: 'browser_emulate_device', args: { largura: 390, altura: 844 } },
      cap_digitar: { tool: 'browser_type', args: { text: 'sonda-registro', modo: 'teclado' } },
      cap_click_xy: { tool: 'browser_click', args: { x: 0, y: 0 } },
      // Lote A. Os args precisam ser validos o bastante para CHEGAR ao freio:
      // o que a sonda exige e a resposta "[somente leitura]", entao um erro de
      // validacao anterior a isso (schema, disco) faria a sonda medir outra
      // coisa e "passar" sem testar a barreira.
      cap_autocomplete: {
        tool: 'browser_autocomplete',
        args: { ref: 1, texto: 'sonda-registro' },
      },
      cap_dialogo: { tool: 'browser_dialog', args: { aceitar: false } },
      cap_form_fill: {
        tool: 'browser_form_fill',
        args: { campos: [{ ref: 1, valor: 'sonda-registro' }] },
      },
      cap_upload_lote: {
        tool: 'browser_upload_batch',
        args: { ref: 1, caminhos: [ARQUIVO_QUE_EXISTE] },
      },
      // Porta 1 nao tem servico: a sonda so precisa CHEGAR ao freio, e o freio
      // roda antes de qualquer rede. Se um dia ela vazar do freio, falha por
      // conexao recusada em vez de baixar coisa de verdade — o lado seguro.
      cap_download: {
        tool: 'browser_download',
        args: { url: 'http://127.0.0.1:1/sonda-registro', caminho: DESTINO_DESCARTAVEL },
      },
      // Fiacao da bancada final (06/09/2026): sem params obrigatorios nos
      // dois — args vazios chegam ao freio do mesmo jeito, que e tudo que a
      // sonda precisa.
      cap_back: { tool: 'browser_back', args: {} },
      cap_forward: { tool: 'browser_forward', args: {} },
      // build() de browser_download_arm roda no SERVIDOR (mkdirSync da pasta
      // padrao) antes mesmo de chegar na extensao — efeito colateral local
      // inofensivo (so cria uma pasta vazia), nao rede. O que a sonda mede e
      // se a extensao barra ANTES de armar o download de verdade.
      cap_download_armar: { tool: 'browser_download_arm', args: {} },
      // Copiar escreve na area de transferencia do PC — altera estado fora da
      // pagina, entao tambem precisa ser barrado em somente leitura.
      copy_to_clipboard: { tool: 'browser_clipboard_copy', args: { text: 'sonda-registro' } },
    };

    const alterar = ALTERAM_ESPERADO;
    const semMapa = alterar.filter((nome) => !MAPA_ACAO_PARA_TOOL[nome]);
    check(semMapa.length === 0,
      'toda acao do conjunto "alteram" (contrato fixo) tem mapeamento de tool para a sonda viva',
      semMapa.length ? `adicione ${semMapa.join(', ')} ao MAPA_ACAO_PARA_TOOL deste teste` : '');

    if (semMapa.length === 0 && alterar.length > 0) {
      // Conserto 2 (2a vistoria, 05/09/2026): esta sonda chamava
      // browser_use_current_tab, que adota QUALQUER aba que estiver na frente
      // do Dr. Cezar naquele instante — e o loop abaixo TENTA DE VERDADE
      // navegar, clicar, digitar e emular nela. Se a barreira de somente
      // leitura estiver quebrada (exatamente o caso que este teste existe
      // para pegar) e ele estiver com o PJe ou qualquer trabalho real na
      // tela, quem faz o estrago e o proprio teste, nao o bug.
      //
      // Troca: a sonda abre a PROPRIA aba-cobaia (site inocuo, via
      // browser_tab_open) e a adota com browser_use_tab, que passa pelo MESMO
      // adotarAbaDoUsuario() que browser_use_current_tab usa (bridge/index.ts
      // comenta, em cap_use_tab: "aba escolhida a dedo e do usuario tanto
      // quanto a corrente") — mesma barreira, mesmo contrato, sem tocar em
      // nada do Dr. Cezar. De quebra fecha o conserto 3: cap_use_tab (o
      // caminho de "usa a aba que eu ja abri") nunca tinha sonda viva
      // nenhuma — adotar-aba.js testava so o caminho feliz de adocao, sem
      // nunca afirmar que o modo leitura vale nela; uma mutacao no
      // `p.permitir_acao === true` de cap_use_tab escapava de toda a
      // bancada. Agora e pega aqui.
      await c.tool('browser_tab_open', { url: 'https://example.com/sonda-registro' });
      await c.tool('browser_wait_network', {}).catch(() => {});
      const cobaia = (await c.json('browser_tabs_list')).activeTabId;

      try {
        const olhar = (await c.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
        const entrouEmLeitura = /somente leitura/i.test(olhar);
        check(entrouEmLeitura, 'sonda: browser_use_tab (aba-cobaia) entra em modo somente leitura', olhar.slice(0, 70));

        if (entrouEmLeitura) {
          for (const nome of alterar) {
            const { tool, args } = MAPA_ACAO_PARA_TOOL[nome];
            const resp = await c.call('tools/call', { name: tool, arguments: args });
            const texto = resp.result?.content?.[0]?.text ?? '';
            const barrado = resp.result?.isError === true && /somente leitura/i.test(texto);
            check(barrado, `sonda: "${nome}" (via ${tool}) e barrado de verdade na aba-cobaia`,
              texto.slice(0, 90));
          }
        }
      } finally {
        // Devolve o agente para a aba propria ANTES de fechar a cobaia: sem
        // isto a sessao fica "presa" em modo leitura ate `c.close()` la
        // embaixo soltar o workspace.
        const volta = (await c.tool('browser_use_own_tab')).content[0].text;
        check(/aba propria/.test(volta), 'sonda: browser_use_own_tab devolve o agente para a aba dele');
        await c.tool('browser_tab_close', { tabId: cobaia }).catch(() => {});
      }
    }
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
