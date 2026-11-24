/** Tools de diagnostico visual e de console. */

import { buildTarget } from './_comum.js';

export const TOOLS = [
  {
    name: 'browser_screenshot',
    description:
      'Captura a aba ativa em JPEG. Com ref, so o elemento — mais barato e sem ambiguidade '
      + '(conferir um campo preenchido ou um numero de protocolo sem gastar a tela inteira). '
      + 'Use so quando precisar mesmo ver o layout; para ler conteudo, use browser_read_page. '
      + 'Tela inteira: sai em no maximo 1280x800 (avisa a escala quando reduz), so_se_mudou:true devolve texto '
      + '"tela igual ao ultimo print" sem imagem se nada mudou, rotulos:true desenha [N] (o ref de browser_click) '
      + 'nos interativos visiveis. Zoom: regiao com tela:true (coordenada da imagem do print) e escala 2.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'number',
          description:
            'Referencia do elemento (backendNodeId) vinda de browser_read_page. Recorta so este elemento.',
        },
        regiao: {
          type: 'object',
          description:
            'Retangulo explicito em vez de ref: {x,y,w,h}, em pixels CSS ABSOLUTOS DA PAGINA '
            + '(do topo do documento, nao do que esta visivel agora — se a pagina estiver rolada, '
            + 'some a rolagem voce mesmo, ou role para o topo antes). Prefira ref quando puder: ele '
            + 'rola e calcula isso sozinho. Com tela:true as coordenadas sao as da JANELA (as da imagem de '
            + 'um print anterior, em pixels CSS), e a ponte soma a rolagem: serve para dar zoom no que viu.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            tela: { type: 'boolean' },
          },
        },
        escala: { type: 'number', description: 'Fator de escala da imagem (scale do CDP). Padrao 1. Com regiao, 2 da zoom.' },
        so_se_mudou: { type: 'boolean', description: 'Tela inteira: se a imagem for igual a do ultimo print desta aba, nao devolve imagem, so o texto.' },
        rotulos: { type: 'boolean', description: 'Tela inteira: desenha [N] (ref de browser_click/browser_type) em cada interativo visivel.' },
        tamanho_real: { type: 'boolean', description: 'Tela inteira: nao reduzir para 1280x800.' },
      },
    },
    action: (i) => (i.ref !== undefined || i.regiao ? 'cap_screenshot_ref' : 'cap_print'),
    build: (i) => ({
      target: buildTarget(i),
      params: i.ref !== undefined || i.regiao
        ? { regiao: i.regiao, escala: i.escala }
        : { so_se_mudou: i.so_se_mudou === true, rotulos: i.rotulos === true, tamanho_real: i.tamanho_real === true },
    }),
    // Sem isto, virar `action` funcao (em vez da string 'screenshot' fixa)
    // quebra o fallback de imagem em bridge-server/src/index.js (`tool.action
    // === 'screenshot'` deixa de bater — tool.action agora e uma funcao, nao
    // a string) e o screenshot inteiro passaria a voltar como texto base64
    // gigante. `tool.imagem` e checado ANTES desse fallback e cobre os dois
    // caminhos (com e sem ref).
    imagem: 'image/jpeg',
  },
  {
    name: 'browser_console_logs',
    description:
      'Console real da pagina via CDP, com excecoes nao tratadas e erros de rede — nao um array que '
      + 'so veria o console da propria extensao. Desde a ultima reconexao da aba. Use para diagnosticar erro de pagina.',
    inputSchema: {
      type: 'object',
      properties: {
        max: { type: 'number', description: 'Quantas mensagens trazer. Padrao: 50.' },
        nivel: {
          type: 'string',
          enum: ['log', 'info', 'warn', 'error', 'excecao'],
          description: 'Filtra por nivel. Sem isto, traz todos.',
        },
      },
    },
    action: 'cap_console',
    build: (i) => ({ params: { max: i.max, nivel: i.nivel } }),
  },
];
