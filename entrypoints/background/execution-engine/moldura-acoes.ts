import { debuggerManager as dm } from '../debugger-manager';
import { cdpClick } from './cdp-tools';
import { aguardarEstavel } from './espera-estavel';
import type { AlvoResolvido } from './index';
import {
  DESCREVE_JS, SEL_MOLDURA, avaliarNaSessao, origemDaSessao, resolverRefMoldura,
  type DescricaoMoldura, type RefMoldura,
} from './molduras';

/**
 * L5 — clique e digitacao por ref DENTRO de moldura de outro site.
 *
 * O ref (f<n>:<id>) vem de `lerMolduras`. Aqui:
 *  - `resolverAlvoDeMoldura` monta um `AlvoResolvido` com o descritor do botao REAL
 *    de dentro da moldura (texto, aria-label, tipo, onclick) e o `moldura.url`, para
 *    o MESMO freio (`avaliar`, policy.ts) julgar texto destrutivo, senha/cartao e
 *    host financeiro da moldura, em vez de julgar o `<iframe>`;
 *  - `cliqueNaMoldura` / `digitarNaMoldura` agem so depois do veredito. O clique e
 *    por coordenada no topo da aba (o Chrome entrega ao processo da moldura, medido
 *    em 23/09/2026), com hit-test dos dois lados: o elemento tem de ser o que esta
 *    no ponto dentro da moldura, e a moldura tem de ser o que esta no ponto da aba.
 */

export type ResolucaoMoldura =
  | { ok: true; alvo: AlvoResolvido; entrada: RefMoldura; desc: DescricaoMoldura }
  | { ok: false; erro: string };

const TIPOS_NAO_DIGITAVEIS = new Set(['file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'range', 'color']);

export async function resolverAlvoDeMoldura(tabId: number, ref: string): Promise<ResolucaoMoldura> {
  const r = await resolverRefMoldura(tabId, ref);
  if (!r.ok) return r;
  const { entrada, desc } = r;
  const campoDigitavel = desc.editavel || desc.tag === 'textarea' || desc.tag === 'select'
    || (desc.tag === 'input' && !TIPOS_NAO_DIGITAVEIS.has(desc.tipo));
  const alvo: AlvoResolvido = {
    tabId,
    como: 'ref',
    backendNodeId: 0,
    objectId: '',
    ponto: null,
    descritor: {
      tag: desc.tag,
      tipo: desc.tipo,
      role: desc.role.toLowerCase(),
      texto: desc.text,
      ariaLabel: desc.ariaLabel,
      ehAba: desc.ehAba,
      temOnclick: desc.temOnclick,
      dentroDeForm: desc.dentroDeForm,
    },
    efetivo: {
      backendNodeId: 0,
      objectId: '',
      tag: desc.tag,
      // cc-* e tratado como senha: a ponte nao digita credencial nem cartao.
      tipo: desc.secreto ? 'password' : desc.tipo,
      editavel: desc.editavel,
      desceu: false,
    },
    cliqueApenasFoca: campoDigitavel,
    escritaCaiuNoFoco: false,
    moldura: { host: entrada.host, url: entrada.url, ref },
  };
  return { ok: true, alvo, entrada, desc };
}

const espera = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Retangulo { x: number; y: number; w: number; h: number }

async function prepararElemento(tabId: number, e: RefMoldura): Promise<Retangulo> {
  const acesso = `document.querySelectorAll(${JSON.stringify(SEL_MOLDURA)})[${e.idx}]`;
  const ok = await avaliarNaSessao<boolean>(tabId, e.sessionId, `(function(){
    var el = ${acesso}; if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return true;
  })()`);
  if (!ok) throw new Error(`ref ${e.ref}: o elemento sumiu da moldura. Releia a pagina com browser_read_page.`);
  const est = await aguardarEstavel(async () => avaliarNaSessao<Retangulo>(tabId, e.sessionId, `(function(){
    var el = ${acesso}; if (!el) return null;
    var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`), { intervaloMs: 30, tetoMs: 500 });
  const r = est.valor;
  if (!r || r.w <= 0 || r.h <= 0) {
    throw new Error(`ref ${e.ref}: o elemento nao tem area visivel na moldura (oculto ou fora do desenho). Releia a pagina.`);
  }
  return r;
}

/** Clique real no centro do elemento da moldura. Falha FECHADO se algo cobre o ponto. */
export async function cliqueNaMoldura(tabId: number, e: RefMoldura): Promise<{ x: number; y: number }> {
  const r = await prepararElemento(tabId, e);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const acesso = `document.querySelectorAll(${JSON.stringify(SEL_MOLDURA)})[${e.idx}]`;
  // 1. Dentro da moldura: o que esta no ponto e o elemento (ou filho dele)?
  const dentro = await avaliarNaSessao<{ ok: boolean; motivo?: string }>(tabId, e.sessionId, `(function(){
    var el = ${acesso}; if (!el) return { ok: false, motivo: 'sumiu' };
    var h = document.elementFromPoint(${cx}, ${cy});
    if (!h) return { ok: false, motivo: 'o ponto esta fora da janela da moldura' };
    return (h === el || el.contains(h)) ? { ok: true } : { ok: false, motivo: 'coberto por <' + h.tagName.toLowerCase() + '>' };
  })()`);
  if (!dentro?.ok) {
    throw new Error(`ref ${e.ref}: clique recusado, ${dentro?.motivo ?? 'sem hit-test'} dentro da moldura. Role ate o elemento ficar livre e releia.`);
  }
  // 2. Posicao na tela da aba.
  const origem = await origemDaSessao(tabId, e.sessionId);
  if (!origem) throw new Error(`ref ${e.ref}: nao consegui a posicao da moldura na tela (oculta ou fora da vista). Role ate ela e releia.`);
  const x = origem.x + cx;
  const y = origem.y + cy;
  // 3. No topo: o ponto esta na janela e quem esta ali e uma <iframe>?
  const topo = await dm.send<{ result?: { value?: { dentro: boolean; tag: string } } }>(tabId, 'Runtime.evaluate', {
    expression: `(function(){ var x=${x}, y=${y};
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { dentro: false, tag: '' };
      var h = document.elementFromPoint(x, y); return { dentro: true, tag: h ? h.tagName : '' }; })()`,
    returnByValue: true,
  });
  const t = topo?.result?.value;
  if (!t?.dentro) throw new Error(`ref ${e.ref}: o elemento esta fora da janela da aba (${Math.round(x)},${Math.round(y)}). Role a pagina ate a moldura e releia.`);
  if (t.tag !== 'IFRAME') throw new Error(`ref ${e.ref}: clique recusado, a moldura esta coberta por <${t.tag.toLowerCase()}> na pagina principal.`);
  await cdpClick(tabId, x, y);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Le o valor atual do campo (mascarado quando e senha/cartao). */
export async function lerValorNaMoldura(tabId: number, e: RefMoldura): Promise<string | null> {
  const v = await avaliarNaSessao<string | null>(tabId, e.sessionId, `(function(){
    ${DESCREVE_JS}
    var el = document.querySelectorAll(${JSON.stringify(SEL_MOLDURA)})[${e.idx}]; if (!el) return null;
    if (__d(el).secreto) return '[oculto]';
    if ('value' in el) return String(el.value).slice(0, 300);
    return el.isContentEditable ? String(el.innerText).slice(0, 300) : null;
  })()`).catch(() => null);
  return v ?? null;
}

/**
 * Escreve num campo da moldura. `rapido` seta pelo setter nativo e dispara
 * input/change (como o modo padrao da ponte); `teclado` foca e manda uma tecla
 * por vez pelo topo da aba (isTrusted), para autocomplete e mascara.
 */
export async function digitarNaMoldura(
  tabId: number, e: RefMoldura, texto: string,
  { limpar = false, modo = 'rapido', delayMs = 60 }: { limpar?: boolean; modo?: 'rapido' | 'teclado'; delayMs?: number } = {},
): Promise<{ lido: string | null }> {
  const acesso = `document.querySelectorAll(${JSON.stringify(SEL_MOLDURA)})[${e.idx}]`;
  const T = JSON.stringify(texto);
  const L = limpar ? 'true' : 'false';
  if (modo === 'teclado') {
    const pronto = await avaliarNaSessao<{ ok: boolean; erro?: string }>(tabId, e.sessionId, `(function(){
      var el = ${acesso}; if (!el) return { ok: false, erro: 'sumiu' };
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      el.focus();
      if (${L}) { if (typeof el.select === 'function') el.select(); else { var s = getSelection(), r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); } }
      return { ok: document.activeElement === el || el.contains(document.activeElement) };
    })()`);
    if (!pronto?.ok) throw new Error(`ref ${e.ref}: o campo nao recebeu o foco dentro da moldura.`);
    if (limpar) await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }).catch(() => {});
    for (const ch of texto) {
      await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
      await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await espera(delayMs);
    }
    return { lido: await lerValorNaMoldura(tabId, e) };
  }
  const r = await avaliarNaSessao<{ ok: boolean; erro?: string }>(tabId, e.sessionId, `(function(){
    var el = ${acesso}; if (!el) return { ok: false, erro: 'sumiu' };
    el.focus();
    var tag = el.tagName.toLowerCase(), t = ${T};
    if (tag === 'input' || tag === 'textarea') {
      var proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      var set = Object.getOwnPropertyDescriptor(proto, 'value').set;
      set.call(el, ${L} ? t : String(el.value) + t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (el.isContentEditable) {
      if (${L}) { var s = getSelection(), r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
      document.execCommand('insertText', false, t);
      return { ok: true };
    }
    return { ok: false, erro: 'o elemento nao e um campo de texto' };
  })()`);
  if (!r?.ok) throw new Error(`ref ${e.ref}: ${r?.erro ?? 'nao consegui escrever'} (moldura ${e.host}).`);
  return { lido: await lerValorNaMoldura(tabId, e) };
}
