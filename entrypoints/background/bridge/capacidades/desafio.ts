import { debuggerManager as dm } from '../../debugger-manager';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Obra 09 — reconhecer pagina de desafio (Cloudflare/captcha) e falhar alto.
 * docs/obra-20260904/09-detector-de-desafio.md
 *
 * Sem capacidade nova: so o gancho `depois`, para `navigate`, `read_page` e
 * `extract` bem-sucedidos. Duas classes de pagina, tratadas diferente:
 *
 * - `interstitial`: a pagina INTEIRA e o desafio (Cloudflare "Verificacao
 *   automatica em andamento", "checking your browser", "Just a moment...",
 *   ou a frase do eSAJ "suspeita de acesso via robo"). O agente que ler isto
 *   como se fosse o conteudo pedido tira conclusao errada (o mesmo padrao do
 *   bug do `extract` que devolvia a cauda — ESTADO, 03/09). Aqui a resposta
 *   vira erro: `{ ok: false }`.
 * - `widget`: pagina NORMAL com um campo de captcha no proprio formulario
 *   (caso TJ-SP/eSAJ). Bloquear isto quebraria a UNICA rota que funciona no
 *   TJ-SP (skill juris-tribunais: "preencher por JS faz o recaptcha barrar").
 *   Aqui a pagina segue `ok: true`, so com um aviso anexado.
 */

interface DeteccaoDesafio {
  titulo: string;
  url: string;
  interstitial: string[];
  widget: string[];
  elementos: number;
}

const ACOES_MONITORADAS = new Set(['navigate', 'read_page', 'extract']);

/**
 * Roda DENTRO da pagina via `Runtime.evaluate`. Escrita como string (nao como
 * function.toString() capturada no escopo da extensao) porque e exatamente
 * isso que `Runtime.evaluate` espera como `expression` — o mesmo padrao de
 * `cdp-tools.ts:95-99` (`(${probeFunc}).call(...)`).
 *
 * Sem `document.body.innerText` inteiro: limitado aos primeiros 4000
 * caracteres (o desafio, quando existe, fica no topo da pagina — regra do
 * briefing, "O que NAO fazer").
 */
const FUNC_DETECCAO = `
  function () {
    var body = document.body;
    if (!body) {
      return { titulo: document.title || '', url: location.href, interstitial: [], widget: [], elementos: 0 };
    }
    var titulo = document.title || '';
    var elementos = body.querySelectorAll('*').length;
    var texto = (body.innerText || '').slice(0, 4000);

    var interstitial = [];
    if (/just a moment|um momento|attention required|verifica[cç][aã]o autom[aá]tica|checking your browser|please wait/i.test(titulo)) {
      interstitial.push('titulo:' + titulo);
    }
    var marcaCloudflare = body.querySelector(
      '#challenge-running, #challenge-form, #challenge-stage, .cf-browser-verification, #cf-chl-widget, iframe[src*="challenges.cloudflare.com"]'
    );
    if (marcaCloudflare && elementos < 60) {
      interstitial.push('marca-cloudflare(elementos=' + elementos + ')');
    }
    var frases = ['Verificação automática em andamento', 'Verifying you are human', 'suspeita de acesso via robô'];
    for (var i = 0; i < frases.length; i++) {
      if (texto.indexOf(frases[i]) !== -1) interstitial.push('frase:' + frases[i]);
    }

    var widget = [];
    if (interstitial.length === 0) {
      var w = body.querySelector('.g-recaptcha, iframe[src*="recaptcha"], .h-captcha, iframe[src*="hcaptcha"], .cf-turnstile');
      if (w) widget.push('widget-de-captcha-no-formulario');
    }

    return { titulo: titulo, url: location.href, interstitial: interstitial, widget: widget, elementos: elementos };
  }
`;

/**
 * Lanca (nao engole) se `Runtime.evaluate` nao devolver um `result.value`
 * usavel — inclusive quando o proprio script de deteccao deu excecao. Um
 * `?? valorPadrao` aqui devolveria "sem desafio" toda vez que a deteccao
 * falhasse, exatamente o padrao de defeito que este projeto ja pagou seis
 * vezes hoje (`.catch(() => null)` escondendo uma defesa que nunca rodou).
 * Quem chama decide o que fazer com o erro; ver comentario em `depois()`.
 */
async function detectar(tabId: number): Promise<DeteccaoDesafio> {
  const res = await dm.send<{
    result: { value?: DeteccaoDesafio };
    exceptionDetails?: { text: string; exception?: { description?: string } };
  }>(tabId, 'Runtime.evaluate', {
    expression: `(${FUNC_DETECCAO})()`,
    returnByValue: true,
    // Sem replMode: quebra a serializacao (capabilities.ts:32 / js.ts:144).
  });

  if (res?.exceptionDetails) {
    const detalhe = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
    throw new Error(`[desafio] deteccao falhou ao rodar na pagina: ${detalhe}`);
  }
  if (!res?.result?.value) {
    throw new Error('[desafio] deteccao nao devolveu valor utilizavel (Runtime.evaluate sem result.value)');
  }
  return res.result.value;
}

function mensagemDeInterstitial(url: string, marcas: string[]): string {
  return `[desafio] a pagina em ${url || '(sem url)'} e um desafio (${marcas.join('; ')}), nao o conteudo pedido. `
    + 'Nao insista nem repita: avise o usuario (ele pode resolver na janela da ponte) ou espere alguns '
    + 'minutos. Se for SCON/eSAJ, uma abertura por vez.';
}

function mensagemDeAviso(marcas: string[]): string {
  return `esta pagina tem um captcha (${marcas.join('; ')}) no formulario: digite de verdade (browser_type `
    + 'modo teclado) e clique com mouse real - preencher por JS faz o captcha barrar';
}

/**
 * So atua em `r.ok === true` (regra do briefing, "O que NAO fazer" — rodar
 * com `r.ok === false` mascararia um erro genuino, como `[aba trocou]`, por
 * cima de um `[desafio]` fabricado).
 *
 * Se `detectar()` lancar (Runtime.evaluate falhou de verdade, nao "pagina sem
 * desafio"), a excecao SOBE sem catch local: quem a recebe e
 * `bridge/index.ts:503-509` (`responder()`), que ja envolve todo gancho
 * "depois" num try/catch e mantem o `r` original se o gancho falhar, com
 * `console.warn`. Isto e comportamento do FRAMEWORK (obra 01), nao decisao
 * deste modulo — nao adiciono um catch redundante aqui que faria a mesma
 * coisa em silencio, sem log. Ver nota no relatorio da obra 09 sobre a
 * consequencia disto: uma falha de deteccao passa batido para o AGENTE (so
 * aparece no console da extensao), o resultado original (que ja era `ok:
 * true`) segue para ele sem o aviso/erro que esta obra adiciona.
 */
async function depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
  if (!r.ok) return r;
  if (!ACOES_MONITORADAS.has(ctx.acao)) return r;

  const deteccao = await detectar(ctx.tabId);

  if (deteccao.interstitial.length > 0) {
    return { ok: false, error: mensagemDeInterstitial(deteccao.url, deteccao.interstitial) };
  }

  if (deteccao.widget.length === 0) return r;

  const aviso = mensagemDeAviso(deteccao.widget);

  if (ctx.acao === 'read_page') {
    const base = (r.data && typeof r.data === 'object') ? (r.data as Record<string, unknown>) : {};
    return { ...r, data: { ...base, aviso } };
  }
  if (ctx.acao === 'extract') {
    const texto = typeof r.data === 'string' ? r.data : '';
    return { ...r, data: `[aviso] ${aviso}\n${texto}` };
  }
  // navigate: o motor devolve `{ success: true }` sem `data`
  // (execution-engine/index.ts:200-205) — nao ha nada para preservar.
  return { ...r, data: { aviso } };
}

export const modulo: ModuloCapacidades = {
  nome: 'desafio',
  capacidades: [],
  ganchos: { depois },
};
