/**
 * Tools de aba filha (obra 08). Ver
 * entrypoints/background/bridge/capacidades/abas-filhas.ts para o desenho completo
 * (registro por openerTabId, alimentado por chrome.tabs.onCreated em bridge/index.ts).
 */

export const TOOLS = [
  {
    name: 'browser_wait_new_tab',
    description:
      'Espera uma aba filha nascer da sua aba atual (window.open, target="_blank", um popup de '
      + 'login ou de emissao de guia/comprovante). Use logo depois de um clique que pode abrir aba '
      + 'nova. NAO troca de aba sozinho: devolve o tabId e o resto e com browser_tab_switch. Se '
      + 'nenhuma aba nascer no prazo, NAO e erro — abaNova vem null e a pagina provavelmente navegou '
      + 'na propria aba; leia-a antes de repetir o clique (repetir sem ler e como nasceu a guia de '
      + 'custas orfa de 18/08/2026).',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Quanto esperar pela aba nova. Padrao: 10000.' },
      },
    },
    action: 'cap_wait_new_tab',
    build: (i) => ({ params: { timeout_ms: i.timeout_ms } }),
    timeout: (i) => (i.timeout_ms ?? 10_000) + 10_000,
  },
];
