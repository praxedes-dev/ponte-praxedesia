import { debuggerManager as dm } from '../../debugger-manager';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Freio de dialogo nativo (alert/confirm/prompt/beforeunload).
 *
 * Ate a obra 04, `debugger-manager/index.ts` aceitava todo dialogo sozinho —
 * um `confirm("Confirma o protocolo?")` do PJe era confirmado sem ninguem ver,
 * e um `beforeunload` ("sair sem salvar?") era aceito, perdendo o rascunho.
 * A obra 01 moveu esse auto-aceite para ca, num gancho `aoAnexar`, sem mudar o
 * comportamento — este arquivo SUBSTITUI aquele auto-aceite por um freio de
 * verdade: nenhum dialogo e respondido sozinho, nem por timeout. Quem responde
 * e o usuário (pelo chat, via a tool `browser_dialog`) ou ele mesmo clicando na
 * janela da ponte, que e Chrome real.
 *
 * Decisao do usuário, fechada: NUNCA auto-aceitar, nem "so para alert" — ele
 * quer ver o que a pagina disse antes de decidir.
 */

// Mesmo formato do `AnyParams` privado de debugger-manager/index.ts (nao
// exportado) — so para bater estruturalmente com o `MethodListener` do `on()`.
type ParamsDeEvento = Record<string, unknown>;

interface DialogoPendente {
  tipo: string;
  mensagem: string;
  url: string;
  defaultPrompt: string;
  /** `Date.now()` de quando o dialogo abriu — usado pelo gancho `depois` para
   * saber se o dialogo nasceu DURANTE a acao que acabou de rodar. */
  desde: number;
}

/** Um dialogo pendente por aba. So existe entrada aqui enquanto ninguem respondeu. */
const pendentes = new Map<number, DialogoPendente>();

/**
 * Quando o gancho `antes` desta aba comecou a rodar pela ultima vez, por
 * `ContextoCapacidade` (nao por tabId: dois comandos podem se cruzar na mesma
 * aba, e cada ctx e um objeto novo por comando).
 *
 * WeakMap de proposito: some sozinho quando o comando termina e ninguem mais
 * segura o ctx — sem isto precisaria de uma faxina manual por comando.
 */
const inicioPorCtx = new WeakMap<ContextoCapacidade, number>();

/**
 * Um listener por aba, memoizado — e nao uma closure nova a cada `aoAnexar`.
 *
 * Achado F3 do cetico da obra 01 (05/09/2026): `debuggerManager.on()` dedupica
 * por IDENTIDADE de funcao (e um `Set<callback>`). `aoAnexar` pode rodar DUAS
 * vezes para a mesma aba sem `onDetach` no meio — dentro de `attach()`, se o
 * primeiro `Page.enable` falhar com "Debugger is not attached" (corrida real,
 * e por isso o retry existe), `send()` reanexa e roda os ganchos (1a vez), e
 * ao voltar `attach()` roda os ganchos de novo no fim (2a vez), incondicional.
 * Com uma closure nova por chamada, isso registraria DOIS listeners para o
 * mesmo `Page.javascriptDialogOpening` — e um unico dialogo real chamaria o
 * usuário DUAS vezes pelo mesmo dialogo (aqui e pior que o "No dialog is
 * showing" mudo do auto-aceite antigo). Guardando a MESMA referencia por
 * tabId, a segunda chamada de `dm.on(tabId, metodo, fn)` adiciona a funcao ja
 * presente no Set — no-op. Vale para os dois listeners (abrir e fechar).
 */
const listenerAoAbrirPorAba = new Map<number, (params: ParamsDeEvento) => void>();
const listenerAoFecharPorAba = new Map<number, (params: ParamsDeEvento) => void>();

function listenerDeAbrirDe(tabId: number): (params: ParamsDeEvento) => void {
  let fn = listenerAoAbrirPorAba.get(tabId);
  if (!fn) {
    fn = (params) => {
      pendentes.set(tabId, {
        tipo: String(params.type ?? 'alert'),
        mensagem: String(params.message ?? ''),
        url: String(params.url ?? ''),
        defaultPrompt: String(params.defaultPrompt ?? ''),
        desde: Date.now(),
      });
    };
    listenerAoAbrirPorAba.set(tabId, fn);
  }
  return fn;
}

function listenerDeFecharDe(tabId: number): (params: ParamsDeEvento) => void {
  let fn = listenerAoFecharPorAba.get(tabId);
  if (!fn) {
    // Cobre o usuário clicando ele mesmo na janela da ponte: o Chrome manda
    // este evento tanto para aceitar/cancelar por CDP quanto para clique real.
    fn = () => {
      pendentes.delete(tabId);
    };
    listenerAoFecharPorAba.set(tabId, fn);
  }
  return fn;
}

/** A mensagem que o agente ve — diz o que aconteceu, o que esta bloqueado e o remedio. */
function mensagemDialogo(p: DialogoPendente): string {
  return `[dialogo aberto] a pagina em ${p.url} perguntou (${p.tipo}): "${p.mensagem}". `
    + 'Nenhum comando roda nesta aba ate alguem responder. NAO responda por conta propria: '
    + 'pergunte ao usuario e depois chame browser_dialog { aceitar: true|false, texto? }. '
    + 'Ele tambem pode responder clicando na janela da ponte.';
}

/**
 * Aba fechada com dialogo pendente nao pode deixar a entrada presa no mapa
 * (vazamento pequeno, mas sem necessidade: a aba nunca mais vai chamar `antes`
 * de novo). Listener global, registrado uma vez no carregamento do modulo —
 * nao por `aoAnexar`, porque nao e por aba, e `chrome.tabs.onRemoved` nao e
 * apagado pelo `onDetach` do debugger (sao APIs diferentes).
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  pendentes.delete(tabId);
});

export const modulo: ModuloCapacidades = {
  nome: 'dialogo',
  capacidades: [
    {
      nome: 'cap_dialogo',
      // Altera a pagina (aceita/cancela o dialogo, digita o prompt) — entra em
      // ACOES_QUE_ALTERAM pela uniao calculada em bridge/index.ts.
      altera: true,
      async executar(ctx) {
        const p = pendentes.get(ctx.tabId);
        if (!p) throw new Error('nenhum dialogo aberto nesta aba');

        const aceitar = Boolean(ctx.params.aceitar);
        const texto = ctx.params.texto as string | undefined;

        await dm.send(ctx.tabId, 'Page.handleJavaScriptDialog', {
          accept: aceitar,
          promptText: texto ?? p.defaultPrompt,
        });
        pendentes.delete(ctx.tabId);

        return { respondido: p.tipo, mensagem: p.mensagem, aceito: aceitar };
      },
    },
  ],
  ganchos: {
    aoAnexar(tabId: number) {
      dm.on(tabId, 'Page.javascriptDialogOpening', listenerDeAbrirDe(tabId));
      // Cobre tanto o cap_dialogo (que ja apaga a pendencia por conta propria)
      // quanto o usuário clicando direto na janela da ponte — sem isto, um
      // dialogo respondido na mao deixava a pendencia presa e todo comando
      // seguinte continuava barrado achando que o dialogo ainda estava aberto.
      dm.on(tabId, 'Page.javascriptDialogClosed', listenerDeFecharDe(tabId));
    },

    /**
     * Roda ANTES do freio (`avaliar`, que chama CDP) e antes de qualquer
     * `cap_*`. Precisa rodar aqui, e nao depois de ler o DOM ou tentar a acao:
     * com o dialogo aberto, `Runtime.evaluate` e boa parte dos comandos CDP
     * ficam bloqueados na aba (medicao 2 do relatorio da obra), e um comando
     * preso ali estoura o timeout do transporte e cai no ramo de
     * `debugger-manager/index.ts` que RECARREGA a aba — perde, por exemplo,
     * um rascunho de peticao no PJe. Por isso nenhuma chamada CDP acontece
     * aqui: so leitura de `Map` e, quando bloqueia, um `throw` sincrono.
     */
    antes(ctx: ContextoCapacidade) {
      // Guardado ANTES do `if`: mesmo quando este gancho bloqueia (dialogo ja
      // pendente ao comecar), o `depois` precisa de um "inicio" para nao
      // confundir esse dialogo (que "estava ali antes") com um dialogo NOVO
      // que a acao tenha aberto por conta propria.
      inicioPorCtx.set(ctx, Date.now());

      // cap_dialogo e a UNICA acao que pode rodar com dialogo pendente — e a
      // que resolve o proprio dialogo.
      if (ctx.acao === 'cap_dialogo') return;

      const p = pendentes.get(ctx.tabId);
      if (p) throw new Error(mensagemDialogo(p));
    },

    /**
     * Roda depois de QUALQUER despacho (inclusive os que a acao acima ja
     * barrou). Cobre o caso em que a propria acao ABRE um dialogo no meio do
     * caminho (ex.: um clique cujo handler chama `confirm()`): se o comando
     * que disparou o dialogo nao travou (o `Input.dispatchMouseEvent` pode
     * retornar sozinho — ver medicao 1 do relatorio), o agente so saberia do
     * dialogo no PROXIMO comando, quando `antes` barrasse. Aqui ele sabe na
     * hora: `depois` reescreve o resultado para erro se detectar um dialogo
     * que nasceu DEPOIS do `antes` desta mesma execucao.
     */
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      if (ctx.acao === 'cap_dialogo') return r;

      const inicio = inicioPorCtx.get(ctx);
      if (inicio === undefined) return r; // este ctx nunca passou pelo `antes` (ex.: bridge_tabs)

      const p = pendentes.get(ctx.tabId);
      // `p.desde < inicio` e o dialogo que JA estava ali quando `antes` rodou
      // (o proprio `antes` ja bloqueou e `r.error` ja tem a mensagem certa,
      // sem sufixo). So o dialogo que abriu DEPOIS do inicio deste comando
      // (`>=`, para nao perder o caso raro de mesma milissegundo) e novidade.
      if (p && p.desde >= inicio) {
        return { ok: false, error: `${mensagemDialogo(p)} (abriu durante ${ctx.acao})` };
      }
      return r;
    },
  },
};
