/**
 * Custo do alvo unico: quantas idas ao CDP (dm.send) e quantas injecoes de
 * script (chrome.scripting.executeScript) cada acao paga, ANTES (codigo de
 * HEAD, extraido com `git archive`, sem tocar na arvore de trabalho) e DEPOIS
 * (codigo desta obra).
 *
 *   node custo.mjs <bundleAntes> <bundleDepois>
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const [BUNDLE_ANTES, BUNDLE_DEPOIS] = process.argv.slice(2);

function montar() {
  const { document, window } = parseHTML(`<html><body>
    <form id=f>
      <label id=rotulo for=senha>Rotulo <input id=campo placeholder="Nome completo"></label>
      <button id=botao>Ver detalhes do processo</button>
    </form></body></html>`);
  const RECTS = {
    rotulo: { x: 10, y: 10, width: 200, height: 30 },
    campo: { x: 120, y: 12, width: 80, height: 24 },
    botao: { x: 10, y: 100, width: 160, height: 30 },
    f: { x: 0, y: 0, width: 400, height: 200 },
  };
  const Element = window.Element;
  Element.prototype.getBoundingClientRect = function () {
    const r = RECTS[this.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  };
  Object.defineProperty(Element.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; },
  });
  Object.defineProperty(Element.prototype, 'isContentEditable', {
    configurable: true, get() { return this.getAttribute('contenteditable') === 'true'; },
  });
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.focus = function () { document.__active = this; };
  document.elementFromPoint = (x, y) => {
    let achado = null;
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) achado = el;
    }
    return achado;
  };
  Object.defineProperty(document, 'activeElement', {
    configurable: true, get() { return document.__active ?? document.body; },
  });
  return { document, window };
}

const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });

function ambiente({ document, window }) {
  const conta = { send: 0, script: 0 };
  const objetos = new Map();
  const porId = new Map();
  let seq = 0;
  const registrar = (n) => { for (const [k, v] of objetos) if (v === n) return k; const k = `o${++seq}`; objetos.set(k, n); return k; };
  [...document.querySelectorAll('*')].forEach((el, i) => porId.set(1000 + i, el));
  const idDe = (el) => [...porId].find(([, n]) => n === el)?.[0];
  const rodar = (decl, thisArg, args = []) => new Function(
    'document', 'window', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event',
    'return (' + decl + ')',
  )(document, window, window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement, window.Event)
    .apply(thisArg, args);

  const send = async (tabId, method, params = {}) => {
    conta.send++;
    if (method === 'DOM.resolveNode') {
      const n = porId.get(params.backendNodeId);
      if (!n) throw new Error('no such node');
      return { object: { objectId: registrar(n) } };
    }
    if (method === 'DOM.describeNode') return { node: { backendNodeId: idDe(objetos.get(params.objectId)) } };
    if (method === 'DOM.focus') { const n = porId.get(params.backendNodeId); if (n) document.__active = n; return {}; }
    if (method === 'Runtime.callFunctionOn') {
      const v = rodar(params.functionDeclaration, objetos.get(params.objectId), (params.arguments ?? []).map((a) => a.value));
      return params.returnByValue ? { result: { value: v } } : { result: { objectId: v && typeof v === 'object' ? registrar(v) : undefined } };
    }
    if (method === 'Runtime.evaluate') {
      const v = rodar(`function(){ return (${params.expression}); }`, undefined, []);
      return params.returnByValue ? { result: { value: v } } : { result: { objectId: v && typeof v === 'object' ? registrar(v) : undefined } };
    }
    if (method === 'DOMDebugger.getEventListeners') return { listeners: [] };
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.getNodeForLocation') {
      const el = document.elementFromPoint(params.x, params.y);
      if (!el) throw new Error('No node found at given location');
      return { backendNodeId: idDe(el) };
    }
    return {};
  };
  globalThis.document = document;
  globalThis.window = window;
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 1, url: 'https://pje.tjro.jus.br/x' }), sendMessage: async () => {}, update: async () => {}, remove: async () => {}, query: async () => [], onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO() },
    scripting: { executeScript: async ({ func, args = [] }) => { conta.script++; return [{ result: func(...args) }]; } },
    debugger: { onDetach: EVENTO(), onEvent: EVENTO(), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
    runtime: { getURL: (p) => p, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO() },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: EVENTO() },
    alarms: { create: () => {}, onAlarm: EVENTO() },
    windows: { onBoundsChanged: EVENTO(), onRemoved: EVENTO(), create: async () => ({}), get: async () => ({}) },
    tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: EVENTO(), query: async () => [], update: async () => ({}) },
    webNavigation: { onCommitted: EVENTO(), onCompleted: EVENTO() },
  };
  return { send, conta, idDe, document };
}

async function medir(bundle, novo) {
  const pagina = montar();
  const amb = ambiente(pagina);
  const mod = await import(pathToFileURL(bundle).href + `?v=${Math.random()}`);
  mod.debuggerManager.send = amb.send;
  mod.debuggerManager.attach = async () => {};
  const ws = { workspaceId: 'w', activeTabId: 1, tabs: { 1: { url: 'https://pje.tjro.jus.br/x' } } };
  const refBotao = amb.idDe(pagina.document.getElementById('botao'));
  const refCampo = amb.idDe(pagina.document.getElementById('campo'));

  const cenarios = {
    'click semantico': { type: 'click', target: { strategy: 'semantic', text: 'Ver detalhes' }, params: {} },
    'click por ref': { type: 'click', target: { strategy: 'agent-id', agentId: refBotao }, params: {} },
    'type por ref': { type: 'type', target: { strategy: 'agent-id', agentId: refCampo }, params: { text: 'abc' } },
    'type semantico': { type: 'type', target: { strategy: 'semantic', placeholder: 'Nome completo' }, params: { text: 'abc' } },
    'press_key': { type: 'press_key', params: { key: 'a' } },
  };

  const placar = {};
  for (const [nome, acao] of Object.entries(cenarios)) {
    amb.conta.send = 0; amb.conta.script = 0;
    if (novo) {
      const r = await mod.resolverAlvoDaAcao(acao, 1);
      await mod.avaliar(acao, ws, false, r.ok ? r.alvo : undefined);
      await mod.executionEngine.run(acao, ws, r);
    } else {
      await mod.avaliar(acao, ws, false);
      await mod.executionEngine.run(acao, ws);
    }
    placar[nome] = { cdp: amb.conta.send, script: amb.conta.script };
  }
  return placar;
}

const antes = await medir(BUNDLE_ANTES, false);
const depois = await medir(BUNDLE_DEPOIS, true);

console.log('acao                  | CDP antes | CDP depois | script antes | script depois');
console.log('----------------------|-----------|------------|--------------|--------------');
for (const nome of Object.keys(antes)) {
  const a = antes[nome]; const d = depois[nome];
  console.log(`${nome.padEnd(21)} | ${String(a.cdp).padStart(9)} | ${String(d.cdp).padStart(10)} | ${String(a.script).padStart(12)} | ${String(d.script).padStart(13)}`);
}
