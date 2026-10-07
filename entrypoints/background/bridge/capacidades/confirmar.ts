import { lerTextoDaPagina } from '../../execution-engine';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Confirmacao do RESULTADO de um clique (obra "verdade pos-acao", 15/09/2026).
 *
 * O problema que isto existe para resolver: `browser_click` responde sucesso
 * quando o evento de mouse foi DESPACHADO (execution-engine, `case 'click'`),
 * e o `assentar.ts` so conta requisicoes de rede. Numa SPA que troca de tela
 * por hash (`#/rota`) sem buscar nada, `requisicoes: 0` e legitimo — e o
 * agente nao tinha como distinguir "cliquei e a tela mudou sem rede" de
 * "cliquei e nada aconteceu".
 *
 * Com `esperar_texto` e/ou `esperar_url` (substring de `location.href`, que
 * inclui o hash), depois do clique E do assentar (este modulo e registrado
 * DEPOIS de `assentar` em `capacidades/index.ts`, entao o `depois` dele roda
 * depois), faz polling na pagina ate as condicoes baterem ou o prazo vencer.
 * Mesma sonda do `wait_for_text` (`lerTextoDaPagina`), nao uma segunda.
 *
 * ADITIVO: sem nenhum dos dois parametros este gancho devolve `r` intacto —
 * nem le a pagina. E so anota: nunca transforma sucesso em erro. "Nao
 * confirmou" volta como `ok: true` com `resultado.confirmado: false`, porque o
 * clique ACONTECEU — um erro aqui faria o agente repetir o clique achando que
 * ele nao saiu, e clique repetido em botao de protocolo e o pior defeito
 * possivel nesta ponte.
 *
 * O prazo e `confirmar_ms` e NAO `esperar_ms`: `esperar_ms` ja existia (obra
 * 13) como teto do assentar de rede, padrao 2500, e mudar o significado dele
 * quebraria quem ja o usa.
 */

const PRAZO_PADRAO_MS = 10_000;
/** Teto duro: a confirmacao roda dentro do comando, e o transporte tem prazo. */
const PRAZO_MAXIMO_MS = 60_000;
const PASSO_MS = 250;

type Params = Record<string, unknown>;

function acaoDeClique(ctx: ContextoCapacidade): boolean {
  return ctx.acao === 'click' || ctx.acao === 'cap_click_xy';
}

/** `confirmar_ms` do agente, com piso em 0 e teto em PRAZO_MAXIMO_MS. Exportado para o teste de tipos ficar honesto. */
export function prazoDeConfirmacao(bruto: unknown): number {
  if (typeof bruto !== 'number' || !Number.isFinite(bruto) || bruto <= 0) return PRAZO_PADRAO_MS;
  return Math.min(bruto, PRAZO_MAXIMO_MS);
}

/** URL atual pela API de abas, para quando a sonda nao conseguiu injetar (pagina navegando). */
async function urlPelaAba(tabId: number): Promise<string> {
  try {
    const aba = await chrome.tabs.get(tabId);
    return aba.url ?? '';
  } catch {
    return '';
  }
}

interface ResultadoConfirmacao {
  confirmado: boolean;
  motivo: string;
  url_final: string;
  esperou_ms: number;
}

async function confirmar(
  tabId: number,
  texto: string | undefined,
  url: string | undefined,
  prazoMs: number,
): Promise<ResultadoConfirmacao> {
  const inicio = Date.now();
  let urlAtual = '';
  let textoOk = texto === undefined;
  let urlOk = url === undefined;

  // Sempre ao menos UMA leitura, mesmo com prazo minimo: o assentar ja pode
  // ter dado tempo de sobra para a tela chegar.
  for (;;) {
    // Sem texto pedido, a sonda roda mesmo assim (com texto vazio, que nunca
    // "acha") so para ler `location.href` no mesmo instante.
    const leitura = await lerTextoDaPagina(tabId, texto ?? '');
    urlAtual = leitura.url || (await urlPelaAba(tabId));
    if (texto !== undefined) textoOk = leitura.achou;
    if (url !== undefined) urlOk = urlAtual.includes(url);
    if (textoOk && urlOk) break;
    if (Date.now() - inicio >= prazoMs) break;
    await new Promise((r) => setTimeout(r, PASSO_MS));
  }

  const esperou = Date.now() - inicio;
  if (textoOk && urlOk) {
    const partes = [
      ...(texto !== undefined ? [`o texto "${texto}" apareceu`] : []),
      ...(url !== undefined ? [`a URL contem "${url}"`] : []),
    ];
    return { confirmado: true, motivo: `${partes.join(' e ')} (${esperou} ms depois do clique assentar)`, url_final: urlAtual, esperou_ms: esperou };
  }

  const faltou = [
    ...(!textoOk ? [`o texto "${texto}" nao apareceu (texto visivel, innerText)`] : []),
    ...(!urlOk ? [`a URL nao passou a conter "${url}"`] : []),
  ];
  return {
    confirmado: false,
    motivo: `cliquei (o clique aconteceu), mas a tela nao chegou onde era esperado em ${prazoMs} ms: `
      + `${faltou.join('; ')}. URL atual: ${urlAtual || '(nao consegui ler)'}. Nao repita o clique as `
      + 'cegas: releia a pagina (browser_read_page/browser_screenshot) para ver o que ela mostra agora.',
    url_final: urlAtual,
    esperou_ms: esperou,
  };
}

/**
 * Acrescenta `resultado` sem perder o que ja veio. `cap_click_xy` devolve uma
 * STRING, que o assentar embrulha como `{ resultado: "clique real em..." }` —
 * esse texto vai para `clique`, para `resultado` passar a ser o objeto da
 * confirmacao em todo clique. So acontece quando a confirmacao foi pedida.
 */
function anexar(data: unknown, resultado: ResultadoConfirmacao): Record<string, unknown> {
  let base: Record<string, unknown>;
  if (data && typeof data === 'object' && !Array.isArray(data)) base = { ...(data as Record<string, unknown>) };
  else if (data === undefined || data === null) base = {};
  else base = { clique: data };
  if ('resultado' in base) {
    const { resultado: anterior, ...resto } = base;
    base = { ...resto, clique: anterior };
  }
  return { ...base, resultado };
}

export const modulo: ModuloCapacidades = {
  nome: 'confirmar',
  capacidades: [],
  ganchos: {
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      if (!acaoDeClique(ctx)) return r;
      // Clique barrado ou que falhou: nao ha resultado a confirmar, e a
      // mensagem de erro original e a que importa.
      if (!r.ok) return r;

      const p = ctx.params as Params;
      const texto = typeof p.esperar_texto === 'string' && p.esperar_texto !== '' ? p.esperar_texto : undefined;
      const url = typeof p.esperar_url === 'string' && p.esperar_url !== '' ? p.esperar_url : undefined;
      if (texto === undefined && url === undefined) return r;

      const prazo = prazoDeConfirmacao(p.confirmar_ms);
      try {
        const resultado = await confirmar(ctx.tabId, texto, url, prazo);
        return { ...r, data: anexar(r.data, resultado) };
      } catch (err) {
        // A confirmacao e anotacao: se ela mesma quebrar, o clique continua
        // tendo acontecido. Diz isso, sem virar erro.
        const motivo = `cliquei, mas nao consegui conferir a tela depois (${err instanceof Error ? err.message : String(err)})`;
        return {
          ...r,
          data: anexar(r.data, { confirmado: false, motivo, url_final: await urlPelaAba(ctx.tabId), esperou_ms: 0 }),
        };
      }
    },
  },
};
