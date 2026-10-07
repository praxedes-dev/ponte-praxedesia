/**
 * "O service worker SOBREVIVE ao carregamento?" — 30 segundos, sem Chrome.
 *
 * Por que existe (obra 25, 06/09/2026): um `chrome.<api>.on<Evento>.addListener`
 * em escopo de MODULO, de uma API que o `manifest.json` nao declara, faz o
 * service worker morrer NA HORA em que o Chrome o inicia. A extensao inteira
 * fica offline para TODOS os agentes e nao reconecta sozinha — e nenhum teste
 * desta bancada pega isso, porque todos precisam da extensao de pe para rodar.
 * Aconteceu de verdade: `chrome.downloads.onDeterminingFilename.addListener`
 * entrou em `capacidades/download-nativo.ts` sem a permissao `downloads` em
 * `wxt.config.ts`, e o primeiro `npm run build`/`reload` depois disso derrubou
 * a ponte.
 *
 * Como e fiel: o `chrome` de mentira daqui responde a QUALQUER API — menos as
 * que o proprio `manifest.json` construido nao autoriza. E exatamente o que o
 * Chrome faz: API sem permissao e `undefined`.
 *
 *   node test/_obra25-smoke-sw.mjs [caminho do .output/chrome-mv3]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ?? path.join(AQUI, '..', '..', '.output', 'chrome-mv3');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const permissoes = new Set(manifest.permissions ?? []);

/**
 * APIs que so existem no service worker quando a permissao homonima esta no
 * manifesto. Nao e a lista inteira do Chrome — e a das que esta extensao usa
 * ou pode vir a usar. Qualquer outra e auto-stubada.
 */
const EXIGEM_PERMISSAO = [
  'downloads', 'cookies', 'alarms', 'notifications', 'tabGroups', 'debugger',
  'scripting', 'declarativeNetRequest', 'webNavigation', 'offscreen', 'sidePanel',
];
const ausentes = EXIGEM_PERMISSAO.filter((api) => !permissoes.has(api));

const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
const stubProfundo = () => new Proxy(function () {}, {
  get(_, prop) {
    if (prop === 'then') return undefined;            // nao finge ser Promise
    if (typeof prop === 'string' && prop.startsWith('on')) return EVENTO();
    return stubProfundo();
  },
  apply() { return stubProfundo(); },
});

globalThis.chrome = new Proxy({}, {
  get(_, api) {
    if (typeof api === 'string' && ausentes.includes(api)) return undefined; // como no Chrome real
    if (api === 'runtime') {
      return { ...stubProfundo(), getURL: (p) => p, id: 'x', getManifest: () => manifest, lastError: undefined, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO(), onConnect: EVENTO(), reload: () => {} };
    }
    return stubProfundo();
  },
});
globalThis.WebSocket = class { constructor() { this.readyState = 0; } send() {} close() {} addEventListener() {} };
globalThis.self = globalThis;

const src = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');
console.log(`manifesto sem permissao para: ${ausentes.length ? ausentes.join(', ') : '(nada)'}`);
try {
  // eslint-disable-next-line no-new-func
  new Function(src)();
  console.log('OK    o service worker AVALIA sem estourar com as APIs que o manifesto concede');
} catch (err) {
  console.log('FALHA o service worker MORRE ao carregar — a extensao fica offline para todos os agentes');
  console.log('      ' + String(err && err.message));
  const alvo = ausentes.find((api) => src.includes(`chrome.${api}.`));
  if (alvo) {
    console.log(`      causa provavel: o codigo usa chrome.${alvo}, e "${alvo}" NAO esta em permissions do wxt.config.ts`);
  }
  process.exitCode = 1;
}
