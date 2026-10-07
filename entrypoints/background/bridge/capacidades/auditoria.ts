import { auditLogger } from '../../audit';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Obra 10 — liga o auditLogger (existia, `init()` roda em
 * `background/index.ts:315`, e nunca era chamado por um comando da ponte) a
 * cada comando que passa por `responder()`, e expoe `cap_auditoria` para
 * listar quem fez o que. Ver docs/obra-20260904/10-auditoria-quem-fez-o-que.md.
 *
 * Nota de conferencia contra a fonte (05/09/2026, depois da obra 01 mexer em
 * bridge/index.ts): o briefing apontava um `TODO: registrar no auditLogger`
 * na linha 393 como o lugar a preencher. Essa linha hoje e outra coisa — o
 * TODO sobrou na 475, dentro so do ramo de SUCESSO do motor (nao cobre
 * [somente leitura]/[bloqueado]/erro). Nao importa: `responder()`
 * (bridge/index.ts:496-512) ja roda os ganchos `depois` de TODO modulo para
 * TODO caminho de resposta desde a obra 01 — inclusive os dois casos que o
 * TODO antigo nunca cobriria. Este arquivo entra so pelo gancho; o TODO
 * antigo fica morto (apagar bridge/index.ts nao e desta obra).
 *
 * Fora do rastro, e fora do que esta obra pode consertar sem tocar
 * bridge/index.ts: `bridge_reload` roda ANTES de existir workspace/ctx
 * (comentario em bridge/index.ts:300-310), entao nunca passa por
 * `responder()` — recarregar a extensao nao aparece em `bridge_auditoria`.
 * Ver nota no relatorio final desta obra.
 */

/**
 * Inicio de cada comando, por `ContextoCapacidade` — um objeto novo por
 * comando (a WeakMap some sozinha quando o comando termina). Mesmo padrao de
 * `dialogo.ts:inicioPorCtx`.
 *
 * Nem todo `ctx` passa pelo gancho `antes` antes de chegar aqui — `bridge_tabs`
 * e os dois retornos antecipados de `[somente leitura]`/`switch_tab` chamam
 * `responder()` direto (ver comentarios em bridge/index.ts perto de cada um).
 * Para esses, `depois` cai no `ms: 0` abaixo em vez de explodir.
 */
const inicioPorCtx = new WeakMap<ContextoCapacidade, number>();

/** `ctx.params` e tipado `Record<string, never>` de proposito (registro.ts) — o formato real e por convencao de cada capacidade, igual `feedback.ts:parametros`. */
function parametros(ctx: ContextoCapacidade): Record<string, unknown> {
  return ctx.params as unknown as Record<string, unknown>;
}

/**
 * So o essencial dos parametros da acao, cortado — nunca base64, nunca um
 * campo de texto inteiro. Cada chave so entra se o parametro existir nesta
 * acao (a maioria das acoes so tem um dos campos abaixo).
 */
function resumoDe(ctx: ContextoCapacidade): string {
  const p = parametros(ctx);
  const partes: string[] = [];

  if (typeof p.url === 'string') partes.push(`url=${p.url.slice(0, 200)}`);
  if (ctx.ref !== undefined) partes.push(`ref=${ctx.ref}`);
  if (typeof p.text === 'string') partes.push(`text=${p.text.slice(0, 60)}`);
  if (typeof p.codigo === 'string') partes.push(`codigo=${p.codigo.slice(0, 120)}`);
  // form_input/type: o VALOR digitado, nunca inteiro — so os 60 primeiros
  // caracteres, igual qualquer outro texto (nao ha exececao para senha aqui:
  // o freio de policy.ts ja recusa campo type=password antes de chegar nesta
  // capacidade — ver docs/obra-20260904/10, "padrao da casa a imitar").
  if (typeof p.valor === 'string') partes.push(`valor=${p.valor.slice(0, 60)}`);
  if (Array.isArray(p.caminhos)) {
    const nomes = p.caminhos
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.split(/[\\/]/).pop());
    if (nomes.length > 0) partes.push(`caminhos=${nomes.join(',')}`);
  }

  return partes.join(' ').slice(0, 200);
}

/**
 * URL da aba no MOMENTO do gancho `depois` — nunca a do workspace
 * (`ws.tabs[].url` fica velha; ver `feedback.ts:urlEHostnameDaAba`, mesmo
 * padrao). `chrome.tabs.get` numa aba que acabou de morrer lanca — o
 * try/catch aqui e o motivo de a auditoria de um comando que recebeu
 * "[aba trocou]" nao explodir por isso.
 */
async function urlDaAba(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? null;
  } catch {
    return null;
  }
}

export const modulo: ModuloCapacidades = {
  nome: 'auditoria',
  capacidades: [
    {
      // Nao declara `altera`: so LE o que ja foi gravado, nunca toca a
      // pagina — nunca pode ser barrada pelo modo somente leitura.
      nome: 'cap_auditoria',
      async executar(ctx: ContextoCapacidade): Promise<unknown> {
        const p = parametros(ctx);
        const limite = typeof p.limite === 'number' && p.limite > 0 ? Math.floor(p.limite) : 50;
        const soMeus = p.so_meus === true;

        const eventos = await auditLogger.listarRecentes(
          limite,
          soMeus ? { clientId: ctx.clientId } : undefined,
        );

        return eventos.map((ev) => ({
          quando: new Date(ev.timestamp).toISOString(),
          agente: (ev.payload.agente as string | null | undefined) ?? null,
          clientId: ev.payload.clientId as string,
          acao: ev.payload.acao as string,
          aba: ev.tabId ?? null,
          url: (ev.payload.url as string | null | undefined) ?? null,
          ok: ev.payload.ok as boolean,
          erro: (ev.payload.erro as string | undefined) ?? undefined,
          ms: ev.payload.ms as number,
          // Fora da lista literal do briefing (secao "o que construir", item
          // 4) — mas o proprio criterio de pronto (item 4) exige conferir o
          // resumo do navigate e do click, e so da para conferir o que esta
          // tool devolve. Sem isto o item 4 seria impossivel de testar via
          // bridge_auditoria.
          resumo: (ev.payload.resumo as string | undefined) ?? '',
        }));
      },
    },
  ],
  ganchos: {
    /**
     * Roda antes do freio, igual todo outro `antes` — aqui so guarda o
     * inicio (nenhuma chamada CDP, nunca bloqueia nada).
     */
    antes(ctx: ContextoCapacidade) {
      inicioPorCtx.set(ctx, Date.now());
    },

    /**
     * Roda depois de QUALQUER despacho (inclusive os que o freio ja barrou)
     * — devolve `r` inalterado, so observa. Nunca lanca: se `auditLogger.log`
     * ou `urlDaAba` falharem de um jeito que este arquivo nao previu, o
     * `try/catch` de `responder()` (bridge/index.ts:505-509) ja absorve e
     * avisa no console — mas o `try/catch` proprio de `urlDaAba` cobre o
     * caso conhecido (aba morta) sem depender dessa rede de fora.
     */
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      const inicio = inicioPorCtx.get(ctx);
      const ms = inicio !== undefined ? Date.now() - inicio : 0;
      const url = await urlDaAba(ctx.tabId);

      auditLogger.log({
        workspaceId: ctx.ws.workspaceId,
        tabId: ctx.tabId,
        type: 'bridge_command',
        payload: {
          clientId: ctx.clientId,
          agente: ctx.nome ?? null,
          acao: ctx.acao,
          ok: r.ok,
          erro: r.error?.slice(0, 300),
          url,
          resumo: resumoDe(ctx),
          ms,
        },
      });

      return r;
    },
  },
};
