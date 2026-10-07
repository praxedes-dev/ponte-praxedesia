/**
 * Obra 22 — canal de feedback do agente.
 * docs/obra-20260904/00-PLANO-DE-OBRA.md §21 (sem briefing proprio — o escopo
 * inteiro esta la). Desenho completo em
 * entrypoints/background/bridge/capacidades/feedback.ts.
 *
 * Contrato testado:
 *  1. relato vazio e recusado, citando os campos que faltam;
 *  2. relato com respostas genericas ("erro", "nao sei"...) tambem e recusado
 *     mesmo sem estar vazio — e "vago" que a obra pede, nao so "ausente";
 *  3. o_que_veio identico a o_que_eu_esperava e recusado (nao e uma quebra);
 *  4. tipo fora do enum e recusado;
 *  5. relato BOM e aceito, aparece no arquivo com contagem por tool;
 *  6. bridge_feedback_ler agrupa por tool e por hostname, e o filtro por tool funciona;
 *  7. o FILTRO DE RUIDO (mensagemEhRuido/MARCADORES_ESPERADOS) nunca deixa os
 *     quatro tipos de erro intencional virarem relato automatico:
 *     [somente leitura], [bloqueado], [dialogo aberto] e timeout de
 *     transporte ("estourou Ns sem resposta") — sao o freio funcionando como
 *     desenhado, nao defeito;
 *  8. o CONTRAPONTO do 7: um erro real da ponte (nao um dos quatro de cima)
 *     vira relato sozinho, sem o agente chamar bridge_feedback — sem este
 *     caso, o 7 seria satisfeito por um filtro que barra tudo;
 *  9. dedupe: o MESMO erro repetido em seguida nao dobra a contagem automatica.
 *
 *   node test/feedback.js
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

// Arquivo de dados real da ponte, fora do repo (~/.praxedes-bridge/). So
// existe a partir desta obra — seguro zerar para o teste ter contagem
// previsivel (nao e token nem config, e o proprio dado que a obra grava).
const ARQUIVO = join(homedir(), '.praxedes-bridge', 'feedback.jsonl');
if (existsSync(ARQUIVO)) rmSync(ARQUIVO);

/**
 * Conta ocorrencias exatas de uma marca no arquivo — direto no disco, nao no
 * resumo de texto do MCP (que so mostra os 5 mais recentes por tool). Outros
 * tres pedreiros compartilham este MESMO Chrome agora (obras 04/20/21) e
 * geram captura automatica propria (medido nesta rodada: `cap_dialogo` de
 * outro agente ja apareceu no arquivo durante este teste) — contar por
 * MARCA UNICA, nao pelo total do grupo, e o que torna o teste imune a esse
 * ruido concorrente.
 */
function contarNoArquivo(marca) {
  if (!existsSync(ARQUIVO)) return 0;
  return readFileSync(ARQUIVO, 'utf8').split('\n').filter((l) => l.includes(marca)).length;
}

const relatoBase = {
  tipo: 'mentiu',
  tool: 'browser_type',
  o_que_eu_queria: 'preencher o campo CPF com 11122233344',
  o_que_eu_chamei: 'browser_type { ref: 7, texto: "11122233344" }',
  o_que_veio: '{ ok: true, lido: "111.222.333" }',
  o_que_eu_esperava: 'lido deveria ser "11122233344" (o texto que mandei)',
  como_descobri: 'conferi o campo "lido" na propria resposta',
};

const c = startClient('teste-feedback');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  // ── 1. relato com todos os campos vazios ──────────────────────────────────
  const vazio = await c.call('tools/call', {
    name: 'bridge_feedback',
    arguments: {
      ...relatoBase,
      o_que_eu_queria: '', o_que_eu_chamei: '', o_que_veio: '', o_que_eu_esperava: '', como_descobri: '',
    },
  });
  const msgVazio = vazio.result.content[0].text;
  check(vazio.result.isError === true, 'relato com campos vazios e recusado', msgVazio.slice(0, 140));
  check(msgVazio.includes('o_que_eu_queria'), 'a recusa cita o_que_eu_queria');
  check(msgVazio.includes('o_que_veio'), 'a recusa cita o_que_veio');
  check(msgVazio.includes('como_descobri'), 'a recusa cita como_descobri');

  // ── 2. respostas genericas, nao vazias — "vago" != so "ausente" ───────────
  const vago = await c.call('tools/call', {
    name: 'bridge_feedback',
    arguments: {
      tipo: 'erro', tool: 'browser_click', o_que_eu_queria: 'clicar',
      o_que_eu_chamei: 'cliquei no botao', o_que_veio: 'erro', o_que_eu_esperava: 'funcionar',
      como_descobri: 'nao sei',
    },
  });
  check(vago.result.isError === true, 'respostas genericas ("erro", "nao sei"...) tambem sao recusadas',
    vago.result.content[0].text.slice(0, 160));

  // ── 3. o_que_veio igual a o_que_eu_esperava — nao e uma quebra ────────────
  const identico = await c.call('tools/call', {
    name: 'bridge_feedback',
    arguments: {
      ...relatoBase,
      tipo: 'confuso', tool: 'browser_read_page', o_que_veio: 'a arvore com 40 elementos',
      o_que_eu_esperava: 'a arvore com 40 elementos',
    },
  });
  check(identico.result.isError === true, 'o_que_veio igual a o_que_eu_esperava e recusado',
    identico.result.content[0].text.slice(0, 160));

  // ── 4. tipo fora do enum ───────────────────────────────────────────────────
  const tipoRuim = await c.call('tools/call', {
    name: 'bridge_feedback',
    arguments: { ...relatoBase, tipo: 'reclamacao' },
  });
  check(tipoRuim.result.isError === true, 'tipo fora do enum e recusado', tipoRuim.result.content[0].text.slice(0, 160));

  // ── 5. relato BOM: aceito, contagem por tool ──────────────────────────────
  const bom1 = await c.tool('bridge_feedback', relatoBase);
  const textoBom1 = bom1.content[0].text;
  check(!bom1.isError, 'relato bem preenchido e aceito', textoBom1);
  check(textoBom1.includes('registrado'), 'a confirmacao diz "registrado"');
  check(textoBom1.includes('1 relato'), 'a confirmacao conta 1 relato para browser_type', textoBom1);

  const bom2 = await c.tool('bridge_feedback', {
    ...relatoBase,
    tipo: 'faltou',
    tool: 'browser_upload_lote',
    o_que_eu_queria: 'anexar 3 arquivos de uma vez no PJe',
    o_que_eu_chamei: 'procurei uma tool de upload em lote e nao achei nenhuma',
    o_que_veio: 'so existe browser_upload_file, um arquivo por vez',
    o_que_eu_esperava: 'uma tool que aceite uma lista de caminhos',
    como_descobri: 'precisei repetir o ciclo de 5 passos 3 vezes',
  });
  check(!bom2.isError, 'segundo relato bom (tool diferente) tambem e aceito', bom2.content[0].text);

  // ── 6. bridge_feedback_ler agrupa por tool e por hostname; filtro funciona ─
  const resumo = await c.tool('bridge_feedback_ler', {});
  const textoResumo = resumo.content[0].text;
  check(textoResumo.includes('browser_type'), 'o resumo lista browser_type', textoResumo.slice(0, 200));
  check(textoResumo.includes('browser_upload_lote'), 'o resumo lista browser_upload_lote', textoResumo.slice(0, 200));
  check(/example\.com/.test(textoResumo), 'o resumo mostra o hostname (example.com)', textoResumo.slice(0, 300));

  const resumoFiltrado = await c.tool('bridge_feedback_ler', { tool: 'browser_type' });
  const textoFiltrado = resumoFiltrado.content[0].text;
  check(textoFiltrado.includes('browser_type'), 'o filtro por tool mostra a tool pedida');
  check(!textoFiltrado.includes('browser_upload_lote'), 'o filtro por tool ESCONDE as outras tools', textoFiltrado.slice(0, 200));

  // ── 7. filtro de ruido: os quatro tipos de erro INTENCIONAL nunca viram relato automatico ──
  // (mutation: esvaziar MARCADORES_ESPERADOS e/ou apagar a checagem de timeout
  // de transporte em mensagemEhRuido faz os 4 sub-casos abaixo ficarem vermelhos.)
  {
    const MARCA_LEITURA = 'example.org'; // hostname proprio deste sub-caso — nenhum outro teste usa .org
    const MARCA_BLOQUEADO = 'RUIDO-BLOQUEADO-042';
    const MARCA_DIALOGO = 'RUIDO-DIALOGO-777';
    const MARCA_TRANSPORTE = 'RUIDO-TRANSPORTE-909';

    // -- [somente leitura]: sessao AUXILIAR e descartavel — adotar uma aba
    //    (mesmo a propria, criada na hora) via browser_use_tab muda para
    //    sempre qual e a "aba propria" da sessao (browser_use_own_tab so
    //    volta para a PRIMEIRA aba que a sessao teve). Fazer isso na sessao
    //    principal `c` quebraria os casos seguintes, que dependem de
    //    continuar na aba https://example.com aberta no topo do arquivo.
    {
      const c2 = startClient('teste-feedback-ruido-leitura');
      try {
        await c2.handshake();
        if (!(await esperarExtensao(c2))) throw new Error('extensao nao conectou (sessao auxiliar)');
        await c2.tool('browser_tab_open', { url: 'https://example.org' });
        await c2.tool('browser_wait_network', {}).catch(() => {});
        const cobaia = (await c2.json('browser_tabs_list')).activeTabId;
        const olhar = (await c2.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
        check(/somente leitura/i.test(olhar), 'ruido: aba-cobaia entrou em modo somente leitura (pre-condicao)',
          olhar.slice(0, 70));

        const tentativa = await c2.call('tools/call', {
          name: 'browser_navigate', arguments: { url: 'https://example.org/outra-pagina' },
        });
        check(tentativa.result?.isError === true && /\[somente leitura\]/.test(tentativa.result.content[0].text),
          'ruido: navegar na aba-cobaia e barrado com [somente leitura] (pre-condicao)',
          tentativa.result?.content?.[0]?.text?.slice(0, 90));
      } finally {
        c2.close();
      }
    }

    // -- [bloqueado]: clique em botao com texto destrutivo, sem confirm (o
    //    freio de policy.ts, regra 4 — nao depende de host financeiro).
    await c.tool('browser_javascript', {
      codigo: `(function(){
        document.body.innerHTML =
          '<button aria-label="${MARCA_BLOQUEADO}">Excluir ${MARCA_BLOQUEADO}</button>';
        return 'montado';
      })()`,
    });
    await sleep(150);
    const paginaBtn = (await c.tool('browser_read_page')).content[0].text;
    const refBtn = Number(paginaBtn.split('\n').find((l) => l.includes(MARCA_BLOQUEADO))?.match(/\[(\d+)\]/)?.[1]);
    check(Number.isFinite(refBtn), 'ruido: achou o ref do botao destrutivo (pre-condicao)', `ref=${refBtn}`);
    const cliqueBloqueado = await c.call('tools/call', { name: 'browser_click', arguments: { ref: refBtn } });
    check(cliqueBloqueado.result?.isError === true && /\[bloqueado\]/.test(cliqueBloqueado.result.content[0].text ?? ''),
      'ruido: clique destrutivo sem confirm e barrado com [bloqueado] (pre-condicao)',
      cliqueBloqueado.result?.content?.[0]?.text?.slice(0, 140));

    // -- [dialogo aberto]: confirm() agendado; resolvido no finally, senao a
    //    aba fica travada para os proximos casos deste arquivo.
    try {
      await c.tool('browser_javascript', {
        codigo: `setTimeout(() => { window.__rRuido = confirm('${MARCA_DIALOGO}'); }, 200); 'agendado'`,
      });
      let dialogoAberto;
      for (let i = 0; i < 8; i += 1) {
        dialogoAberto = await c.call('tools/call', { name: 'browser_read_page', arguments: {} });
        if (dialogoAberto.result?.isError) break;
        await sleep(300);
      }
      check(dialogoAberto?.result?.isError === true && /dialogo aberto/i.test(dialogoAberto.result.content[0].text ?? ''),
        'ruido: dialogo nativo aberto barra o comando seguinte com [dialogo aberto] (pre-condicao)',
        dialogoAberto?.result?.content?.[0]?.text?.slice(0, 90));
    } finally {
      await c.call('tools/call', { name: 'browser_dialog', arguments: { aceitar: false } });
    }

    // -- timeout de transporte: a checagem NAO tem "^" (o texto pode vir
    //    embutido em qualquer mensagem) — cap_js serve de gatilho controlado,
    //    sem esperar os 60s de verdade do timeout de hub.js.
    const jsTransporte = await c.call('tools/call', {
      name: 'browser_javascript',
      arguments: { codigo: `throw new Error('${MARCA_TRANSPORTE} estourou 5s sem resposta')` },
    });
    check(jsTransporte.result?.isError === true && /estourou 5s sem resposta/.test(jsTransporte.result.content[0].text ?? ''),
      'ruido: erro com o texto de timeout de transporte realmente falha (pre-condicao)',
      jsTransporte.result?.content?.[0]?.text?.slice(0, 160));

    // Drena tudo de uma vez (o buffer automatico e global — de qualquer
    // sessao) e confere que NENHUM dos quatro virou relato.
    await sleep(300);
    await c.tool('bridge_feedback_ler', {});
    const conteudoRuido = existsSync(ARQUIVO) ? readFileSync(ARQUIVO, 'utf8') : '';
    check(!conteudoRuido.includes(MARCA_LEITURA), 'ruido: [somente leitura] NAO virou relato automatico');
    check(!conteudoRuido.includes(MARCA_BLOQUEADO), 'ruido: [bloqueado] NAO virou relato automatico');
    check(!conteudoRuido.includes(MARCA_DIALOGO), 'ruido: [dialogo aberto] NAO virou relato automatico');
    check(!conteudoRuido.includes(MARCA_TRANSPORTE), 'ruido: timeout de transporte NAO virou relato automatico');
  }

  // ── 8. captura automatica: erro real de verdade (excecao no JS), sem o agente chamar bridge_feedback ──
  // browser_click com ref invalido NAO falha (medido nesta rodada: resolve
  // por backendNodeId da arvore de acessibilidade e devolve ok mesmo sem
  // elemento) — browser_javascript com referencia inexistente e o gatilho
  // confiavel: cap_js (entrypoints/.../capacidades/js.ts) relanca QUALQUER
  // excecao do V8 como `erro no script: ...`.
  const MARCA_A = 'marcaFeedbackAlfa999';
  const jsRuim = await c.call('tools/call', { name: 'browser_javascript', arguments: { codigo: `${MARCA_A}.propriedade` } });
  check(jsRuim.result.isError === true, 'JS com referencia inexistente realmente falha (pre-condicao do teste)',
    jsRuim.result.content[0].text.slice(0, 160));

  await sleep(300); // o gancho `depois` roda antes da resposta, mas da uma folga por seguranca
  await c.tool('bridge_feedback_ler', {}); // forca cap_feedback_drenar -> anexarLinha no arquivo
  const linhaA = existsSync(ARQUIVO)
    ? readFileSync(ARQUIVO, 'utf8').split('\n').find((l) => l.includes(MARCA_A))
    : undefined;
  check(Boolean(linhaA), 'apareceu um relato automatico no arquivo sem o agente chamar bridge_feedback',
    linhaA?.slice(0, 200) ?? '(nada gravado)');
  if (linhaA) {
    const registroA = JSON.parse(linhaA);
    check(registroA.origem === 'automatica', 'o relato automatico tem origem "automatica"', registroA.origem);
    check(registroA.tool === 'cap_js', 'o relato automatico cita a tool certa (cap_js)', registroA.tool);
    check(registroA.hostname === 'example.com', 'o relato automatico tem o hostname certo', registroA.hostname);
  }
  check(contarNoArquivo(MARCA_A) === 1, 'exatamente 1 relato automatico gravado para este erro',
    `contagem=${contarNoArquivo(MARCA_A)}`);

  // ── 9. dedupe: o MESMO erro repetido na janela nao dobra a contagem ───────
  await c.call('tools/call', { name: 'browser_javascript', arguments: { codigo: `${MARCA_A}.propriedade` } });
  await sleep(300);
  await c.tool('bridge_feedback_ler', {});
  check(contarNoArquivo(MARCA_A) === 1, 'repetir o MESMO erro na janela de dedupe nao cria um segundo relato automatico',
    `contagem=${contarNoArquivo(MARCA_A)} (esperado 1, igual antes)`);

  // Erro DIFERENTE (outra variavel) para confirmar que o dedupe e por chave, nao uma trava geral.
  const MARCA_B = 'marcaFeedbackBeta777';
  await c.call('tools/call', { name: 'browser_javascript', arguments: { codigo: `${MARCA_B}.outraCoisa` } });
  await sleep(300);
  await c.tool('bridge_feedback_ler', {});
  check(contarNoArquivo(MARCA_B) === 1, 'um erro DIFERENTE gera um relato automatico proprio (dedupe e por chave, nao geral)',
    `contagem=${contarNoArquivo(MARCA_B)}`);
  check(contarNoArquivo(MARCA_A) === 1, 'o erro A continua com 1 so relato depois do erro B (nao interferiu)',
    `contagem=${contarNoArquivo(MARCA_A)}`);
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
