/**
 * SONDA DO CETICO (obra 25) — o no EFETIVO que o freio julgou nem sempre e o
 * que recebe o texto.
 *
 * Mesma bancada do pedreiro (linkedom + CDP simulado que roda os scripts de
 * verdade), com UMA correcao de fidelidade ao Chrome:
 *
 *   - `DOM.focus` no CDP real FALHA ("Element is not focusable") num no que nao
 *     aceita foco (div/span/label sem tabindex). Na bancada do pedreiro ele
 *     sempre grava `__active`, e por isso o fallback do motor nunca aparece.
 *   - `HTMLElement.focus()` num no nao focavel e no-op no navegador. Idem.
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const BUNDLE = process.argv[2];
let falhas = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` -- ${extra}` : ''}`);
  if (!ok) { falhas++; process.exitCode = 1; }
};

const FOCAVEL = 'input,textarea,select,button,a[href],[tabindex],[contenteditable="true"]';

function montarPagina(html, rects) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  const Element = window.Element;
  Element.prototype.getBoundingClientRect = function () {
    const r = rects[this.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  };
  Object.defineProperty(Element.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; },
  });
  Object.defineProperty(Element.prototype, 'isContentEditable', {
    configurable: true, get() { return this.getAttribute('contenteditable') === 'true'; },
  });
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.focus = function () { if (this.matches && this.matches(FOCAVEL)) document.__active = this; };
  document.elementFromPoint = (x, y) => {
    let achado = null;
    for (const el of [...document.querySelectorAll('*')]) {
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

function montarAmbiente({ document, window }) {
  const chamadas = [];
  const objetos = new Map();
  const porBackendNodeId = new Map();
  let seq = 0;
  const registrar = (node) => {
    for (const [id, n] of objetos) if (n === node) return id;
    const id = `obj${++seq}`; objetos.set(id, node); return id;
  };
  [...document.querySelectorAll('*')].forEach((el, i) => porBackendNodeId.set(1000 + i, el));
  const backendNodeIdDe = (el) => [...porBackendNodeId].find(([, n]) => n === el)?.[0];
  const rodar = (decl, thisArg, args = []) => new Function(
    'document', 'window', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event',
    'return (' + decl + ')',
  )(document, window, window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement, window.Event)
    .apply(thisArg, args);

  const send = async (tabId, method, params = {}) => {
    chamadas.push({ method, params });
    if (method === 'DOM.resolveNode') {
      const node = porBackendNodeId.get(params.backendNodeId);
      if (!node) throw new Error('no such node');
      return { object: { objectId: registrar(node) } };
    }
    if (method === 'DOM.describeNode') return { node: { backendNodeId: backendNodeIdDe(objetos.get(params.objectId)) } };
    if (method === 'DOM.focus') {
      const node = porBackendNodeId.get(params.backendNodeId);
      if (!node || !(node.matches && node.matches(FOCAVEL))) throw new Error('Element is not focusable');
      document.__active = node;
      return {};
    }
    if (method === 'Runtime.callFunctionOn') {
      const alvo = objetos.get(params.objectId);
      const valor = rodar(params.functionDeclaration, alvo, (params.arguments ?? []).map((a) => a.value));
      if (params.returnByValue) return { result: { value: valor } };
      return { result: { objectId: valor && typeof valor === 'object' ? registrar(valor) : undefined } };
    }
    if (method === 'Runtime.evaluate') {
      const valor = rodar(`function(){ return (${params.expression}); }`, undefined, []);
      if (params.returnByValue) return { result: { value: valor } };
      return { result: { objectId: valor && typeof valor === 'object' ? registrar(valor) : undefined } };
    }
    if (method === 'DOMDebugger.getEventListeners') return { listeners: [] };
    if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown' && typeof params.text === 'string' && params.text.length === 1) {
      const alvo = document.activeElement;
      if (alvo && 'value' in alvo) alvo.value = (alvo.value ?? '') + params.text;
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.getNodeForLocation') {
      const el = document.elementFromPoint(params.x, params.y);
      if (!el) throw new Error('No node found at given location');
      return { backendNodeId: backendNodeIdDe(el) };
    }
    return {};
  };
  return { send, chamadas, backendNodeIdDe };
}

const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
function instalarChrome(document, window) {
  globalThis.document = document; globalThis.window = window;
  globalThis.chrome = {
    tabs: { get: async () => ({ id: 1, url: 'https://pje.tjro.jus.br/x' }), sendMessage: async () => {}, update: async () => {}, remove: async () => {}, query: async () => [], onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO() },
    scripting: { executeScript: async ({ func, args = [] }) => [{ result: func(...args) }] },
    debugger: { onDetach: EVENTO(), onEvent: EVENTO(), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
    runtime: { getURL: (p) => p, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO() },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: EVENTO() },
    alarms: { create: () => {}, onAlarm: EVENTO() },
    windows: { onBoundsChanged: EVENTO(), onRemoved: EVENTO(), create: async () => ({}), get: async () => ({}) },
    tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: EVENTO(), query: async () => [], update: async () => ({}) },
    webNavigation: { onCommitted: EVENTO(), onCompleted: EVENTO() },
  };
}

const FIXTURE = [
  '<form id=f>',
  '<input id=senha type=password placeholder="Senha de acesso">',
  '<div id=caixa>Ajuda</div>',
  '<span id=rotulo>Digite aqui</span>',
  '<input id=nome placeholder="Nome">',
  '</form>',
].join('');
const RECTS = {
  senha: { x: 10, y: 10, width: 200, height: 24 },
  caixa: { x: 10, y: 50, width: 200, height: 24 },
  rotulo: { x: 10, y: 90, width: 200, height: 24 },
  nome: { x: 10, y: 130, width: 200, height: 24 },
  f: { x: 0, y: 0, width: 400, height: 200 },
};

const pagina = montarPagina(FIXTURE, RECTS);
instalarChrome(pagina.document, pagina.window);
const amb = montarAmbiente(pagina);
const mod = await import(pathToFileURL(BUNDLE).href);
mod.debuggerManager.send = amb.send;
mod.debuggerManager.attach = async () => {};

const ws = { workspaceId: 'w', activeTabId: 1, tabs: { 1: { url: 'https://pje.tjro.jus.br/x' } } };
const refDe = (id) => amb.backendNodeIdDe(pagina.document.getElementById(id));
const val = (id) => pagina.document.getElementById(id).value ?? '';
const focar = (id) => { pagina.document.__active = pagina.document.getElementById(id); };
const zerar = () => { for (const id of ['senha', 'nome']) pagina.document.getElementById(id).value = ''; amb.chamadas.length = 0; };

async function despachar(acao, confirm = false) {
  let resolucao, alvo;
  if (mod.ACOES_COM_ALVO_UNICO.has(acao.type)) {
    resolucao = await mod.resolverAlvoDaAcao(acao, ws.activeTabId);
    if (resolucao.ok) alvo = resolucao.alvo;
    else if (resolucao.causa !== 'no-inexistente' && resolucao.causa !== 'sem-alvo') {
      return { bloqueado: true, motivo: `[bloqueado] ${acao.type}: ${resolucao.motivo}` };
    }
  }
  const v = await mod.avaliar(acao, ws, confirm, alvo);
  if (!v.permitido) return { bloqueado: true, motivo: `[bloqueado] ${v.motivo}`, alvo };
  const res = await mod.executionEngine.run(acao, ws, resolucao);
  return { bloqueado: false, res, alvo };
}
const capDe = (m, nome) => m.capacidades.find((c) => c.nome === nome);
const ctxPara = (ref, params) => ({ clientId: 'c', nome: 'c', ws, tabId: 1, ref, params, confirm: false, acao: 'cap', emSomenteLeitura: false });
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

console.log('=== SONDA DO CETICO: efetivo nao-campo + foco em senha ===');

zerar(); focar('senha');
const e1 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('caixa'), { text: 'SEGREDO1', delay_ms: 0 })));
check(val('senha') === '', 'cap_digitar ref=<div> com senha focada NAO escreve na senha',
  `erro=${e1} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const e2 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('rotulo'), { text: 'SEGREDO2', delay_ms: 0 })));
check(val('senha') === '', 'cap_digitar ref=<span> com senha focada NAO escreve na senha',
  `erro=${e2} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const t1 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('caixa') }, params: { text: 'SEGREDO3' } });
check(val('senha') === '', 'type ref=<div> com senha focada NAO escreve na senha',
  `bloqueado=${t1.bloqueado} efetivo=${t1.alvo?.efetivo?.tag}/${t1.alvo?.efetivo?.tipo} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const t2 = await despachar({ type: 'type', target: { strategy: 'semantic', text: 'Digite aqui' }, params: { text: 'SEGREDO4' } });
check(val('senha') === '', 'type semantico -> <span> com senha focada NAO escreve na senha',
  `bloqueado=${t2.bloqueado} como=${t2.alvo?.como} efetivo=${t2.alvo?.efetivo?.tag} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const e5 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('nome'), { text: 'ok', delay_ms: 0 })));
check(val('nome') === 'ok' && val('senha') === '', 'controle: cap_digitar ref=<input> comum escreve no campo certo',
  `erro=${e5} nome=${JSON.stringify(val('nome'))} senha=${JSON.stringify(val('senha'))}`);

console.log(`\n=== ${falhas} FALHA(S) ===`);
