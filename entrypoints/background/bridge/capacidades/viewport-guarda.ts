import { debuggerManager as dm } from '../../debugger-manager';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * v6.1 (a) — guarda de viewport para clique por coordenada.
 *
 * Coordenada x,y vem de uma leitura (screenshot, read_page) feita com a janela de um
 * tamanho. Se a janela mudou depois (emulacao de dispositivo, janela redimensionada ou
 * restaurada, zoom), o mesmo x,y cai em outro lugar e o clique acerta o elemento errado
 * sem erro nenhum. Esta guarda anota o tamanho do viewport a cada leitura e, antes de um
 * clique/arrasto por coordenada, confere se continua o mesmo. Mudou: NAO clica, devolve
 * aviso (o roteiro anexa a leitura nova, ver bridge-server/src/roteiro.js).
 *
 * Nao e atualizada pelo proprio aviso: so uma leitura de verdade renova a base, para o
 * agente nao repetir o mesmo x,y as cegas. Sem leitura anterior nesta aba, nao ha o que
 * comparar e o clique segue como sempre.
 */

export interface Viewport { w: number; h: number; dpr: number }

/** Acoes que leem a tela e portanto renovam a base. */
export const ACOES_DE_LEITURA = new Set(['read_page', 'cap_print', 'cap_screenshot_ref']);
/** Acoes que clicam num ponto da tela. */
export const ACOES_POR_PONTO = new Set(['cap_click_xy', 'drag']);

const TOLERANCIA_PX = 1;
const TOLERANCIA_DPR = 0.01;

export function viewportMudou(base: Viewport, atual: Viewport): boolean {
  return Math.abs(base.w - atual.w) > TOLERANCIA_PX
    || Math.abs(base.h - atual.h) > TOLERANCIA_PX
    || Math.abs(base.dpr - atual.dpr) > TOLERANCIA_DPR;
}

const fmt = (v: Viewport) => `${Math.round(v.w)}x${Math.round(v.h)}${v.dpr !== 1 ? ` (zoom/dpr ${Math.round(v.dpr * 100) / 100})` : ''}`;

export function mensagemViewportMudou(base: Viewport, atual: Viewport): string {
  return `[viewport mudou] a janela desta aba estava ${fmt(base)} na ultima leitura e agora esta ${fmt(atual)}. `
    + 'O clique por coordenada NAO foi enviado: o x,y que voce tem pode cair em outro elemento. '
    + 'Leia a tela de novo (browser_read_page ou browser_screenshot), use as coordenadas novas e repita.';
}

export interface DepsGuarda {
  ler(tabId: number): Promise<Viewport | null>;
  carregar?(): Promise<Record<string, Viewport>>;
  salvar?(todos: Record<string, Viewport>): Promise<void>;
}

/** Fabrica testavel: a logica sem `chrome.*`. */
export function criarGuarda(deps: DepsGuarda) {
  const base = new Map<number, Viewport>();
  let carregado = false;

  async function garantirCarga(): Promise<void> {
    if (carregado) return;
    carregado = true;
    try {
      const salvo = (await deps.carregar?.()) ?? {};
      for (const [k, v] of Object.entries(salvo)) if (!base.has(Number(k))) base.set(Number(k), v);
    } catch { /* sem espelho: so memoria */ }
  }

  async function persistir(): Promise<void> {
    try { await deps.salvar?.(Object.fromEntries(base)); } catch { /* idem */ }
  }

  return {
    /** Anota o viewport desta aba (chamado depois de uma leitura bem-sucedida). */
    async registrarLeitura(tabId: number): Promise<void> {
      await garantirCarga();
      const v = await deps.ler(tabId).catch(() => null);
      if (!v) return;
      base.set(tabId, v);
      await persistir();
    },
    /** Devolve a mensagem de recusa, ou null se pode clicar. Nunca lanca. */
    async conferir(tabId: number): Promise<string | null> {
      await garantirCarga();
      const antes = base.get(tabId);
      if (!antes) return null;
      const agora = await deps.ler(tabId).catch(() => null);
      if (!agora) return null;
      return viewportMudou(antes, agora) ? mensagemViewportMudou(antes, agora) : null;
    },
    esquecer(tabId: number): void { base.delete(tabId); },
    /** So teste. */
    base(tabId: number): Viewport | undefined { return base.get(tabId); },
  };
}

const CHAVE_SESSAO = 'viewportBase';

async function lerViewportReal(tabId: number): Promise<Viewport | null> {
  const r = await dm.send<{ result?: { value?: Viewport } }>(tabId, 'Runtime.evaluate', {
    expression: '({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 })',
    returnByValue: true,
  });
  const v = r?.result?.value;
  return v && Number.isFinite(v.w) && Number.isFinite(v.h) ? v : null;
}

export const guarda = criarGuarda({
  ler: lerViewportReal,
  carregar: async () => ((await chrome.storage.session.get(CHAVE_SESSAO))[CHAVE_SESSAO] ?? {}) as Record<string, Viewport>,
  salvar: async (todos) => { await chrome.storage.session.set({ [CHAVE_SESSAO]: todos }); },
});

try {
  chrome.tabs?.onRemoved?.addListener((id) => guarda.esquecer(id));
} catch { /* teste sem chrome */ }

export const modulo: ModuloCapacidades = {
  nome: 'viewport-guarda',
  capacidades: [],
  ganchos: {
    async antes(ctx: ContextoCapacidade) {
      if (!ACOES_POR_PONTO.has(ctx.acao)) return;
      const aviso = await guarda.conferir(ctx.tabId);
      if (aviso) throw new Error(aviso);
    },
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      if (r.ok && ACOES_DE_LEITURA.has(ctx.acao)) await guarda.registrarLeitura(ctx.tabId);
      return r;
    },
  },
};
