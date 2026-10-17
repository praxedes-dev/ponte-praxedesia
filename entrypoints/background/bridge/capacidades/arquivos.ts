import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';
import { executarJs } from './js';

/**
 * Capacidades de arquivo.
 *
 * O que destrava a maioria delas e o servidor MCP rodar no Windows e ter DISCO —
 * extensao nenhuma tem. Por isso PDF e download voltam em base64 daqui e sao
 * gravados la, e o upload recebe o caminho do arquivo ja no sistema de arquivos.
 */

/** 1 cm em polegadas — e a unidade que `Page.printToPDF` exige para margem. */
const CM_PARA_POLEGADAS = 1 / 2.54;

/**
 * Pagina inteira em PDF (base64). Serve para comprovante de protocolo.
 *
 * `cabecalho`/`rodape` (obra 15): HTML das classes do CDP (`date`, `title`,
 * `url`, `pageNumber`, `totalPages`). `displayHeaderFooter` PRECISA ser
 * `true` para os templates valerem — deixado em `false` (o padrao do CDP),
 * os dois campos abaixo sao ignorados em SILENCIO pelo Chrome, sem erro
 * nenhum (pegadinha do estudo 2, §B.8: quem mandar so `cabecalho` sem saber
 * disso vai jurar que a tool esta com defeito). Por isso os dois HTML sao
 * montados sempre que UM dos dois vier, nunca so quando os dois vierem.
 *
 * Template vazio (`''`) com `displayHeaderFooter: true` NAO produz cabecalho
 * em branco — o Chrome cai no cabecalho PADRAO dele (titulo + data), que e o
 * "defeito irmao" documentado no briefing desta obra. `'<span></span>'` (um
 * elemento vazio, mas nao string vazia) e o jeito de pedir "nada" sem cair
 * nesse padrao — por isso o fallback abaixo nunca e `''`.
 *
 * `paginas` vai cru para `pageRanges`: um intervalo invalido (ex.: "9-7",
 * inicio maior que fim) o proprio CDP rejeita e `dm.send` reflete o erro do
 * protocolo — nao validamos aqui de proposito, para a mensagem continuar
 * sendo a do Chrome, nao uma reinvencao nossa que pode divergir dela.
 */
export async function paginaEmPdf(
  tabId: number,
  opts: {
    paisagem?: boolean;
    fundo?: boolean;
    cabecalho?: string;
    rodape?: string;
    paginas?: string;
    margens_cm?: { cima?: number; baixo?: number; esquerda?: number; direita?: number };
    escala?: number;
  } = {},
): Promise<string> {
  const temCabecalhoOuRodape = Boolean(opts.cabecalho || opts.rodape);
  const margens = opts.margens_cm ?? {};

  const res = await dm.send<{ data: string }>(tabId, 'Page.printToPDF', {
    landscape: opts.paisagem ?? false,
    printBackground: opts.fundo ?? true,
    preferCSSPageSize: false,
    displayHeaderFooter: temCabecalhoOuRodape,
    headerTemplate: opts.cabecalho ?? '<span></span>',
    footerTemplate: opts.rodape ?? '<span></span>',
    ...(opts.paginas !== undefined ? { pageRanges: opts.paginas } : {}),
    ...(margens.cima !== undefined ? { marginTop: margens.cima * CM_PARA_POLEGADAS } : {}),
    ...(margens.baixo !== undefined ? { marginBottom: margens.baixo * CM_PARA_POLEGADAS } : {}),
    ...(margens.esquerda !== undefined ? { marginLeft: margens.esquerda * CM_PARA_POLEGADAS } : {}),
    ...(margens.direita !== undefined ? { marginRight: margens.direita * CM_PARA_POLEGADAS } : {}),
    ...(opts.escala !== undefined ? { scale: opts.escala } : {}),
  });
  if (!res?.data) throw new Error('o Chrome nao devolveu o PDF');
  return res.data;
}

/**
 * Anexa arquivos do disco a um input[type=file].
 *
 * Aqui esta o acesso que a extensao do Claude nao pode ter: ela vive na sandbox
 * do navegador e nao alcanca o sistema de arquivos. Como o agente roda no
 * Windows, ele passa o caminho e o CDP faz o resto.
 */
export async function anexarArquivos(
  tabId: number,
  backendNodeId: number,
  caminhos: string[],
): Promise<string> {
  await dm.send(tabId, 'DOM.setFileInputFiles', { backendNodeId, files: caminhos });
  return `${caminhos.length} arquivo(s) anexado(s): ${caminhos.join(', ')}`;
}

/**
 * Baixa uma URL usando a sessao logada da pagina e devolve base64.
 *
 * ── Obra 20b — furo real: `browser_download` furava o modo somente leitura ──
 *
 * Ate 05/09/2026 esta funcao chamava `executarJs` com DOIS argumentos: o
 * terceiro (`emSomenteLeitura`) caia no default `false` e o `fetch(...,
 * {credentials:'include'})` abaixo rodava liso — inclusive na aba do Dr.
 * Cezar, com o cookie de sessao dele — mesmo com o agente em modo leitura.
 * Medido por um cetico: `browser_javascript` com o MESMO fetch foi barrado
 * (`[somente leitura]`); `browser_download` nao foi. Ver
 * `bridge-server/test/download-somente-leitura.js`.
 *
 * A defesa agora e DUPLA, de proposito (defesa em profundidade, nao
 * redundancia por descuido):
 *
 * 1. `cap_download` (abaixo) agora declara `altera: true` — entra em
 *    `nomesQueAlteram()` e o gate de NOME de `bridge/index.ts` barra a
 *    chamada inteira ANTES de `baixarComoBase64` rodar, sempre que a aba for
 *    do usuario e ele nao tiver liberado com `permitir_acao: true`. Isto e
 *    suficiente sozinho para fechar o furo, e e o MESMO padrao que toda outra
 *    capacidade de escrita da ponte ja segue (`cap_upload`, `cap_autocomplete`
 *    etc.) — o Dr. Cezar libera do jeito que ja conhece.
 * 2. `emSomenteLeitura` agora e passado adiante para `executarJs`, que liga
 *    `throwOnSideEffect` quando for `true` (mesmo mecanismo da obra 20 para
 *    `cap_js`). Na pratica, com o gate de NOME acima, esta funcao so roda com
 *    `emSomenteLeitura: true` se o gate falhar por algum motivo — mas se isso
 *    acontecer, o `fetch(..., {credentials:'include'})` e escrita de rede
 *    observavel e o V8 aborta do mesmo jeito que aborta `document.title = x`.
 *    Ver o comentario de `executarJs` em `js.ts` para o que essa checagem
 *    cobre e o que ela NAO cobre (o `EvalError` de efeito colateral).
 *
 * Pratica para quem usa: baixar da aba PROPRIA do agente continua igual, sem
 * pedir nada. Baixar da aba do Dr. Cezar sem ele ter chamado
 * `browser_use_current_tab` com `permitir_acao: true` agora falha com
 * `[somente leitura]` em vez de baixar silenciosamente.
 */
export async function baixarComoBase64(
  tabId: number,
  url: string,
  emSomenteLeitura = false,
): Promise<{ base64: string; tipo: string }> {
  const resultado = await executarJs(tabId, `
    fetch(${JSON.stringify(url)}, { credentials: 'include' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var tipo = r.headers.get('content-type') || 'application/octet-stream';
        return r.blob().then(function (b) { return { b: b, tipo: tipo }; });
      })
      .then(function (x) {
        return new Promise(function (res) {
          var fr = new FileReader();
          fr.onload = function () { res({ base64: String(fr.result).split(',')[1], tipo: x.tipo }); };
          fr.readAsDataURL(x.b);
        });
      })
  `, emSomenteLeitura);

  // O retorno e uma Promise dentro da pagina; safeExecuteScript ja resolve.
  const r = resultado as { base64?: string; tipo?: string } | undefined;
  if (!r?.base64) throw new Error('a pagina nao devolveu o arquivo');
  return { base64: r.base64, tipo: r.tipo ?? 'application/octet-stream' };
}

/** Cookies de um dominio, prontos para virar header de curl. */
export async function lerCookies(url: string): Promise<{ header: string; total: number }> {
  const cookies = await chrome.cookies.getAll({ url });
  const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { header, total: cookies.length };
}

export const modulo: ModuloCapacidades = {
  nome: 'arquivos',
  capacidades: [
    {
      nome: 'cap_pdf',
      executar: (ctx) => paginaEmPdf(ctx.tabId, {
        paisagem: ctx.params.paisagem,
        fundo: ctx.params.fundo,
        cabecalho: ctx.params.cabecalho,
        rodape: ctx.params.rodape,
        paginas: ctx.params.paginas,
        margens_cm: ctx.params.margens_cm,
        escala: ctx.params.escala,
      }).then((base64) => ({ base64 })),
    },
    {
      nome: 'cap_upload',
      altera: true,
      executar: (ctx) => {
        if (ctx.ref === undefined) throw new Error('informe a ref do campo de arquivo');
        return anexarArquivos(ctx.tabId, ctx.ref, ctx.params.caminhos);
      },
    },
    {
      nome: 'cap_download',
      altera: true,
      executar: (ctx) => baixarComoBase64(ctx.tabId, ctx.params.url, ctx.emSomenteLeitura),
    },
    {
      nome: 'cap_cookies',
      executar: async (ctx) => lerCookies(ctx.params.url ?? (await chrome.tabs.get(ctx.tabId)).url!),
    },
    {
      // 07/10/2026 (pedido do Estrelinha): os cookies inteiros, no formato cru do
      // chrome.cookies.getAll, para o bridge-server gravar em ARQUIVO. Quem devolve
      // ao agente so nomes e quantidade e o bridge-server (browser_cookies_salvar);
      // esta acao nao tem tool propria e nao entra em roteiro. getAll({url}) ja
      // limita ao site pedido e aos dominios-pai que valem para ele.
      nome: 'cap_cookies_completos',
      executar: async (ctx) => {
        const url = ctx.params.url as string | undefined;
        if (!url || !/^https?:\/\//.test(url)) throw new Error('informe a url (http/https) do site');
        return { cookies: await chrome.cookies.getAll({ url }) };
      },
    },
  ],
};
