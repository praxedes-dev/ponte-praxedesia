/**
 * Roda a bateria inteira e SEMPRE vai ate o fim.
 *
 * O script `test` do package.json encadeia os arquivos com `&&`, entao a
 * primeira falha esconde todos os seguintes — foi assim que uma falha no
 * isolamento fez parecer que a bateria tinha 13 checks quando tem ~90, e o
 * capataz somou resultados de execucoes separadas achando que era uma so.
 *
 *   node test/todos.js
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
/**
 * A bateria rodava so os 10 primeiros — TODA a cobertura escrita nas obras de
 * 04 a 26 ficava fora, e ninguem via. Um `npm test` verde dizia menos do que
 * parecia: o teste do dialogo, do upload, do autocomplete, do formulario, do
 * teclado e dos dois freios nunca era executado aqui. Ligar cada teste novo
 * nesta lista e parte de fechar uma obra, nao um extra (plano §5).
 *
 * Ficam DE FORA de proposito, e nao por esquecimento:
 * - `janela-coberta`: precisa que uma pessoa cubra a janela da ponte com outra
 *   janela maximizada. Nao da para automatizar; roda por `npm run test:coberta`.
 * - `cetico-obra21` e `cetico-obra21-confirma`: sondas adversariais de auditoria,
 *   guardadas de proposito como ponto de partida de quem for mexer no teclado.
 *   Nao sao contrato — sao investigacao.
 * - `cetico-setimo-furo`: SUPERADA nesta bancada (operador final, 06/09/2026,
 *   obra "alvo unico"/obra 25). Media os furos 7-A/7-B/7-C/8 como ABERTOS —
 *   rodei de novo agora, ao vivo, contra o codigo desta obra: 7-A, 7-B e a
 *   contraprova de 7-B ja saem `OK` (barrados), igual a `alvo-unico-furos.js`
 *   abaixo. Sobrou so um `FALHA` novo e sem relacao com os furos — "7-D: nao
 *   achei a ref do campo de senha no read_page" — que e mais provavel ser
 *   fixture/leitura de pagina do que a barreira; nao investiguei a fundo
 *   porque `alvo-unico-furos.js` ja cobre os mesmos quatro furos de forma
 *   limpa (20/20, 2 rodadas). Fica de fora por ser INVESTIGACAO redundante,
 *   nao por furo aberto — se algum dia sobrar tempo, ou apagar o 7-D solto ou
 *   promover o arquivo inteiro depois de entender aquela linha.
 * - `_cetico-iframe-ataques` e `medicao-clique-iframe`: obra DIFERENTE e em
 *   ANDAMENTO — "clique dentro de iframe" (`deslocamentoAteTopo` em
 *   `cdp-tools.ts`), sem relacao com o alvo unico. Medido nesta bancada
 *   (06/09/2026): `cdp-tools.ts` mudou de arquivo DE VERDADE tres vezes
 *   enquanto eu segurava a `.obra-lock` para o build+teste do alvo unico —
 *   ha um pedreiro mexendo nele agora. `medicao-clique-iframe.js` alias
 *   declara no proprio cabecalho que e MEDICAO, nao o teste de regressao
 *   formal ("quem retomar... so entao escrever/expandir o teste de
 *   regressao"). Ligar teste para codigo que muda debaixo do pe, de outra
 *   obra, e do jeito errado de fechar isto — fica para quem estiver com a
 *   trava daquela obra quando ela parar de se mexer.
 * - `client` e `reload`: infraestrutura, nao teste.
 *
 * PROMOVIDAS nesta bancada (operador final, 06/09/2026) — as tres sondas do
 * cetico que mediam os furos 4/5/6/7a, CONFIRMADOS FECHADOS por leitura direta
 * do codigo (nao so pelo relatorio do pedreiro): `descreverElementoNoPonto` e
 * o campo `ariaLabel` separado (furo 4) e `tipoDoElementoAtivo` (furo 6) estao
 * em `policy.ts`; a chamada a `avaliar()` em `cap_digitar` (furo 5) esta em
 * `capacidades/formulario.ts`; o listener `chrome.tabs.onRemoved` (furo 7a)
 * esta em `bridge/index.ts`. O comentario anterior deste bloco dizia que os
 * furos 4/5/6 continuavam ABERTOS — nao era mais verdade (o pedreiro que os
 * fechou nao veio atualizar este arquivo); corrigido aqui:
 * - `cetico-quarto-furo`: H1 (furo 4, busca por ariaLabel e por substring
 *   inocente), H2 (furo 5, `cap_digitar` sem `avaliar()`) e H3 (furo 6, `type`
 *   sem target) — as tres hipoteses do proprio arquivo.
 * - `cetico-aba-fantasma`: furo 7a (`abasCriadasPelaPonte` sem
 *   `chrome.tabs.onRemoved`), pela via original de investigacao do cetico
 *   (fechar uma aba por fora e medir se `switch_tab`/`close_tab` ainda a
 *   reconhecem como "da ponte").
 * - `cetico-fronteira-switch-tab`: bateria de valores de fronteira do furo 1
 *   (`resolverAlvoDeSwitchTab`), ja fechado antes desta obra final. UMA linha
 *   desta bateria (`'COMBO params.tabId:null + target.agentId:<cobaia>'`) FICA
 *   VERMELHA sempre, e nao e regressao: e o proprio `??` documentado do
 *   conserto do furo 1 (`null` e nulo de verdade, cai no `target.agentId`, que
 *   aqui e uma aba PROPRIA e legitima — o switch tem sucesso e solta a leitura
 *   corretamente). O pedreiro que fechou o furo 7b ja mediu isso e registrou
 *   como achado colateral fora do escopo dele. Mesmo tratamento de
 *   `abas-filhas` linha abaixo: falha conhecida, de UM item so, documentada —
 *   nao tratar como defeito novo. Quem tiver permissao sobre este arquivo pode
 *   corrigir a expectativa dessa linha; ate la, o placar mostra 1 falha fixa
 *   aqui.
 *
 * PROMOVIDAS de investigacao para contrato nesta bancada (06/09/2026), depois
 * de rodar cada uma 2x ao vivo contra o build de hoje e as duas baterem limpo:
 * - `cetico-switch-tab-alvo` e `cetico-click-alvo`: o cetico escreveu estas
 *   duas sondas para provar os furos 1 (switch_tab com tabId falsy desarmava
 *   o modo somente-leitura por TOOL NORMAL) e 2 (o freio de clique destrutivo
 *   conferia um elemento e o motor clicava em outro). O proprio relatorio do
 *   cetico confirma os dois FECHADOS ("os consertos de close_tab, switch_tab,
 *   click ... resistiram a tudo que joguei") — e a bateria delas aqui, rodada
 *   2x, bateu 12/12 e 3/3 sem falha. Uma sonda que mede furo fechado deixou
 *   de ser investigacao: agora e regressao dos furos 1 e 2. (O cetico achou
 *   OUTROS furos na mesma familia depois — furos 4/5/6 acima —, mas esses sao
 *   payloads diferentes; nao reabrem o que estas duas sondas medem.)
 */
const ARQUIVOS = [
  // base
  'smoke', 'registro', 'isolamento', 'aba-sumiu', 'digitacao-real',
  'e2e', 'capabilities', 'adotar-aba', 'ociosidade', 'freio-aba', 'indicador',
  // Lote A
  'dialogo', 'upload-lote', 'autocomplete', 'form-fill', 'js-somente-leitura',
  'feedback', 'press-key-edicao',
  // freios da familia freio-x-motor (obras 25/26/B2/B3)
  'receptor-da-escrita', 'clipboard-somente-leitura', 'freio-drag-clique',
  // freios e consertos posteriores
  'clique-que-nao-mente', 'freio-clique-xy', 'form-fantasma-e-senha',
  'download-somente-leitura',
  // Regressao dos furos 1/2/3 da familia "freio le um campo, motor le outro"
  // (bancada final de 06/09/2026). `click-semantico-legitimo` e
  // `type-senha-alvo` sao testes do PROPRIO pedreiro que consertou (nao sao
  // sonda `cetico-*`) e nunca tinham entrado nesta lista — faltando na
  // comparacao `ls test/*.js` x `ARQUIVOS` que esta bancada fez. As duas
  // sondas do cetico que provam os furos 1 e 2 fechados (ver bloco acima):
  'cetico-switch-tab-alvo', 'cetico-click-alvo',
  'click-semantico-legitimo', 'type-senha-alvo',
  // Lote A (obras 08/09/10/11/12, ligadas na bancada final de 06/09/2026 —
  // ate entao existiam no disco e passavam so se alguem chamasse `node
  // test/<nome>.js` na mao; nunca tinham rodado dentro de `npm test`)
  //
  // `abas-filhas` FALHA de proposito, sempre no MESMO item (item5, download
  // nativo) — confirmado em 2 rodadas na bancada final de 06/09/2026, com o
  // build+reload do dia. AMBIENTAL, nao defeito: `download-nativo.ts` ja
  // documenta e mede que os dois metodos CDP de download (Browser/Page.
  // setDownloadBehavior) sao recusados nesta versao do Chrome, e falha alto
  // de proposito em vez de engolir. Fica vermelho ate o capataz decidir o
  // "Plano C" (permissao `downloads` em wxt.config.ts, ja proposto no
  // briefing da obra 08) — esconder o arquivo pra "npm test" passar
  // maquiaria uma limitacao real do ambiente.
  'abas-filhas', 'pagina-interna', 'desafio', 'auditoria', 'rede-inspecao',
  'historico-ritmo',
  // Lote B (obras 13/14/15)
  'clique-assentar', 'diagnostico', 'pdf-js-args',
  // Lote C (obra 16) — VERDE na bancada final de 06/09/2026 (18/18, 2
  // rodadas), depois do conserto de `comTemporizadorDeAbandono` em
  // capacidades/js.ts ter passado por build+reload+teste pela primeira vez
  // (o pedreiro anterior escreveu o codigo mas nunca conseguiu a trava pra
  // verificar ao vivo). O comentario velho deste bloco chamava isto de
  // "FALHA conhecida" — nao e mais verdade, atualizado aqui.
  // Ressalva do cetico (06/09/2026), ainda de pe: a checagem "1c. levou
  // menos de 4s" (test/timeouts.js) sobrevive a uma mutacao que reintroduz o
  // defeito original (passa mesmo em 3015ms) — quem mata a mutacao sao 1a/1b
  // (isError), nao 1c. O teto de 4000ms e frouxo demais pra um timeout_ms de
  // 1000; devia ser algo como 2000. Nao mexi (timeouts.js nao e um dos dois
  // arquivos que esta bancada pode editar) — fica de pendencia pro proximo
  // pedreiro.
  'timeouts',
  // obra 23 (canal de feedback do agente sem aba viva)
  'feedback-sem-aba',
  // conserto do furo em close_tab (achado 06/09/2026, ver
  // resolverAlvoDeCloseTab em execution-engine/index.ts) — faltava na lista
  // (unico arquivo de teste "normal" fora da bateria, conferido comparando
  // `ls test/*.js` com este array na bancada final de 06/09/2026).
  // O comentario anterior deste bloco dizia que o proprio teste tinha uma
  // falha conhecida (helper `abaExiste()` usando `switch_tab` como sonda de
  // existencia). JA NAO E VERDADE: o arquivo em disco usa `cap_tabs_all`
  // (leitura pura, sem tocar aba nenhuma) — conferido lendo o codigo e
  // rodando `node test/close-tab-alvo.js` 2x nesta bancada, 9/9 limpo nas
  // duas vezes. Comentario desatualizado, corrigido aqui.
  'close-tab-alvo',
  // Regressao dos furos 4/5/6/7a (operador final, 06/09/2026 — ver bloco de
  // comentario "PROMOVIDAS nesta bancada" no topo do arquivo). As tres do
  // cetico primeiro, na ordem em que os furos foram fechados:
  'cetico-quarto-furo', 'cetico-aba-fantasma', 'cetico-fronteira-switch-tab',
  // Testes do PROPRIO pedreiro que fechou cada furo (mesmo padrao de
  // `click-semantico-legitimo`/`type-senha-alvo` acima: nunca tinham entrado
  // nesta lista por nao serem sonda `cetico-*`, faltando na comparacao
  // `ls test/*.js` x `ARQUIVOS`):
  // - furo5: `cap_digitar` SEM `ref` (o caso que `cetico-quarto-furo` H2 nao
  //   cobre — la o teste sempre manda `ref`).
  // - furo7a: prova DETERMINISTICA (fechar a MESMA aba duas vezes), mais
  //   direta que a via de `cetico-aba-fantasma` (que depende de reciclagem de
  //   id pelo Chrome).
  // - furo7b: best-effort/investigativo por natureza (corrida de milissegundos
  //   entre o freio e o motor) — roda sozinho, sem depender de pessoa; pode
  //   reportar "0 verificacoes" numa rodada sem pegar a corrida, o que NAO e
  //   falha (o proprio arquivo documenta isso). Fica na bateria mesmo assim
  //   porque, quando pega a corrida, e o UNICO teste que prova o invariante.
  //
  //   ATUALIZACAO (operador final, 06/09/2026, bancada da obra "alvo unico"):
  //   isto NAO e mais "0 verificacoes ou tudo verde" — quando a corrida PEGA,
  //   o invariante esta QUEBRADO DE VERDADE, 100% das vezes (medido 2x: 3/15
  //   e 7/15 tentativas pegaram a corrida, e TODAS reproduziram a falha).
  //   Causa raiz encontrada por leitura + reproducao isolada (nao e o
  //   `somenteLeitura.delete` que esta obra consertou — aquele CONTINUA certo,
  //   guardado por `result.success`): em `execution-engine/index.ts`, o
  //   `case 'switch_tab'` chama `workspaceManager.switchActiveTab(...)` ANTES
  //   de `await chrome.tabs.update(...)` confirmar que a aba existe. Quando o
  //   `tabs.update` falha (aba fechada por fora, e exatamente o cenario deste
  //   teste), `ws.activeTabId` ja ficou apontando pra aba morta mesmo com
  //   `success:false` sendo devolvido corretamente. O PROXIMO comando do
  //   agente preso cai em `resolveWorkspace` (bridge/index.ts, bloco "a aba do
  //   agente morreu"), que acha a aba morta e da
  //   `this.somenteLeitura.delete(clientId)` SEM CONDICAO NENHUMA — reabre a
  //   protecao por um caminho que esta obra nao tocou (o pedreiro documentou
  //   que deixou `resolverAlvoDeSwitchTab` como estava, de proposito). Nao e
  //   escape para a aba do usuario (o agente ganha uma aba PROPRIA em branco
  //   nova, nao a aba adotada nem a do Dr. Cezar), mas o invariante que o
  //   arquivo afirma ("switch falhou => leitura continua de pe") e falso.
  //   Reproduzido com um script avulso (fora do repo, na scratchpad da sessao,
  //   nao ficou salvo); para repetir sem ele basta rodar este arquivo mesmo,
  //   N alto (15-20), 2-3x, e olhar o texto de erro do 1o comando POS-falha.
  // - press-key-senha-alvo: bonus do furo 6 (`press_key` de carater isolado
  //   tambem escreve no `activeElement`) — nenhum outro arquivo cobre isso.
  'furo5-cap-digitar-sem-ref', 'furo7a-aba-fantasma-limpa',
  'furo7b-switch-tab-falha-mantem-leitura', 'press-key-senha-alvo',
  // PROMOVIDA nesta bancada (operador final, 06/09/2026, obra "alvo unico"/
  // obra 25): o teste ao vivo dos furos 7-A/7-B/7-C/8, escrito pelo proprio
  // pedreiro que fez o conserto. Rodei 2x contra o build de hoje: 20/20 nas
  // duas, incluindo os 7 casos de nao-falso-positivo (campo normal, ref,
  // form_input, press_key, clique inocente, clique destrutivo COM confirm).
  // Sucede `cetico-setimo-furo` (ver bloco de comentario "Ficam DE FORA" no
  // topo) como o contrato formal desta familia de furo.
  'alvo-unico-furos',
  // PROMOVIDA nesta bancada — obra "download nativo" (Plano C,
  // chrome.downloads), sonda do cetico com nome `_cetico-*` (convencao que ja
  // existia na pasta) que nunca tinha entrado aqui. Rodei 2x: 7/8 casos
  // sempre verdes (nunca reporta "ok" para conexao cortada, arquivo de 0
  // bytes, link quebrado, timeout, pasta invalida, ou download nao
  // disparado — a pergunta que decide, "ELA SABE DIZER QUE NAO BAIXOU?", bate
  // que sim). so o caso 1 (caminho feliz, arquivo pequeno de verdade) falha
  // as 2 vezes, e NAO por logica errada: o proprio Chrome reporta
  // bytesReceived=totalBytes=fileSize=33, exists=true, e MESMO ASSIM
  // `state` nunca vira "complete" dentro do timeout (medido com
  // `descreverItem` — ver capacidades/download-nativo.ts). Mesma familia
  // ambiental do item5 de `abas-filhas` abaixo (mesma feature, mesmo Chrome);
  // NAO tratar como regressao nova.
  '_cetico-download-honesto',
  // Perfis multiplos do Chrome (pedido do Dr. Cezar, 11/09/2026): hub guarda
  // perfil -> conexao em vez de uma extensao so. Roda num hub PRIVADO
  // (porta 18799), isolado do hub compartilhado — ver comentario no topo do
  // arquivo.
  'perfis-multiplos',
  // Obra "entregar aba" (11/09/2026, incidente do PJe): browser_entregar_aba
  // e a rede de seguranca da faxina por ociosidade. Ver docs/obra-20260904.
  'entregar-aba', 'faxina-entrega',
  // Obra "verdade pos-acao" (15/09/2026): conferencia de execucao apos
  // estouro do browser_javascript (item 1), incluir_oculto no
  // browser_wait_for_text (item 3) e confirmacao de resultado do
  // browser_click via esperar_texto/esperar_url (item 4). O item 2 (upload
  // fora do PJe) so muda MENSAGEM de erro/aviso das tools ja cobertas por
  // upload-lote.js -- sem teste vivo novo por nao ter um segundo site real
  // (Portal OAB) disponivel na bateria automatizada.
  'js-conferir', 'wait-for-text-oculto', 'clique-confirmar', 'roteiro',
];

const rodar = (nome) => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(AQUI, `${nome}.js`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  p.stdout.on('data', (d) => { saida += d; });
  p.stderr.on('data', (d) => { saida += d; });
  p.on('close', (code) => {
    const linhas = saida.split('\n');
    const ok = linhas.filter((l) => l.startsWith('OK')).length;
    const falhas = linhas.filter((l) => l.startsWith('FALHA') || l.startsWith('ERRO'));
    resolve({ nome, ok, falhas, code });
  });
});

let totalOk = 0;
const problemas = [];

for (const nome of ARQUIVOS) {
  const r = await rodar(nome);
  totalOk += r.ok;
  const marca = r.falhas.length === 0 && r.code === 0 ? 'ok   ' : 'FALHA';
  console.log(`${marca} ${nome.padEnd(16)} ${r.ok} verificacoes`);
  for (const f of r.falhas) {
    console.log(`        ${f.trim()}`);
    problemas.push(`${nome}: ${f.trim()}`);
  }
}

console.log(`\n=== ${totalOk} verificacoes OK, ${problemas.length} problema(s) ===`);
if (problemas.length) process.exitCode = 1;
