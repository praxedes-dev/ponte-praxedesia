/** Tools de arquivo: PDF, upload, download, cookies. */

export const TOOLS = [
  {
    name: 'browser_save_pdf',
    description:
      'Salva a pagina atual como PDF num arquivo do disco. Serve para comprovante de protocolo, '
      + 'decisao ou fatura — em papel de verdade, nao print de tela. cabecalho/rodape sao HTML '
      + '(classes date, title, url, pageNumber, totalPages) — sem font-size eles saem minusculos. '
      + 'Exemplo de rodape com pagina e data: <div style="font-size:9px;width:100%;'
      + 'text-align:right;padding-right:1cm">Pag. <span class="pageNumber"></span>/'
      + '<span class="totalPages"></span> · <span class="date"></span></div>',
    inputSchema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho completo do arquivo .pdf a gravar.' },
        paisagem: { type: 'boolean', description: 'Orientacao paisagem. Padrao: false.' },
        fundo: { type: 'boolean', description: 'Imprimir cores de fundo. Padrao: true.' },
        cabecalho: { type: 'string', description: 'HTML do cabecalho de cada pagina. Sem isto, nenhum.' },
        rodape: {
          type: 'string',
          description: 'HTML do rodape de cada pagina — data/hora do comprovante, por exemplo.',
        },
        paginas: {
          type: 'string',
          description: 'Intervalo de paginas a exportar, ex.: "1-3,5". Sem isto, todas.',
        },
        margens_cm: {
          type: 'object',
          description:
            'Margens em centimetros (padrao do Chrome: ~1cm). Com cabecalho/rodape, use pelo menos '
            + '1.5 em cima/embaixo ou o template some por falta de espaco.',
          properties: {
            cima: { type: 'number' },
            baixo: { type: 'number' },
            esquerda: { type: 'number' },
            direita: { type: 'number' },
          },
        },
        escala: { type: 'number', description: 'Escala de impressao (1 = 100%). Padrao do Chrome.' },
      },
      required: ['caminho'],
    },
    action: 'cap_pdf',
    build: (i) => ({
      params: {
        paisagem: i.paisagem,
        fundo: i.fundo,
        cabecalho: i.cabecalho,
        rodape: i.rodape,
        paginas: i.paginas,
        margens_cm: i.margens_cm,
        escala: i.escala,
      },
    }),
    timeout: 120_000,
    gravaEm: (i) => i.caminho,
  },
  {
    name: 'browser_upload_file',
    description:
      'Anexa arquivos do disco a um campo de upload da pagina. Isto e o que extensao nenhuma '
      + 'consegue fazer: pegar um PDF do disco e anexar direto no formulario do site.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Ref do input de arquivo na pagina.' },
        caminhos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Caminhos completos dos arquivos no Windows.',
        },
      },
      required: ['ref', 'caminhos'],
    },
    action: 'cap_upload',
    build: (i) => ({ target: { strategy: 'agent-id', agentId: i.ref }, params: { caminhos: i.caminhos } }),
  },
  {
    name: 'browser_salvar_texto',
    description:
      'Grava o texto (ou o HTML) de um trecho da pagina DIRETO num arquivo do disco. O conteudo nao volta '
      + 'para voce, so o tamanho: economiza tokens em texto longo (resposta do Gemini, acordao, conversa). '
      + 'Nao usa download nem a area de transferencia do usuario. Sem seletor, grava a pagina inteira; '
      + 'seletor que casa com varios elementos junta todos na ordem.',
    inputSchema: {
      type: 'object',
      properties: {
        caminho: { type: 'string', description: 'Caminho completo do arquivo (.txt, .md, .html).' },
        seletor: { type: 'string', description: 'Seletor CSS do trecho. Sem isto: a pagina inteira.' },
        formato: { type: 'string', enum: ['texto', 'html'], description: 'texto (padrao, o que se ve) ou html.' },
      },
      required: ['caminho'],
    },
    action: 'cap_salvar_texto',
    build: (i) => ({ params: { seletor: i.seletor, formato: i.formato } }),
    timeout: 60_000,
    gravaEm: (i) => i.caminho,
  },
  {
    name: 'browser_download',
    description:
      'Baixa uma URL usando a sessao logada da pagina e grava no disco, com o nome que voce escolher. '
      + 'Serve para anexo de processo e documento atras de login. Na aba do usuario sem permissao, '
      + 'e barrado com [somente leitura] — repita browser_use_current_tab com permitir_acao: true '
      + 'primeiro (baixar anexo do PJe na aba dele e rotina, isto nao e sinal de defeito).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL do arquivo.' },
        caminho: { type: 'string', description: 'Caminho completo onde gravar.' },
      },
      required: ['url', 'caminho'],
    },
    action: 'cap_download',
    build: (i) => ({ params: { url: i.url } }),
    timeout: 180_000,
    gravaEm: (i) => i.caminho,
  },
  {
    name: 'browser_cookies',
    description:
      'Devolve os cookies do site como header Cookie pronto para curl. Permite logar uma vez no '
      + 'Chrome e depois raspar por HTTP, que e muito mais rapido que dirigir o navegador.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL do site. Sem isto, usa a aba atual.' } },
    },
    action: 'cap_cookies',
    build: (i) => ({ params: { url: i.url } }),
  },
];
