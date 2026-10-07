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
}

const porAba = new Map<number, Map<string, Sessao>>();
const ligado = new Set<number>();

// Reattach apaga os ouvintes da aba (onDetach do debugger-manager): liga de novo na proxima leitura.
dm.aoAnexar((tabId) => {
  ligado.delete(tabId);
  porAba.delete(tabId);
});

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
    mapa.delete(p.sessionId as string);
  });
  dm.on(tabId, 'Target.targetInfoChanged', (p) => {
    const info = p.targetInfo as { targetId: string; url: string } | undefined;
    if (!info) return;
    for (const s of mapa.values()) if (s.targetId === info.targetId) s.url = info.url;
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

const LISTAR = `(function(){
  var sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=textbox],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[onclick],[contenteditable=""],[contenteditable=true]';
  var W = innerWidth, H = innerHeight, out = [];
  var els = document.querySelectorAll(sel);
  for (var i = 0; i < els.length && out.length < 150; i++) {
    var el = els[i], r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? ((el.type || 'text') === 'text' ? 'textbox' : el.type) : tag === 'textarea' ? 'textbox' : el.isContentEditable ? 'textbox' : tag);
    var txt = (el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    out.push({ role: role, text: txt, placeholder: el.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      href: tag === 'a' ? (el.getAttribute('href') || undefined) : undefined,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }
  return out;
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
      const origem = await origemDoFrame(tabId, f.frameId);
      if (!origem) { ilegiveis.push(`${f.host} (moldura sem posicao na tela: oculta ou fora da vista)`); continue; }
      try {
        const lista = await avaliarNoFrame<Array<Omit<ElementoDeMoldura, 'moldura'>>>(tabId, f.frameId, LISTAR);
        for (const e of lista ?? []) {
          elementos.push({ ...e, rect: { x: e.rect.x + origem.x, y: e.rect.y + origem.y, w: e.rect.w, h: e.rect.h }, moldura: f.host });
        }
      } catch (err) {
        ilegiveis.push(`${f.host} (${String(err).slice(0, 100)})`);
      }
    }
  } catch (err) {
    ilegiveis.push(`arvore de frames ilegivel (${String(err).slice(0, 100)})`);
  }

  // 2. Outro site: sessoes filhas (processo proprio).
  for (const s of mapa.values()) {
    let host = s.url;
    try { host = new URL(s.url).host || s.url; } catch { /* fica a url */ }
    if (!s.url || s.url === 'about:blank') continue;
    const origem = await origemDaMoldura(tabId, s, mapa);
    if (!origem) {
      ilegiveis.push(`${host} (moldura sem posicao na tela: oculta ou fora da vista)`);
      continue;
    }
    try {
      const r = await dm.sendSessao<{ result?: { value?: Array<Omit<ElementoDeMoldura, 'moldura'>> } }>(
        tabId, s.sessionId, 'Runtime.evaluate', { expression: LISTAR, returnByValue: true },
      );
      for (const e of r?.result?.value ?? []) {
        elementos.push({
          ...e,
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
