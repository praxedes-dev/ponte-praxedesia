import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';
import { nodeResolve } from '@rollup/plugin-node-resolve';

// build:seguro compila para outra pasta (WXT_OUT_DIR) e so depois troca o conteudo
// de .output/chrome-mv3 (scripts/build-seguro.mjs). O padrao continua .output.
export default defineConfig({
  outDir: process.env.WXT_OUT_DIR || '.output',
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
    name: 'PraxedesIA v6',
    version: '6.1.0',
    minimum_chrome_version: '125',
    description: 'Ponte entre os agentes locais e o Chrome real',
    action: {
      default_title: 'PraxedesIA v6 — ponte',
      // No default_popup — side panel is opened via chrome.sidePanel.open() in onClicked handler
    },
    icons: {
      '16': 'icon-16.png',
      '32': 'icon-32.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
    permissions: [
      'tabs',
      'tabGroups',
      'debugger',
      'storage',
      'scripting',
      'sidePanel',
      'offscreen',
      // Faxina periodica dos grupos de agente parado (setInterval morre com o SW).
      'alarms',
      'notifications',
      // Download nativo do Chrome (browser_download_arm/wait). Autorizada pelo
      // usuário em 06/09/2026: documento do PJe as vezes baixa por link em
      // vez de abrir na tela, e os dois caminhos por CDP nao existem nesta
      // versao do Chrome.
      'downloads',
      // Exportar sessao logada para uso em curl (browser_cookies).
      'cookies',
    ],
    host_permissions: [
      '<all_urls>',
    ],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'toggle-side-panel': {
        // v6: sem suggested_key — Ctrl+E ja e da v5 e os dois conflitam no mesmo Chrome.
        // Atalho pode ser atribuido manualmente em chrome://extensions/shortcuts.
        description: 'Toggle agent side panel',
      },
    },
  },
});
