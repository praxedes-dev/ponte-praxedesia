import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';

/**
 * Ve a rede que a aba pediu — sem `Fetch.enable`/interceptacao (isso muda o
 * comportamento de toda requisicao; so leitura passiva dos eventos que
 * `Network.enable` ja manda, ligado no `attach()` — `debugger-manager/index.ts:92`).
 *
 * Por que existe: a ponte so ESPERA a rede acalmar (`cap_wait_network`, em
 * `rede.ts`); nao via o que passou. Quando o Dropzone do PJe recusa um
 * arquivo sem mensagem nenhuma na tela (skill `protocolo-pje-ponte` §4.0), o
 * corpo da resposta HTTP e a unica testemunha.
 *
 * ⚠️ ARMADILHA MEDIDA (05/09/2026, `bridge-server/test/rede-inspecao.js`):
 * `browser_tab_open` com `url` preenchido perde o documento principal, TODA
 * vez, em silencio. Causa: `workspace-manager/index.ts:184` faz
 * `chrome.tabs.create({ url, active: false })` e SO DEPOIS chama
 * `debuggerManager.attach(tab.id)` — a navegacao ja comeca no `tabs.create`,
 * antes de `Network.enable` e do gancho `aoAnexar` (abaixo) rodarem. O
 * `Network.requestWillBeSent` do documento dispara antes de qualquer listener
 * nosso existir e some para sempre — nao e uma corrida rara, e a ordem normal
 * das chamadas. Medido: abrir a aba em branco (`browser_tab_open` sem `url`)
 * e SO DEPOIS `browser_navigate` na mesma aba captura o documento certinho,
 * porque dessa vez o attach (e o gancho) ja rodaram antes da navegacao
 * comecar. Isto NAO e so "aba anexada antes desta obra, pega no proximo
 * reattach" (a licao que o briefing original previu) — e um efeito colateral
 * de toda vez que `browser_tab_open` recebe uma URL. Documentado tambem na
 * descricao de `browser_network_requests` (`bridge-server/src/tools/rede-inspecao.js`).
 * Nao e escopo desta obra consertar `workspace-manager/index.ts` (fora da
 * lista de arquivos que este briefing autoriza tocar).
 *
 * Docs: docs/obra-20260904/11-inspecao-de-rede.md.
 */

/** Uma requisicao vista pela aba, do jeito que a ponte consegue enxergar por CDP. */
export interface Entrada {
  requestId: string;
  url: string;
  metodo: string;
  /** ResourceType do CDP: Document, XHR, Fetch, Script, Image, Stylesheet, Other... */
  tipo: string;
  status?: number;
  mime?: string;
  /** `encodedDataLength` de `Network.loadingFinished` — bytes na rede, nao decodificados. */
  bytes?: number;
  iniciadoEm: number;
  concluidoEm?: number;
  /** `errorText` de `Network.loadingFailed`. So existe quando a requisicao falhou. */
  falha?: string;
}

/** Teto por aba: acima disso descarta a mais velha. Isto e memoria de service worker, nao disco. */
const TETO_POR_ABA = 300;

/** Buffer por aba. Desde a ultima reconexao do service worker — ele dorme e o buffer some. */
const buffers = new Map<number, Entrada[]>();

function entradasDe(tabId: number): Entrada[] {
  let lista = buffers.get(tabId);
  if (!lista) {
    lista = [];
    buffers.set(tabId, lista);
  }
  return lista;
}

/**
 * Aba fechada nao pode deixar buffer preso para sempre — mesmo raciocinio de
 * `dialogo.ts` (listener global de `chrome.tabs.onRemoved`, registrado uma vez
 * no carregamento do modulo, porque essa API nao e apagada pelo `onDetach` do
 * debugger).
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  buffers.delete(tabId);
});

function cortarUrl(url: string): string {
  return url.length > 200 ? `${url.slice(0, 200)}…` : url;
}

/** Corta o corpo com aviso de quanto sobrou — mesmo espirito de `cortar()` em bridge-server/src/format.js. */
function cortarTexto(texto: string, maxChars: number): string {
  if (texto.length <= maxChars) return texto;
  const restantes = texto.length - maxChars;
  return `${texto.slice(0, maxChars)}\n\n[... ${restantes} caracteres restantes]`;
}

// ── Listeners memoizados por aba e por evento ───────────────────────────────
//
// Achado F3 do cetico da obra 01 (documentado em `dialogo.ts`): `aoAnexar`
// pode rodar DUAS vezes para a mesma aba sem `onDetach` no meio (retry de
// `attach()` quando o primeiro `Page.enable` falha por corrida). `dm.on()`
// dedupica por IDENTIDADE de funcao (`Set<callback>`); com uma closure NOVA a
// cada chamada isso registraria listener duplicado e cada evento de rede
// entraria duas vezes no buffer. Guardando a MESMA referencia por tabId, a
// segunda chamada de `dm.on(tabId, metodo, fn)` e no-op.
const listenersRequestWillBeSent = new Map<number, (p: Record<string, unknown>) => void>();
const listenersResponseReceived = new Map<number, (p: Record<string, unknown>) => void>();
const listenersLoadingFinished = new Map<number, (p: Record<string, unknown>) => void>();
const listenersLoadingFailed = new Map<number, (p: Record<string, unknown>) => void>();

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

function onRequestWillBeSentDe(tabId: number) {
  return memoizado(listenersRequestWillBeSent, tabId, () => (params) => {
    try {
      const requestId = String(params.requestId ?? '');
      if (!requestId) return;
      const request = params.request as { url?: string; method?: string } | undefined;
      const lista = entradasDe(tabId);
      const existente = lista.find((e) => e.requestId === requestId);
      if (existente) {
        // Redirecionamento: o CDP manda um NOVO `requestWillBeSent` para o
        // MESMO requestId, com `redirectResponse` preenchido e uma `request`
        // nova (a URL para onde redirecionou). Atualiza em vez de duplicar.
        //
        // NAO COBERTO POR TESTE AUTOMATIZADO (declarado, nao escondido): tentei
        // `http://google.com` (redireciona para https ha decadas) como alvo
        // estavel sem precisar de servidor proprio, mas o Chrome faz upgrade
        // para https por HSTS ANTES de tocar a rede — o pedido nunca sai como
        // http de verdade, entao nunca exercita este ramo (medido nesta obra,
        // `bridge-server/test/rede-inspecao.js`, removido do teste final por
        // isso). Quem for mexer aqui: confirme com um redirect de servidor de
        // verdade (302/301 explicito, sem HSTS no dominio), nao com
        // `google.com`.
        if (request?.url) existente.url = request.url;
        if (request?.method) existente.metodo = request.method;
        if (typeof params.type === 'string') existente.tipo = params.type;
        return;
      }
      lista.push({
        requestId,
        url: request?.url ?? '',
        metodo: request?.method ?? 'GET',
        tipo: typeof params.type === 'string' ? params.type : 'Other',
        iniciadoEm: Date.now(),
      });
      if (lista.length > TETO_POR_ABA) lista.shift();
    } catch (err) {
      // Defeito irmao (briefing §"O que NAO fazer"): `debugger-manager/index.ts:25`
      // chama todo listener do mesmo metodo num `forEach` — um `throw` aqui
      // interromperia o listener de `waitForNetworkIdle` (cdp-tools.ts:796),
      // que escuta o MESMO evento. So metadado, nunca decide nada: warn e segue.
      console.warn('[rede-inspecao] requestWillBeSent falhou:', err);
    }
  });
}

function onResponseReceivedDe(tabId: number) {
  return memoizado(listenersResponseReceived, tabId, () => (params) => {
    try {
      const requestId = String(params.requestId ?? '');
      const entrada = entradasDe(tabId).find((e) => e.requestId === requestId);
      if (!entrada) return; // requisicao vista antes do reattach — sem entrada, nao ha o que atualizar
      const response = params.response as { status?: number; mimeType?: string } | undefined;
      if (typeof response?.status === 'number') entrada.status = response.status;
      if (typeof response?.mimeType === 'string') entrada.mime = response.mimeType;
      if (typeof params.type === 'string') entrada.tipo = params.type; // refina o tipo (mais confiavel aqui que no requestWillBeSent)
    } catch (err) {
      console.warn('[rede-inspecao] responseReceived falhou:', err);
    }
  });
}

function onLoadingFinishedDe(tabId: number) {
  return memoizado(listenersLoadingFinished, tabId, () => (params) => {
    try {
      const requestId = String(params.requestId ?? '');
      const entrada = entradasDe(tabId).find((e) => e.requestId === requestId);
      if (!entrada) return;
      if (typeof params.encodedDataLength === 'number') entrada.bytes = params.encodedDataLength;
      entrada.concluidoEm = Date.now();
    } catch (err) {
      console.warn('[rede-inspecao] loadingFinished falhou:', err);
    }
  });
}

function onLoadingFailedDe(tabId: number) {
  return memoizado(listenersLoadingFailed, tabId, () => (params) => {
    try {
      const requestId = String(params.requestId ?? '');
      const entrada = entradasDe(tabId).find((e) => e.requestId === requestId);
      if (!entrada) return;
      entrada.falha = typeof params.errorText === 'string' ? params.errorText : 'falha desconhecida';
      entrada.concluidoEm = Date.now();
    } catch (err) {
      console.warn('[rede-inspecao] loadingFailed falhou:', err);
    }
  });
}

export const modulo: ModuloCapacidades = {
  nome: 'rede-inspecao',
  capacidades: [
    {
      nome: 'cap_network_requests',
      // So leitura do buffer local — nao altera a pagina.
      executar: async (ctx) => {
        const filtroUrl = (ctx.params.filtro_url as string | undefined)?.toLowerCase();
        const tipo = ctx.params.tipo as string | undefined;
        const soFalhas = Boolean(ctx.params.so_falhas);
        const limite = (ctx.params.limite as number | undefined) ?? 50;

        // Buffer guarda do mais velho para o mais novo (push); do mais novo
        // para o mais velho e o que o criterio de pronto pede na listagem.
        const doMaisNovo = [...entradasDe(ctx.tabId)].reverse();
        const filtradas = doMaisNovo.filter((e) => {
          if (filtroUrl && !e.url.toLowerCase().includes(filtroUrl)) return false;
          if (tipo && e.tipo !== tipo) return false;
          if (soFalhas && !e.falha) return false;
          return true;
        }).slice(0, limite);

        return filtradas.map((e) => ({ ...e, url: cortarUrl(e.url) }));
      },
    },
    {
      nome: 'cap_network_body',
      executar: async (ctx) => {
        const requestId = ctx.params.requestId as string | undefined;
        const filtroUrl = (ctx.params.filtro_url as string | undefined)?.toLowerCase();
        const maxChars = (ctx.params.max_chars as number | undefined) ?? 20000;

        const lista = entradasDe(ctx.tabId);
        let alvo: Entrada | undefined;
        if (requestId) {
          alvo = lista.find((e) => e.requestId === requestId);
          if (!alvo) {
            throw new Error(
              `nenhuma requisicao com requestId "${requestId}" no buffer desta aba (o buffer e desde `
              + 'a ultima reconexao da extensao — a aba pode ter navegado ou o service worker dormiu).',
            );
          }
        } else if (filtroUrl) {
          const candidatas = lista.filter((e) => e.url.toLowerCase().includes(filtroUrl));
          alvo = candidatas[candidatas.length - 1]; // mais recente: buffer em ordem de insercao (mais velho -> mais novo)
          if (!alvo) {
            throw new Error(`nenhuma requisicao com url contendo "${filtroUrl}" no buffer desta aba.`);
          }
        } else {
          throw new Error('informe requestId (de browser_network_requests) ou filtro_url.');
        }

        let resposta: { body: string; base64Encoded: boolean } | undefined;
        try {
          resposta = await dm.send(ctx.tabId, 'Network.getResponseBody', { requestId: alvo.requestId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('No resource with given identifier') || msg.includes('No data found')) {
            throw new Error(
              'corpo nao esta mais em cache (a aba navegou ou a resposta expirou) — refaca a acao e '
              + 'leia logo depois.',
            );
          }
          throw err;
        }

        if (!resposta) throw new Error('o Chrome nao devolveu corpo nenhum para esta requisicao.');

        if (resposta.base64Encoded) {
          // Nunca devolver base64 no texto: um PDF de inteiro teor tem megabytes
          // e estouraria a janela do agente. `browser_download` ja resolve isto.
          const bytesDecodificados = alvo.bytes ?? Math.ceil((resposta.body.length * 3) / 4);
          return {
            binario: true,
            mime: alvo.mime,
            bytes: bytesDecodificados,
            aviso: 'use browser_download com esta url',
          };
        }

        return cortarTexto(resposta.body, maxChars);
      },
    },
  ],
  ganchos: {
    aoAnexar(tabId: number) {
      dm.on(tabId, 'Network.requestWillBeSent', onRequestWillBeSentDe(tabId));
      dm.on(tabId, 'Network.responseReceived', onResponseReceivedDe(tabId));
      dm.on(tabId, 'Network.loadingFinished', onLoadingFinishedDe(tabId));
      dm.on(tabId, 'Network.loadingFailed', onLoadingFailedDe(tabId));
    },
  },
};
