/** Tools de espera: tempo fixo, texto, mudanca de conteudo, rede. */

export const TOOLS = [
  {
    name: 'browser_wait',
    description: 'Espera um tempo fixo. Prefira browser_wait_for_text ou browser_wait_for_change, que sao mais precisos.',
    inputSchema: {
      type: 'object',
      properties: { ms: { type: 'number', description: 'Milissegundos. Padrao: 1000.' } },
    },
    action: 'wait_for',
    build: (i) => ({ params: { ms: i.ms } }),
    timeout: 120_000,
  },
  {
    name: 'browser_wait_for_text',
    description:
      'Espera um texto aparecer (present true) ou sumir (present false) da pagina. Serve para esperar '
      + 'carregamento acabar. Por padrao so enxerga texto VISIVEL (innerText): texto em display:none, '
      + 'aba fechada ou acordeao recolhido nao conta. Para achar texto que esta no DOM mas escondido, '
      + 'use incluir_oculto: true.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto a procurar.' },
        present: { type: 'boolean', description: 'true espera aparecer, false espera sumir. Padrao: true.' },
        timeout_ms: { type: 'number', description: 'Teto da espera. Padrao: 300000.' },
        interval_ms: { type: 'number', description: 'Intervalo entre checagens. Padrao: 1500.' },
        incluir_oculto: {
          type: 'boolean',
          description:
            'true procura no texto do DOM inteiro (textContent), visivel ou nao -- inclusive o de '
            + '<script>/<style>, entao nao prova que o usuario VE o texto. Nao desce em shadow root. '
            + 'Padrao: false (so o que esta renderizado na tela).',
        },
      },
      required: ['text'],
    },
    action: 'wait_for_text',
    build: (i) => ({
      params: {
        text: i.text,
        present: i.present,
        timeout_ms: i.timeout_ms,
        interval_ms: i.interval_ms,
        incluir_oculto: i.incluir_oculto,
      },
    }),
    timeout: (i) => (i.timeout_ms ?? 300_000) + 15_000,
  },
  {
    name: 'browser_wait_for_change',
    description: 'Espera o conteudo da pagina crescer e depois estabilizar. Ideal para resposta de chat ou carregamento incremental.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Teto da espera. Padrao: 30000.' },
        interval_ms: { type: 'number', description: 'Intervalo entre checagens. Padrao: 1000.' },
        min_change: { type: 'number', description: 'Minimo de caracteres novos para contar como mudanca. Padrao: 50.' },
        stable_ms: { type: 'number', description: 'Quanto tempo sem crescer para considerar estavel. Padrao: 1500.' },
        from_length: { type: 'number', description: 'Tamanho conhecido antes da acao que disparou a mudanca.' },
      },
    },
    action: 'wait_for_change',
    build: (i) => ({
      params: {
        timeout_ms: i.timeout_ms,
        interval_ms: i.interval_ms,
        min_change: i.min_change,
        stable_ms: i.stable_ms,
        from_length: i.from_length,
      },
    }),
    timeout: (i) => (i.timeout_ms ?? 30_000) + 15_000,
  },
  {
    name: 'browser_wait_network',
    description:
      'Espera a rede da pagina acalmar. Use depois de navegar ou de uma acao que dispara '
      + 'carregamento, em vez de chutar um tempo fixo.',
    inputSchema: {
      type: 'object',
      properties: { max_wait_ms: { type: 'number', description: 'Teto da espera. Padrao: 15000.' } },
    },
    action: 'cap_wait_network',
    build: (i) => ({ params: { max_wait_ms: i.max_wait_ms } }),
    timeout: (i) => (i.max_wait_ms ?? 15_000) + 10_000,
  },
];
