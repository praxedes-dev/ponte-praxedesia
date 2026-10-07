/**
 * BANCADA DO RECEPTOR — quem USA a resolucao (obra 26, 06/09/2026).
 *
 * Irma da `alvo-unico-bancada.mjs`, mesmo DOM (linkedom) e mesmo CDP simulado,
 * mesma forma de despacho de `bridge/index.ts`. A diferenca e a pergunta: a
 * bancada anterior provou que existe UMA resolucao; esta prova que quem escreve
 * escreve EXATAMENTE no no que o freio julgou.
 *
 * Duas diferencas de ambiente em relacao a bancada irma, as duas para poder
 * medir defeito que so aparece quando o Chrome recusa alguma coisa:
 *  - `DOM.focus` LANCA para elemento nao focavel (`disabled`), como o Chrome de
 *    verdade faz ("Element is not focusable");
 *  - `Input.insertText` insere no FOCADO, que e o que o Chrome faz — e o
 *    caminho por onde o texto de `type` escapa quando o efetivo nao e campo.
 *
 *   node bridge-server/test/_obra25-bundle.mjs <bundle>
 *   node bridge-server/test/receptor-da-escrita-bancada.mjs <bundle>
 */
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const BUNDLE = process.argv[2];
if (!BUNDLE) { console.error('uso: node receptor-da-escrita-bancada.mjs <caminho do bundle>'); process.exit(2); }

let falhas = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` -- ${extra}` : ''}`);
  if (!ok) { falhas++; process.exitCode = 1; }
};

/**
 * Focavel pelas MESMAS regras do Chrome que importam aqui: campo/controle de
 * formulario, ancora com href, ou qualquer elemento com `tabindex`. Elemento
 * `disabled` nunca recebe foco. Um `<span>` sem `tabindex` NAO e focavel — e o
 * caso do combo do select2 quando a biblioteca ainda nao montou o widget.
 */
function ehFocavel(el) {
  if (!el || !el.tagName) return false;
  if (el.hasAttribute?.('disabled')) return false;
  if (el.hasAttribute?.('tabindex')) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return el.hasAttribute('href');
  if (el.getAttribute?.('contenteditable') === 'true') return true;
  return ['input', 'textarea', 'select', 'button'].includes(tag);
}

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
  // O Chrome so move o foco para elemento REALMENTE focavel. Sem esta regra a
  // bancada focaria um <span> sem tabindex e esconderia justamente o defeito:
  // e por o span NAO receber foco que o texto cai em quem estava focado antes.
  Element.prototype.focus = function () {
    if (!ehFocavel(this)) return;
    // `data-rouba-foco`: focar (ou clicar) este elemento manda o foco para o
    // campo de senha. Padrao real — botao que abre um widget de login e foca a
    // senha, campo com `onfocus` que redireciona.
    document.__active = this.hasAttribute('data-rouba-foco')
      ? document.getElementById('senha')
      : this;
  };
  // linkedom expoe `length` no classList mas NAO o acesso indexado (`lista[i]`)
  // que o DOMTokenList do Chrome permite — e `LER_DESCRICAO` (producao) le
  // `lista[i]`. Sem este remendo, todo elemento COM classe estoura a leitura do
  // descritor e a bancada mediria uma falha que so existe aqui dentro.
  const classListOriginal = Object.getOwnPropertyDescriptor(Element.prototype, 'classList').get;
  Object.defineProperty(Element.prototype, 'classList', {
    configurable: true,
    get() {
      const orig = classListOriginal.call(this);
      const nomes = [...orig];
      nomes.contains = (n) => orig.contains(n);
      nomes.add = (...a) => orig.add(...a);
      nomes.remove = (...a) => orig.remove(...a);
      return nomes;
    },
  });
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
      // O Chrome de verdade RECUSA focar elemento nao focavel — e essa recusa
      // que o `.catch(() => {})` de `digitarTeclaATecla` engolia.
      if (!ehFocavel(node)) throw new Error('Element is not focusable');
      // Pagina que ROUBA o foco: o comando e ACEITO (nao lanca), o foco vai
      // para outro lugar, e quem confiar na ausencia de erro digita no campo
      // errado. Existe de verdade (campo com onfocus que redireciona) e e o
      // unico caso que a segunda camada — conferir de volta — pega sozinha.
      node.focus();
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
    // Tecla imprimivel: o Chrome insere no FOCADO.
    if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown' && typeof params.text === 'string' && params.text.length === 1) {
      const alvo = document.activeElement;
      if (alvo && 'value' in alvo) alvo.value = (alvo.value ?? '') + params.text;
    }
    // `Input.insertText` NAO aceita alvo: insere em quem esta com foco. E por
    // aqui que o texto de `type` escapa quando o efetivo nao e campo digitavel.
    if (method === 'Input.insertText') {
      const alvo = document.activeElement;
      if (alvo && 'value' in alvo) alvo.value = (alvo.value ?? '') + params.text;
      else if (alvo) alvo.textContent = (alvo.textContent ?? '') + params.text;
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
      sendMessage: async () => {}, update: async () => {}, remove: async () => {}, query: async () => [],
      onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO(),
    },
    scripting: { executeScript: async ({ func, args = [] }) => [{ result: func(...args) }] },
    debugger: { onDetach: EVENTO(), onEvent: EVENTO(), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
    runtime: { getURL: (p) => p, lastError: undefined, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO() },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: EVENTO() },
    alarms: { create: () => {}, onAlarm: EVENTO() },
    windows: { onBoundsChanged: EVENTO(), onRemoved: EVENTO(), create: async () => ({}), get: async () => ({}) },
    tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: EVENTO(), query: async () => [], update: async () => ({}) },
    webNavigation: { onCommitted: EVENTO(), onCompleted: EVENTO() },
  };
}

// ───────────────────────────────────────────────────────────────── fixture
//
// `combo` e a imitacao fiel do select2 do PJe (a mesma de digitacao-real.js):
// o que a arvore de acessibilidade lista e o <span role=combobox>, e a
// travessia `campo-digitavel` NAO acha campo nenhum dentro dele.
const FIXTURE = `
  <form id=f>
    <input id=senha type=password placeholder="Senha de acesso">
    <input id=nome placeholder="Nome completo">
    <input id=desabilitado disabled placeholder="Campo desabilitado">
    <span id=combo class="select2 select2-container" role=combobox aria-label="Materia">Selecione</span>
    <span id=combo2 class="select2-selection" role=combobox tabindex="0" aria-label="Materia focavel">Selecione</span>
    <button id=excluir>Excluir conta</button>
    <div id=editor contenteditable="true"></div>
    <div id=cartao tabindex="0"><input id=senha3 type=password placeholder="Cartao"></div>
    <input id=ladrao data-rouba-foco placeholder="Campo que rouba o foco">
    <button id=abrir type=button data-rouba-foco>Abrir opcoes</button>
  </form>`;
const RECTS = {
  senha: { x: 10, y: 10, width: 200, height: 24 },
  nome: { x: 10, y: 50, width: 200, height: 24 },
  desabilitado: { x: 10, y: 90, width: 200, height: 24 },
  combo: { x: 10, y: 130, width: 200, height: 24 },
  combo2: { x: 10, y: 400, width: 200, height: 24 },
  excluir: { x: 10, y: 170, width: 160, height: 30 },
  editor: { x: 10, y: 210, width: 200, height: 40 },
  cartao: { x: 10, y: 440, width: 200, height: 30 },
  senha3: { x: 120, y: 442, width: 80, height: 24 },
  ladrao: { x: 10, y: 480, width: 200, height: 24 },
  abrir: { x: 10, y: 520, width: 160, height: 30 },
  f: { x: 0, y: 0, width: 400, height: 560 },
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
const texto = (id) => pagina.document.getElementById(id).textContent ?? '';
const zerar = () => {
  for (const id of ['senha', 'nome', 'desabilitado', 'senha3', 'ladrao']) pagina.document.getElementById(id).value = '';
  pagina.document.getElementById('editor').textContent = '';
  pagina.document.getElementById('combo2').textContent = 'Selecione';
  amb.chamadas.length = 0;
};

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

console.log('=== BANCADA RECEPTOR (quem USA a resolucao) ===');

// ══════════════════════════════════════════════════════════════════════════
// A1 — `type` cujo EFETIVO nao aceita texto: o motor cai no elemento FOCADO
// ══════════════════════════════════════════════════════════════════════════
zerar(); focar('senha');
const a1 = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('combo') }, params: { text: 'segredo123' },
});
check(a1.bloqueado && /senha/i.test(a1.motivo || '') && val('senha') === '',
  'A1: type por ref de <span select2> com SENHA focada -> BARRADO e nada escrito na senha',
  `bloqueado=${a1.bloqueado} motivo=${(a1.motivo || '').slice(0, 60)} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const a1b = await despachar({
  type: 'type', target: { strategy: 'semantic', ariaLabel: 'Materia' }, params: { text: 'segredo123' },
});
check(a1b.bloqueado && val('senha') === '',
  'A1 (via busca semantica): mesmo alvo nao-digitavel, senha focada -> BARRADO',
  `bloqueado=${a1b.bloqueado} senha=${JSON.stringify(val('senha'))}`);

// A1 sem falso positivo: com um campo COMUM focado, o texto continua saindo —
// e sai no campo que o freio julgou.
zerar(); focar('nome');
const a1c = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('combo') }, params: { text: 'abc' },
});
check(!a1c.bloqueado && val('nome') === 'abc',
  'A1 (sem falso positivo): mesmo caminho com campo COMUM focado continua escrevendo NELE',
  `bloqueado=${a1c.bloqueado} nome=${JSON.stringify(val('nome'))} motivo=${(a1c.motivo || '').slice(0, 50)}`);

// A1, a contraprova que o desvio para o foco NAO pode custar: a regra 4 do
// `type` pergunta sobre o no NOMEADO (o que vai ser CLICADO), nunca sobre o
// receptor. Com um campo de texto focado, olhar o receptor responderia "e
// campo digitavel, o clique so foca" e o botao destrutivo passaria.
zerar(); focar('nome');
const a1d = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('excluir') }, params: { text: 'x' },
});
check(a1d.bloqueado && /irreversivel|excluir/i.test(a1d.motivo || ''),
  'A1 (contraprova da regra 4): type num botao "Excluir conta" COM campo de texto focado -> BARRADO',
  (a1d.motivo || 'PASSOU').slice(0, 70));

// A1, terceira face: alvo que nao aceita texto e NADA focado. Nao ha receptor
// nenhum — antes o texto sumia no `Input.insertText` e a tool dizia sucesso.
zerar(); focar(null);
const a1e = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('combo') }, params: { text: 'sumiu' },
});
check(!a1e.bloqueado && a1e.res?.success === false && val('nome') === '' && val('senha') === '',
  'A1 (nada focado): type em alvo que nao aceita texto FALHA ALTO em vez de dizer sucesso sem escrever',
  `success=${a1e.res?.success} erro=${(a1e.res?.error || '').slice(0, 60)}`);

// As DUAS regras na mesma acao: o veto de credencial nao pode apagar o aviso
// de que aquilo ali tambem ia clicar um botao irreversivel.
zerar(); focar('senha');
const a1i = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('excluir') }, params: { text: 'x' },
});
check(a1i.bloqueado && /senha/i.test(a1i.motivo || '') && /excluir conta/i.test(a1i.motivo || ''),
  'as duas regras juntas: o veto de senha conta TAMBEM que a acao despacharia um clique irreversivel',
  (a1i.motivo || 'PASSOU').slice(0, 110));

// A1, quarta face: o CLIQUE que o `type` despacha MOVE o foco (o combo do
// select2 tem tabindex). Se o motor voltar a sondar `document.activeElement`
// DEPOIS do clique, ele escreve em quem o clique focou — um no que o freio
// nunca viu. O texto tem de ir para o no que o freio julgou.
zerar(); focar('nome');
const a1f = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('combo2') }, params: { text: 'XYZ' },
});
check(!a1f.bloqueado && val('nome') === 'XYZ' && !texto('combo2').includes('XYZ'),
  'A1 (o clique move o foco): o texto vai para o no que o FREIO julgou, nao para quem o clique focou',
  `nome=${JSON.stringify(val('nome'))} combo2=${JSON.stringify(texto('combo2'))}`);

// A1, o caso que decide QUEM escolhe o alvo da escrita: o clique que o `type`
// despacha leva o foco para o campo de SENHA (botao que abre um widget de
// login — padrao real). Se o motor sondar `document.activeElement` DEPOIS do
// clique, ele escreve na senha; o freio julgou outro elemento e nem viu.
zerar(); focar('combo2');
const a1h = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('abrir') }, params: { text: 'segredo123' },
});
check(val('senha') === '',
  'A1 (o clique foca a SENHA): o motor escreve onde o freio mandou, nao em quem o clique focou',
  `senha=${JSON.stringify(val('senha'))} bloqueado=${a1h.bloqueado} combo2=${JSON.stringify(texto('combo2'))}`);

// A1, quinta face: o elemento FOCADO e um wrapper com um <input type=password>
// dentro. `cdpType` desce por `findRealInput` a partir de quem recebe — logo o
// receptor e a senha, e e ela que o freio tem de julgar (furo 7-C, agora
// aplicado ao foco em vez do no nomeado).
zerar(); focar('cartao');
const a1g = await despachar({
  type: 'type', target: { strategy: 'agent-id', agentId: refDe('combo') }, params: { text: 'segredo123' },
});
check(a1g.bloqueado && /senha/i.test(a1g.motivo || '') && val('senha3') === '',
  'A1 (wrapper focado): a travessia do FOCO tambem desce ate o <input type=password> -> BARRADO',
  `bloqueado=${a1g.bloqueado} senha3=${JSON.stringify(val('senha3'))}`);

// ══════════════════════════════════════════════════════════════════════════
// A2 — `DOM.focus` que FALHA nao pode virar digitacao em quem estava focado
// ══════════════════════════════════════════════════════════════════════════
zerar(); focar('senha');
const a2 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('desabilitado'), { text: 'segredo123', delay_ms: 0 })));
check(/nao consegui colocar o foco no campo/.test(a2 || '') && val('senha') === '',
  'A2 (1a camada, o CDP recusa): cap_digitar com ref cujo DOM.focus LANCA -> ERRO com o motivo do CDP',
  `erro=${(a2 || 'NENHUM ERRO').slice(0, 70)} senha=${JSON.stringify(val('senha'))}`);

// A2, 2a camada: a pagina ACEITA o comando de foco e leva o foco para outro
// lugar (campo com onfocus que redireciona). Nao ha erro nenhum do CDP para
// engolir — quem pega e conferir de volta quem ficou com o foco.
zerar(); focar('nome');
const a2e = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('ladrao'), { text: 'segredo123', delay_ms: 0 })));
check(/o foco nao foi para ele/.test(a2e || '') && val('senha') === '' && val('ladrao') === '',
  'A2 (2a camada, a pagina rouba o foco): DOM.focus nao reclama, o foco vai para a senha -> ERRO, nada digitado',
  `erro=${(a2e || 'NENHUM ERRO').slice(0, 70)} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const a2b = await erroDe(() => capDe(mod.moduloAutocomplete, 'cap_autocomplete')
  .executar(ctxPara(refDe('desabilitado'), { texto: 'segredo123', timeout_ms: 100, delay_ms: 0 })));
check(a2b !== null && val('senha') === '',
  'A2 (autocomplete): mesma falha de foco -> ERRO, nada digitado na senha focada',
  `erro=${(a2b || 'NENHUM ERRO').slice(0, 70)} senha=${JSON.stringify(val('senha'))}`);

// A2, o outro lado: com ref que NAO aceita texto (o span do select2) e um
// campo comum focado, `cap_digitar` continua digitando — no campo focado, que
// e o que o freio examinou. Sem o desvio na resolucao isto viraria erro de
// foco, e a capacidade deixaria de funcionar onde sempre funcionou.
zerar(); focar('nome');
const a2d = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('combo'), { text: 'abc', delay_ms: 0 })));
check(a2d === null && val('nome') === 'abc',
  'A2 (espelho do motor): cap_digitar com ref que nao aceita texto digita no campo FOCADO, que o freio julgou',
  `erro=${(a2d || '').slice(0, 60)} nome=${JSON.stringify(val('nome'))}`);

// A2 sem falso positivo: foco que FUNCIONA continua digitando.
zerar(); focar(null);
const a2c = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(refDe('nome'), { text: 'Fulano', delay_ms: 0 })));
check(a2c === null && val('nome') === 'Fulano',
  'A2 (sem falso positivo): cap_digitar com ref focavel continua digitando',
  `erro=${a2c} nome=${JSON.stringify(val('nome'))}`);

// ══════════════════════════════════════════════════════════════════════════
// A3/A4 — freio e motor tem de concordar sobre o NOME da tecla
// ══════════════════════════════════════════════════════════════════════════
zerar(); focar('senha');
const a4 = await despachar({ type: 'press_key', params: { key: 'space' } });
check(a4.bloqueado && /senha/i.test(a4.motivo || '') && val('senha') === '',
  'A4: press_key {key:"space"} com SENHA focada -> BARRADO (o motor le a tecla como " ")',
  `bloqueado=${a4.bloqueado} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const a4b = await despachar({ type: 'press_key', params: { key: 'spacebar' } });
check(a4b.bloqueado && val('senha') === '',
  'A4: press_key {key:"spacebar"} (o outro alias de " ") com senha focada -> BARRADO',
  `bloqueado=${a4b.bloqueado} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('senha');
const a4c = await despachar({ type: 'press_key', params: { key: 'space', modifiers: ['Shift'] } });
check(a4c.bloqueado && val('senha') === '',
  'A4: Shift+space (Shift NAO desliga a insercao) com senha focada -> BARRADO',
  `bloqueado=${a4c.bloqueado} senha=${JSON.stringify(val('senha'))}`);

zerar(); focar('excluir');
const a3 = await despachar({ type: 'press_key', params: { key: 'space' } });
check(a3.bloqueado && /irreversivel|excluir/i.test(a3.motivo || ''),
  'A3: press_key {key:"space"} com "Excluir conta" focado -> BARRADO pela regra 4',
  (a3.motivo || 'PASSOU').slice(0, 70));

zerar(); focar('excluir');
const a3b = await despachar({ type: 'press_key', params: { key: 'spacebar' } });
check(a3b.bloqueado, 'A3: alias "spacebar" no mesmo botao -> BARRADO', (a3b.motivo || 'PASSOU').slice(0, 60));

// UMA DEFINICAO SO: o nome que o freio le e o nome que o motor despacha.
const TECLAS = [
  'space', 'spacebar', 'Enter', 'return', 'esc', 'a', 'A', 'Ctrl+a', 'Shift+a',
  'Alt+F4', 'ArrowDown', 'down', 'Backspace', 'Tab', 'F5', 'Ctrl+Shift+K', '+',
];
zerar(); focar('nome');
const divergentes = [];
for (const k of TECLAS) {
  amb.chamadas.length = 0;
  const antes = val('nome');
  await despachar({ type: 'press_key', params: { key: k } });
  const inseriuDeVerdade = val('nome') !== antes;
  const freioAchaQueInsere = mod.pressKeyEscreveTexto
    ? mod.pressKeyEscreveTexto(k, undefined)
    : null;
  if (freioAchaQueInsere !== null && freioAchaQueInsere !== inseriuDeVerdade) {
    divergentes.push(`${k}: freio=${freioAchaQueInsere} motor=${inseriuDeVerdade}`);
  }
}
check(mod.pressKeyEscreveTexto !== undefined && divergentes.length === 0,
  'A3/A4: freio e motor concordam sobre "esta tecla insere texto?" em toda a tabela de alias',
  mod.pressKeyEscreveTexto === undefined ? 'pressKeyEscreveTexto nao exportado' : divergentes.join(' | ') || 'nenhuma divergencia');

// ══════════════════════════════════════════════════════════════════════════
// Sem falso positivo — o caminho normal continua inteiro
// ══════════════════════════════════════════════════════════════════════════
zerar(); focar('nome');
const s1 = await despachar({ type: 'press_key', params: { key: 'space' } });
check(!s1.bloqueado && val('nome') === ' ',
  'sem falso positivo: press_key "space" em campo COMUM continua escrevendo o espaco',
  `bloqueado=${s1.bloqueado} nome=${JSON.stringify(val('nome'))}`);

zerar(); focar(null);
const s2 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('nome') }, params: { text: 'Ciclano' } });
check(!s2.bloqueado && val('nome') === 'Ciclano',
  'sem falso positivo: type por ref em campo comum continua escrevendo', `nome=${JSON.stringify(val('nome'))}`);

zerar(); focar(null);
const s3 = await despachar({ type: 'type', target: { strategy: 'semantic', placeholder: 'Nome completo' }, params: { text: 'Fulano' } });
check(!s3.bloqueado && val('nome') === 'Fulano',
  'sem falso positivo: type semantico em campo comum continua escrevendo', `nome=${JSON.stringify(val('nome'))}`);

zerar(); focar(null);
const s4 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: refDe('editor') }, params: { text: 'texto rico' } });
check(!s4.bloqueado && pagina.document.getElementById('editor').textContent === 'texto rico',
  'sem falso positivo: type em contenteditable continua escrevendo',
  `editor=${JSON.stringify(pagina.document.getElementById('editor').textContent)}`);

zerar(); focar('nome');
const s5 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(undefined, { text: 'abc', delay_ms: 0 })));
check(s5 === null && val('nome') === 'abc',
  'sem falso positivo: cap_digitar SEM ref no campo focado continua digitando',
  `erro=${s5} nome=${JSON.stringify(val('nome'))}`);

zerar(); focar('nome');
const s6 = await despachar({ type: 'press_key', params: { key: 'Enter' } });
check(!s6.bloqueado, 'sem falso positivo: Enter em campo de texto continua liberado', (s6.motivo || '').slice(0, 50));

zerar(); focar('nome');
const s7 = await despachar({ type: 'press_key', params: { key: 'a', modifiers: ['Control'] } });
check(!s7.bloqueado && val('nome') === '',
  'sem falso positivo: Ctrl+a e atalho de edicao, nao insercao — liberado e nao escreve',
  `bloqueado=${s7.bloqueado} nome=${JSON.stringify(val('nome'))}`);

zerar(); focar('senha');
const s8 = await despachar({ type: 'press_key', params: { key: 'Enter' } });
check(!s8.bloqueado,
  'sem falso positivo: Enter com senha focada NAO e barrado pela regra 1 (nao insere caractere)',
  (s8.motivo || '').slice(0, 50));

console.log(`\n=== ${falhas} FALHA(S) ===`);
