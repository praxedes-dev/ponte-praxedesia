/** Tools de leitura da pagina: arvore, busca, extracao de texto, clipboard. */

export const TOOLS = [
  {
    name: 'browser_read_page',
    description:
      'Le a pagina e devolve os elementos com que da para interagir, cada um com a ref numerica '
      + 'que browser_click e browser_type aceitam. Use isto antes de clicar ou digitar: e mais barato '
      + 'e mais confiavel que screenshot. Por padrao traz so o que e interativo; use mode "full" '
      + 'quando precisar da estrutura inteira da pagina.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['interactive', 'full'],
          description: 'interactive (padrao) = so o que da para clicar ou preencher. full = arvore inteira.',
        },
        max_chars: { type: 'number', description: 'Teto de caracteres da resposta. Padrao: 8000.' },
        offset: { type: 'number', description: 'Continuar a leitura a partir deste caractere (em qualquer modo, quando a resposta vier cortada: use o valor que ela mesma indica).' },
        scope: {
          type: 'string',
          enum: ['page', 'viewport'],
          description: 'viewport = so o que esta na janela; page = tudo, com [fora da vista] marcado. Padrao: viewport em mode full, page em interactive (la so marca, nao corta).',
        },
        so_interativos: { type: 'boolean', description: 'mode full: so as linhas interativas, sem estrutura.' },
        profundidade: { type: 'number', description: 'mode full: so N niveis da arvore.' },
        seletor: { type: 'string', description: 'Le so dentro dos elementos que casam com este seletor CSS.' },
        secao: { type: 'string', description: 'Le so o painel/landmark cujo nome contem este texto (ex.: "Filtros"). Se nao achar, lista os nomes existentes.' },
        moldura: { type: 'string', description: 'Le so a moldura (iframe de outro site) cujo host contem este texto.' },
        ref: { type: 'number', description: 'Le so a subarvore deste ref.' },
      },
    },
    action: 'read_page',
    build: (i) => ({
      params: {
        scope: i.scope ?? (i.mode === 'full' ? 'viewport' : 'page'),
        ...(i.so_interativos !== undefined && { so_interativos: i.so_interativos }),
        ...(i.profundidade !== undefined && { profundidade: i.profundidade }),
        ...(i.seletor && { seletor: i.seletor }),
        ...(i.secao && { secao: i.secao }),
        ...(i.ref !== undefined && { ref: i.ref }),
      },
    }),
  },
  {
    name: 'browser_find',
    description:
      'Procura elementos da pagina por descricao livre ("botao salvar", "campo CPF") e devolve so os '
      + 'candidatos com suas refs. Prefira isto a browser_read_page quando ja souber o que procura: '
      + 'evita despejar a pagina inteira.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'O que voce procura, em palavras.' },
        limite: { type: 'number', description: 'Maximo de candidatos. Padrao: 12.' },
      },
      required: ['query'],
    },
    action: 'read_page',
  },
  {
    name: 'browser_extract',
    description: 'Extrai o texto da pagina, ou de um seletor CSS. Use para ler conteudo longo sem gastar screenshot. '
      + 'Em documento do Google Docs (docs.google.com/document), sem seletor, devolve o documento INTEIRO de uma vez (nao so o que esta na tela); passe max_chars grande e continue com from_length se vier cortado. '
      + 'Pediu um dado so (um numero, um nome, uma linha)? Passe seletor e max_chars pequenos: devolver so o valor custa bem menos que a pagina.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS. Sem ele, extrai a pagina toda.' },
        max_chars: { type: 'number', description: 'Teto de caracteres. Padrao: 5000.' },
        from_length: {
          type: 'number',
          description: 'Comecar a leitura neste caractere (0 = comeco, o padrao). Negativo = so a cauda da pagina.',
        },
        so_valor: { type: 'boolean', description: 'Devolve so o texto extraido, sem aviso nem formatacao extra.' },
      },
    },
    action: 'extract',
    build: (i) => ({ params: { selector: i.selector, max_chars: i.max_chars, from_length: i.from_length } }),
  },
  {
    name: 'browser_clipboard_copy',
    description: 'Copia texto para a area de transferencia do Windows, direto ou a partir de um seletor CSS.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto literal a copiar.' },
        selector: { type: 'string', description: 'Seletor CSS de onde tirar o texto.' },
      },
    },
    action: 'copy_to_clipboard',
    build: (i) => ({ params: { text: i.text, selector: i.selector } }),
  },
];
