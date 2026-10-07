import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';

/**
 * Console REAL da pagina, via CDP — nao o array que `entrypoints/content/
 * index.ts:8-26` preenche monkeypatchando `console.log/warn/error`. Aquele
 * content script roda sem `world: 'MAIN'` (linhas 3-6 do mesmo arquivo),
 * entao intercepta o console do MUNDO ISOLADO da extensao, nunca o da
 * pagina — por isso a versao antiga (`execution-engine/index.ts:362-372`,
 * `get_console_logs`) sempre voltava vazia para log de pagina de verdade.
 * Nao mexemos em `content/index.ts` (fora do escopo desta obra; o
 * monkeypatch fica como divida, documentada no relatorio).
 *
 * `Runtime.enable` ja esta ligado no `attach()` (`debugger-manager/index.ts`),
 * entao `Runtime.consoleAPICalled`/`Runtime.exceptionThrown` chegam de graca.
 * `Log.enable` (aqui) traz o resto: erro de rede (404, CORS), aviso de
 * seguranca, deprecacao.
 *
 * Docs: docs/obra-20260904/14-diagnostico-screenshot-recorte-e-console-cdp.md.
 */

export type Nivel = 'log' | 'info' | 'warn' | 'error' | 'excecao';
export type Origem = 'console' | 'excecao' | 'rede' | 'seguranca' | 'outro';

export interface EntradaConsole {
  quando: number;
  nivel: Nivel;
  origem: Origem;
  texto: string;
  url?: string;
  linha?: number;
}

/** Teto por aba: acima disso descarta a mais velha. Memoria de service worker, nao disco. */
const TETO_POR_ABA = 200;
/** `description` de objeto pode ter kilobytes — corta antes de guardar. */
const MAX_TEXTO = 500;

/** Buffer por aba. Desde a ultima reconexao da aba (attach/reattach) — o service worker dorme e o buffer some. */
const buffers = new Map<number, EntradaConsole[]>();

function entradasDe(tabId: number): EntradaConsole[] {
  let lista = buffers.get(tabId);
  if (!lista) {
    lista = [];
    buffers.set(tabId, lista);
  }
  return lista;
}

/** Aba fechada nao pode deixar buffer preso para sempre — mesmo raciocinio de `rede-inspecao.ts`/`dialogo.ts`. */
chrome.tabs.onRemoved.addListener((tabId) => {
  buffers.delete(tabId);
});

function cortar(texto: string): string {
  return texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO - 1)}…` : texto;
}

function empilhar(tabId: number, entrada: EntradaConsole): void {
  const lista = entradasDe(tabId);
  lista.push(entrada);
  if (lista.length > TETO_POR_ABA) lista.shift();
}

/** `Runtime.consoleAPICalled.type`: 'log'|'debug'|'info'|'error'|'warning'|'trace'|... — so 4 niveis importam aqui. */
function nivelDeConsoleType(type: unknown): Nivel {
  if (type === 'error' || type === 'assert') return 'error';
  if (type === 'warning') return 'warn';
  if (type === 'info') return 'info';
  return 'log';
}

/** `Log.entryAdded.entry.level`: 'verbose'|'info'|'warning'|'error'. */
function nivelDeLogLevel(level: unknown): Nivel {
  if (level === 'error') return 'error';
  if (level === 'warning') return 'warn';
  if (level === 'info') return 'info';
  return 'log';
}

/** `Log.entryAdded.entry.source`: 'network'|'security'|'javascript'|'deprecation'|... */
function origemDeLogSource(source: unknown): Origem {
  if (source === 'network') return 'rede';
  if (source === 'security') return 'seguranca';
  return 'outro';
}

// ── Listeners memoizados por aba ────────────────────────────────────────────
//
// Mesmo achado F3 do cetico da obra 01 (documentado em `dialogo.ts` e
// repetido em `rede-inspecao.ts`): `aoAnexar` pode rodar DUAS vezes para a
// mesma aba sem `onDetach` no meio (retry de `attach()`). `dm.on()` dedupica
// por IDENTIDADE de funcao; com uma closure NOVA a cada chamada isso
// registraria listener duplicado e cada mensagem entraria duas vezes no
// buffer. Guardando a MESMA referencia por tabId, a segunda chamada e no-op.
const listenersConsole = new Map<number, (p: Record<string, unknown>) => void>();
const listenersExcecao = new Map<number, (p: Record<string, unknown>) => void>();
const listenersLog = new Map<number, (p: Record<string, unknown>) => void>();

function memoizado(
  mapa: Map<number, (p: Record<string, unknown>) => void>,
  tabId: number,
  fabrica: () => (p: Record<string, unknown>) => void,
): (p: Record<string, unknown>) => void {
  let fn = mapa.get(tabId);
  if (!fn) {
    fn = fabrica();
    mapa.set(tabId, fn);
  }
  return fn;
}

function onConsoleAPICalledDe(tabId: number) {
  return memoizado(listenersConsole, tabId, () => (params) => {
    try {
      const args = (params.args as Array<{ value?: unknown; description?: string }> | undefined) ?? [];
      // Defeito irmao (briefing "O que NAO fazer"): isto tambem dispara para
      // console.log feito pelo PROPRIO agente via browser_javascript (cap_js
      // roda por Runtime.evaluate no contexto real da pagina — js.ts:1-10 —
      // entao e a mesma execution context que o script do site). E correto
      // listar; nao filtramos "quem chamou", so marcamos origem: console igual.
      const texto = args.map((a) => a.value ?? a.description ?? '').join(' ');
      empilhar(tabId, {
        quando: Date.now(),
        nivel: nivelDeConsoleType(params.type),
        origem: 'console',
        texto: cortar(String(texto)),
      });
    } catch (err) {
      // Defeito irmao: `debugger-manager/index.ts` chama todo listener do
      // mesmo metodo num forEach — um throw aqui derrubaria outros ouvintes
      // do mesmo evento. So metadado, nunca decide nada: warn e segue.
      console.warn('[console] consoleAPICalled falhou:', err);
    }
  });
}

function onExceptionThrownDe(tabId: number) {
  return memoizado(listenersExcecao, tabId, () => (params) => {
    try {
      const detalhes = params.exceptionDetails as {
        text?: string;
        url?: string;
        lineNumber?: number;
        exception?: { description?: string };
      } | undefined;
      const texto = detalhes?.exception?.description ?? detalhes?.text ?? 'excecao sem descricao';
      empilhar(tabId, {
        quando: Date.now(),
        nivel: 'excecao',
        origem: 'excecao',
        texto: cortar(texto),
        url: detalhes?.url,
        linha: detalhes?.lineNumber,
      });
    } catch (err) {
      console.warn('[console] exceptionThrown falhou:', err);
    }
  });
}

function onLogEntryAddedDe(tabId: number) {
  return memoizado(listenersLog, tabId, () => (params) => {
    try {
      const entry = params.entry as {
        source?: string;
        level?: string;
        text?: string;
        url?: string;
        lineNumber?: number;
      } | undefined;
      if (!entry) return;
      empilhar(tabId, {
        quando: Date.now(),
        nivel: nivelDeLogLevel(entry.level),
        origem: origemDeLogSource(entry.source),
        texto: cortar(entry.text ?? ''),
        url: entry.url,
        linha: entry.lineNumber,
      });
    } catch (err) {
      console.warn('[console] entryAdded falhou:', err);
    }
  });
}

export const modulo: ModuloCapacidades = {
  nome: 'console',
  capacidades: [
    {
      nome: 'cap_console',
      // So leitura do buffer local — nao altera a pagina.
      executar: async (ctx) => {
        const max = (ctx.params.max as number | undefined) ?? 50;
        const nivel = ctx.params.nivel as Nivel | undefined;
        const lista = entradasDe(ctx.tabId).filter((e) => !nivel || e.nivel === nivel);
        // Cronologico (mais velho -> mais novo, ordem de chegada); so as
        // ultimas `max`.
        return lista.slice(-max);
      },
    },
  ],
  ganchos: {
    aoAnexar(tabId: number) {
      dm.on(tabId, 'Runtime.consoleAPICalled', onConsoleAPICalledDe(tabId));
      dm.on(tabId, 'Runtime.exceptionThrown', onExceptionThrownDe(tabId));
      dm.on(tabId, 'Log.entryAdded', onLogEntryAddedDe(tabId));
      // Best effort: medido nesta obra (05/09/2026, ver relatorio) se e
      // permitido. Sem ele so falta rede/seguranca/deprecacao — console e
      // excecao continuam vindo do Runtime, que ja esta ligado no attach().
      dm.send(tabId, 'Log.enable').catch((err) => {
        console.warn(`[console] Log.enable falhou na aba ${tabId} — segue so com Runtime:`, err);
      });
    },
  },
};
