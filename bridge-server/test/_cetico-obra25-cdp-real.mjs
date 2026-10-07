/**
 * BANCADA COM CDP DE VERDADE (cetico da obra 25).
 *
 * Roda o codigo REAL do freio (`bridge/policy.ts`), do resolvedor de alvo unico
 * e do motor (`execution-engine/index.ts`) — o MESMO bundle da bancada do
 * pedreiro — mas com `debuggerManager.send` apontado para uma sessao CDP de um
 * Chromium DE VERDADE (o do Playwright, perfil efemero; nao encosta no Chrome
 * do Dr. Cezar).
 *
 * Diferenca para a bancada do pedreiro: la o CDP e simulado sobre linkedom, e
 * por isso `DOM.focus` sempre funciona, `elementFromPoint` responde por
 * retangulo declarado e clique nao move foco. Aqui quem responde e o Blink.
 *
 *   node bancada-cdp-real.mjs <bundle.mjs>
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUNDLE = process.argv[2];
let falhas = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` -- ${extra}` : ''}`);
  if (!ok) { falhas++; process.exitCode = 1; }
};

// ───────────────────────────────────────────────── Chromium proprio, efemero
const RAIZ = 'C:/Users/Cezar/AppData/Local/ms-playwright';
const dirChromium = readdirSync(RAIZ).filter((d) => d.startsWith('chromium-')).sort().pop();
const EXE = join(RAIZ, dirChromium, 'chrome-win64', 'chrome.exe');
const perfil = mkdtempSync(join(tmpdir(), 'cetico-cdp-'));
const HTML = join(perfil, 'p.html');

// Pagina de login comum: senha, um rotulo que aponta para ela, e ruido.
writeFileSync(HTML, `<!doctype html><meta charset=utf-8>
<style>body{font:14px sans-serif} #caixa,#linha{display:block;padding:8px;background:#eee;width:280px}</style>
<body>
  <form id=f>
    <label id=lbl for=senha>Senha do certificado</label>
    <input id=senha type=password placeholder="Senha de acesso">
    <div id=caixa>Ajuda sobre o certificado</div>
    <li id=linha role=button>Continuar</li>
    <input id=nome placeholder="Nome completo">
    <button id=excluir type=button onclick="window.__c=(window.__c||0)+1">Excluir conta</button>
  </form>
</body>`);

const proc = spawn(EXE, [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1200,900',
  `file:///${HTML.replace(/\\/g, '/')}`,
], { stdio: ['ignore', 'pipe', 'pipe'] });
proc.stderr.on('data', () => {});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let alvoWs;
for (let i = 0; i < 40 && !alvoWs; i++) {
  await espera(250);
  try {
    const lista = await fetch('http://127.0.0.1:9334/json/list').then((r) => r.json());
    alvoWs = lista.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch {}
}
if (!alvoWs) { console.error('chromium nao subiu'); proc.kill(); process.exit(2); }

const ws = new WebSocket(alvoWs.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0;
const pendentes = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendentes.has(m.id)) { pendentes.get(m.id)(m); pendentes.delete(m.id); }
};
/** Assinatura do debuggerManager: send(tabId, method, params). Lanca no erro,
 *  como o chrome.debugger faz. */
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const meu = ++seq;
  pendentes.set(meu, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: meu, method, params }));
});
await cdp('DOM.enable');
await cdp('Runtime.enable');

// ───────────────────────────────────── chrome.* minimo, com scripting DE VERDADE
const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
globalThis.chrome = {
  tabs: {
    get: async () => ({ id: 1, url: 'https://pje.tjro.jus.br/login' }),
    sendMessage: async () => {}, update: async () => {}, remove: async () => {}, query: async () => [],
    onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO(),
  },
  scripting: {
    // Injeta de verdade: a funcao vira fonte e roda no mundo da pagina.
    executeScript: async ({ func, args = [] }) => {
      const r = await cdp('Runtime.evaluate', {
        expression: `(${func.toString()}).apply(null, ${JSON.stringify(args)})`,
        returnByValue: true, awaitPromise: true,
      });
      return [{ result: r?.result?.value ?? null }];
    },
  },
  debugger: { onDetach: EVENTO(), onEvent: EVENTO(), attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) },
  runtime: { getURL: (p) => p, onMessage: EVENTO(), onInstalled: EVENTO(), onStartup: EVENTO() },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: EVENTO() },
  alarms: { create: () => {}, onAlarm: EVENTO() },
  windows: { onBoundsChanged: EVENTO(), onRemoved: EVENTO(), create: async () => ({}), get: async () => ({}) },
  tabGroups: { TAB_GROUP_ID_NONE: -1, onRemoved: EVENTO(), query: async () => [], update: async () => ({}) },
  webNavigation: { onCommitted: EVENTO(), onCompleted: EVENTO() },
};

const mod = await import(pathToFileURL(BUNDLE).href);
mod.debuggerManager.send = async (_tabId, method, params) => cdp(method, params);
mod.debuggerManager.attach = async () => {};

// ───────────────────────────────────────────────────────────────── utilitarios
const ws0 = { workspaceId: 'w', activeTabId: 1, tabs: { 1: { url: 'https://pje.tjro.jus.br/login' } } };
const js = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
const doc = await cdp('DOM.getDocument', { depth: -1 });
const refDe = async (sel) => {
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
  const d = await cdp('DOM.describeNode', { nodeId });
  return d.node.backendNodeId;
};
const val = (id) => js(`document.getElementById(${JSON.stringify(id)}).value`);
const ativo = () => js('document.activeElement.id || document.activeElement.tagName');
const focar = (id) => js(`document.getElementById(${JSON.stringify(id)}).focus()`);
const zerar = async () => {
  await js('document.getElementById("senha").value=""; document.getElementById("nome").value=""; window.__c=0');
};

async function despachar(acao, confirm = false) {
  let resolucao, alvo;
  if (mod.ACOES_COM_ALVO_UNICO.has(acao.type)) {
    resolucao = await mod.resolverAlvoDaAcao(acao, 1);
    if (resolucao.ok) alvo = resolucao.alvo;
    else if (resolucao.causa !== 'no-inexistente' && resolucao.causa !== 'sem-alvo') {
      return { bloqueado: true, motivo: `[bloqueado] ${acao.type}: ${resolucao.motivo}` };
    }
  }
  const v = await mod.avaliar(acao, ws0, confirm, alvo);
  if (!v.permitido) return { bloqueado: true, motivo: `[bloqueado] ${v.motivo}`, alvo };
  const res = await mod.executionEngine.run(acao, ws0, resolucao);
  return { bloqueado: false, res, alvo };
}
const capDe = (m, nome) => m.capacidades.find((c) => c.nome === nome);
const ctxPara = (ref, params) => ({ clientId: 'c', nome: 'c', ws: ws0, tabId: 1, ref, params, confirm: false, acao: 'cap', emSomenteLeitura: false });
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

const REF = {
  excluir: await refDe('#excluir'), senha: await refDe('#senha'), caixa: await refDe('#caixa'),
  linha: await refDe('#linha'), lbl: await refDe('#lbl'), nome: await refDe('#nome'),
};

console.log('=== BANCADA COM CDP REAL (Blink responde, nao um simulador) ===');
console.log('   pagina:', HTML);

// ── controle: o aparato funciona? clique destrutivo continua barrado ────────
await zerar();
const c0 = await despachar({ type: 'click', target: { strategy: 'agent-id', agentId: REF.excluir } });
check(c0.bloqueado && /Excluir conta/.test(c0.motivo) && (await js('window.__c')) === 0,
  'CONTROLE: clique em "Excluir conta" continua BARRADO no CDP real',
  `${c0.motivo ?? 'passou'} cliques=${await js('window.__c')}`);

// ── controle: senha por ref direto continua barrada ────────────────────────
await zerar();
const c1 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: REF.senha }, params: { text: 'X' } });
check(c1.bloqueado && (await val('senha')) === '', 'CONTROLE: type por ref no <input type=password> continua BARRADO',
  `${c1.motivo ?? 'passou'} senha=${JSON.stringify(await val('senha'))}`);

// ── 1. cap_digitar com ref de um <div>, senha focada ───────────────────────
await zerar(); await focar('senha');
const e1 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(REF.caixa, { text: 'SEGREDO1', delay_ms: 0 })));
check((await val('senha')) === '', '1. cap_digitar ref=<div> com senha focada NAO escreve na senha',
  `erro=${e1} senha=${JSON.stringify(await val('senha'))} foco=${await ativo()}`);

// ── 2. cap_digitar com ref de <li role=button> (aparece em read_page) ──────
await zerar(); await focar('senha');
const e2 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(REF.linha, { text: 'SEGREDO2', delay_ms: 0 })));
check((await val('senha')) === '', '2. cap_digitar ref=<li role=button> com senha focada NAO escreve na senha',
  `erro=${e2} senha=${JSON.stringify(await val('senha'))}`);

// ── 3. type por ref do <label for=senha> (input FORA do label) ─────────────
await zerar(); await focar('nome');
const t3 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: REF.lbl }, params: { text: 'SEGREDO3' } });
check((await val('senha')) === '', '3. type ref=<label for=senha> (input fora) NAO escreve na senha',
  `bloqueado=${t3.bloqueado} efetivo=${t3.alvo?.efetivo?.tag}/${t3.alvo?.efetivo?.tipo} senha=${JSON.stringify(await val('senha'))} foco=${await ativo()}`);

// ── 4. type semantico pelo texto do rotulo ─────────────────────────────────
await zerar(); await focar('nome');
const t4 = await despachar({ type: 'type', target: { strategy: 'semantic', text: 'Senha do certificado' }, params: { text: 'SEGREDO4' } });
check((await val('senha')) === '', '4. type semantico "Senha do certificado" NAO escreve na senha',
  `bloqueado=${t4.bloqueado} como=${t4.alvo?.como} efetivo=${t4.alvo?.efetivo?.tag} senha=${JSON.stringify(await val('senha'))}`);

// ── 5. cap_autocomplete com ref nao focavel ───────────────────────────────
await zerar(); await focar('senha');
const e5 = await erroDe(() => capDe(mod.moduloAutocomplete, 'cap_autocomplete')
  .executar(ctxPara(REF.caixa, { texto: 'SEGREDO5', timeout_ms: 200, delay_ms: 0 })));
check((await val('senha')) === '', '5. cap_autocomplete ref=<div> com senha focada NAO escreve na senha',
  `erro=${(e5 ?? '').slice(0, 60)} senha=${JSON.stringify(await val('senha'))}`);

// ── 6. sem falso positivo: campo comum por ref continua funcionando ────────
await zerar(); await focar('senha');
const e6 = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
  .executar(ctxPara(REF.nome, { text: 'Fulano', delay_ms: 0 })));
check((await val('nome')) === 'Fulano' && (await val('senha')) === '',
  '6. SEM FALSO POSITIVO: cap_digitar ref=<input> comum escreve no campo certo',
  `erro=${e6} nome=${JSON.stringify(await val('nome'))} senha=${JSON.stringify(await val('senha'))}`);

// ── 7. sem falso positivo: type por ref em campo comum ────────────────────
await zerar();
const t7 = await despachar({ type: 'type', target: { strategy: 'agent-id', agentId: REF.nome }, params: { text: 'Ciclano', clear: true } });
check(!t7.bloqueado && (await val('nome')) === 'Ciclano', '7. SEM FALSO POSITIVO: type por ref em campo comum continua escrevendo',
  `bloqueado=${t7.bloqueado} nome=${JSON.stringify(await val('nome'))}`);

console.log(`\n=== ${falhas} FALHA(S) ===`);
ws.close();
proc.kill();
