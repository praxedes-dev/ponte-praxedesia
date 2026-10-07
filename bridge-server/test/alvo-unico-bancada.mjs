/**
 * BANCADA DO ALVO UNICO — freio x motor SEM Chrome (obra 25, 06/09/2026).
 *
 * Roda o codigo REAL de `bridge/policy.ts` (freio), de
 * `execution-engine/index.ts` (motor + `resolverAlvoDaAcao`) e das capacidades
 * que chamam `avaliar()`, empacotados por esbuild, contra um DOM de verdade
 * (linkedom) e um CDP simulado que EXECUTA os mesmos `functionDeclaration` que
 * os dois lados injetam na pagina. Herdada da bancada do cetico
 * (`cetico-bancada-freio-motor.mjs`) — a diferenca e o que ela afirma: aquela
 * documentava os furos 7 e 8 ABERTOS; esta afirma o contrato depois do
 * conserto, e e onde o mutation testing desta obra roda (nao precisa da
 * `.obra-lock`, nao mexe em `.output/`).
 *
 * O `despachar()` daqui repete, passo a passo, o que `bridge/index.ts` faz:
 * resolve o alvo UMA vez, passa para `avaliar` e passa o MESMO objeto para o
 * motor. Testar so `avaliar` provaria metade.
 *
 *   node bridge-server/test/_obra25-bundle.mjs <bundle>
 *   node bridge-server/test/alvo-unico-bancada.mjs <bundle>
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const BUNDLE = process.argv[2];
if (!BUNDLE) { console.error('uso: node alvo-unico-bancada.mjs <caminho do bundle>'); process.exit(2); }

let falhas = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` -- ${extra}` : ''}`);
  if (!ok) { falhas++; process.exitCode = 1; }
};

// ─────────────────────────────────────────────────────────── DOM da bancada
function montarPagina(html, rects) {
  const { document, window } = parseHTML(`<html><body>${html}</body></html>`);
  const Element = window.Element;
  Element.prototype.getBoundingClientRect = function () {
    const r = rects[this.id] ?? { x: 0, y: 0, width: 0, height: 0 };
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  };
  Object.defineProperty(Element.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
  });
  Object.defineProperty(Element.prototype, 'isContentEditable', {
    configurable: true, get() { return this.getAttribute('contenteditable') === 'true'; },
  });
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.focus = function () { document.__active = this; };
  document.elementFromPoint = (x, y) => {
    const todos = [...document.querySelectorAll('*')];
    let achado = null;
    for (const el of todos) {
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

// ────────────────────────────────────── CDP simulado que RODA o script real
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

  const rodar = (decl, thisArg, args = []) => {
    const fn = new Function(
      'document', 'window', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event',
      'return (' + decl + ')',
    )(document, window, window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement, window.Event);
    return fn.apply(thisArg, args);
  };

  /** Ligado por um teste para simular CDP recusando a conversa. */
  const quebrado = { getNodeForLocation: false, callFunctionOn: false };

  const send = async (tabId, method, params = {}) => {
    chamadas.push({ method, params });
    if (method === 'DOM.resolveNode') {
      const node = porBackendNodeId.get(params.backendNodeId);
      if (!node) throw new Error('no such node');
      return { object: { objectId: registrar(node) } };
    }
    if (method === 'DOM.describeNode') {
      const node = objetos.get(params.objectId);
      return { node: { backendNodeId: backendNodeIdDe(node) } };
    }
    if (method === 'DOM.focus') {
      const node = porBackendNodeId.get(params.backendNodeId);
      if (node) document.__active = node;
      return {};
    }
    if (method === 'Runtime.callFunctionOn') {
      if (quebrado.callFunctionOn) throw new Error('Target closed');
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
    // Emula o que o Chrome faz com uma tecla imprimivel: insere no focado.
    if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown' && typeof params.text === 'string' && params.text.length === 1) {
      const alvo = document.activeElement;
      if (alvo && 'value' in alvo) alvo.value = (alvo.value ?? '') + params.text;
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.getNodeForLocation') {
      if (quebrado.getNodeForLocation) throw new Error('Failed to deserialize params.x - BINDINGS: int32 value expected');
      const el = document.elementFromPoint(params.x, params.y);
      if (!el) throw new Error('No node found at given location');
      return { backendNodeId: backendNodeIdDe(el) };
    }
    return {};
  };
  return { send, chamadas, porBackendNodeId, backendNodeIdDe, objetos, quebrado };
}

const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });

function instalarChrome(document, window) {
  globalThis.document = document;
  globalThis.window = window;
  globalThis.chrome = {
    tabs: {
      get: async () => ({ id: 1, url: 'https://pje.tjro.jus.br/processo' }),
      sendMessage: async () => {},
      update: async () => {},
      remove: async () => {},
      query: async () => [],
      onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO(),
    },
    scripting: {
      executeScript: async ({ func, args = [] }) => {
        try {
          return [{ result: func(...args) }];
        } catch (err) {
          if (process.env.BANCADA_DEBUG) console.error('[bancada] executeScript estourou:', err);
          throw err;
        }
      },
    },
    debugger: { onDetach: EVENTO(), onEvent: EVENTO(), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
    runtime: { getURL: (p) => p, lastError: undefined, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO() },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: EVENTO() },
    alarms: { create: () => {}, onAlarm: EVENTO() },
    windows: { onBoundsChanged: EVENTO(), onRemoved: EVENTO(), create: async () => ({}), get: async () => ({}) },
    tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: EVENTO(), query: async () => [], update: async () => ({}) },
    webNavigation: { onCommitted: EVENTO(), onCompleted: EVENTO() },
  };
}

// ───────────────────────────────────────────────────────────────── cenarios
const FIXTURE = `
  <form id=f>
    <label id=rotulo for=senha>Senha <input id=senha type=password placeholder="Senha de acesso"></label>
    <input id=nome placeholder="Nome completo">
    <button id=protocolar>Protocolar inicial</button>
    <button id=avancado aria-label="Excluir conta definitivamente">Opcoes avancadas</button>
    <button id=excluir>Excluir conta</button>
    <div id=caixa role=textbox><input id=senha2 type=password placeholder="Confirme a senha"></div>
    <input id=busca placeholder="Buscar" value="pagar custas">
    <input id=submeter type=submit value="Pagar agora">
  </form>`;
const RECTS = {
  rotulo: { x: 10, y: 10, width: 200, height: 30 },
  senha: { x: 120, y: 12, width: 80, height: 24 },
  nome: { x: 10, y: 60, width: 200, height: 24 },
  protocolar: { x: 10, y: 100, width: 160, height: 30 },
  avancado: { x: 10, y: 140, width: 160, height: 30 },
  excluir: { x: 10, y: 180, width: 160, height: 30 },
  caixa: { x: 10, y: 220, width: 200, height: 30 },
  senha2: { x: 120, y: 222, width: 80, height: 24 },
  busca: { x: 10, y: 260, width: 200, height: 24 },
  submeter: { x: 10, y: 300, width: 160, height: 30 },
  f: { x: 0, y: 0, width: 400, height: 360 },
};

const pagina = montarPagina(FIXTURE, RECTS);
instalarChrome(pagina.document, pagina.window);
const amb = montarAmbiente(pagina);

const mod = await import(pathToFileURL(BUNDLE).href);
mod.debuggerManager.send = amb.send;
mod.debuggerManager.attach = async () => {};
mod.debuggerManager.screenshot = async () => '';

const ws = { workspaceId: 'w', activeTabId: 1, tabs: { 1: { url: 'https://pje.tjro.jus.br/processo' } } };
const refDe = (id) => amb.backendNodeIdDe(pagina.document.getElementById(id));
const val = (id) => pagina.document.getElementById(id).value ?? '';
const focar = (id) => { pagina.document.__active = id ? pagina.document.getElementById(id) : pagina.document.body; };
const zerar = () => {
  for (const id of ['senha', 'senha2', 'nome']) pagina.document.getElementById(id).value = '';
  pagina.document.getElementById('busca').value = 'pagar custas';
  amb.chamadas.length = 0;
};
const cliquesEm = (id) => {
  const r = RECTS[id];
  return amb.chamadas.filter((c) => c.method === 'Input.dispatchMouseEvent'
    && c.params.type === 'mousePressed'
    && c.params.x >= r.x && c.params.x <= r.x + r.width
    && c.params.y >= r.y && c.params.y <= r.y + r.height).length;
};

/**
 * O MESMO caminho de `bridge/index.ts`: resolve uma vez, avalia com aquele
 * alvo, e so entao chama o motor com o MESMO objeto.
 */
async function despachar(acao, confirm = false) {
  let resolucao;
  let alvo;
  if (mod.ACOES_COM_ALVO_UNICO.has(acao.type)) {
    resolucao = await mod.resolverAlvoDaAcao(acao, ws.activeTabId);
    if (resolucao.ok) alvo = resolucao.alvo;
    else if (resolucao.causa !== 'no-inexistente' && resolucao.causa !== 'sem-alvo') {
      return { bloqueado: true, motivo: `[bloqueado] ${acao.type}: ${resolucao.motivo}`, resolucao };
    }
  }
  const v = await mod.avaliar(acao, ws, confirm, alvo);
  if (!v.permitido) return { bloqueado: true, motivo: `[bloqueado] ${v.motivo}`, veredito: v };
  const res = await mod.executionEngine.run(acao, ws, resolucao);
  return { bloqueado: false, res, veredito: v, alvo };
}

const capDe = (modulo, nome) => modulo.capacidades.find((c) => c.nome === nome);
const ctxPara = (ref, params) => ({
  clientId: 'bancada', nome: 'bancada', ws, tabId: 1, ref, params, confirm: false,
  acao: 'cap', emSomenteLeitura: false,
});
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

console.log('=== BANCADA ALVO UNICO (sem Chrome) ===');

// ── 7-A: type com alvo semantico que NAO resolve, senha focada ────────────
zerar(); focar('senha');
const a = await despachar({ type: 'type', target: { strategy: 'semantic', text: 'segredo123' }, params: { text: 'segredo123' } });
check(a.bloqueado && /senha/i.test(a.motivo) && val('senha') === '',
  '7-A: type com alvo semantico que NAO resolve, senha focada -> BARRADO e nada escrito',
  `${a.bloqueado ? a.motivo.slice(0, 60) : 'passou'} valor=${JSON.stringify(val('senha'))}`);

// ── 7-A (sem falso positivo): mesmo caminho, campo comum focado ───────────
zerar(); focar('nome');
const a2 = await despachar({ type: 'type', target: { strategy: 'semantic', text: 'texto qualquer' }, params: { text: 'texto qualquer' } });
check(!a2.bloqueado && val('nome') === 'texto qualquer',
  '7-A (sem falso positivo): mesmo caminho com campo COMUM focado continua escrevendo',
  `bloqueado=${a2.bloqueado} valor=${JSON.stringify(val('nome'))}`);

// ── 7-B: type despacha clique real em botao destrutivo ────────────────────
zerar(); focar(null);
const b = await despachar({ type: 'type', target: { strategy: 'semantic', text: 'Protocolar inicial' }, params: { text: 'x' } });
check(b.bloqueado && /irreversivel|protocolar/i.test(b.motivo) && cliquesEm('protocolar') === 0,
  '7-B: type em botao destrutivo e BARRADO pela regra 4 e NAO clica',
  `${b.bloqueado ? b.motivo.slice(0, 70) : 'passou'} cliques=${cliquesEm('protocolar')}`);

// ── 7-C: type por ref de WRAPPER que contem <input type=password> ─────────
zerar(); focar(null);
const c1 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('rotulo') }, params: { text: 'outrosegredo' } });
check(c1.bloqueado && /senha/i.test(c1.motivo) && val('senha') === '',
  '7-C: ref do <label> (wrapper) e BARRADO — o freio julga o <input type=password> de dentro',
  `${c1.bloqueado ? c1.motivo.slice(0, 60) : 'passou'} valor=${JSON.stringify(val('senha'))}`);

zerar(); focar(null);
const c2 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('caixa') }, params: { text: 'vazou' } });
check(c2.bloqueado && /senha/i.test(c2.motivo) && val('senha2') === '',
  '7-C (2a face): ref do <div role=textbox> tambem e BARRADO pelo <input> interno',
  `${c2.bloqueado ? c2.motivo.slice(0, 60) : 'passou'} valor=${JSON.stringify(val('senha2'))}`);

// ── FURO 8: cap_autocomplete digitava antes de avaliar ────────────────────
zerar(); focar(null);
const erroAuto = await erroDe(() => capDe(mod.moduloAutocomplete, 'cap_autocomplete')
  .executar(ctxPara(refDe('senha'), { texto: 'segredo', timeout_ms: 200, delay_ms: 0 })));
check(/bloqueado/.test(erroAuto || '') && /senha/i.test(erroAuto || '') && val('senha') === '',
  'FURO 8: cap_autocomplete e BARRADO ANTES de digitar (nao escreve nada no campo de senha)',
  `erro=${(erroAuto || 'sem erro').slice(0, 70)} valor=${JSON.stringify(val('senha'))}`);

// ── regressao dos furos ja fechados antes desta obra ──────────────────────
zerar(); focar('senha');
const d = await despachar({ type: 'type', params: { text: 'x' } });
check(d.bloqueado, 'regressao FURO 6: type SEM target, senha focada, continua BARRADO', (d.motivo || '').slice(0, 50));

zerar(); focar(null);
const e = await despachar({ type: 'type', target: { strategy: 'semantic', placeholder: 'Senha de acesso' }, params: { text: 'x' } });
check(e.bloqueado && val('senha') === '', 'regressao FURO 3: type semantico que RESOLVE na senha continua BARRADO', (e.motivo || '').slice(0, 50));

zerar(); focar(null);
const f = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('senha') }, params: { text: 'x' } });
check(f.bloqueado && val('senha') === '', 'regressao: type por agent-id cru na senha continua BARRADO', (f.motivo || '').slice(0, 50));

zerar(); focar('senha');
const g = await despachar({ type: 'press_key', params: { key: 'a' } });
check(g.bloqueado, 'regressao: press_key de caractere isolado com senha focada continua BARRADO', (g.motivo || '').slice(0, 50));

zerar(); focar(null);
const h = await despachar({ type: 'click', target: { strategy: 'semantic', text: 'inicial' }, params: {} });
check(h.bloqueado, 'regressao FURO 4: busca por pedaco inocente ("inicial") continua BARRADA', (h.motivo || '').slice(0, 60));

const i = await despachar({ type: 'click', target: { strategy: 'semantic', ariaLabel: 'Excluir conta' }, params: {} });
check(i.bloqueado, 'regressao FURO 4: aria-label perigoso com innerText inocente continua BARRADO', (i.motivo || '').slice(0, 60));

// ── DEFESA NOVA: press_key que ATIVA o controle focado ────────────────────
zerar(); focar('excluir');
const j = await despachar({ type: 'press_key', params: { key: 'space' } });
check(j.bloqueado && /irreversivel|excluir/i.test(j.motivo),
  'NOVA: press_key "space" com botao "Excluir conta" focado e BARRADO (a tecla ativa o botao)',
  (j.motivo || 'passou').slice(0, 70));

const j2 = await despachar({ type: 'press_key', params: { key: 'Enter' } });
check(j2.bloqueado, 'NOVA: press_key "Enter" no mesmo botao focado tambem e BARRADO', (j2.motivo || 'passou').slice(0, 60));

focar('nome');
const j3 = await despachar({ type: 'press_key', params: { key: 'Enter' } });
check(!j3.bloqueado, 'NOVA (sem falso positivo): Enter em campo de TEXTO nao e barrado', (j3.motivo || '').slice(0, 60));

// ── DEFESA NOVA: drag com from == to e um clique disfarcado ───────────────
zerar(); focar(null);
const alvoExcluir = { x: RECTS.excluir.x + 5, y: RECTS.excluir.y + 5 };
const k = await despachar({
  type: 'drag',
  params: { fromX: alvoExcluir.x, fromY: alvoExcluir.y, toX: alvoExcluir.x, toY: alvoExcluir.y },
});
check(k.bloqueado && /irreversivel|excluir/i.test(k.motivo),
  'NOVA: browser_drag com from == to sobre "Excluir conta" e BARRADO (era clique sem freio nenhum)',
  (k.motivo || 'passou').slice(0, 70));

// ── DEFESA NOVA: falha FECHADA quando nao da para saber quem esta no ponto ─
zerar();
const semNo = await despachar({ type: 'click', target: { strategy: 'coordinates', x: 9000, y: 9000 }, params: {} });
check(semNo.bloqueado && /nao ha elemento|nao consegui identificar/i.test(semNo.motivo),
  'NOVA: click por coordenada sem elemento nenhum ali FALHA FECHADO (antes o freio liberava)',
  (semNo.motivo || 'passou').slice(0, 80));

zerar();
amb.quebrado.getNodeForLocation = true;
const cdpRuim = await despachar({ type: 'click', target: { strategy: 'semantic', text: 'Nome completo' }, params: {} });
amb.quebrado.getNodeForLocation = false;
check(cdpRuim.bloqueado,
  'NOVA: CDP recusando o hit-test FALHA FECHADO (nao clica sem saber em quem)',
  (cdpRuim.motivo || 'passou').slice(0, 80));

// ── mesma falha fechada pelo caminho das capacidades (avaliar resolve sozinho) ─
//
// `bridge/index.ts` resolve antes e passa o alvo; as capacidades `cap_*`
// chamam `avaliar` direto. Os dois caminhos tem de falhar do MESMO jeito —
// senao a defesa existe so em um deles.
zerar();
const vSemNo = await mod.avaliar({ type: 'click', target: { strategy: 'coordinates', x: 9000, y: 9000 }, params: {} }, ws, false);
check(vSemNo.permitido === false && vSemNo.confirmavel === false,
  'FALHA FECHADA tambem quando quem resolve e o proprio avaliar (caminho das capacidades)',
  `permitido=${vSemNo.permitido} confirmavel=${vSemNo.confirmavel}`);

const vRefFalso = await mod.avaliar({ type: 'click', target: { strategy: 'agent-id', agentId: 999999 }, params: {} }, ws, false);
check(vRefFalso.permitido === true,
  'excecao documentada: ref inexistente NAO e barrado pelo freio (o motor falha pelo mesmo motivo, com mensagem util)',
  `permitido=${vRefFalso.permitido}`);

// ── ref inexistente continua sendo erro DO MOTOR, com a mensagem util ─────
zerar();
const refFalso = await despachar({ type: 'click', target: { strategy: 'agent-id', agentId: 999999 }, params: {} });
check(!refFalso.bloqueado && refFalso.res?.success === false && /releia|read_page/i.test(refFalso.res?.error || ''),
  'ref inexistente NAO vira [bloqueado]: o motor falha pelo mesmo motivo e explica o que fazer',
  `bloqueado=${refFalso.bloqueado} erro=${(refFalso.res?.error || '').slice(0, 70)}`);

// ── sem falso positivo ────────────────────────────────────────────────────
zerar(); focar(null);
const l = await despachar({ type: 'type', target: { strategy: 'semantic', placeholder: 'Nome completo' }, params: { text: 'Fulano' } });
check(!l.bloqueado && val('nome') === 'Fulano',
  'sem falso positivo: digitar em campo NORMAL por busca semantica continua funcionando',
  `bloqueado=${l.bloqueado} valor=${JSON.stringify(val('nome'))}`);

zerar(); focar(null);
const m = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('nome') }, params: { text: 'Ciclano' } });
check(!m.bloqueado && val('nome') === 'Ciclano',
  'sem falso positivo: digitar em campo NORMAL por ref continua funcionando',
  `bloqueado=${m.bloqueado} valor=${JSON.stringify(val('nome'))}`);

zerar(); focar(null);
const n = await despachar({ type: 'click', target: { strategy: 'semantic', text: 'Opcoes avancadas' }, params: {} }, true);
check(!n.bloqueado && n.res?.success === true,
  'sem falso positivo: clique legitimo com confirm:true passa e o motor executa',
  `bloqueado=${n.bloqueado}`);

zerar(); focar(null);
const o = await despachar({ type: 'click', target: { strategy: 'semantic', text: 'Nome completo' }, params: {} });
check(!o.bloqueado && o.res?.success === true, 'sem falso positivo: clique em elemento inocente continua liberado');

// cap_form_input e cap_digitar legitimos
zerar(); focar(null);
const erroForm = await erroDe(() => capDe(mod.moduloFormulario, 'cap_form_input')
  .executar(ctxPara(refDe('nome'), { valor: 'Beltrano' })));
check(erroForm === null && val('nome') === 'Beltrano',
  'sem falso positivo: cap_form_input em campo comum continua preenchendo',
  `erro=${erroForm} valor=${JSON.stringify(val('nome'))}`);

zerar(); focar(null);
const erroSenhaForm = await erroDe(() => capDe(mod.moduloFormulario, 'cap_form_input')
  .executar(ctxPara(refDe('senha'), { valor: 'x' })));
check(/bloqueado/.test(erroSenhaForm || '') && val('senha') === '',
  'regressao: cap_form_input em campo de senha continua BARRADO', (erroSenhaForm || '').slice(0, 60));

zerar(); focar('nome');
const erroDigitar = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(undefined, { text: 'abc', delay_ms: 0 })));
check(erroDigitar === null && val('nome') === 'abc',
  'sem falso positivo: cap_digitar SEM ref no campo focado comum continua digitando',
  `erro=${erroDigitar} valor=${JSON.stringify(val('nome'))}`);

zerar(); focar('senha');
const erroDigitarSenha = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(undefined, { text: 'abc', delay_ms: 0 })));
check(/bloqueado/.test(erroDigitarSenha || '') && val('senha') === '',
  'regressao FURO 5: cap_digitar SEM ref com senha FOCADA continua BARRADO',
  `erro=${(erroDigitarSenha || '').slice(0, 60)} valor=${JSON.stringify(val('senha'))}`);

// ── regra 4 no `type`: clique-para-focar x clique de ACAO ────────────────
zerar(); focar(null);
const p1 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('busca') }, params: { text: 'x', clear: true } });
check(!p1.bloqueado && val('busca') === 'x',
  'sem falso positivo: digitar num campo cujo VALOR diz "pagar" nao e barrado (o clique so foca)',
  `bloqueado=${p1.bloqueado} valor=${JSON.stringify(val('busca'))}`);

zerar(); focar(null);
const p2 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('submeter') }, params: { text: 'x' } });
check(p2.bloqueado && /irreversivel|pagar/i.test(p2.motivo),
  'NOVA: `type` num <input type=submit value="Pagar agora"> continua BARRADO (casa input, mas e botao)',
  (p2.motivo || 'passou').slice(0, 70));

// ── uma resolucao so: o motor recusa acao sem alvo resolvido ──────────────
const semAlvo = await mod.executionEngine.run(
  { type: 'click', target: { strategy: 'semantic', text: 'Nome completo' }, params: {} }, ws,
);
check(semAlvo.success === false && /alvo resolvido/i.test(semAlvo.error || ''),
  'UMA RESOLUCAO SO: o motor recusa acao de ACOES_COM_ALVO_UNICO que chegue sem alvo',
  (semAlvo.error || '').slice(0, 80));

// ── o freio e o motor terminam no MESMO no ────────────────────────────────
zerar(); focar(null);
const rWrapper = await mod.resolverAlvoDaAcao(
  { type: 'type', target: { strategy: 'agent-id', agentId: refDe('caixa') }, params: { text: 'x' } }, 1,
);
check(rWrapper.ok && rWrapper.alvo.efetivo.backendNodeId === refDe('senha2') && rWrapper.alvo.efetivo.desceu === true,
  'travessia: o efetivo do <div role=textbox> e o <input type=password> de dentro (o mesmo que cdpType escreveria)',
  rWrapper.ok ? `efetivo=${rWrapper.alvo.efetivo.backendNodeId} senha2=${refDe('senha2')}` : rWrapper.motivo);

const rClique = await mod.resolverAlvoDaAcao(
  { type: 'click', target: { strategy: 'agent-id', agentId: refDe('caixa') }, params: {} }, 1,
);
check(rClique.ok && rClique.alvo.efetivo.backendNodeId === refDe('caixa'),
  'travessia: clique NAO desce (a familia da acao decide) — o efetivo continua sendo o no clicado',
  rClique.ok ? `efetivo=${rClique.alvo.efetivo.backendNodeId} caixa=${refDe('caixa')}` : rClique.motivo);

// ── fronteira dos resolvedores antigos (nao regrediram) ───────────────────
const fronteirasSwitch = [
  [{ params: { tabId: 0 } }, null], [{ params: { tabId: -1 } }, null], [{ params: { tabId: NaN } }, null],
  [{ params: { tabId: '0' } }, null], [{ params: { tabId: null }, target: { agentId: 7 } }, 7],
  [{ params: {}, target: { agentId: 0 } }, null], [{ params: { tabId: 12 }, target: { agentId: 99 } }, 12],
];
check(fronteirasSwitch.every(([acao, esperado]) => mod.resolverAlvoDeSwitchTab(acao) === esperado),
  'fronteira: resolverAlvoDeSwitchTab continua falhando FECHADO em 0/-1/NaN/"0"');
check(mod.resolverAlvoDeCloseTab({ params: { tabId: 0 }, target: { agentId: 9 } }, 55) === 0
  && mod.resolverAlvoDeCloseTab({ params: {}, target: {} }, 55) === 55,
  'fronteira: resolverAlvoDeCloseTab continua tratando 0 como tabId valido');

console.log(`\n=== ${falhas} FALHA(S) ===`);
