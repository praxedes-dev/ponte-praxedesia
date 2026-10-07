#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { BridgeLink, HOST, PORT } from './hub.js';
import { TOOLS, TOOL_BY_NAME } from './tools.js';
import { formatarPagina, procurar } from './format.js';
import { getToken } from './token.js';
import { ROTEIRO_TOOL, executarRoteiro } from './roteiro.js';
import { MIDIA_TOOL, baixarMidia } from './midia.js';
import { UPLOAD_CLIQUE_TOOL, uploadPorClique } from './upload-clique.js';
import { FLOW_TOOLS, executarFlow } from './flow.js';

// stdout pertence ao protocolo MCP. Todo log vai para stderr.
const log = (msg) => process.stderr.write(`[praxedes-bridge] ${msg}\n`);

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const clientName = argValue('--name', process.env.PRAXEDES_BRIDGE_NAME || basename(process.cwd()));
const clientId = randomUUID().slice(0, 8);

const link = new BridgeLink({ clientId, name: clientName, token: getToken() });
link.on('log', log);
link.on('role', (role) => log(`papel: ${role}`));
link.on('extension', (online) => log(online ? 'extensao online' : 'extensao offline'));

const STATUS_TOOL = {
  name: 'browser_status',
  description:
    'Diagnostico da ponte: se a extensao PraxedesIA esta conectada, qual o papel deste processo '
    + '(hub ou peer), quantos agentes compartilham o Chrome agora, quais PERFIS (extensoes/Chrome) '
    + 'estao conectados e qual e o perfil ATIVO desta sessao. Chame isto primeiro quando algo falhar, '
    + 'ou para conferir o nome exato de um perfil antes de browser_usar_perfil.',
  inputSchema: { type: 'object', properties: {} },
};

const USAR_PERFIL_TOOL = {
  name: 'browser_usar_perfil',
  description:
    'Escolhe qual perfil do Chrome (qual extensao conectada) recebe os comandos desta sessao a partir '
    + 'de agora — por exemplo "escritorio" para operar o WhatsApp Web do escritorio, mantendo outra '
    + 'sessao no perfil pessoal. Sem chamar isto a sessao fica no perfil "padrao" (o de sempre). Todo '
    + 'comando desta sessao vai so para o perfil ativo — se ele cair, a acao falha dizendo qual perfil '
    + 'faltou, nunca migra sozinha para outro. Confira os nomes conectados com browser_status.',
  inputSchema: {
    type: 'object',
    properties: {
      perfil: {
        type: 'string',
        description: 'Nome do perfil, igual ao definido nas opcoes da extensao daquele Chrome (ex.: "padrao", "escritorio").',
      },
    },
    required: ['perfil'],
  },
};

const server = new Server(
  { name: 'praxedes-bridge', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    STATUS_TOOL,
    USAR_PERFIL_TOOL,
    { ...ROTEIRO_TOOL, inputSchema: comAba(ROTEIRO_TOOL.inputSchema) },
    { ...MIDIA_TOOL, inputSchema: comAba(MIDIA_TOOL.inputSchema) },
    { ...UPLOAD_CLIQUE_TOOL, inputSchema: comAba(UPLOAD_CLIQUE_TOOL.inputSchema) },
    ...FLOW_TOOLS.map((t) => ({ ...t, inputSchema: comAba(t.inputSchema) })),
    ...TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: comAba(inputSchema) })),
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: input = {} } = req.params;

  if (name === 'browser_status') {
    // O peer pergunta ao hub em vez de responder "desconhecido": quem esta longe
    // da extensao ainda precisa saber se ela esta no ar.
    return textResult(JSON.stringify({
      agente: clientName,
      clientId,
      ...(await link.estado()),
    }, null, 2));
  }

  if (name === 'browser_usar_perfil') {
    const nome = String(input.perfil || '').trim();
    if (!nome) return errorResult('informe o nome do perfil (ex.: "padrao", "escritorio")');
    const ativo = link.usarPerfil(nome);
    return textResult(`perfil ativo desta sessao agora: "${ativo}"`);
  }

  if (name === ROTEIRO_TOOL.name) {
    const relatorio = await executarRoteiro(input, (n, a, o) => rodarTool(n, input.aba !== undefined && a?.aba === undefined ? { ...a, aba: input.aba } : a, o));
    const texto = JSON.stringify(relatorio, null, 2);
    return relatorio.ok ? textResult(texto) : errorResult(texto);
  }

  if (FLOW_TOOLS.some((t) => t.name === name)) {
    try {
      const rel = await executarFlow(name, input, rodarTool, (acao, args, timeout) => link.send(acao, args, timeout), uploadPorClique);
      return textResult(JSON.stringify(rel, null, 1));
    } catch (err) {
      return errorResult(err.message);
    }
  }

  if (name === UPLOAD_CLIQUE_TOOL.name) {
    try {
      const rel = await uploadPorClique(input, rodarTool, (acao, args, timeout) => link.send(acao, args, timeout));
      return textResult(JSON.stringify(rel));
    } catch (err) {
      return errorResult(err.message);
    }
  }

  if (name === MIDIA_TOOL.name) {
    try {
      const rel = await baixarMidia(input, (acao, args, timeout) => link.send(acao, input.aba !== undefined ? { ...args, aba: input.aba } : args, timeout));
      const texto = JSON.stringify(rel, null, 2);
      return rel.ok ? textResult(texto) : errorResult(`nada baixado. ${texto}`);
    } catch (err) {
      return errorResult(err.message);
    }
  }

  return rodarTool(name, input);
});

/**
 * O caminho unico de toda tool que vai a extensao. Separado do handler para o
 * `browser_roteiro` passar pelo MESMO build/freio/formatacao de uma chamada
 * avulsa — roteiro que pulasse este caminho seria uma porta dos fundos no freio.
 * `bruto` devolve tambem o dado cru, que o roteiro usa para conferir e guardar.
 */
/**
 * Parametro `aba` em toda tool (26/09/2026). Subagentes da tool Agent herdam a
 * conexao da sessao-mae e caiam todos na mesma aba. Com `aba`, cada um age na
 * aba que ele mesmo abriu, so naquele comando.
 */
function comAba(schema) {
  if (!schema || schema.type !== 'object') return schema;
  return {
    ...schema,
    properties: {
      ...(schema.properties ?? {}),
      aba: {
        type: 'number',
        description: 'Opcional. tabId de uma aba que VOCE abriu com browser_tab_open (o newTabId). O comando age '
          + 'nela e so nele, sem mudar a aba da sessao. Use quando houver varios subagentes na mesma sessao: '
          + 'cada um abre a sua e passa "aba" em TODA chamada.',
      },
    },
  };
}

async function rodarTool(name, input, { bruto = false } = {}) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return errorResult(`tool desconhecida: ${name}`);

  const args = tool.build ? tool.build(input) : {};
  // Aba explicita por comando: cada subagente age na SUA aba (ver comAba).
  if (input.aba !== undefined && input.aba !== null) args.aba = input.aba;
  if (input.confirm === true) args.confirm = true;
  const timeout = typeof tool.timeout === 'function' ? tool.timeout(input) : tool.timeout;
  // A mesma tool pode virar acoes diferentes conforme o input (click por ref ou
  // por coordenada; type rapido ou tecla a tecla).
  const acao = typeof tool.action === 'function' ? tool.action(input) : tool.action;

  try {
    const data = await link.send(acao, args, timeout);

    // O que a extensao nao alcanca: gravar em disco. Ela devolve base64 e a
    // escrita acontece aqui, do lado que roda no Windows.
    const resultado = tool.gravaEm
      ? gravarEmDisco(tool.gravaEm(input), data)
      : formatResult(tool, data, input);
    return bruto ? { ...resultado, data } : resultado;
  } catch (err) {
    return errorResult(err.message);
  }
}

function gravarEmDisco(caminho, data) {
  const base64 = typeof data === 'string' ? data : data?.base64;
  if (!base64) return errorResult('a extensao nao devolveu conteudo para gravar');

  const bytes = Buffer.from(base64, 'base64');
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, bytes);

  const kb = (bytes.length / 1024).toFixed(1);
  const tipo = data?.tipo ? ` (${data.tipo})` : '';
  return textResult(`gravado em ${caminho} — ${kb} KB${tipo}`);
}

function formatResult(tool, data, input) {
  // Tool nova que devolve imagem ou tem formatacao propria nao precisa editar
  // esta funcao: basta declarar `imagem` (mimeType) ou `formatar` na propria
  // definicao, em tools/<dominio>.js.
  if (tool.imagem) return { content: [{ type: 'image', data, mimeType: tool.imagem }] };
  if (tool.formatar) return textResult(tool.formatar(data, input));

  // Screenshot volta em base64 e precisa ir como imagem, nao como texto gigante.
  if (tool.action === 'screenshot' && typeof data === 'string') {
    return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
  }
  // read_page devolve o estado inteiro, com a arvore duplicada. Enxugar aqui e
  // o que impede uma leitura de pagina grande de comer a janela do agente.
  if (tool.name === 'browser_find') return textResult(procurar(data, input.query, input.limite));
  if (tool.action === 'read_page') return textResult(formatarPagina(data, input));

  if (data === undefined || data === null) return textResult('ok');
  return textResult(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const textResult = (text) => ({ content: [{ type: 'text', text }] });
const errorResult = (text) => ({ content: [{ type: 'text', text }], isError: true });

/**
 * A ORDEM AQUI IMPORTA, e ja custou uma sessao inteira (09/09/2026).
 *
 * Este processo tem DOIS canais, e eles sao independentes:
 *   1. o stdio com o Claude Code — por onde ele recebe ordens;
 *   2. o WebSocket com o hub — por onde ele fala com a extensao no Chrome.
 *
 * O codigo antigo fazia `await link.start()` ANTES de `server.connect()`, ou
 * seja: so avisava o Claude Code "estou pronto" DEPOIS de conectar no hub. E o
 * `#becomePeer()` de hub.js so resolve em `open` ou `close` — se a conexao fica
 * no meio do caminho (o hub aceita o TCP mas ainda esta subindo, que e
 * exatamente o instante da eleicao quando varios servidores MCP nascem juntos),
 * a espera NAO TERMINA NUNCA.
 *
 * Resultado medido: o Claude Code espera 30s pelo handshake `initialize`,
 * desiste, marca o servidor como falho e NAO tenta de novo. O processo continua
 * vivo e acaba conectando no hub — virando um peer orfao, visivel na 8788 e
 * inutil para a sessao que o criou.
 *
 * Agora: o canal MCP sobe PRIMEIRO (nao depende de rede nenhuma) e a conexao
 * com o hub acontece em segundo plano. Nenhum problema de hub, porta ou Chrome
 * pode mais impedir a ponte de aparecer na sessao. Quem chamar uma tool antes
 * de o hub responder recebe erro claro de `link.send`, que e o comportamento
 * correto — melhor uma tool que falha explicando do que um servidor que some.
 */
async function main() {
  await server.connect(new StdioServerTransport());
  log(`canal MCP pronto como "${clientName}" (${clientId})`);

  link.start()
    .then(() => log('ligado ao hub'))
    .catch((err) => log(`nao consegui ligar ao hub: ${err.message} — as tools do navegador vao falhar ate reconectar`));
}

main().catch((err) => {
  log(`falhou ao subir: ${err.message}`);
  process.exit(1);
});
