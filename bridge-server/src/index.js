#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { appendFile, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { BridgeLink, HOST, PORT } from './hub.js';
import { TOOLS, TOOL_BY_NAME } from './tools.js';
import { formatarPagina, procurar } from './format.js';
import { CONFIG_DIR, getToken } from './token.js';
import { ROTEIRO_TOOL, executarRoteiro } from './roteiro.js';
import { MIDIA_TOOL, baixarMidia } from './midia.js';
import { COOKIES_SALVAR_TOOL, salvarCookies } from './cookies-salvar.js';
import { YOUTUBE_TOOL, transcricaoYoutube } from './youtube.js';
import { UPLOAD_CLIQUE_TOOL, uploadPorClique } from './upload-clique.js';
import { FLOW_TOOLS, executarFlow } from './flow.js';
import { GEMINI_TOOLS, executarGemini } from './gemini.js';
import { AISTUDIO_TOOLS, executarAistudio } from './aistudio.js';
import { limitarResposta } from './saida.js';
import { prefixoDoCaderno } from './caderno.js';
import { MEDICAO_ARQ, tamanhoDaResposta, ehClienteDeTeste } from './consumo.js';

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
    + 'de agora — por exemplo "trabalho" para operar o WhatsApp Web do perfil de trabalho, mantendo outra '
    + 'sessao no perfil pessoal. Sem chamar isto a sessao fica no perfil "padrao" (o de sempre). Todo '
    + 'comando desta sessao vai so para o perfil ativo — se ele cair, a acao falha dizendo qual perfil '
    + 'faltou, nunca migra sozinha para outro. Confira os nomes conectados com browser_status.',
  inputSchema: {
    type: 'object',
    properties: {
      perfil: {
        type: 'string',
        description: 'Nome do perfil, igual ao definido nas opcoes da extensao daquele Chrome (ex.: "padrao", "trabalho").',
      },
    },
    required: ['perfil'],
  },
};

// G1 (20/10/2026): regras de uso entregues uma vez por sessao, no handshake MCP.
const INSTRUCOES = [
  'Como usar a ponte PraxedesIA (Chrome real do usuário):',
  '1. LEIA antes de ver: browser_read_page, browser_find ou browser_extract antes de qualquer print. Print so quando a leitura nao explica a tela.',
  '2. Nao peca print e leitura da mesma pagina na mesma rodada; escolha um.',
  '3. PARE quando o resultado que voce queria aparecer. Nao confirme o que ja esta confirmado.',
  '4. Acao que falhou NAO se repete as cegas: releia a pagina (a tela mudou) e so entao decida.',
  '5. Lista ou tabela: extraia de uma vez com browser_javascript (retorne o array pronto), em vez de ler item por item. Resposta acima de 12000 caracteres vai sozinha para um arquivo (o caminho vem na resposta): leia so o trecho que precisar.',
  '6. Sequencia conhecida (Portal OAB, abas do PJe): use browser_roteiro, que confere a tela entre os passos e devolve um relatorio curto.',
  '7. Ato irreversivel (assinar, pagar, excluir, enviar) ou login com senha por preencher: a ponte barra e o usuário recebe uma notificacao do Windows com botoes; o erro diz "aguardando decisao" com um id. Espere com browser_decisao {id}; APROVADA = repita a MESMA acao sem confirm (vale uma vez, 60 s); NEGADA = nao repita. Voce nunca aprova nem digita senha; confirm:true so depois de ele dizer sim no chat.',
  '8. Em subagente, abra a sua aba (browser_tab_open) e passe "aba" em toda chamada.',
  '9. Login: se a pagina pede login e o usuario e a senha JA estao preenchidos (gerenciador de senhas do usuário), pode clicar em Entrar/Login/Acessar sem perguntar: o usuário autorizou. Nunca digite senha; em site financeiro (bancos, InfinitePay) nao clique em login.',
].join('\n');

const server = new Server(
  { name: 'praxedes-bridge-v6', version: '0.1.0' },
  { capabilities: { tools: {} }, instructions: INSTRUCOES },
);

// X8 (fase 4): modo enxuto. PRAXEDES_BRIDGE_ENXUTO=1 lista so as ~15 tools principais no tools/list
// (cada schema custa tokens em TODA sessao). As demais continuam respondendo se chamadas pelo nome.
// NAO e o padrao.
export const TOOLS_ENXUTO = new Set([
  'browser_navigate', 'browser_read_page', 'browser_find', 'browser_extract', 'browser_click', 'browser_type',
  'browser_form_fill', 'browser_press_key', 'browser_scroll', 'browser_wait_for_text', 'browser_javascript',
  'browser_roteiro', 'browser_screenshot', 'browser_tabs_list', 'browser_status',
]);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: listaDeTools(),
}));

function listaDeTools() {
  const todas = [
    STATUS_TOOL,
    USAR_PERFIL_TOOL,
    { ...ROTEIRO_TOOL, inputSchema: comAba(ROTEIRO_TOOL.inputSchema) },
    { ...MIDIA_TOOL, inputSchema: comAba(MIDIA_TOOL.inputSchema) },
    { ...COOKIES_SALVAR_TOOL, inputSchema: comAba(COOKIES_SALVAR_TOOL.inputSchema) },
    { ...YOUTUBE_TOOL, inputSchema: comAba(YOUTUBE_TOOL.inputSchema) },
    { ...UPLOAD_CLIQUE_TOOL, inputSchema: comAba(UPLOAD_CLIQUE_TOOL.inputSchema) },
    ...FLOW_TOOLS.map((t) => ({ ...t, inputSchema: comAba(t.inputSchema) })),
    ...GEMINI_TOOLS.map((t) => ({ ...t, inputSchema: comAba(t.inputSchema) })),
    ...AISTUDIO_TOOLS.map((t) => ({ ...t, inputSchema: comAba(t.inputSchema) })),
    ...TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: comAba(inputSchema) })),
  ];
  return process.env.PRAXEDES_BRIDGE_ENXUTO === '1' ? todas.filter((t) => TOOLS_ENXUTO.has(t.name)) : todas;
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // OCIOSO: toda chamada conta como atividade e, se o processo estava adormecido, religa antes.
  emVoo += 1;
  ultimaChamada = Date.now();
  const t0 = Date.now();
  let resposta;
  try {
    await garantirAcordado();
    resposta = limitarResposta(await tratarChamada(req), { tool: req.params?.name, input: req.params?.arguments ?? {}, dir: SAIDAS_DIR });
    return resposta;
  } finally {
    emVoo -= 1;
    ultimaChamada = Date.now();
    registrarMedicao(req.params?.name, Date.now() - t0, resposta);
  }
});

async function tratarChamada(req) {
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
    if (!nome) return errorResult('informe o nome do perfil (ex.: "padrao", "trabalho")');
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

  if (GEMINI_TOOLS.some((t) => t.name === name)) {
    try {
      const rel = await executarGemini(name, input, rodarTool, (acao, args, timeout) => link.send(acao, args, timeout), uploadPorClique);
      return textResult(JSON.stringify(rel, null, 1));
    } catch (err) {
      return errorResult(err.message);
    }
  }

  if (AISTUDIO_TOOLS.some((t) => t.name === name)) {
    try {
      const rel = await executarAistudio(name, input, rodarTool, (acao, args, timeout) => link.send(acao, args, timeout));
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

  if (name === YOUTUBE_TOOL.name) {
    try {
      const rel = await transcricaoYoutube(input, (acao, args, timeout) => link.send(acao, input.aba !== undefined ? { ...args, aba: input.aba } : args, timeout));
      return textResult(JSON.stringify(rel, null, 1));
    } catch (err) {
      return errorResult(err.message);
    }
  }

  if (name === COOKIES_SALVAR_TOOL.name) {
    try {
      const rel = await salvarCookies(input, (acao, args, timeout) => link.send(acao, input.aba !== undefined ? { ...args, aba: input.aba } : args, timeout));
      return textResult(JSON.stringify(rel, null, 2));
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
}

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

async function rodarTool(name, input, { bruto = false, timeout_ms: tetoMs } = {}) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return errorResult(`tool desconhecida: ${name}`);

  const args = tool.build ? tool.build(input) : {};
  // Aba explicita por comando: cada subagente age na SUA aba (ver comAba).
  if (input.aba !== undefined && input.aba !== null) args.aba = input.aba;
  if (input.confirm === true) args.confirm = true;
  let timeout = typeof tool.timeout === 'function' ? tool.timeout(input) : tool.timeout;
  // B2: o roteiro passa o tempo que lhe resta; o transporte nunca espera mais que isso
  // (nem mais que o teto proprio da tool). 60 s e o padrao do hub (hub.js DEFAULT_TIMEOUT_MS).
  if (typeof tetoMs === 'number' && tetoMs > 0) timeout = Math.min(timeout ?? 60_000, tetoMs);
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
  if (tool.imagem) {
    // X5: print da tela inteira volta como objeto (imagem + escala) ou {igual:true}.
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.igual === true) return textResult('tela igual ao ultimo print (nenhuma imagem enviada)');
      const notas = [];
      if (data.escala && data.escala < 1) {
        notas.push(`imagem reduzida a ${Math.round(data.escala * 100)}% (${data.largura}x${data.altura}; a janela tem ${data.largura_tela}x${data.altura_tela}): `
          + `para browser_click {x,y}, divida os pixels da imagem por ${data.escala}`);
      }
      if (data.rotulos !== undefined) notas.push(`${data.rotulos} rotulo(s) [N]: o N e o ref de browser_click/browser_type`);
      return { content: [{ type: 'image', data: data.data, mimeType: tool.imagem }, ...(notas.length ? [{ type: 'text', text: notas.join('; ') }] : [])] };
    }
    return { content: [{ type: 'image', data, mimeType: tool.imagem }] };
  }
  if (tool.formatar) return textResult(tool.formatar(data, input));

  // Screenshot volta em base64 e precisa ir como imagem, nao como texto gigante.
  if (tool.action === 'screenshot' && typeof data === 'string') {
    return { content: [{ type: 'image', data, mimeType: 'image/jpeg' }] };
  }
  // read_page devolve o estado inteiro, com a arvore duplicada. Enxugar aqui e
  // o que impede uma leitura de pagina grande de comer a janela do agente.
  if (tool.name === 'browser_find') return textResult(procurar(data, input.query, input.limite));
  if (tool.action === 'read_page') return textResult(prefixoDoCaderno(data?.url) + formatarPagina(data, input));

  // X1: so_valor devolve apenas o resultado (string crua, ou JSON compacto), sem recuo nem envelope.
  if (input.so_valor === true && (tool.name === 'browser_javascript' || tool.name === 'browser_extract')) {
    if (data === undefined || data === null) return textResult('');
    return textResult(typeof data === 'string' ? data : JSON.stringify(data));
  }

  if (data === undefined || data === null) return textResult('ok');
  return textResult(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

const textResult = (text) => ({ content: [{ type: 'text', text }] });
const errorResult = (text) => ({ content: [{ type: 'text', text }], isError: true });

// ---------------------------------------------------------------- MEDICAO
// Uma linha JSON por chamada MCP: tool, duracao e tamanho (em caracteres) do que
// foi devolvido ao agente. Serve para comparar fases (antes/depois de cada melhoria)
// sem depender do Chrome. `chars` = texto; `img_chars` = imagem em base64 (separado,
// porque um print pesa por outro critério). PRAXEDES_BRIDGE_MEDICAO=0 desliga;
// PRAXEDES_BRIDGE_MEDICAO_ARQ troca o arquivo (os testes usam).
const SAIDAS_DIR = process.env.PRAXEDES_BRIDGE_SAIDAS_DIR || join(CONFIG_DIR, 'saidas');
const MEDICAO_LIGADA = process.env.PRAXEDES_BRIDGE_MEDICAO !== '0';
const MEDICAO_TETO_BYTES = 5 * 1024 * 1024;

function registrarMedicao(tool, ms, resposta) {
  if (!MEDICAO_LIGADA) return;
  // Teste nao polui o uso real: so vale para o arquivo padrao (os testes que apontam o proprio arquivo seguem medindo).
  if (!process.env.PRAXEDES_BRIDGE_MEDICAO_ARQ && (ehClienteDeTeste(clientName) || process.env.PRAXEDES_BRIDGE_TESTE === '1')) return;
  try {
    const linha = JSON.stringify({
      t: new Date().toISOString(), agente: clientName, tool, ms,
      ...tamanhoDaResposta(resposta), ...(resposta?.isError ? { erro: true } : {}),
    }) + '\n';
    mkdirSync(dirname(MEDICAO_ARQ), { recursive: true });
    try {
      if (statSync(MEDICAO_ARQ).size > MEDICAO_TETO_BYTES) renameSync(MEDICAO_ARQ, `${MEDICAO_ARQ}.1`);
    } catch { /* arquivo ainda nao existe */ }
    appendFile(MEDICAO_ARQ, linha, () => { /* medicao nunca derruba a chamada */ });
  } catch { /* idem */ }
}

// ---------------------------------------------------------------- OCIOSO
// Sem nenhuma chamada de tool por PRAXEDES_BRIDGE_OCIOSO_MIN minutos (padrao 60), o
// processo larga o WebSocket, os timers e (se hub, e so se estiver sozinho) a porta,
// ficando com o esqueleto stdio. A proxima chamada religa e responde normal.
// 0 ou negativo desliga.
const OCIOSO_MIN = process.env.PRAXEDES_BRIDGE_OCIOSO_MIN !== undefined && process.env.PRAXEDES_BRIDGE_OCIOSO_MIN !== ''
  ? Number(process.env.PRAXEDES_BRIDGE_OCIOSO_MIN)
  : 60;
const OCIOSO_RECHECAR_MAX_MS = 5 * 60_000;
// Extensao sem hub entra em repouso e tenta 1 vez por minuto (alarme); quem acorda como hub espera por ela ate 65 s.
const ACORDAR_ESPERA_EXTENSAO_MS = process.env.PRAXEDES_BRIDGE_ACORDAR_ESPERA_MS !== undefined
  ? Number(process.env.PRAXEDES_BRIDGE_ACORDAR_ESPERA_MS)
  : 65_000;
let ultimaChamada = Date.now();
let emVoo = 0;
let timerOcioso = null;
let acordando = null;

function armarOcioso(ms) {
  if (!(OCIOSO_MIN > 0)) return;
  clearTimeout(timerOcioso);
  timerOcioso = setTimeout(() => { verificarOcioso().catch((e) => log(`ocioso: ${e.message}`)); }, Math.max(ms, 50));
  timerOcioso.unref?.();
}

async function verificarOcioso() {
  const limite = OCIOSO_MIN * 60_000;
  const parado = Date.now() - ultimaChamada;
  if (emVoo > 0 || parado < limite) return armarOcioso(emVoo > 0 ? limite : limite - parado);
  const rssAntes = Math.round(process.memoryUsage().rss / 1048576);
  const r = await link.suspender();
  if (!r.suspenso) {
    log(`ocioso: nao larguei (${r.motivo}); vejo de novo ja`);
    return armarOcioso(Math.min(limite, OCIOSO_RECHECAR_MAX_MS));
  }
  log(`ocioso: adormecido apos ${Math.round(parado / 1000)}s sem chamada (rss ${rssAntes} MB -> ${Math.round(process.memoryUsage().rss / 1048576)} MB)`);
}

/** Religa o link se o processo estava adormecido; quem acorda como hub espera a extensao voltar. */
async function garantirAcordado() {
  armarOcioso(OCIOSO_MIN * 60_000);
  if (!link.suspenso) return;
  acordando ??= (async () => {
    try {
      await link.acordar();
      log(`ocioso: acordei como ${link.role}`);
      if (link.role === 'hub') {
        const fim = Date.now() + ACORDAR_ESPERA_EXTENSAO_MS;
        while (!link.connected && Date.now() < fim) await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      acordando = null;
    }
  })();
  await acordando;
}

// ------------------------------------------------------------- ENCERRAMENTO
// O Claude Code fecha o stdin quando a sessao acaba (ou morre). Sem tratar isso, o
// WebSocket mantinha o processo vivo para sempre: orfao ocupando a porta ou um socket.
let encerrando = false;
async function encerrar(motivo) {
  if (encerrando) return;
  encerrando = true;
  log(`encerrando: ${motivo}`);
  const forca = setTimeout(() => process.exit(0), 1500);
  forca.unref?.();
  try { await link.parar(); } catch { /* saindo mesmo assim */ }
  process.exit(0);
}

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
 * vivo e acaba conectando no hub — virando um peer orfao, visivel na 8789 e
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
  process.stdin.on('end', () => { void encerrar('stdin fechou (a sessao acabou)'); });
  process.stdin.on('close', () => { void encerrar('stdin fechou (a sessao acabou)'); });
  process.stdin.on('error', () => { void encerrar('erro no stdin'); });
  armarOcioso(OCIOSO_MIN * 60_000);

  link.start()
    .then(() => log('ligado ao hub'))
    .catch((err) => log(`nao consegui ligar ao hub: ${err.message} — as tools do navegador vao falhar ate reconectar`));
}

main().catch((err) => {
  log(`falhou ao subir: ${err.message}`);
  process.exit(1);
});
