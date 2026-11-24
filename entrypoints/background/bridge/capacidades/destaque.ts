import { debuggerManager as dm } from '../../debugger-manager';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Contorno visivel de 300ms no elemento que vai ser clicado, antes do clique
 * acontecer — confirmacao visual barata do que o agente vai fazer, para o
 * usuário ver na tela dele (ate cinco agentes dividem a mesma janela).
 * Obra 13 (docs/obra-20260904/13-clique-destaque-e-assentar.md).
 *
 * `Overlay` NAO entra nos dominios habilitados no attach() de
 * debugger-manager/index.ts (so Page, Runtime, Network — conferido na fonte,
 * linhas 83-85 na versao de 05/09/2026): este modulo habilita sozinho via
 * `aoAnexar`. Se o `chrome.debugger` desta versao recusar o dominio, o
 * modulo se desliga SO NAQUELA ABA (console.warn, sem throw) — nunca derruba
 * o attach nem impede o clique de acontecer.
 *
 * Este gancho e so ANOTACAO: nunca pode bloquear um clique real por um
 * defeito seu. `antes` roda ANTES do freio (bridge/index.ts) dentro do
 * mesmo try/catch que decide se o comando inteiro falha — um throw aqui
 * cancelaria o clique sem o freio nunca ter rodado. Por isso todo I/O deste
 * modulo fica em try/catch que so loga e segue.
 */

/** Por aba: `Overlay.enable` deu certo aqui? Sem entrada = ainda nao medido — trata como desligado. */
const overlayAtivoPorAba = new Map<number, boolean>();

/**
 * Se este `ctx` (mesmo objeto, antes e depois) realmente acendeu o contorno.
 * WeakMap por ctx, nao por `cmd.id`: `ContextoCapacidade` (registro.ts) nao
 * carrega o id do comando — o padrao da casa (dialogo.ts, `inicioPorCtx`) ja
 * resolve isso guardando pela IDENTIDADE do proprio ctx, que e um objeto novo
 * por comando (bridge/index.ts monta um `ctx` por despacho). Some sozinho
 * quando o comando termina.
 */
const destacouPorCtx = new WeakMap<ContextoCapacidade, boolean>();

type ParamsDeCtx = Record<string, unknown>;

/** Acha o backendNodeId do alvo do clique, sem lancar — clique semantico sem ref fica sem destaque de proposito. */
async function backendNodeIdDoAlvo(ctx: ContextoCapacidade): Promise<number | undefined> {
  if (ctx.ref !== undefined) return ctx.ref;

  if (ctx.acao === 'cap_click_xy') {
    const params = ctx.params as ParamsDeCtx;
    const x = Math.round(Number(params.x));
    const y = Math.round(Number(params.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    try {
      // Mesma exigencia de inteiro que capacidades/clique.ts ja resolveu
      // (DOM.getNodeForLocation quer x/y int32) — arredondado acima.
      const no = await dm.send<{ backendNodeId?: number }>(
        ctx.tabId, 'DOM.getNodeForLocation', { x, y, includeUserAgentShadowDOM: false },
      );
      return no?.backendNodeId;
    } catch {
      // Sem no naquele ponto, ou CDP recusou: nao e este modulo que freia o
      // clique (capacidades/clique.ts faz isso por conta propria) — aqui so
      // significa "nada para destacar".
      return undefined;
    }
  }

  return undefined;
}

/** Envolve `data` num objeto para acrescentar `destacado`, sem perder o valor original. */
function embrulhar(data: unknown): Record<string, unknown> {
  if (data && typeof data === 'object' && !Array.isArray(data)) return { ...(data as Record<string, unknown>) };
  if (data === undefined || data === null) return {};
  return { resultado: data };
}

export const modulo: ModuloCapacidades = {
  nome: 'destaque',
  capacidades: [],
  ganchos: {
    async aoAnexar(tabId: number) {
      try {
        // MEDIDO ao vivo (05/09/2026): `Overlay.enable` sozinho falha com
        // "DOM should be enabled first" (CDP -32000) -- debugger-manager/
        // index.ts (nao mexido por esta obra) so liga Page/Runtime/Network no
        // attach(). `DOM.enable` e pre-requisito documentado do dominio
        // Overlay, entao este modulo liga os dois, na ordem certa, sozinho.
        await dm.send(tabId, 'DOM.enable');
        await dm.send(tabId, 'Overlay.enable');
        overlayAtivoPorAba.set(tabId, true);
      } catch (err) {
        overlayAtivoPorAba.set(tabId, false);
        console.warn(
          `[Destaque] Overlay.enable recusado pelo chrome.debugger na aba ${tabId} — `
          + 'destaque desligado so nesta aba, attach segue normal:',
          err,
        );
      }
    },

    async antes(ctx: ContextoCapacidade) {
      try {
        if (ctx.acao !== 'click' && ctx.acao !== 'cap_click_xy') return;
        if (overlayAtivoPorAba.get(ctx.tabId) !== true) return;

        // Fase 4 (decisao do usuário, 20/10/2026): DESLIGADO por padrao. A ponte roda em janela
        // minimizada e ele nao precisa ver; cada clique pagava 300 ms parados. Religar:
        // chrome.storage.local.set({ destacarAntesDeClicar: true }).
        const { destacarAntesDeClicar } = await chrome.storage.local.get('destacarAntesDeClicar');
        if (destacarAntesDeClicar !== true) return;

        const backendNodeId = await backendNodeIdDoAlvo(ctx);
        if (backendNodeId === undefined) return;

        try {
          await dm.send(ctx.tabId, 'Overlay.highlightNode', {
            backendNodeId,
            highlightConfig: {
              contentColor: { r: 59, g: 130, b: 246, a: 0.35 },
              borderColor: { r: 37, g: 99, b: 235, a: 0.9 },
            },
          });
          await new Promise((r) => setTimeout(r, 300));
          destacouPorCtx.set(ctx, true);
        } finally {
          // SEMPRE apaga o destaque, mesmo se highlightNode falhou no meio —
          // marca perdida na tela do usuário e no screenshot e o defeito que
          // este `finally` existe para evitar (briefing, "o que NAO fazer").
          await dm.send(ctx.tabId, 'Overlay.hideHighlight').catch(() => {});
        }
      } catch (err) {
        // Anotacao nunca pode custar o clique: qualquer falha aqui vira log,
        // nao erro do comando.
        console.warn('[Destaque] gancho "antes" falhou, clique segue sem destaque:', err);
      }
    },

    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      if (ctx.acao !== 'click' && ctx.acao !== 'cap_click_xy') return r;
      const destacado = destacouPorCtx.get(ctx) === true;
      return { ...r, data: { ...embrulhar(r.data), destacado } };
    },
  },
};
