/**
 * Segunda rodada do cetico, com marcacao no formato do PJe (RichFaces +
 * select2) e CDP de verdade. Pergunta: os refs que `browser_read_page` DE FATO
 * entrega (roles button/combobox/menuitem/tab/option) sao todos focaveis? Se
 * nao, o texto de `browser_type` vai para o campo focado, e nao para o no que
 * o freio julgou.
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

const RAIZ = 'C:/Users/Cezar/AppData/Local/ms-playwright';
const dirChromium = readdirSync(RAIZ).filter((d) => d.startsWith('chromium-')).sort().pop();
const EXE = join(RAIZ, dirChromium, 'chrome-win64', 'chrome.exe');
const perfil = mkdtempSync(join(tmpdir(), 'cetico-pje-'));
const HTML = join(perfil, 'p.html');

writeFileSync(HTML, `<!doctype html><meta charset=utf-8>
<style>body{font:14px sans-serif} span,li,div{display:block;padding:6px;background:#eee;width:300px;margin:3px 0}</style>
<body>
  <!-- assinatura do PJe: a senha do certificado fica focada esperando digitacao -->
  <input id=senha type=password placeholder="Senha do certificado">

  <!-- select2 dos combos do PJe: o <select> real e IRMAO do span, nao filho -->
  <select id=selReal class=select2-hidden-accessible><option>Comarca</option></select>
  <span id=combo class=select2-container role=combobox>Selecione a comarca</span>

  <!-- menu e aba do RichFaces -->
  <li id=item role=menuitem>Juntar documento</li>
  <div id=aba role=tab>Dados iniciais</div>
  <li id=opcao role=option>Porto Velho</li>
  <div id=botao role=button>Adicionar</div>

  <input id=nome placeholder="Nome completo">
</body>`);

const proc = spawn(EXE, ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1200,900',
  `file:///${HTML.replace(/\\/g, '/')}`], { stdio: ['ignore', 'pipe', 'pipe'] });
proc.stderr.on('data', () => {});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let alvoWs;
for (let i = 0; i < 40 && !alvoWs; i++) {
  await espera(250);
  try { const l = await fetch('http://127.0.0.1:9336/json/list').then((r) => r.json()); alvoWs = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
}
if (!alvoWs) { console.error('nao subiu'); proc.kill(); process.exit(2); }
const ws = new WebSocket(alvoWs.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const meu = ++seq; pend.set(meu, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: meu, method, params }));
});
await cdp('DOM.enable'); await cdp('Runtime.enable');

const EVENTO = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
globalThis.chrome = {
  tabs: { get: async () => ({ id: 1, url: 'https://pje.tjro.jus.br/x' }), sendMessage: async () => {}, update: async () => {}, remove: async () => {}, query: async () => [], onUpdated: EVENTO(), onRemoved: EVENTO(), onCreated: EVENTO(), onActivated: EVENTO() },
  scripting: { executeScript: async ({ func, args = [] }) => {
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

const mod = await import(pathToFileURL(BUNDLE).href);
mod.debuggerManager.send = async (_t, m, p) => cdp(m, p);
mod.debuggerManager.attach = async () => {};

const ws0 = { workspaceId: 'w', activeTabId: 1, tabs: { 1: { url: 'https://pje.tjro.jus.br/x' } } };
const js = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true }))?.result?.value;
const doc = await cdp('DOM.getDocument', { depth: -1 });
const refDe = async (sel) => {
  const { nodeId } = await cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
  return (await cdp('DOM.describeNode', { nodeId })).node.backendNodeId;
};
const REF = {};
for (const id of ['senha', 'combo', 'item', 'aba', 'opcao', 'botao', 'nome']) REF[id] = await refDe('#' + id);

const capDe = (m, n) => m.capacidades.find((c) => c.nome === n);
const ctxPara = (ref, params) => ({ clientId: 'c', nome: 'c', ws: ws0, tabId: 1, ref, params, confirm: false, acao: 'cap', emSomenteLeitura: false });
const erroDe = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
const zerar = () => js('document.getElementById("senha").value=""; document.getElementById("nome").value=""');

console.log('=== 2a RODADA: refs que browser_read_page entrega, no formato do PJe ===');

// Quais desses refs o CDP considera focaveis?
console.log('\n-- DOM.focus por ref (o que digitarTeclaATecla tenta, e engole se falhar) --');
for (const id of ['combo', 'item', 'aba', 'opcao', 'botao', 'nome']) {
  const erro = await erroDe(() => cdp('DOM.focus', { backendNodeId: REF[id] }));
  console.log(`   #${id.padEnd(7)} -> ${erro ? 'ERRO: ' + erro : 'focou'}`);
}

// browser_type modo:teclado (cap_digitar) em cada um, com a SENHA focada.
console.log('\n-- browser_type({modo:"teclado", ref}) com a senha do certificado focada --');
for (const id of ['combo', 'item', 'aba', 'opcao', 'botao']) {
  await zerar();
  await js('document.getElementById("senha").focus()');
  const e = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar')
    .executar(ctxPara(REF[id], { text: 'MinhaSenha123', delay_ms: 0 })));
  const senha = await js('document.getElementById("senha").value');
  check(senha === '', `ref #${id} (role visivel na ax-tree) NAO escreve na senha`,
    `bloqueado=${e ? 'sim' : 'NAO'} senha=${JSON.stringify(senha)}`);
}

// press_key "space": o freio classifica pelo NOME da tecla, o motor normaliza para " ".
await zerar();
await js('document.getElementById("senha").focus()');
let resolucao = await mod.resolverAlvoDaAcao({ type: 'press_key', params: { key: 'space' } }, 1);
let v = await mod.avaliar({ type: 'press_key', params: { key: 'space' } }, ws0, false, resolucao.ok ? resolucao.alvo : undefined);
if (v.permitido) await mod.executionEngine.run({ type: 'press_key', params: { key: 'space' } }, ws0, resolucao);
check((await js('document.getElementById("senha").value')) === '',
  'press_key key:"space" com senha focada NAO insere caractere na senha',
  `permitido=${v.permitido} senha=${JSON.stringify(await js('document.getElementById("senha").value'))}`);

// Controle: press_key de um caractere continua barrado
await zerar();
await js('document.getElementById("senha").focus()');
resolucao = await mod.resolverAlvoDaAcao({ type: 'press_key', params: { key: 'a' } }, 1);
v = await mod.avaliar({ type: 'press_key', params: { key: 'a' } }, ws0, false, resolucao.ok ? resolucao.alvo : undefined);
check(!v.permitido, 'CONTROLE: press_key key:"a" com senha focada continua BARRADO', `permitido=${v.permitido}`);

// Sem falso positivo: cap_digitar no proprio campo comum
await zerar();
await js('document.getElementById("senha").focus()');
const eOk = await erroDe(() => capDe(mod.moduloFormulario, 'cap_digitar').executar(ctxPara(REF.nome, { text: 'Fulano', delay_ms: 0 })));
check((await js('document.getElementById("nome").value')) === 'Fulano',
  'SEM FALSO POSITIVO: cap_digitar em campo comum continua escrevendo', `erro=${eOk}`);

console.log(`\n=== ${falhas} FALHA(S) ===`);
ws.close(); proc.kill();
