/** Tool de emulacao de aparelho (tamanho de tela e toque). */

export const TOOLS = [
  {
    name: 'browser_emulate_device',
    description:
      'Emula um aparelho (tamanho de tela e toque) para conferir layout responsivo sem Playwright. '
      + 'Use desligar: true para voltar ao normal.',
    inputSchema: {
      type: 'object',
      properties: {
        largura: { type: 'number', description: 'Largura em pixels. Ex.: 390 para celular.' },
        altura: { type: 'number', description: 'Altura em pixels. Ex.: 844.' },
        escala: { type: 'number', description: 'deviceScaleFactor. Padrao: 1.' },
        movel: { type: 'boolean', description: 'Emular toque e user agent movel.' },
        desligar: { type: 'boolean', description: 'Voltar ao tamanho real da janela.' },
      },
    },
    action: 'cap_emular',
    build: (i) => ({
      params: {
        largura: i.largura, altura: i.altura, escala: i.escala, movel: i.movel, desligar: i.desligar,
      },
    }),
  },
];
