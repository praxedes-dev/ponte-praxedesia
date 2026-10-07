/** Tools de navegacao e abas. */

export const TOOLS = [
  {
    name: 'browser_navigate',
    description: 'Navega a aba ativa para uma URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL completa, com protocolo.' },
        timeout_ms: {
          type: 'number',
          description:
            'Teto do transporte, em ms. Padrao: 90000. A espera interna pela rede acalmar e FIXA em '
            + 'ate 15 s (nao muda com isto) -- este campo so estica o prazo total para um portal atras '
            + 'de Cloudflare ou uma rede lenta responder antes de a ponte desistir.',
        },
      },
      required: ['url'],
    },
    action: 'navigate',
    build: (i) => ({ params: { url: i.url } }),
    timeout: (i) => i.timeout_ms ?? 90_000,
    confirmavel: true,
  },
  {
    name: 'browser_tab_open',
    description: 'Abre uma aba nova na janela da ponte, deste agente.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL inicial. Padrao: about:blank.' } },
    },
    action: 'open_tab',
    build: (i) => ({ params: { url: i.url } }),
    timeout: 90_000,
  },
  {
    name: 'browser_tab_switch',
    description: 'Torna ativa outra aba deste agente, na janela da ponte.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number', description: 'ID da aba.' } },
      required: ['tabId'],
    },
    action: 'switch_tab',
    build: (i) => ({ params: { tabId: i.tabId } }),
  },
  {
    name: 'browser_tab_close',
    description: 'Fecha uma aba. Sem tabId, fecha a ativa.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number', description: 'ID da aba. Sem isto, fecha a ativa.' } },
    },
    action: 'close_tab',
    build: (i) => ({ params: { tabId: i.tabId } }),
  },
];
