import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default defineConfig({
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    external: ['chromium-bidi/lib/cjs/bidiMapper/BidiMapper.js'],
    plugins: [
      tailwindcss(),
      nodeResolve({ browser: true, resolveOnly: ['puppeteer-core'] }),
    ],
  }),
  manifest: {
    name: 'PraxedesIA v5',
    version: '5.0.0',
    description: 'Ponte entre os agentes locais e o Chrome real',
    action: {
      default_title: 'PraxedesIA v5 — ponte',
      // No default_popup — side panel is opened via chrome.sidePanel.open() in onClicked handler
    },
    icons: {
      '16': 'icon-128.png',
      '32': 'icon-128.png',
      '48': 'icon-128.png',
      '128': 'icon-128.png',
    },
    permissions: [
      'tabs',
      'tabGroups',
      'activeTab',
      'debugger',
      'storage',
      'scripting',
      'sidePanel',
      'offscreen',
      // Faxina periodica dos grupos de agente parado (setInterval morre com o SW).
      'alarms',
      'notifications',
      'webNavigation',
      'declarativeNetRequest',
      // Download nativo do Chrome (browser_download_arm/wait). Autorizada pelo
      // Dr. Cezar em 06/09/2026: documento do PJe as vezes baixa por link em
      // vez de abrir na tela, e os dois caminhos por CDP nao existem nesta
      // versao do Chrome.
      'downloads',
      // Exportar sessao logada para uso em curl (browser_cookies).
      'cookies',
    ],
    host_permissions: [
      '<all_urls>',
      'http://localhost:11434/*',
      'http://localhost:1234/*',
    ],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'toggle-side-panel': {
        description: 'Toggle agent side panel',
        suggested_key: {
          default: 'Ctrl+E',
          mac: 'Command+E',
        },
      },
    },
    web_accessible_resources: [
      {
        resources: ['blocked.html', 'sounds/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
