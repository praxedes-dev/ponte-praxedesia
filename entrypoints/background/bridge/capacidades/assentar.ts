import { debuggerManager as dm } from '../../debugger-manager';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';
import { LONGA_MS } from '../../execution-engine/cdp-tools';

/**
 * Espera a rede acalmar DE VERDADE depois de um clique (ou Enter, ou
 * preenchimento de campo), com teto curto — para o agente nao ler a tela do
 * PJe cedo demais. Obra 13 (docs/obra-20260904/13-clique-destaque-e-assentar.md).
 *
 * NAO reaproveita `waitForNetworkIdle` (execution-engine/cdp-tools.ts:
 * 750-825 na versao de 05/09/2026): `checkIdle` la so resolve depois de
 * `hasReceivedFCP`, que so vira true num `Page.lifecycleEvent`
 * firstContentfulPaint/load — um clique que dispara so AJAX parcial nunca
 * recebe esse evento e resolveria so no teto, em TODO clique. Este modulo
 * mede rede (requisicoes em voo) e navegacao (frame principal), nada de FCP.
 *
 * Igual a destaque.ts: este gancho e so ANOTACAO (mede e espera, nunca
 * decide o resultado do comando) — `antes` roda antes do freio e um throw
 * aqui cancelaria o clique sem o freio ter rodado, entao todo I/O fica em
 * try/catch que so loga e segue sem armar a espera.
 */

interface EstadoAssentar {
  /** requestId -> inicio. Aberta ha mais de LONGA_MS = conexao longa (canal ao vivo), nao conta (Gemini, 26/09/2026). */
  emVoo: Map<string, number>;
  navegou: boolean;
  carregou: boolean;
  requisicoes: number;
  /** `Date.now()` da ultima mudanca relevante (requisicao, navegacao, load) — base do "quieto". */
  ultimaAtividade: number;
  /** `Date.now()` de quando este estado foi armado (`antes`) — base do teto e de `assentou_ms`. */
  armadoEm: number;
  offs: Array<() => void>;
}

/**
 * Estado por comando, pela IDENTIDADE do `ctx` (mesmo objeto em `antes` e em
 * `depois` — bridge/index.ts monta um `ContextoCapacidade` novo por
 * despacho). Mesmo padrao de dialogo.ts (`inicioPorCtx`): `ContextoCapacidade`
 * nao carrega `cmd.id`, entao "guardar por cmd.id" (como uma leitura literal
 * do briefing desta obra sugeria) nao tem onde pendurar — o WeakMap por ctx
 * e o que a casa ja usa para o mesmo problema, e some sozinho no fim do
 * comando.
 */
const estadoPorCtx = new WeakMap<ContextoCapacidade, EstadoAssentar>();

type ParamsDeCtx = Record<string, unknown>;
type ParamsDeEvento = Record<string, unknown>;

const QUIETO_MS = 400;
const TETO_PADRAO_MS = 2500;
const PASSO_MS = 50;

function acaoRelevante(ctx: ContextoCapacidade): boolean {
  if (ctx.acao === 'click' || ctx.acao === 'cap_click_xy' || ctx.acao === 'cap_form_input') return true;
  if (ctx.acao === 'press_key') {
    const params = ctx.params as ParamsDeCtx;
    const tecla = String(params.key ?? '').toLowerCase();
    return tecla === 'enter' || tecla === 'return';
  }
  return false;
}

/**
 * Registra os listeners de rede/navegacao para este comando. Chamado no
 * `antes` (arma ANTES do clique real acontecer): senao perde as
 * requisicoes que o proprio clique dispara antes de o gancho registrar.
 */
async function armar(tabId: number): Promise<EstadoAssentar> {
  const agora = Date.now();
  const estado: EstadoAssentar = {
    emVoo: new Map(), navegou: false, carregou: false, requisicoes: 0,
    ultimaAtividade: agora, armadoEm: agora, offs: [],
  };

  // Frame principal da aba, para so contar `frameStartedLoading` dele — sem
  // isto, um iframe de propaganda recarregando faria `navegou` ficar preso
  // esperando um `loadEventFired` que nunca chega para aquele frame.
  let mainFrameId: string | undefined;
  try {
    const tree = await dm.send<{ frameTree?: { frame?: { id?: string } } }>(tabId, 'Page.getFrameTree');
    mainFrameId = tree?.frameTree?.frame?.id;
  } catch {
    // Sem frame principal conhecido: qualquer frameStartedLoading conta como
    // navegacao — mais conservador (espera um pouco mais) do que ignorar de
    // vez uma navegacao real.
  }

  const marcar = () => { estado.ultimaAtividade = Date.now(); };

  const onRequisicao = (p: ParamsDeEvento) => { estado.emVoo.set(String(p.requestId), Date.now()); estado.requisicoes += 1; marcar(); };
  // Defeito irmao 2 (briefing): loadingFinished/loadingFailed de uma
  // requisicao iniciada ANTES deste `armar` (nao contada aqui) nao pode
  // zerar o contador para negativo — clamp em 0.
  const onFimOuFalha = (p: ParamsDeEvento) => { if (estado.emVoo.delete(String(p.requestId))) marcar(); };
  const onFrameIniciou = (p: ParamsDeEvento) => {
    if (mainFrameId === undefined || p.frameId === mainFrameId) {
      estado.navegou = true;
      marcar();
    }
  };
  const onLoadEvent = () => { estado.carregou = true; marcar(); };

  estado.offs.push(dm.on(tabId, 'Network.requestWillBeSent', onRequisicao));
  estado.offs.push(dm.on(tabId, 'Network.loadingFinished', onFimOuFalha));
  estado.offs.push(dm.on(tabId, 'Network.loadingFailed', onFimOuFalha));
  estado.offs.push(dm.on(tabId, 'Page.frameStartedLoading', onFrameIniciou));
  estado.offs.push(dm.on(tabId, 'Page.loadEventFired', onLoadEvent));

  return estado;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera ate `emVoo === 0` por `QUIETO_MS` seguidos E (`!navegou || carregou`),
 * ou o teto vencer. Nunca falha: teto vencido devolve `esgotou: true` com
 * `assentou_ms = teto`, sem lancar.
 */
async function esperarAssentar(
  estado: EstadoAssentar,
  teto: number,
): Promise<{ assentou_ms: number; requisicoes: number; esgotou: boolean }> {
  let esgotou = false;
  for (;;) {
    const agora = Date.now();
    let recentes = 0;
    for (const t of estado.emVoo.values()) if (agora - t < LONGA_MS) recentes += 1;
    const assentado = recentes === 0
      && (!estado.navegou || estado.carregou)
      && (agora - estado.ultimaAtividade) >= QUIETO_MS;
    if (assentado) break;
    if (agora - estado.armadoEm >= teto) { esgotou = true; break; }
    await sleep(PASSO_MS);
  }

  for (const off of estado.offs) off();

  return {
    assentou_ms: esgotou ? teto : Date.now() - estado.armadoEm,
    requisicoes: estado.requisicoes,
    esgotou,
  };
}

/** Envolve `data` num objeto para acrescentar os campos de assentamento, sem perder o valor original. */
function embrulhar(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) return { ...(data as Record<string, unknown>) };
  if (data === undefined || data === null) return {};
  return { resultado: data };
}

export const modulo: ModuloCapacidades = {
  nome: 'assentar',
  capacidades: [],
  ganchos: {
    async antes(ctx: ContextoCapacidade) {
      try {
        if (!acaoRelevante(ctx)) return;
        const params = ctx.params as ParamsDeCtx;
        if ((params.esperar as boolean | undefined) === false) return;

        estadoPorCtx.set(ctx, await armar(ctx.tabId));
      } catch (err) {
        // Anotacao nunca pode custar o clique/tecla/preenchimento: se armar
        // falhou, o comando segue sem espera (equivalente a esperar:false).
        console.warn('[Assentar] gancho "antes" falhou, comando segue sem espera de rede:', err);
      }
    },

    /**
     * Roda para TODO resultado, inclusive os barrados pelo freio ([bloqueado],
     * [somente leitura]) — Defeito irmao 1 do briefing: `antes` ja armou os
     * listeners antes do freio rodar, entao mesmo um clique barrado precisa
     * passar por aqui para os listeners serem removidos (senao vazam por
     * comando, um a mais a cada clique barrado).
     */
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      const estado = estadoPorCtx.get(ctx);
      if (!estado) return r;
      estadoPorCtx.delete(ctx);

      const params = ctx.params as ParamsDeCtx;
      const tetoParam = params.esperar_ms as number | undefined;
      const teto = typeof tetoParam === 'number' && tetoParam > 0 ? tetoParam : TETO_PADRAO_MS;

      const { assentou_ms, requisicoes, esgotou } = await esperarAssentar(estado, teto);

      return {
        ...r,
        data: {
          ...embrulhar(r.data),
          assentou_ms,
          requisicoes,
          ...(esgotou ? { esgotou: true } : {}),
        },
      };
    },
  },
};
