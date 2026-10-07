/**
 * Obra 22 — canal de feedback DO AGENTE (docs/obra-20260904/00-PLANO-DE-OBRA.md §21).
 * Desenho completo em entrypoints/background/bridge/capacidades/feedback.ts.
 *
 * Quem grava em disco e este arquivo, porque e o lado que RODA em Node — a
 * extensao (MV3) nao tem sistema de arquivos. `~/.praxedes-bridge/feedback.jsonl`,
 * uma linha JSON por relato: formato que aguenta varias sessoes de agente
 * escrevendo ao mesmo tempo (append de string curta e uma unica syscall de
 * escrita, atomica na pratica para o tamanho de um relato).
 *
 * Os dois tools continuam no padrao action/build/formatar de qualquer outro
 * arquivo desta pasta (ver tools/dialogo.js): `link.send()` fala com a
 * extensao normalmente, e `formatar(data, input)` — ja generico em
 * src/index.js — e o unico lugar novo: em vez de so devolver texto, ele
 * TAMBEM anexa a linha no arquivo. Nao precisou de mecanismo novo em
 * src/index.js (que so tem `gravaEm`, para bytes binarios sobrescrevendo o
 * arquivo — errado para um log que cresce por append).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONFIG_DIR } from '../token.js';

const ARQUIVO = join(CONFIG_DIR, 'feedback.jsonl');

function anexarLinha(registro) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  appendFileSync(ARQUIVO, `${JSON.stringify(registro)}\n`, 'utf8');
}

/** Nunca deixa uma linha corrompida (escrita pela metade, disco cheio no meio) derrubar a leitura das outras — so essa linha some do relatorio. */
function lerTodos() {
  if (!existsSync(ARQUIVO)) return [];
  const bruto = readFileSync(ARQUIVO, 'utf8');
  const registros = [];
  for (const linha of bruto.split('\n')) {
    const l = linha.trim();
    if (!l) continue;
    try {
      registros.push(JSON.parse(l));
    } catch {
      // linha corrompida: ignora, nao derruba a leitura das demais.
    }
  }
  return registros;
}

function formatarResumo(todos, filtro = {}) {
  let filtrada = todos;
  if (filtro.tool) filtrada = filtrada.filter((r) => r.tool === filtro.tool);
  if (filtro.hostname) filtrada = filtrada.filter((r) => r.hostname === filtro.hostname);

  if (filtrada.length === 0) {
    return todos.length === 0
      ? 'nenhum relato registrado ainda. bridge_feedback grava um; esta chamada tambem ja drenou a captura automatica pendente na extensao (nenhuma agora).'
      : `nenhum relato bate com o filtro (${todos.length} no total, sem filtro).`;
  }

  const porTool = new Map();
  for (const r of filtrada) {
    const chave = r.tool || '(sem tool)';
    if (!porTool.has(chave)) porTool.set(chave, []);
    porTool.get(chave).push(r);
  }

  const linhas = [
    `${filtrada.length} relato(s)${filtrada.length !== todos.length ? ` (de ${todos.length} sem filtro)` : ''}, agrupados por tool:`,
    '',
  ];

  const porToolOrdenado = [...porTool.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [tool, registros] of porToolOrdenado) {
    const porHost = new Map();
    for (const r of registros) {
      const h = r.hostname || '(sem host)';
      porHost.set(h, (porHost.get(h) || 0) + 1);
    }
    const resumoHosts = [...porHost.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([h, n]) => `${n} em ${h}`)
      .join(', ');
    linhas.push(`${tool}: ${registros.length} relato(s) — ${resumoHosts}`);

    // So os 5 mais recentes por tool: agrupar e para virar pauta, nao para
    // repetir o arquivo inteiro na resposta e comer a janela do agente.
    for (const r of registros.slice(-5)) {
      const marca = r.origem === 'automatica' ? '[automatico]' : `[${r.tipo}]`;
      const resumo = r.origem === 'automatica'
        ? r.mensagem
        : `esperava "${r.o_que_eu_esperava}", veio "${r.o_que_veio}"`;
      linhas.push(`  ${marca} ${r.hora || ''} ${r.hostname || ''} — ${String(resumo ?? '').slice(0, 160)}`);
    }
  }

  return linhas.join('\n');
}

export const TOOLS = [
  {
    name: 'bridge_feedback',
    description:
      'Registra um relato SEU sobre uma tool da ponte — erro, resposta que mentiu ("ok" mas nao fez), '
      + 'algo que faltou, ou algo confuso. NAO e para reclamar do site que voce esta operando: e sobre a '
      + 'PROPRIA PONTE (extensao/MCP). Cada campo precisa do dado concreto, nao um resumo — relato vago '
      + '(campo vazio, generico como "nao funcionou", ou o_que_veio igual a o_que_eu_esperava) e RECUSADO, '
      + 'com a lista do que falta para tentar de novo. A ponte preenche sozinha URL, hostname, aba, agente, '
      + 'hora e versao do build — voce so escreve o julgamento. Use bridge_feedback_ler para ver o que ja '
      + 'foi relatado antes de comecar um lote de obras ou uma sessao longa no mesmo tipo de tarefa.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['erro', 'mentiu', 'faltou', 'confuso'],
          description:
            '"erro" = a tool falhou ou o navegador quebrou. "mentiu" = devolveu ok/sucesso mas o efeito '
            + 'nao aconteceu. "faltou" = capacidade que voce precisava nao existe. "confuso" = a tool '
            + 'existe e funcionou, mas o nome, a descricao ou o formato da resposta enganam.',
        },
        tool: { type: 'string', description: 'Nome exato da tool (ex: browser_upload_file).' },
        o_que_eu_queria: { type: 'string', description: 'O objetivo: o que voce estava tentando fazer.' },
        o_que_eu_chamei: { type: 'string', description: 'A chamada exata que voce fez — tool e argumentos.' },
        o_que_veio: { type: 'string', description: 'A resposta EXATA que voltou — cole o texto ou erro, nao resuma.' },
        o_que_eu_esperava: { type: 'string', description: 'O que deveria ter voltado, na sua leitura da tool.' },
        como_descobri: {
          type: 'string',
          description: 'O que te fez perceber a diferenca (ex: conferi na tela, o valor lido de volta nao bateu).',
        },
      },
      required: [
        'tipo', 'tool', 'o_que_eu_queria', 'o_que_eu_chamei', 'o_que_veio', 'o_que_eu_esperava', 'como_descobri',
      ],
    },
    action: 'cap_feedback',
    build: (i) => ({
      params: {
        tipo: i.tipo,
        tool: i.tool,
        o_que_eu_queria: i.o_que_eu_queria,
        o_que_eu_chamei: i.o_que_eu_chamei,
        o_que_veio: i.o_que_veio,
        o_que_eu_esperava: i.o_que_eu_esperava,
        como_descobri: i.como_descobri,
      },
    }),
    formatar(data) {
      anexarLinha(data);
      const totalDaTool = lerTodos().filter((r) => r.tool === data.tool).length;
      const local = data.hostname ? ` (este em ${data.hostname})` : '';
      return `registrado. ja sao ${totalDaTool} relato(s) para "${data.tool}"${local}.`;
    },
  },
  {
    name: 'bridge_feedback_ler',
    description:
      'Le os relatos de bridge_feedback, agrupados por tool e por hostname — para virar pauta '
      + '("browser_upload_file: 7 relatos, 5 em pje.jus.br"), nao um deposito que ninguem le. Antes de '
      + 'agrupar, drena a captura AUTOMATICA que a propria ponte grava quando uma tool devolve erro que '
      + 'nao e nem timeout de rede nem o freio funcionando como desenhado. Chame sem filtro para ver tudo, '
      + 'ou com `tool`/`hostname` para focar. Leia isto como primeiro passo de qualquer rodada de obras '
      + 'nesta ponte, do mesmo jeito que se le um HANDOFF-*.md antes de comecar.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Filtra so os relatos desta tool.' },
        hostname: { type: 'string', description: 'Filtra so os relatos deste hostname.' },
      },
    },
    action: 'cap_feedback_drenar',
    build: () => ({ params: {} }),
    formatar(data, input) {
      for (const registro of Array.isArray(data) ? data : []) anexarLinha(registro);
      return formatarResumo(lerTodos(), input);
    },
  },
];
