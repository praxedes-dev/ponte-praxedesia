/**
 * CUSTO REAL do alvo unico: tempo de parede e idas ao CDP, num Chromium DE
 * VERDADE, HEAD contra o codigo desta obra. O pedreiro so conseguiu contar
 * round-trips (a bancada dele nao tem navegador); aqui o Blink responde, entao
 * o numero inclui layout, hit-test e injecao de script de verdade.
 *
 *   node custo-real.mjs <bundleAntes> <bundleDepois> [repeticoes]
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [ANTES, DEPOIS, REPS = '15'] = process.argv.slice(2);
const N = Number(REPS);

const RAIZ = 'C:/Users/Cezar/AppData/Local/ms-playwright';
const dirChromium = readdirSync(RAIZ).filter((d) => d.startsWith('chromium-')).sort().pop();
const EXE = join(RAIZ, dirChromium, 'chrome-win64', 'chrome.exe');
const perfil = mkdtempSync(join(tmpdir(), 'cetico-custo-'));
const HTML = join(perfil, 'p.html');

// Pagina com bastante elemento, para a varredura semantica custar como no PJe.
const ruido = Array.from({ length: 400 }, (_, i) =>
  `<div class=l><a href="#a${i}">link ${i}</a> <button type=button>acao ${i}</button> <input placeholder="campo ${i}"></div>`).join('');
writeFileSync(HTML, `<!doctype html><meta charset=utf-8><style>.l{padding:2px}</style><body>
<button id=alvo type=button>Ver detalhes do processo</button>
<input id=campo placeholder="Nome completo">
${ruido}</body>`);

const proc = spawn(EXE, [
  '--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1200,900',
  `file:///${HTML.replace(/\\/g, '/')}`,
], { stdio: ['ignore', 'pipe', 'pipe'] });
proc.stderr.on('data', () => {});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let alvoWs;
for (let i = 0; i < 40 && !alvoWs; i++) {
  await espera(250);
  try {
    const l = await fetch('http://127.0.0.1:9335/json/list').then((r) => r.json());
    alvoWs = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
}
if (!alvoWs) { console.error('nao subiu'); proc.kill(); process.exit(2); }
const ws = new WebSocket(alvoWs.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
let idas = 0;
const cdp = (method, params = {}) => new Promise((res, rej) => {
  idas++;
  const meu = ++seq;
  pend.set(meu, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: meu, method, params }));
});
await cdp('DOM.enable'); await cdp('Runtime.enable');

let scripts = 0;
const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
globalThis.chrome = {
  tabs: { get: async () => ({ id: 1, url: 'https://pje.tjro.jus.br/x' }), sendMessage: async () => {}, update: async () => {}, remove: async () => {}, query: async () => [], onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO() },
  scripting: { executeScript: async ({ func, args = [] }) => {
    scripts++;
    const r = await cdp('Runtime.evaluate', { expression: `(${func.toString()}).apply(null, ${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true });
    return [{ result: r?.result?.value ?? null }];
  } },
  debugger: { onDetach: EVENTO(), onEvent: EVENTO(), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
  runtime: { getURL: (p) => p, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO() },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: EVENTO() },
  alarms: { create: () => {}, onAlarm: EVENTO() },
  windows: { onBoundsChanged: EVENTO(), onRemoved: EVENTO(), create: async () => ({}), get: async () => ({}) },
  tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: EVENTO(), query: async () => [], update: async () => ({}) },
  webNavigation: { onCommitted: EVENTO(), onCompleted: EVENTO() },
};

const doc = await cdp('DOM.getDocument', { depth: -1 });
const refDe = async (sel) => {
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
  return (await cdp('DOM.describeNode', { nodeId })).node.backendNodeId;
};
const REF = { alvo: await refDe('#alvo'), campo: await refDe('#campo') };
const ws0 = { workspaceId: 'w', activeTabId: 1, tabs: { 1: { url: 'https://pje.tjro.jus.br/x' } } };

async function medir(caminho, rotulo) {
  const mod = await import(pathToFileURL(caminho).href + `?v=${Date.now()}`);
  mod.debuggerManager.send = async (_t, m, p) => cdp(m, p);
  mod.debuggerManager.attach = async () => {};
  const novo = Boolean(mod.ACOES_COM_ALVO_UNICO);

  const despachar = async (acao) => {
    if (novo) {
      let resolucao, alvo;
      if (mod.ACOES_COM_ALVO_UNICO.has(acao.type)) {
        resolucao = await mod.resolverAlvoDaAcao(acao, 1);
        if (resolucao.ok) alvo = resolucao.alvo;
      }
      const v = await mod.avaliar(acao, ws0, false, alvo);
      if (!v.permitido) return;
      await mod.executionEngine.run(acao, ws0, resolucao);
    } else {
      const v = await mod.avaliar(acao, ws0, false);
      if (!v.permitido) return;
      await mod.executionEngine.run(acao, ws0);
    }
  };

  const casos = {
    'click por ref': { type: 'click', target: { strategy: 'agent-id', agentId: REF.alvo } },
    'click semantico': { type: 'click', target: { strategy: 'semantic', text: 'Ver detalhes do processo' } },
    'type por ref': { type: 'type', target: { strategy: 'agent-id', agentId: REF.campo }, params: { text: 'x', clear: true } },
    'type semantico': { type: 'type', target: { strategy: 'semantic', placeholder: 'Nome completo' }, params: { text: 'x', clear: true } },
    'press_key': { type: 'press_key', params: { key: 'a' } },
  };
  const linhas = {};
  for (const [nome, acao] of Object.entries(casos)) {
    await despachar(acao); // aquecimento
    idas = 0; scripts = 0;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await despachar(acao);
    const ms = (performance.now() - t0) / N;
    linhas[nome] = { ms: ms.toFixed(1), cdp: (idas / N).toFixed(1), js: (scripts / N).toFixed(1) };
  }
  console.log(`\n--- ${rotulo} (${novo ? 'alvo unico' : 'HEAD'}) — media de ${N} execucoes ---`);
  for (const [n, v] of Object.entries(linhas)) {
    console.log(`  ${n.padEnd(18)} ${String(v.ms).padStart(7)} ms   ${String(v.cdp).padStart(5)} idas CDP   ${String(v.js).padStart(4)} injecoes`);
  }
  return linhas;
}

const a = await medir(ANTES, 'ANTES');
const d = await medir(DEPOIS, 'DEPOIS');

console.log('\n=== DELTA (ms por acao, negativo = ficou mais rapido) ===');
for (const n of Object.keys(a)) {
  const dif = Number(d[n].ms) - Number(a[n].ms);
  const pct = ((dif / Number(a[n].ms)) * 100).toFixed(0);
  console.log(`  ${n.padEnd(18)} ${a[n].ms} -> ${d[n].ms} ms  (${dif >= 0 ? '+' : ''}${dif.toFixed(1)} ms, ${pct}%)   CDP ${a[n].cdp}->${d[n].cdp}  injecoes ${a[n].js}->${d[n].js}`);
}
ws.close(); proc.kill();
