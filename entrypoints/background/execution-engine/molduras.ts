import { debuggerManager as dm } from '../debugger-manager';

/**
 * Molduras de OUTRO SITE (iframe cross-origin, que o Chrome roda em processo
 * proprio). Pedido de 23/09/2026 (sessao "Google Cloud billing"): o link
 * "Alterar" do Google Payments, o chat do Assistente de faturamento e o do
 * Google One moram numa moldura assim, e o read_page nao mostrava NADA la
 * dentro — o agente mirava no escuro.
 *
 * MEDIDO no mesmo dia (laboratorio `_archive/tmp/iframe-lab-20260923`: pagina
 * em 127.0.0.1 com moldura em localhost): clique por coordenada, tecla e
 * digitacao CHEGAM dentro da moldura. O que faltava era ENXERGAR. Aqui a
 * ponte se anexa a cada moldura (Target.setAutoAttach com flatten; o
 * chrome.debugger aceita sessao filha desde o Chrome 125) e lista os
 * elementos dela com a coordenada ja convertida para a tela da aba — a mesma
 * de browser_click {x, y}. Nao ha ref: o ref da ponte e backendNodeId da
 * pagina principal, e o de dentro da moldura e de outro processo.
 */

interface Sessao {
  sessionId: string;
  targetId: string;
  url: string;
  /** Sessao de quem contem esta moldura; undefined = pagina principal. */
  pai?: string;
}

export interface ElementoDeMoldura {
  role: string;
  text: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
  rect: { x: number; y: number; w: number; h: number };
  moldura: string;
  /** Centro fora da janela da aba: clique ali cai no vazio ate rolar. */
  foraDaVista?: boolean;
  /** L5: ref de moldura (f<n>:<id>), so em moldura de outro site lida por sessao filha. */
  ref?: string;
  /** L5: campo de senha ou de cartao (autocomplete cc-*): o valor nunca sai da moldura. */
  secreto?: boolean;
  /** Posicao do elemento no querySelectorAll da moldura (parte do ref). */
  idx?: number;
  /** Assinatura do elemento no momento da leitura (so interna). */
  sig?: string;
}

/**
 * L5: o que a ponte guarda de cada ref de moldura. O ref e `f<n>:<idx>`: n = numero
 * da moldura na aba (nunca reaproveitado ate religar o debugger), idx = posicao do
 * elemento na lista de interativos da moldura. `token` e o performance.timeOrigin do
 * documento da moldura: muda a cada carga, entao recarregar a moldura invalida os refs.
 */
export interface RefMoldura {
  ref: string;
  n: number;
  sessionId: string;
  targetId: string;
  host: string;
  url: string;
  idx: number;
  sig: string;
  token: number;
}

const porAba = new Map<number, Map<string, Sessao>>();
const ligado = new Set<number>();
const refsPorAba = new Map<number, Map<string, RefMoldura>>();
const numerosPorAba = new Map<number, { prox: number; porTarget: Map<string, number> }>();

// Reattach apaga os ouvintes da aba (onDetach do debugger-manager): liga de novo na proxima leitura.
dm.aoAnexar((tabId) => {
  ligado.delete(tabId);
  porAba.delete(tabId);
  refsPorAba.delete(tabId);
  numerosPorAba.delete(tabId);
});

/** Moldura de captcha (reCAPTCHA, hCaptcha, Turnstile...): a ponte nunca le nem clica. */
export function ehMolduraDeCaptcha(url: string | undefined): boolean {
  if (!url) return false;
  let h = '';
  let p = '';
  try { const u = new URL(url); h = u.hostname.toLowerCase(); p = u.pathname.toLowerCase(); } catch { return false; }
  if (/recaptcha|hcaptcha|turnstile|arkoselabs|funcaptcha|geetest/.test(h)) return true;
  if (h === 'challenges.cloudflare.com' || h.endsWith('.challenges.cloudflare.com')) return true;
  return (h === 'google.com' || h.endsWith('.google.com')) && p.startsWith('/recaptcha');
}

function numeroDaMoldura(tabId: number, targetId: string): number {
  let e = numerosPorAba.get(tabId);
  if (!e) { e = { prox: 1, porTarget: new Map() }; numerosPorAba.set(tabId, e); }
  let n = e.porTarget.get(targetId);
  if (n === undefined) { n = e.prox++; e.porTarget.set(targetId, n); }
  return n;
}

function soltarRefsDaMoldura(tabId: number, n: number): void {
  const t = refsPorAba.get(tabId);
  if (!t) return;
  for (const k of [...t.keys()]) if (k.startsWith(`f${n}:`)) t.delete(k);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AUTO = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

async function ligar(tabId: number): Promise<void> {
  if (ligado.has(tabId)) return;
  ligado.add(tabId);
  const mapa = new Map<string, Sessao>();
  porAba.set(tabId, mapa);

  dm.on(tabId, 'Target.attachedToTarget', (p, sessaoPai) => {
    const info = p.targetInfo as { targetId: string; type: string; url: string } | undefined;
    const sessionId = p.sessionId as string | undefined;
    if (!info || !sessionId || info.type !== 'iframe') return;
    mapa.set(sessionId, { sessionId, targetId: info.targetId, url: info.url, pai: sessaoPai });
    // Moldura dentro de moldura: a filha tambem precisa anexar as dela.
    dm.sendSessao(tabId, sessionId, 'Target.setAutoAttach', AUTO).catch(() => {});
  });
  dm.on(tabId, 'Target.detachedFromTarget', (p) => {
    const sid = p.sessionId as string;
    const s = mapa.get(sid);
    if (s) soltarRefsDaMoldura(tabId, numeroDaMoldura(tabId, s.targetId));
    mapa.delete(sid);
  });
  dm.on(tabId, 'Target.targetInfoChanged', (p) => {
    const info = p.targetInfo as { targetId: string; url: string } | undefined;
    if (!info) return;
    for (const s of mapa.values()) {
      if (s.targetId !== info.targetId) continue;
      // A moldura navegou: os refs de antes apontam para outro documento.
      if (s.url !== info.url) soltarRefsDaMoldura(tabId, numeroDaMoldura(tabId, s.targetId));
      s.url = info.url;
    }
  });

  await dm.send(tabId, 'Target.setAutoAttach', AUTO);
  // As molduras que JA existem chegam logo depois, como eventos.
  await esperar(400);
}

/** Canto de cima-esquerdo da AREA DE CONTEUDO da moldura, em coordenada da tela da aba. */
async function origemDaMoldura(tabId: number, s: Sessao, mapa: Map<string, Sessao>, prof = 0): Promise<{ x: number; y: number } | null> {
  if (prof > 5) return null;
  const enviarNoPai = <T>(metodo: string, params: object) => (s.pai
    ? dm.sendSessao<T>(tabId, s.pai, metodo, params)
    : dm.send<T>(tabId, metodo, params));
  try {
    await enviarNoPai('DOM.getDocument', { depth: 0 });
    const dono = await enviarNoPai<{ backendNodeId?: number }>('DOM.getFrameOwner', { frameId: s.targetId });
    if (!dono?.backendNodeId) return null;
    const caixa = await enviarNoPai<{ model?: { content?: number[] } }>('DOM.getBoxModel', { backendNodeId: dono.backendNodeId });
    const q = caixa?.model?.content;
    if (!q || q.length < 2) return null;
    const local = { x: q[0], y: q[1] };
    if (!s.pai) return local;
    const avo = mapa.get(s.pai);
    if (!avo) return null;
    const base = await origemDaMoldura(tabId, avo, mapa, prof + 1);
    return base ? { x: base.x + local.x, y: base.y + local.y } : null;
  } catch {
    return null;
  }
}

/** Seletor dos interativos de moldura. Uma definicao so: a leitura e a acao por ref usam a mesma ordem. */
export const SEL_MOLDURA = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=textbox],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[onclick],[contenteditable=""],[contenteditable=true]';

/**
 * Descreve um elemento DENTRO da moldura. `secreto` = senha ou autocomplete cc-*:
 * o valor desses campos nunca vira texto da resposta. `sigTexto` ignora o valor de
 * campo de texto (muda quando se digita), para o ref sobreviver a uma digitacao.
 */
export const DESCREVE_JS = `function __d(el){
  var tag = el.tagName.toLowerCase();
  var tipo = tag === 'input' ? String(el.type || 'text').toLowerCase() : '';
  var ac = String(el.getAttribute('autocomplete') || '').toLowerCase();
  var secreto = tipo === 'password' || /(^|\\s)cc-/.test(ac);
  var botaoInput = tag === 'input' && /^(submit|button|reset|image)$/.test(tipo);
  var visivel = String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  var texto = secreto ? '' : (visivel || (tag === 'input' || tag === 'textarea' || tag === 'select' ? String(el.value || '') : '')).replace(/\\s+/g, ' ').trim().slice(0, 80);
  var role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (tipo === 'text' ? 'textbox' : tipo) : tag === 'textarea' ? 'textbox' : el.isContentEditable ? 'textbox' : tag);
  return { tag: tag, tipo: tipo, role: role, text: texto, secreto: secreto,
    sigTexto: secreto ? '' : (visivel || (botaoInput ? String(el.value || '') : '')),
    placeholder: el.getAttribute('placeholder') || '', ariaLabel: el.getAttribute('aria-label') || '',
    href: tag === 'a' ? (el.getAttribute('href') || '') : '',
    ehAba: role === 'tab',
    temOnclick: typeof el.onclick === 'function' || el.hasAttribute('onclick'),
    dentroDeForm: !!el.form || !!el.closest('form'),
    editavel: !!el.isContentEditable && tag !== 'input' && tag !== 'textarea' };
}`;

const LISTAR = `(function(){
  ${DESCREVE_JS}
  var sel = ${JSON.stringify(SEL_MOLDURA)};
  var W = innerWidth, H = innerHeight, out = [];
  var els = document.querySelectorAll(sel);
  for (var i = 0; i < els.length && out.length < 150; i++) {
    var el = els[i], r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    var d = __d(el);
    out.push({ role: d.role, text: d.text, placeholder: d.placeholder || undefined,
      ariaLabel: d.ariaLabel || undefined, href: d.href || undefined, secreto: d.secreto || undefined,
      idx: i, sig: [d.tag, d.role, d.sigTexto, d.placeholder, d.ariaLabel, d.href].join('|'),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }
  return { token: performance.timeOrigin, els: out };
})()`;

interface FrameNoMesmoProcesso {
  frameId: string;
  url: string;
  host: string;
}

/**
 * Molduras de outra ORIGEM mas do MESMO SITE (ex.: apps.google.com com
 * moldura em outro subdominio de google.com). O Chrome nao separa essas em
 * processo proprio, entao nao viram sessao filha: moram na arvore de frames
 * da propria aba. O JS da pagina nao alcanca (origem diferente), mas o CDP
 * alcanca por um "mundo isolado" criado dentro do frame. Achado de
 * 23/09/2026: o chat do Assistente de faturamento do Google Cloud continuou
 * invisivel depois do conserto das sessoes filhas.
 */
async function framesNoMesmoProcesso(tabId: number, excluir: Set<string>): Promise<FrameNoMesmoProcesso[]> {
  type No = { frame: { id: string; url: string; securityOrigin?: string }; childFrames?: No[] };
  const arvore = await dm.send<{ frameTree?: No }>(tabId, 'Page.getFrameTree', {});
  const raiz = arvore?.frameTree;
  if (!raiz) return [];
  const origemTopo = raiz.frame.securityOrigin || '';
  const out: FrameNoMesmoProcesso[] = [];
  const andar = (n: No) => {
    for (const f of n.childFrames ?? []) {
      const u = f.frame.url || '';
      if (u && u !== 'about:blank' && !excluir.has(f.frame.id) && f.frame.securityOrigin !== origemTopo) {
        let host = u;
        try { host = new URL(u).host || u; } catch { /* fica */ }
        out.push({ frameId: f.frame.id, url: u, host });
      }
      andar(f);
    }
  };
  andar(raiz);
  return out;
}

const mundoPorFrame = new Map<string, number>();

async function avaliarNoFrame<T>(tabId: number, frameId: string, expressao: string): Promise<T | undefined> {
  const tentar = async (): Promise<T | undefined> => {
    let ctx = mundoPorFrame.get(`${tabId}:${frameId}`);
    if (ctx === undefined) {
      const m = await dm.send<{ executionContextId?: number }>(tabId, 'Page.createIsolatedWorld', {
        frameId, worldName: 'praxedes-molduras', grantUniveralAccess: false,
      });
      if (m?.executionContextId === undefined) return undefined;
      ctx = m.executionContextId;
      mundoPorFrame.set(`${tabId}:${frameId}`, ctx);
    }
    const r = await dm.send<{ result?: { value?: T } }>(tabId, 'Runtime.evaluate', {
      expression: expressao, contextId: ctx, returnByValue: true,
    });
    return r?.result?.value;
  };
  try {
    return await tentar();
  } catch {
    // Contexto velho (o frame navegou): cria de novo uma vez.
    mundoPorFrame.delete(`${tabId}:${frameId}`);
    return tentar();
  }
}

/** Canto da area de conteudo de um frame do mesmo processo, na tela da aba. */
async function origemDoFrame(tabId: number, frameId: string): Promise<{ x: number; y: number } | null> {
  try {
    await dm.send(tabId, 'DOM.getDocument', { depth: 0 });
    const dono = await dm.send<{ backendNodeId?: number }>(tabId, 'DOM.getFrameOwner', { frameId });
    if (!dono?.backendNodeId) return null;
    // Medido na obra 25 (cdp-tools.ts): getBoxModel de no dentro de iframe do
    // mesmo processo ja vem em coordenada do TOPO da aba — sem somar nada.
    const caixa = await dm.send<{ model?: { content?: number[] } }>(tabId, 'DOM.getBoxModel', { backendNodeId: dono.backendNodeId });
    const q = caixa?.model?.content;
    return q && q.length >= 2 ? { x: q[0], y: q[1] } : null;
  } catch {
    return null;
  }
}

/**
 * Elementos visiveis de TODAS as molduras de outro site da aba, com a
 * coordenada da tela da aba. Nunca lanca: moldura que nao deu para ler vira
 * uma linha dizendo isso, e a leitura da pagina principal segue igual.
 */
export async function lerMolduras(tabId: number): Promise<{ elementos: ElementoDeMoldura[]; ilegiveis: string[] }> {
  const elementos: ElementoDeMoldura[] = [];
  const ilegiveis: string[] = [];
  try {
    await ligar(tabId);
  } catch (err) {
    return { elementos, ilegiveis: [`nao consegui anexar as molduras: ${String(err).slice(0, 120)}`] };
  }
  const mapa = porAba.get(tabId) ?? new Map<string, Sessao>();

  // 1. Mesmo site, outra origem: frames da propria aba, por mundo isolado.
  try {
    const excluir = new Set([...mapa.values()].map((s) => s.targetId));
    for (const f of await framesNoMesmoProcesso(tabId, excluir)) {
      if (ehMolduraDeCaptcha(f.url)) { ilegiveis.push(`${f.host} (captcha: a ponte nao le nem clica)`); continue; }
      const origem = await origemDoFrame(tabId, f.frameId);
      if (!origem) { ilegiveis.push(`${f.host} (moldura sem posicao na tela: oculta ou fora da vista)`); continue; }
      try {
        const lista = await avaliarNoFrame<{ els: Array<Omit<ElementoDeMoldura, 'moldura'>> }>(tabId, f.frameId, LISTAR);
        for (const e of lista?.els ?? []) {
          // Mesmo processo: sem ref (L5 so cobre moldura de outro site, por sessao filha).
          elementos.push({ ...e, idx: undefined, sig: undefined, rect: { x: e.rect.x + origem.x, y: e.rect.y + origem.y, w: e.rect.w, h: e.rect.h }, moldura: f.host });
        }
      } catch (err) {
        ilegiveis.push(`${f.host} (${String(err).slice(0, 100)})`);
      }
    }
  } catch (err) {
    ilegiveis.push(`arvore de frames ilegivel (${String(err).slice(0, 100)})`);
  }

  // 2. Outro site: sessoes filhas (processo proprio).
  const captchaNaCadeia = (s: Sessao): boolean => {
    let x: Sessao | undefined = s;
    for (let i = 0; x && i < 6; i++) {
      if (ehMolduraDeCaptcha(x.url)) return true;
      x = x.pai ? mapa.get(x.pai) : undefined;
    }
    return false;
  };
  for (const s of mapa.values()) {
    let host = s.url;
    try { host = new URL(s.url).host || s.url; } catch { /* fica a url */ }
    if (!s.url || s.url === 'about:blank') continue;
    if (captchaNaCadeia(s)) { ilegiveis.push(`${host} (captcha: a ponte nao le nem clica)`); continue; }
    const origem = await origemDaMoldura(tabId, s, mapa);
    if (!origem) {
      ilegiveis.push(`${host} (moldura sem posicao na tela: oculta ou fora da vista)`);
      continue;
    }
    try {
      const r = await dm.sendSessao<{ result?: { value?: { token: number; els: Array<Omit<ElementoDeMoldura, 'moldura'>> } } }>(
        tabId, s.sessionId, 'Runtime.evaluate', { expression: LISTAR, returnByValue: true },
      );
      const lido = r?.result?.value;
      const n = numeroDaMoldura(tabId, s.targetId);
      // Releitura: os refs desta moldura passam a ser os desta leitura.
      soltarRefsDaMoldura(tabId, n);
      let tabela = refsPorAba.get(tabId);
      if (!tabela) { tabela = new Map(); refsPorAba.set(tabId, tabela); }
      for (const e of lido?.els ?? []) {
        const ref = `f${n}:${e.idx}`;
        tabela.set(ref, {
          ref, n, sessionId: s.sessionId, targetId: s.targetId, host, url: s.url,
          idx: e.idx as number, sig: e.sig as string, token: lido!.token,
        });
        elementos.push({
          ...e,
          sig: undefined,
          ref,
          rect: { x: e.rect.x + origem.x, y: e.rect.y + origem.y, w: e.rect.w, h: e.rect.h },
          moldura: host,
        });
      }
    } catch (err) {
      ilegiveis.push(`${host} (${String(err).slice(0, 100)})`);
    }
  }
  // Centro fora da janela da aba: o clique por coordenada cairia no vazio
  // (medido no laboratorio: moldura abaixo da dobra, "clique real" em nada).
  try {
    const v = await dm.send<{ result?: { value?: { w: number; h: number } } }>(tabId, 'Runtime.evaluate', {
      expression: '({w: innerWidth, h: innerHeight})', returnByValue: true,
    });
    const W = v?.result?.value?.w ?? Infinity;
    const H = v?.result?.value?.h ?? Infinity;
    for (const e of elementos) {
      const cx = e.rect.x + e.rect.w / 2;
      const cy = e.rect.y + e.rect.h / 2;
      if (cx < 0 || cy < 0 || cx > W || cy > H) e.foraDaVista = true;
    }
  } catch { /* sem medida, sem marca */ }
  return { elementos, ilegiveis };
}

/**
 * O foco esta numa moldura de outro site? Devolve o host dela (para a
 * digitacao dizer onde o texto foi, em vez de "lido: null" mudo) e, se
 * possivel, o valor do campo focado LA DENTRO.
 */
export async function focoEmMoldura(tabId: number): Promise<{ host: string; valor: string | null } | null> {
  try {
    const r = await dm.send<{ result?: { value?: string } }>(tabId, 'Runtime.evaluate', {
      expression: `(function(){var a=document.activeElement;if(!a||a.tagName!=='IFRAME')return '';try{if(a.contentDocument)return '';}catch(e){}return a.src||'?';})()`,
      returnByValue: true,
    });
    const src = r?.result?.value;
    if (!src) return null;
    let host = src;
    try { host = new URL(src).host; } catch { /* fica */ }
    await ligar(tabId).catch(() => {});
    const mapa = porAba.get(tabId);
    let valor: string | null = null;
    const LER_FOCO = `(function(){var a=document.activeElement;if(!a)return null;if('value' in a)return String(a.value);if(a.isContentEditable)return a.innerText;return null;})()`;
    // Mesmo site, outra origem: frame da propria aba.
    try {
      for (const f of await framesNoMesmoProcesso(tabId, new Set())) {
        if (f.host !== host) continue;
        const v = await avaliarNoFrame<string | null>(tabId, f.frameId, LER_FOCO).catch(() => undefined);
        if (typeof v === 'string') return { host, valor: v };
      }
    } catch { /* segue para as sessoes filhas */ }
    for (const s of mapa?.values() ?? []) {
      let h = s.url;
      try { h = new URL(s.url).host; } catch { /* fica */ }
      if (h !== host) continue;
      try {
        const v = await dm.sendSessao<{ result?: { value?: string | null } }>(tabId, s.sessionId, 'Runtime.evaluate', {
          expression: `(function(){var a=document.activeElement;if(!a)return null;if('value' in a)return String(a.value);if(a.isContentEditable)return a.innerText;return null;})()`,
          returnByValue: true,
        });
        if (typeof v?.result?.value === 'string') { valor = v.result.value; break; }
      } catch { /* tenta a proxima */ }
    }
    return { host, valor };
  } catch {
    return null;
  }
}

/**
 * Avalia a MESMA expressao na pagina principal e em TODAS as molduras (mesmo
 * site por mundo isolado, outro site por sessao filha). Usado para achar video
 * em pedacos dentro de player embutido (Vimeo no Behance, 26/09/2026): o
 * player e moldura de outro site e os pedidos dele nao aparecem na rede da aba.
 */
export async function avaliarEmTodas<T>(tabId: number, expressao: string): Promise<Array<{ onde: string; valor: T }>> {
  const out: Array<{ onde: string; valor: T }> = [];
  try {
    const r = await dm.send<{ result?: { value?: T } }>(tabId, 'Runtime.evaluate', { expression: expressao, returnByValue: true });
    if (r?.result?.value !== undefined) out.push({ onde: 'pagina', valor: r.result.value });
  } catch { /* segue */ }
  await ligar(tabId).catch(() => {});
  const mapa = porAba.get(tabId) ?? new Map<string, Sessao>();
  try {
    const excluir = new Set([...mapa.values()].map((s) => s.targetId));
    for (const f of await framesNoMesmoProcesso(tabId, excluir)) {
      const v = await avaliarNoFrame<T>(tabId, f.frameId, expressao).catch(() => undefined);
      if (v !== undefined) out.push({ onde: f.host, valor: v });
    }
  } catch { /* segue */ }
  for (const s of mapa.values()) {
    try {
      const r = await dm.sendSessao<{ result?: { value?: T } }>(tabId, s.sessionId, 'Runtime.evaluate', { expression: expressao, returnByValue: true });
      let host = s.url;
      try { host = new URL(s.url).host; } catch { /* fica */ }
      if (r?.result?.value !== undefined) out.push({ onde: host, valor: r.result.value });
    } catch { /* moldura sem permissao ou ja fechada */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// L5 — acesso por ref a elementos de moldura de outro site
// ---------------------------------------------------------------------------

export const ehRefMoldura = (r: unknown): r is string => typeof r === 'string' && /^f\d+:\d+$/.test(r);

export interface DescricaoMoldura {
  tag: string; tipo: string; role: string; text: string; secreto: boolean; sigTexto: string;
  placeholder: string; ariaLabel: string; href: string; ehAba: boolean; temOnclick: boolean;
  dentroDeForm: boolean; editavel: boolean;
}

/** Avalia uma expressao na sessao filha de uma moldura. */
export async function avaliarNaSessao<T>(tabId: number, sessionId: string, expressao: string): Promise<T | undefined> {
  const r = await dm.sendSessao<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>(
    tabId, sessionId, 'Runtime.evaluate', { expression: expressao, returnByValue: true },
  );
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || 'excecao na moldura');
  return r?.result?.value;
}

/** Canto da area de conteudo da moldura na tela da aba (mesma conta da leitura). */
export async function origemDaSessao(tabId: number, sessionId: string): Promise<{ x: number; y: number } | null> {
  const mapa = porAba.get(tabId);
  const s = mapa?.get(sessionId);
  if (!mapa || !s) return null;
  return origemDaMoldura(tabId, s, mapa);
}

/**
 * Resolve um ref de moldura para a entrada guardada na leitura E confere, na hora,
 * que o documento da moldura e o mesmo (token) e que o elemento ainda e o mesmo
 * (assinatura). Qualquer diferenca: erro claro mandando reler.
 */
export async function resolverRefMoldura(
  tabId: number, ref: string,
): Promise<{ ok: true; entrada: RefMoldura; desc: DescricaoMoldura } | { ok: false; erro: string }> {
  const releia = 'Releia a pagina com browser_read_page e use um ref atual.';
  const entrada = refsPorAba.get(tabId)?.get(ref);
  if (!entrada) {
    return { ok: false, erro: `ref de moldura ${ref} desconhecido ou invalidado (a moldura recarregou, fechou ou o ref e de outra leitura). ${releia}` };
  }
  const s = porAba.get(tabId)?.get(entrada.sessionId);
  if (!s) {
    soltarRefsDaMoldura(tabId, entrada.n);
    return { ok: false, erro: `a moldura do ref ${ref} (${entrada.host}) nao existe mais. ${releia}` };
  }
  if (ehMolduraDeCaptcha(s.url) || ehMolduraDeCaptcha(entrada.url)) {
    return { ok: false, erro: `ref ${ref}: moldura de captcha, que a ponte nao toca. Peca ao usuário.` };
  }
  let lido: { token: number; sumiu?: boolean; d?: DescricaoMoldura } | undefined;
  try {
    lido = await avaliarNaSessao(tabId, entrada.sessionId, `(function(){
      ${DESCREVE_JS}
      var el = document.querySelectorAll(${JSON.stringify(SEL_MOLDURA)})[${entrada.idx}];
      if (!el) return { token: performance.timeOrigin, sumiu: true };
      return { token: performance.timeOrigin, d: __d(el) };
    })()`);
  } catch (err) {
    return { ok: false, erro: `ref ${ref}: nao consegui falar com a moldura (${String(err).slice(0, 120)}). ${releia}` };
  }
  if (!lido || lido.token !== entrada.token) {
    soltarRefsDaMoldura(tabId, entrada.n);
    return { ok: false, erro: `ref ${ref}: a moldura (${entrada.host}) recarregou desde a leitura; o ref e de outro documento. ${releia}` };
  }
  if (lido.sumiu || !lido.d) return { ok: false, erro: `ref ${ref}: o elemento nao existe mais na moldura. ${releia}` };
  const d = lido.d;
  const sig = [d.tag, d.role, d.sigTexto, d.placeholder, d.ariaLabel, d.href].join('|');
  if (sig !== entrada.sig) {
    return { ok: false, erro: `ref ${ref}: o elemento mudou desde a leitura (a moldura se redesenhou). ${releia}` };
  }
  return { ok: true, entrada, desc: d };
}
