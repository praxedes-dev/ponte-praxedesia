/**
 * Correcao 3 do pedreiro de 05/09/2026 (docs/obra-20260904/00-PLANO-DE-OBRA.md,
 * bancada da obra 22/23) — bridge_feedback/bridge_feedback_ler NAO podem
 * depender de aba viva.
 *
 * Medido antes do conserto: `resolveWorkspace` (bridge/index.ts, ~582-606)
 * lancava `[aba trocou]` para QUALQUER `cmd.action` quando a aba do agente
 * tinha morrido — inclusive para quem estava chamando bridge_feedback para
 * relatar exatamente isso. E o pior momento para a ferramenta falhar: o
 * agente quer relatar que algo quebrou, e a propria aba dele e a vitima.
 *
 * Este teste reusa o padrao de test/aba-sumiu.js (agente B fecha a aba de A
 * "por fora") mas em vez de mandar A ler a pagina (que DEVE continuar
 * falhando alto — aba-sumiu.js ja cobre isso), manda A chamar bridge_feedback
 * e bridge_feedback_ler, que DEVEM funcionar normalmente, sem "[aba trocou]".
 *
 *   node test/feedback-sem-aba.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const a = startClient('agente-A-feedback-sem-aba');
const b = startClient('agente-B-feedback-sem-aba');

// Nome de tool UNICO por execucao: o arquivo ~/.praxedes-bridge/feedback.jsonl
// e compartilhado por TODOS os pedreiros rodando agora (mesma convencao de
// test/feedback.js) — filtrar por um nome que so esta execucao usa evita
// contar relato de outra rodada (ou desta mesma rodada de antes) por engano.
const TOOL_MARCADA = `browser_read_page_teste_correcao3_${Date.now()}`;

// Nota: o texto dos campos abaixo evita a sequencia "aba trocou" de proposito
// — a asercao mais adiante confere que a RESPOSTA da propria tool nao carrega
// esse marcador, e um fixture que o citasse literalmente no o_que_veio (o
// resumo devolve os campos de volta) daria falso alarme na asercao.
const relato = {
  tipo: 'erro',
  tool: TOOL_MARCADA,
  o_que_eu_queria: 'ler a pagina depois que minha aba morreu',
  o_que_eu_chamei: 'browser_read_page sem argumentos',
  o_que_veio: 'erro dizendo que a aba antiga sumiu e foi fechada por fora',
  o_que_eu_esperava: 'poder relatar isso sem a ferramenta de relato tambem depender de aba viva',
  como_descobri: 'a chamada anterior falhou por causa da aba morta',
};

try {
  await a.handshake();
  if (!(await esperarExtensao(a))) throw new Error('extensao nao conectou');
  await b.handshake();

  await a.tool('browser_navigate', { url: 'https://example.com' });
  await a.tool('browser_wait_for_text', { text: 'Example Domain', timeout_ms: 20_000 });
  const infoA = await a.json('browser_tabs_list');
  const abaA = infoA.activeTabId;

  // B fecha a aba de A "por fora" — mesmo cenario de aba-sumiu.js.
  await b.tool('browser_tab_close', { tabId: abaA });
  await sleep(800);

  // bridge_feedback: NAO pode falhar com [aba trocou]. Deve registrar normal.
  const resultadoFeedback = await a.call('tools/call', { name: 'bridge_feedback', arguments: relato });
  const textoFeedback = resultadoFeedback.result.content[0].text;
  check(resultadoFeedback.result.isError !== true,
    'bridge_feedback funciona mesmo com a aba do agente morta (nao depende de aba viva)',
    textoFeedback.slice(0, 160));
  check(!textoFeedback.startsWith('[aba trocou]'), 'a resposta NAO e o erro [aba trocou]',
    textoFeedback.slice(0, 160));
  check(textoFeedback.includes('registrado'), 'o relato foi mesmo registrado', textoFeedback.slice(0, 160));

  // bridge_feedback_ler: mesma garantia, a leitura tambem nao pode depender de aba viva.
  // A aba de A ja foi recriada (em branco, na janela da ponte) pelo proprio
  // resolveWorkspace durante a chamada acima — mata-la de novo prova que a
  // excecao vale em qualquer rodada, nao so na primeira.
  const infoDepoisDoFeedback = await a.json('browser_tabs_list');
  await b.tool('browser_tab_close', { tabId: infoDepoisDoFeedback.activeTabId });
  await sleep(800);

  const resultadoLer = await a.call('tools/call', { name: 'bridge_feedback_ler', arguments: { tool: TOOL_MARCADA } });
  const textoLer = resultadoLer.result.content[0].text;
  check(resultadoLer.result.isError !== true,
    'bridge_feedback_ler tambem funciona com a aba do agente morta', textoLer.slice(0, 160));
  check(!textoLer.startsWith('[aba trocou]'), 'a leitura NAO e o erro [aba trocou]', textoLer.slice(0, 160));
  check(textoLer.includes(TOOL_MARCADA), 'a leitura mostra o relato que acabou de gravar (filtrado pelo nome unico desta rodada)',
    textoLer.slice(0, 220));

  // Controle: uma acao NORMAL (nao-feedback) continua falhando alto quando a
  // aba morre — a excecao e so para as duas capacidades de feedback, nao para
  // tudo. Sem este controle, um bug que abrisse a excecao para QUALQUER acao
  // passaria despercebido (e reintroduziria o incidente de 03/09/2026).
  const infoAntesDoControle = await a.json('browser_tabs_list');
  await b.tool('browser_tab_close', { tabId: infoAntesDoControle.activeTabId });
  await sleep(800);
  const controle = await a.call('tools/call', { name: 'browser_read_page', arguments: {} });
  check(controle.result.isError === true && /\[aba trocou\]/.test(controle.result.content[0].text),
    'controle: uma acao normal (browser_read_page) CONTINUA falhando alto com [aba trocou]',
    controle.result.content[0].text.slice(0, 100));
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  a.close();
  b.close();
}
