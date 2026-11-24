import { debuggerManager as dm } from '../../debugger-manager';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * v6.1 (d) — detector de <select> nativo aberto.
 *
 * Clicar num <select> comum abre a lista NATIVA do Chrome, desenhada fora da pagina: nao esta no
 * DOM, nao aparece na leitura e um clique nas "opcoes" cai no vazio (o agente clicava e nada
 * acontecia). Depois de um clique, de uma tecla de abrir (Enter/Espaco/seta) ou de uma leitura, se o
 * elemento focado e um select de lista suspensa, o resultado ganha o aviso e o caminho certo:
 * browser_form_input com o texto ou o value da opcao.
 *
 * So observa: devolve o resultado intacto mais o aviso. Nunca falha a acao.
 */

export interface InfoSelect {
  nome: string;
  valor: string;
  /** Texto das primeiras opcoes. */
  opcoes: string[];
  total: number;
}

/** Roda com `this` = elemento focado. Devolve null se nao for select de lista suspensa. */
export const SONDA_SELECT = `
  function () {
    var e = this;
    if (!e || e.tagName !== 'SELECT' || e.multiple || (e.size && e.size > 1) || e.disabled) return null;
    var ops = [].slice.call(e.options || []);
    var rotulo = e.getAttribute('aria-label') || e.name || e.id || '';
    if (!rotulo && e.labels && e.labels[0]) rotulo = (e.labels[0].innerText || '').trim();
    return {
      nome: String(rotulo).slice(0, 60),
      valor: String(e.value || '').slice(0, 60),
      opcoes: ops.slice(0, 8).map(function (o) { return (o.text || o.value || '').trim().slice(0, 40); }),
      total: ops.length
    };
  }
`;

export function montarAvisoSelect(info: InfoSelect, ref?: number): string {
  const alvo = ref !== undefined ? `ref ${ref}` : 'a ref do select (browser_read_page)';
  const lista = info.opcoes.join(' | ') + (info.total > info.opcoes.length ? ` (+${info.total - info.opcoes.length})` : '');
  return `[select nativo] a lista suspensa${info.nome ? ` de "${info.nome}"` : ''} provavelmente esta ABERTA. O Chrome desenha essa lista fora da pagina: `
    + 'ela nao aparece na leitura nem no print, e clicar nas opcoes cai no vazio. NAO clique nela. '
    + `Escolha por valor: browser_form_input {ref: ${ref ?? '<ref do select>'}, valor: "<texto ou value da opcao>"} (${alvo}). `
    + `Atual: "${info.valor}". Opcoes: ${lista}.`;
}

/** Acoes depois das quais um select pode ter sido aberto. */
export const ACOES_QUE_ABREM = new Set(['click', 'cap_click_xy', 'press_key', 'read_page']);

async function detectar(tabId: number): Promise<{ info: InfoSelect; ref?: number } | null> {
  let objectId: string | undefined;
  try {
    const foco = await dm.send<{ result?: { objectId?: string; subtype?: string } }>(tabId, 'Runtime.evaluate', {
      expression: 'document.activeElement', returnByValue: false,
    });
    objectId = foco?.result?.objectId;
    if (!objectId || foco?.result?.subtype !== 'node') return null;
    const r = await dm.send<{ result?: { value?: InfoSelect | null } }>(tabId, 'Runtime.callFunctionOn', {
      objectId, functionDeclaration: SONDA_SELECT, returnByValue: true,
    });
    const info = r?.result?.value;
    if (!info) return null;
    let ref: number | undefined;
    try {
      const d = await dm.send<{ node?: { backendNodeId?: number } }>(tabId, 'DOM.describeNode', { objectId });
      ref = d?.node?.backendNodeId;
    } catch { /* sem ref: o aviso manda reler a pagina */ }
    return { info, ref };
  } catch {
    return null;
  } finally {
    if (objectId) dm.send(tabId, 'Runtime.releaseObject', { objectId }).catch(() => {});
  }
}

/** So `press_key` que abre a lista; as demais teclas nao valem a sonda. */
function teclaAbre(ctx: ContextoCapacidade): boolean {
  const k = String((ctx.params as { key?: string }).key ?? '');
  return /^(Enter| |Space|ArrowDown|ArrowUp|F4)$/.test(k) || k === 'Alt+ArrowDown';
}

async function depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
  if (!r.ok || !ACOES_QUE_ABREM.has(ctx.acao)) return r;
  if (ctx.acao === 'press_key' && !teclaAbre(ctx)) return r;
  const achado = await detectar(ctx.tabId);
  if (!achado) return r;
  const aviso = montarAvisoSelect(achado.info, achado.ref);
  const base = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;

  if (ctx.acao === 'read_page') {
    // A leitura formata `avisoLeitura` no cabecalho como [aviso].
    const antes = typeof base?.avisoLeitura === 'string' && base.avisoLeitura ? `${base.avisoLeitura}; ` : '';
    return { ...r, data: { ...(base ?? {}), avisoLeitura: antes + aviso } };
  }
  return { ...r, data: { ...(base ?? (r.data === undefined || r.data === null ? {} : { resultado: r.data })), select_nativo: aviso } };
}

export const modulo: ModuloCapacidades = {
  nome: 'select-nativo',
  capacidades: [],
  ganchos: { depois },
};
