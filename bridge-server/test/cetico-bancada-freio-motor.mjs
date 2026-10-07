/**
 * BANCADA DO CETICO — freio x motor SEM Chrome (06/09/2026).
 *
 * Por que existe: a extensao da ponte caiu offline (extensionOnline:false) e
 * nao reconecta sozinha, entao NAO deu para medir ao vivo. Esta bancada roda o
 * codigo REAL de `bridge/policy.ts` (o freio) e de `execution-engine/index.ts`
 * (o motor), empacotados por esbuild, contra um DOM de verdade (linkedom) e um
 * CDP simulado que EXECUTA os mesmos `functionDeclaration`/`func` que os dois
 * lados injetam na pagina. Nao substitui a medicao no Chrome — mas nao inventa
 * o comportamento de nenhum dos dois lados: quem decide continua sendo o
 * arquivo de producao.
 *
 *   node build-bundle-cetico.mjs <saida>   (na raiz, gera o bundle)
 *   node bridge-server/test/cetico-bancada-freio-motor.mjs <bundle>
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const BUNDLE = process.argv[2];
if (!BUNDLE) { console.error('uso: node cetico-bancada-freio-motor.mjs <caminho do bundle>'); process.exit(2); }

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
    // Emula o que o Chrome faz com uma tecla imprimivel: insere no elemento
    // focado. E o que `digitarTeclaATecla` (cap_digitar/cap_autocomplete) usa.
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
  return { send, chamadas, porBackendNodeId, backendNodeIdDe, objetos };
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
  </form>`;
const RECTS = {
  rotulo: { x: 10, y: 10, width: 200, height: 30 },
  senha: { x: 120, y: 12, width: 80, height: 24 },
  nome: { x: 10, y: 60, width: 200, height: 24 },
  protocolar: { x: 10, y: 100, width: 160, height: 30 },
  avancado: { x: 10, y: 140, width: 160, height: 30 },
  f: { x: 0, y: 0, width: 400, height: 200 },
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
const valorSenha = () => pagina.document.getElementById('senha').value ?? '';
const zerar = () => { pagina.document.getElementById('senha').value = ''; amb.chamadas.length = 0; };

console.log('=== BANCADA FREIO x MOTOR (sem Chrome) ===');

// ── 7-A: type com alvo semantico que NAO resolve
zerar();
pagina.document.__active = pagina.document.getElementById('senha');
const acaoA = { type: 'type', target: { strategy: 'semantic', text: 'segredo123' }, params: { text: 'segredo123', clear: false } };
const vA = await mod.avaliar(acaoA, ws, false);
const rA = await mod.executionEngine.run(acaoA, ws);
console.log(`[7-A] freio: permitido=${vA.permitido} | motor: ok=${rA.success} | senha no DOM=${JSON.stringify(valorSenha())}`);
check(vA.permitido === true && valorSenha() === 'segredo123',
  '7-A: FURO -- browser_type sem ref (alvo semantico nao resolvido) escreve no campo de SENHA focado e o freio libera',
  `permitido=${vA.permitido} valor=${JSON.stringify(valorSenha())}`);

// ── 7-B: type dispara CLIQUE REAL no botao destrutivo
zerar();
pagina.document.__active = pagina.document.body;
const acaoB = { type: 'type', target: { strategy: 'semantic', text: 'Protocolar inicial' }, params: { text: 'Protocolar inicial' } };
const vB = await mod.avaliar(acaoB, ws, false);
await mod.executionEngine.run(acaoB, ws);
const cliques = amb.chamadas.filter((c) => c.method === 'Input.dispatchMouseEvent' && c.params.type === 'mousePressed');
const noBotao = cliques.some((c) => c.params.x >= 10 && c.params.x <= 170 && c.params.y >= 100 && c.params.y <= 130);
console.log(`[7-B] freio: permitido=${vB.permitido} | cliques=${cliques.length} | em cima do "Protocolar inicial"=${noBotao}`);
check(vB.permitido === true && noBotao,
  '7-B: FURO -- type clica DE VERDADE no "Protocolar inicial" e a regra 4 (clique destrutivo) nunca roda',
  `permitido=${vB.permitido} cliqueNoBotao=${noBotao}`);

const vB2 = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', text: 'Protocolar inicial' }, params: {} }, ws, false);
check(vB2.permitido === false,
  '7-B (contraprova): o MESMO alvo, como `click`, e barrado pela regra 4 -- so muda o nome da acao',
  (vB2.motivo || '').slice(0, 70));

// ── 7-C: type por ref de WRAPPER (<label>)
zerar();
pagina.document.__active = pagina.document.body;
const acaoC = { type: 'type', target: { strategy: 'agent-id', agentId: refDe('rotulo') }, params: { text: 'outrosegredo' } };
const vC = await mod.avaliar(acaoC, ws, false);
await mod.executionEngine.run(acaoC, ws);
console.log(`[7-C] freio: permitido=${vC.permitido} | senha no DOM=${JSON.stringify(valorSenha())}`);
check(vC.permitido === true && valorSenha() === 'outrosegredo',
  '7-C: FURO -- ref do <label> (wrapper): o freio SOBE ao ancestral e ve "label", o cdpType DESCE e escreve na senha',
  `permitido=${vC.permitido} valor=${JSON.stringify(valorSenha())}`);

// ── regressao dos furos ja consertados
zerar();
pagina.document.__active = pagina.document.getElementById('senha');
const vD = await mod.avaliar({ type: 'type', params: { text: 'x' } }, ws, false);
check(vD.permitido === false, 'regressao FURO 6: type SEM target nenhum, com senha focada, continua BARRADO', (vD.motivo || '').slice(0, 50));

const vE = await mod.avaliar({ type: 'type', target: { strategy: 'semantic', placeholder: 'Senha de acesso' }, params: { text: 'x' } }, ws, false);
check(vE.permitido === false, 'regressao FURO 3: type semantico que RESOLVE no campo de senha continua BARRADO', (vE.motivo || '').slice(0, 50));

const vF = await mod.avaliar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('senha') }, params: { text: 'x' } }, ws, false);
check(vF.permitido === false, 'regressao: type por agent-id cru no campo de senha continua BARRADO', (vF.motivo || '').slice(0, 50));

const vG = await mod.avaliar({ type: 'press_key', params: { key: 'a' } }, ws, false);
check(vG.permitido === false, 'regressao press_key: caractere isolado com senha focada continua BARRADO', (vG.motivo || '').slice(0, 50));

// FURO 4: buscar por um PEDACO inocente do texto -- so barra quem julga o ELEMENTO
const vO = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', text: 'inicial' }, params: {} }, ws, false);
check(vO.permitido === false,
  'regressao FURO 4: busca por pedaco inocente ("inicial") do botao "Protocolar inicial" continua BARRADA',
  (vO.motivo || '').slice(0, 60));

// FURO 4 (ariaLabel): innerText inocente, aria-label perigoso
const vP = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', ariaLabel: 'Excluir conta' }, params: {} }, ws, false);
check(vP.permitido === false,
  'regressao FURO 4: botao com innerText inocente e aria-label "Excluir conta definitivamente" continua BARRADO',
  (vP.motivo || '').slice(0, 60));

// ── falso positivo
zerar();
pagina.document.__active = pagina.document.getElementById('nome');
const alvoNome = { type: 'type', target: { strategy: 'semantic', placeholder: 'Nome completo' }, params: { text: 'Fulano' } };
const vH = await mod.avaliar(alvoNome, ws, false);
const rH = await mod.executionEngine.run(alvoNome, ws);
check(vH.permitido === true && rH.success === true && pagina.document.getElementById('nome').value === 'Fulano',
  'sem falso positivo: digitar em campo NORMAL por busca semantica continua funcionando',
  `permitido=${vH.permitido} valor=${JSON.stringify(pagina.document.getElementById('nome').value)}`);

const vI = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', text: 'Nome completo' }, params: {} }, ws, false);
check(vI.permitido === true, 'sem falso positivo: clique em elemento inocente continua liberado');

const vJ = await mod.avaliar({ type: 'press_key', params: { key: 'Enter' } }, ws, false);
check(vJ.permitido === true, 'sem falso positivo: press_key de tecla de controle (Enter) nao e barrado');

// ── cap_digitar (FURO 5, consertado) x cap_autocomplete (mesmo digitador, SEM freio)
const capDe = (mod2, nome) => mod2.capacidades.find((c) => c.nome === nome);
const ctxPara = (ref, params) => ({
  clientId: 'cetico', nome: 'cetico', ws, tabId: 1, ref, params, confirm: false,
  acao: 'cap', emSomenteLeitura: false,
});

zerar();
pagina.document.__active = pagina.document.body;
let erroDigitar = null;
try {
  await capDe(mod.moduloFormulario, 'cap_digitar').executar(ctxPara(refDe('senha'), { text: 'segredo' }));
} catch (e) { erroDigitar = e.message; }
check(/bloqueado/.test(erroDigitar || '') && valorSenha() === '',
  'regressao FURO 5: cap_digitar (browser_type modo teclado) com ref de senha e BARRADO e nao escreve nada',
  `erro=${(erroDigitar || '').slice(0, 60)} valor=${JSON.stringify(valorSenha())}`);

zerar();
pagina.document.__active = pagina.document.body;
let erroAuto = null;
try {
  await capDe(mod.moduloAutocomplete, 'cap_autocomplete').executar(ctxPara(refDe('senha'), { texto: 'segredo', timeout_ms: 200, delay_ms: 0 }));
} catch (e) { erroAuto = e.message; }
console.log(`[7-D] cap_autocomplete: erro=${(erroAuto || '(sem erro)').slice(0, 60)} | senha no DOM=${JSON.stringify(valorSenha())}`);
check(valorSenha() === 'segredo' && !/bloqueado/.test(erroAuto || ''),
  '7-D: FURO -- cap_autocomplete DIGITA no campo de senha antes de qualquer avaliar() (o freio dele so cobre o clique na sugestao)',
  `valor=${JSON.stringify(valorSenha())}`);

// ── FAIL-OPEN da regra 4: comentario promete "na duvida, barra"; o codigo libera
zerar();
const vK = await mod.avaliar({ type: 'click', target: { strategy: 'agent-id', agentId: 999999 }, params: {} }, ws, false);
check(vK.permitido === true,
  'ACHADO: regra 4 com DOM ilegivel (ref inexistente) LIBERA -- o comentario do arquivo promete "na duvida... barra"',
  `permitido=${vK.permitido}`);

// mesmo caso pelo ramo semantico: coordenada resolve, mas elementFromPoint nao devolve elemento
const elementFromPointReal = pagina.document.elementFromPoint;
pagina.document.elementFromPoint = () => null;
const vL = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', text: 'Protocolar inicial' }, params: {} }, ws, false);
pagina.document.elementFromPoint = elementFromPointReal;
check(vL.permitido === true,
  'ACHADO: regra 4 no ramo semantico LIBERA quando o ponto nao devolve elemento -- e o motor clica na coordenada assim mesmo',
  `permitido=${vL.permitido}`);

// ── valores de fronteira dos tres resolvedores compartilhados (funcoes puras)
const fronteirasSwitch = [
  [{ params: { tabId: 0 } }, null, '0'],
  [{ params: { tabId: -1 } }, null, '-1'],
  [{ params: { tabId: NaN } }, null, 'NaN'],
  [{ params: { tabId: '0' } }, null, '"0"'],
  [{ params: { tabId: '' } }, null, '""'],
  [{ params: { tabId: null }, target: { agentId: 7 } }, 7, 'null cai em target.agentId'],
  [{ params: {}, target: { agentId: 0 } }, null, 'target.agentId 0'],
  [{ params: { tabId: 1.5 } }, null, '1.5'],
  [{ params: {}, target: {} }, null, 'nada'],
  [{ params: { tabId: 12 }, target: { agentId: 99 } }, 12, 'params vence target'],
];
let okFront = true;
for (const [acao, esperado, nome] of fronteirasSwitch) {
  const got = mod.resolverAlvoDeSwitchTab(acao);
  if (got !== esperado) { okFront = false; console.log(`   fronteira switch_tab ${nome}: esperado ${esperado}, veio ${got}`); }
}
check(okFront, 'fronteira: resolverAlvoDeSwitchTab falha FECHADO em 0/-1/NaN/"0"/""/1.5 e respeita a precedencia');

const fronteirasClose = [
  [{ params: { tabId: 0 }, target: { agentId: 9 } }, 0, 'tabId 0 vence (?? nao e ||)'],
  [{ params: {}, target: { agentId: 0 } }, 0, 'agentId 0 vence o padrao'],
  [{ params: {}, target: {} }, 55, 'sem nada, cai no padrao'],
];
let okClose = true;
for (const [acao, esperado, nome] of fronteirasClose) {
  const got = mod.resolverAlvoDeCloseTab(acao, 55);
  if (got !== esperado) { okClose = false; console.log(`   fronteira close_tab ${nome}: esperado ${esperado}, veio ${got}`); }
}
check(okClose, 'fronteira: resolverAlvoDeCloseTab trata 0 como tabId valido (freio e motor leem o MESMO numero)');

const clique0 = mod.resolverAlvoDeClique({ target: { strategy: 'agent-id', agentId: 0 }, params: {} });
const cliqueSemStrategy = mod.resolverAlvoDeClique({ target: { agentId: 5, text: 'Excluir conta' }, params: {} });
const cliqueRescue = mod.resolverAlvoDeClique({ target: { strategy: 'semantic' }, params: { text: 'Excluir conta' } });
const cliqueVazio = mod.resolverAlvoDeClique({ target: { strategy: 'semantic', text: '' }, params: {} });
check(clique0?.modo === 'agent-id' && clique0.agentId === 0, 'fronteira: agentId 0 continua sendo modo agent-id (0 nao e "ausente")');
check(cliqueSemStrategy?.modo === 'semantic', 'fronteira: target sem strategy cai no ramo semantico (mesma decisao do motor)');
check(cliqueRescue?.modo === 'semantic' && cliqueRescue.target.text === 'Excluir conta', 'fronteira: Rescue de params.text entra no alvo que o freio avalia');
check(cliqueVazio?.modo === 'semantic' && !cliqueVazio.target.text, 'fronteira: string de busca vazia nao vira criterio');

// ── acento e caixa: TEXTOS_DESTRUTIVOS e sem acento; o botao do PJe tem
zerar();
const doc = pagina.document;
doc.getElementById('protocolar').textContent = 'PROTOCOLAR INICIAL';
const vM = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', text: 'PROTOCOLAR' }, params: {} }, ws, false);
check(vM.permitido === false, 'fronteira: caixa alta no texto do elemento continua barrando (comparacao e lowercase)');
doc.getElementById('protocolar').textContent = 'Enviar petição';
const vN = await mod.avaliar({ type: 'click', target: { strategy: 'semantic', text: 'Enviar' }, params: {} }, ws, false);
check(vN.permitido === true,
  'ACHADO (acento): "Enviar petição" NAO e barrada -- a lista tem "enviar peticao" sem acento e a comparacao e literal',
  `permitido=${vN.permitido}`);
doc.getElementById('protocolar').textContent = 'Protocolar inicial';

console.log(`\n=== ${falhas} FALHA(S) ===`);
