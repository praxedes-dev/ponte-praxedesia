import { debuggerManager as dm, siteSimples } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';
import { TEXTOS_DESTRUTIVOS, hostFinanceiro } from '../policy';

/**
 * Roda JS na pagina e devolve o retorno.
 *
 * Vai por `Runtime.evaluate` do CDP, e nao por `chrome.scripting`: no mundo
 * isolado da extensao a CSP proibe avaliar string como codigo ('unsafe-eval'),
 * e o script morre antes de rodar. Pelo CDP o codigo roda no contexto real da
 * pagina — igual a digitar no console — e ainda enxerga as variaveis do app.
 *
 * `executarJs` e reaproveitada por OUTRAS capacidades, e elas NAO se
 * defendem todas do mesmo jeito — duas classes, nao uma so:
 *
 * 1. Barradas SO pelo gate de NOME (`bridge/index.ts`): `autocomplete.ts:108`
 *    (`cap_autocomplete`) e `upload-lote.ts:114` (`cap_upload_lote`) escrevem
 *    no DOM e declaram `altera: true` na propria capacidade — o gate de NOME
 *    barra a chamada inteira ANTES de chegar aqui, sempre que a aba for do
 *    usuario sem permissao. As duas chamam `executarJs` com 2 argumentos, sem
 *    nunca precisar de `throwOnSideEffect`: o gate de nome ja resolveu, o
 *    conteudo do script nem chega a importar.
 * 2. Com as DUAS camadas: `arquivos.ts:85` (`cap_download`, desde a obra 20b
 *    de 05/09/2026) TAMBEM declara `altera: true` (mesmo gate de nome do item
 *    1) **e**, em `arquivos.ts:99`, repassa `emSomenteLeitura` como terceiro
 *    argumento para `executarJs` — a mesma checagem por CONTEUDO que `cap_js`
 *    usa (abaixo). Nao e redundancia por descuido: a segunda camada so entra
 *    em jogo se a primeira falhar por algum motivo. Ver o comentario de
 *    `baixarComoBase64` em `arquivos.ts` para o porque de duplicar defesa
 *    numa capacidade so. (Uma versao anterior deste comentario juntava
 *    `cap_download` no mesmo grupo do item 1, como se as tres chamassem
 *    `executarJs` so com 2 argumentos — falso para `cap_download` desde a
 *    obra 20b; corrigido em 05/09/2026.)
 *
 * ⚠️ Isto NAO e verdade para toda chamada de `executarJs` fora deste arquivo.
 * `upload-lote.ts:288` (`cap_upload_conferir`) tambem chama `executarJs`, e
 * essa capacidade NAO declara `altera` — passa pelo gate de NOME livre, igual
 * a `cap_js`. Hoje isso e seguro porque o script que ela roda so LE o DOM
 * (`querySelectorAll` + `getComputedStyle`, para conferir se o upload em lote
 * realmente apareceu na lista — ver `upload-lote.ts`), sem tocar em nada.
 * Quem tocar em `cap_upload_conferir` para fazer mais que ler tem de decidir
 * entre `altera: true` (se passar a escrever de verdade) ou repetir aqui o
 * mesmo truque de `cap_js`/`cap_download`: checar por CONTEUDO com
 * `emSomenteLeitura`. Nao presuma que "so confere" continua verdade sem reler
 * a funcao.
 *
 * `cap_js`, por sua vez, nao declara `altera` DE PROPOSITO: e a UNICA
 * capacidade que NAO TEM gate de nome nenhum para se apoiar — bloquear
 * `browser_javascript` por nome bloquearia leitura legitima tambem, que e o
 * uso mais comum da tool ("olha isso aqui"). Por isso ela decide SOZINHA por
 * CONTEUDO, via `throwOnSideEffect` — o mesmo mecanismo que `cap_download`
 * usa como SEGUNDA camada (item 2 acima), so que para `cap_js` e a UNICA
 * defesa que existe, nao um reforco extra. O porque esta todo na obra 20, abaixo.
 *
 * ── Obra 20 — docs/obra-20260904/20-javascript-fura-o-modo-somente-leitura.md ──
 *
 * `cap_js` nao entrava em `nomesQueAlteram()` (nunca declarou `altera`), entao
 * `document.querySelector('form').submit()` rodava liso na aba do usuário
 * mesmo em modo leitura — o furo mais largo da barreira. Marcar `altera: true`
 * incondicional consertaria isso, mas bloquearia TODO `browser_javascript` na
 * aba dele, leitura pura inclusa — e "olha isso aqui" e leitura.
 *
 * A saida e decidir por CONTEUDO, nao por nome: quando `emSomenteLeitura` for
 * true (setado em `bridge/index.ts` ao montar o `ContextoCapacidade`, mesmo
 * sinal que o gate de nome consulta), a chamada ao CDP leva
 * `throwOnSideEffect: true`. E o mesmo mecanismo do preview do
 * autocomplete/console do DevTools: o V8 entra num modo de avaliacao "livre
 * de efeito colateral" e ABORTA antes de qualquer escrita observavel, com uma
 * excecao propria, em vez de deixar o efeito acontecer.
 *
 * MEDIDO na ponte de verdade em 05/09/2026 (aba-cobaia, nunca a do usuário —
 * ver bridge-server/test/js-somente-leitura.js), 10 casos:
 *
 *   - leitura pura (`document.title`) — PASSA, devolve o valor normal.
 *   - escrita sincrona (`document.title = 'x'`) — BARRADA.
 *   - `(async () => { return document.title; })()` (funcao async, mas SEM
 *     nenhum `await` dentro) — PASSA, devolve o valor normal: sem `await` a
 *     funcao nunca suspende, e para o checker do V8 e so codigo sincrono
 *     comum dentro de um wrapper async.
 *   - `(async () => { const v = await Promise.resolve(7); return v; })()` —
 *     BARRADA, mesmo SEM NENHUMA escrita no codigo (nenhuma escrita, nenhuma
 *     rede, so um `await` numa promise ja resolvida). Quem dispara o aborto
 *     e o proprio `await`: a suspensao da funcao async, sozinha, e o que o
 *     V8 trata como o efeito que `throwOnSideEffect` proibe. NAO existe "a
 *     continuacao ainda roda dentro do modo de checagem e e pega la" — essa
 *     era a descricao deste comentario ate 05/09/2026, e estava ERRADA: a
 *     excecao estoura NO PROPRIO `await`, antes de a continuacao (o que vem
 *     depois dele) sequer comecar a rodar. Corrigido porque o comentario
 *     anterior ja tinha sido escrito para corrigir uma afirmacao falsa
 *     diferente — conferir de novo, nao repetir de memoria.
 *
 *     CUSTO disto, que nao estava escrito em lugar nenhum ate agora: como
 *     QUALQUER `await` aborta (nao so um `await` que precede escrita),
 *     NENHUM JS assincrono que use `await` funciona na aba do usuário em
 *     modo somente leitura — nem um `await` de LEITURA pura (por exemplo
 *     `await fetch(url).then(r => r.json())` so para ler algo da rede, ou
 *     qualquer `await` numa Promise que so espera um timer). Quem for usar
 *     `browser_javascript` para "olhar" a aba dele com `await` no meio do
 *     script recebe `[somente leitura]` mesmo sem ter tentado escrever nada.
 *     O contorno e nao usar `await` (encadear com `.then()`, que nao suspende
 *     a funcao que o CDP esta avaliando — e o que `baixarComoBase64` em
 *     `arquivos.ts` ja faz) enquanto a aba estiver em modo leitura.
 *
 *     Medido especificamente com `Promise.resolve(7)`. Nao ha documentacao
 *     formal do V8/CDP garantindo que TODA forma de suspensao (timer real,
 *     mensagem entre contextos, IndexedDB etc.) aborta do mesmo jeito — o
 *     mecanismo observado (a propria suspensao, nao uma escrita, e o que
 *     aciona a excecao) nao deixa margem obvia para um padrao que escape,
 *     mas se um aparecer o registro correto e medir de novo e atualizar este
 *     comentario, nao presumir.
 *   - `.click()` em link, `location.href = ...`, `fetch(..., {method:'POST'})`,
 *     `document.body.innerHTML = ...`, `window.open(...)` — todos BARRADOS,
 *     mesma excecao. Cobre os quatro exemplos nomeados no objetivo desta obra
 *     (submit/click/location/POST) sem precisar de lista de padroes de texto.
 *   - controle: um erro comum de leitura (`null.textContent`) NAO cai na
 *     mesma excecao — vem com `className: 'TypeError'`, nao `'EvalError'`
 *     com a descricao de efeito colateral. Por isso da para diferenciar "bug
 *     do agente" de "bloqueio da barreira" e devolver a mensagem certa.
 *
 * Todos os 7 casos de mutacao vieram com a MESMA assinatura exata:
 *   exception.className === 'EvalError'
 *   exception.description === 'EvalError: Possible side-effect in debug-evaluate'
 * `ehEfeitoColateralBarrado` abaixo checa essa assinatura.
 */
function ehEfeitoColateralBarrado(
  exceptionDetails: { exception?: { className?: string; description?: string } } | undefined,
): boolean {
  const ex = exceptionDetails?.exception;
  return ex?.className === 'EvalError' && (ex.description ?? '').includes('Possible side-effect');
}

type ExceptionDetails = {
  text: string;
  exception?: { description?: string; className?: string; subtype?: string };
} | undefined;

/**
 * Obra 16 (docs/obra-20260904/16-timeout-configuravel.md), REDESENHADA em
 * 06/09/2026 depois de o cetico medir e reprovar a primeira versao.
 *
 * MEDIDO na ponte de verdade (Chrome do usuário), tres vezes, sempre igual:
 *
 *   browser_javascript({ codigo: 'new Promise(r => setTimeout(() => r(1), 3000))', timeout_ms: 1000 })
 *
 * levou 3018-3024ms e voltou SUCESSO com o valor 1 — sem excecao, sem
 * abortar, sem respeitar o teto pedido. `Runtime.evaluate.timeout` (e o
 * mesmo parametro em `Runtime.callFunctionOn`) e experimental no protocolo
 * CDP e **nao aborta a avaliacao nesta versao do Chrome**. A versao anterior
 * desta obra tentava DETECTAR o estouro por tempo decorrido depois de
 * `dm.send` resolver (`estourouNoTimeout`, removida aqui) — mas se o CDP
 * nunca aborta, `dm.send` so resolve depois que o script JA RODOU POR
 * INTEIRO, entao aquela deteccao so conseguia reportar o estouro DEPOIS do
 * fato (nos mesmos ~3020ms), nunca perto do teto pedido (1000ms). Isso e
 * exatamente o que o criterio de pronto da obra proibe ("tem que abortar
 * perto do teto, nao depois do script inteiro") — por isso o cetico reprovou
 * a versao anterior.
 *
 * O teto real, agora, e um `setTimeout` do lado da EXTENSAO (nao do CDP):
 * `comTemporizadorDeAbandono` corre `dm.send(...)` contra um temporizador
 * proprio e rejeita assim que o prazo estoura, nao importa o que o CDP
 * esteja fazendo. Continuamos mandando `timeout` ao CDP tambem (ver as duas
 * chamadas abaixo) por precaucao: se uma versao futura do Chrome passar a
 * honrar o parametro, ele MATA o script de verdade, o que este temporizador
 * sozinho nao consegue — mas quem GARANTE o teto hoje, medido, e o
 * temporizador da extensao.
 *
 * ⚠️ Rejeitar aqui NAO MATA o script na pagina: `dm.send` continua correndo
 * no V8 da aba ate terminar sozinho. O agente recebe o erro NA HORA (perto
 * do teto pedido) e pode seguir em frente, mas se o script tiver efeito
 * colateral (grava algo, navega, faz POST) esse efeito ainda acontece, so
 * que depois — documentado tambem na propria mensagem de erro, senao vira a
 * proxima documentacao que mente. A promessa abandonada nao contamina
 * NENHUMA chamada seguinte: cada `dm.send` e um comando CDP com id proprio,
 * resolvido so para quem o chamou — nao ha fila nem cache por aba onde uma
 * resposta tardia pudesse ser lida por engano; ela e so capturada (bloco
 * `then` de `comTemporizadorDeAbandono`) para nao virar unhandled rejection
 * no service worker, e logada para quem for depurar um efeito tardio.
 */
/**
 * Obra (aditiva): conferencia de execucao para quando `comTemporizadorDeAbandono`
 * desiste antes do script real terminar (ver comentario grande acima). Sem
 * isto, um `[ERRO estourou]` deixava o agente cego: nao dava para saber se o
 * script tinha SEQUER COMECADO a rodar, nem se — mais tarde — ele terminou
 * bem ou mal.
 *
 * A marca fica na propria pagina (`window.__ponteJs[idExec]`), NUNCA no
 * service worker: um `browser_javascript` novo pode ir para outro tabId, e o
 * unico jeito barato de "conferir depois" sem manter estado paralelo por
 * comando na extensao e perguntar a propria aba. Ela roda pelo MESMO
 * `Runtime.evaluate` (contexto padrao = mundo da pagina) que `executarSemArgs`
 * e `executarComArgs` usam para o codigo do agente — nunca `chrome.scripting`
 * (que injeta em mundo ISOLADO por padrao) — entao a marca e o script do
 * agente sempre compartilham o mesmo `window`.
 *
 * A marcacao de INICIO e um `dm.send` PROPRIO, separado do `dm.send` que roda
 * o codigo do agente, e sem `throwOnSideEffect`: se ela fosse parte da MESMA
 * avaliacao que o codigo do agente, um agente em modo somente leitura veria
 * a propria marca (uma escrita em `window`) disparar o aborto ANTES do codigo
 * dele rodar — quebraria `cap_js` em somente leitura por inteiro. A marca e
 * instrumentacao da PONTE, nao efeito colateral do agente, e por isso nao
 * passa pela mesma peneira.
 */
let contadorIdExec = 0;
function gerarIdExec(): string {
  contadorIdExec += 1;
  return `js_${Date.now()}_${contadorIdExec}`;
}

/** Sobrescreve so os campos passados em `campos`, preservando os demais (ex.: `inicio`). */
async function marcarExecucao(
  tabId: number,
  idExec: string,
  campos: { inicio?: number; fim?: number | null; ok?: boolean | null; erro?: string },
): Promise<void> {
  if (await siteSimples(tabId)) return; // modo simples: nenhuma marca na pagina
  try {
    await dm.send(tabId, 'Runtime.evaluate', {
      expression: `(function(){
        window.__ponteJs = window.__ponteJs || {};
        window.__ponteJs[${JSON.stringify(idExec)}] = Object.assign(
          {}, window.__ponteJs[${JSON.stringify(idExec)}], ${JSON.stringify(campos)}
        );
      })()`,
      returnByValue: true,
    });
  } catch (err) {
    // Falha em marcar nunca pode derrubar a execucao real do agente — so fica
    // sem conferencia disponivel depois (ex.: aba fechou entre o inicio e o fim).
    console.warn(`[executarJs] falha ao marcar conferencia de execucao (id_exec=${idExec}):`, err);
  }
}

/**
 * Marca de FIM a partir da resposta do CDP. Um `throw` do script NAO rejeita a
 * promessa do CDP: chega como `exceptionDetails` numa resposta resolvida — sem
 * copiar a mensagem dali, a conferencia dizia "terminou_com_erro" sem dizer qual.
 */
function marcaDeFim(ex?: ExceptionDetails): Record<string, unknown> {
  if (!ex) return { fim: Date.now(), ok: true };
  const erro = ex.exception?.description ?? ex.text ?? 'erro sem descricao';
  return { fim: Date.now(), ok: false, erro: String(erro) };
}

export type StatusConferencia = 'nunca_comecou' | 'ainda_rodando' | 'terminou_ok' | 'terminou_com_erro';

/**
 * Le `window.__ponteJs[idExec]` na aba e traduz em um dos 4 estados que o
 * briefing pede. `nunca_comecou` cobre tanto "id_exec invalido/errado" quanto
 * "a pagina navegou/recarregou depois do inicio" — os dois casos perdem a
 * marca do mesmo jeito, e distingui-los exigiria guardar estado em outro
 * lugar (o service worker pode ter dormido e acordado entre os dois, MV3).
 */
export async function conferirExecucaoJs(
  tabId: number,
  idExec: string,
): Promise<{ status: StatusConferencia; detalhe?: string }> {
  if (!idExec) throw new Error('informe id_exec (devolvido por browser_javascript no erro de estouro)');

  const res = await dm.send<{
    result?: { value?: { inicio?: number; fim?: number | null; ok?: boolean | null; erro?: string } | null };
  }>(tabId, 'Runtime.evaluate', {
    expression: `(window.__ponteJs && window.__ponteJs[${JSON.stringify(idExec)}]) || null`,
    returnByValue: true,
  });

  const registro = res?.result?.value;
  if (!registro) {
    return {
      status: 'nunca_comecou',
      detalhe: 'nenhum registro para este id_exec nesta aba — id invalido/de outra aba, ou a pagina '
        + 'navegou/recarregou depois do inicio (a marca vive no window da pagina, e some com ela).',
    };
  }
  if (registro.fim == null) return { status: 'ainda_rodando' };
  if (registro.ok) return { status: 'terminou_ok' };
  return { status: 'terminou_com_erro', detalhe: registro.erro };
}

/**
 * Distingue "a extensao desistiu de esperar" (o unico caso em que da para
 * afirmar 'o script CHEGOU A INICIAR') de qualquer outro erro que `bruto`
 * possa rejeitar ANTES do timer de `comTemporizadorDeAbandono` disparar (ex.:
 * debugger desanexado, tab fechada) — esses NAO provam que o script rodou na
 * pagina, e reescrever a mensagem deles com "chegou a iniciar" seria mentira.
 * Casada com o texto fixo que `comTemporizadorDeAbandono` usa (`estourou`).
 */
function ehEstouroDeTimeout(err: unknown): boolean {
  return err instanceof Error && /estourou \d+ms na pagina/.test(err.message);
}

function comTemporizadorDeAbandono<T>(promessa: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) return promessa;
  return new Promise<T>((resolve, reject) => {
    let liquidada = false;
    const timer = setTimeout(() => {
      liquidada = true;
      reject(new Error(
        `erro no script: estourou ${timeoutMs}ms na pagina (a extensao parou de esperar; o CDP nao `
        + 'aborta o script sozinho, entao ele pode continuar rodando ate terminar por conta propria, '
        + 'sem que este erro reflita o que ele fez depois)',
      ));
    }, timeoutMs);

    promessa.then(
      (valor) => {
        if (liquidada) {
          console.warn('[executarJs] script resolveu depois de a extensao ja ter desistido por timeout');
          return;
        }
        liquidada = true;
        clearTimeout(timer);
        resolve(valor);
      },
      (err) => {
        if (liquidada) {
          console.warn('[executarJs] script rejeitou depois de a extensao ja ter desistido por timeout:', err);
          return;
        }
        liquidada = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Le o `exceptionDetails` que tanto `Runtime.evaluate` quanto
 * `Runtime.callFunctionOn` devolvem no mesmo formato, e decide entre as duas
 * mensagens possiveis. Extraido para as duas trilhas de `executarJs` (sem
 * args e com args, obra 15) nunca divergirem sozinhas — a obra 20 mediu essa
 * checagem com cuidado (ver comentario grande acima) e um dos dois caminhos
 * reescrevendo a logica por conta propria e exatamente o tipo de deriva que
 * o projeto ja levou defeito silencioso por causa disso.
 *
 * Nao trata mais timeout (obra 16, redesenhada 06/09/2026): quem garante o
 * teto agora e `comTemporizadorDeAbandono`, que rejeita a promise ANTES de
 * `dm.send` sequer resolver — quando isso acontece, esta funcao nunca chega
 * a ser chamada para aquela chamada. Antes desta obra, o teto vivia aqui
 * atras de `if (!exceptionDetails) return;`, e como o CDP nao lanca excecao
 * nenhuma quando so demora (ele termina mais tarde, com sucesso), esse
 * `return` fazia a checagem de timeout ser codigo morto no caminho mais
 * comum — o oitavo caso do padrao "ok que mente" deste projeto.
 */
function tratarExcecao(exceptionDetails: ExceptionDetails, emSomenteLeitura: boolean): void {
  if (!exceptionDetails) return;
  if (emSomenteLeitura && ehEfeitoColateralBarrado(exceptionDetails)) {
    throw new Error(
      '[somente leitura] este JS tenta alterar a aba do usuario (o navegador detectou efeito '
      + 'colateral e abortou antes de rodar). Para agir nela, pergunte a ele e repita '
      + 'browser_use_current_tab com permitir_acao: true. Para rodar sem incomodar, volte para a '
      + 'sua aba com browser_use_own_tab.',
    );
  }
  const detalhe = exceptionDetails.exception?.description ?? exceptionDetails.text;
  throw new Error(`erro no script: ${detalhe}`);
}

/**
 * Roda `codigo` sem argumentos. Regra ADITIVA (obras 15 e 16): sem
 * `timeoutMs`, nem `timeout` e mandado ao CDP nem `comTemporizadorDeAbandono`
 * entra em jogo (ela devolve a promessa original quando `timeoutMs` nao e um
 * numero positivo) — o comportamento observavel para quem nao pede teto de
 * pagina continua o de antes desta obra.
 */
async function executarSemArgs(
  tabId: number,
  codigo: string,
  emSomenteLeitura: boolean,
  timeoutMs?: number,
): Promise<unknown> {
  const idExec = gerarIdExec();
  await marcarExecucao(tabId, idExec, { inicio: Date.now(), fim: null, ok: null });

  // Promessa CRUA (sem o temporizador de abandono por cima): mesmo se a
  // extensao desistir de esperar por `comTemporizadorDeAbandono`, este `.then`
  // continua preso a ELA, entao a marca de FIM sai assim que o CDP realmente
  // responder — cedo (caminho feliz) ou tarde (depois de um estouro).
  const bruto = dm.send<{
    result: { value?: unknown; description?: string };
    exceptionDetails?: ExceptionDetails;
  }>(tabId, 'Runtime.evaluate', {
    expression: codigo,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
    ...(emSomenteLeitura ? { throwOnSideEffect: true } : {}),
    ...(typeof timeoutMs === 'number' && timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    // Sem replMode: ligado, ele quebra a serializacao e todo objeto volta como {}.
  });
  bruto.then(
    (r) => marcarExecucao(tabId, idExec, marcaDeFim(r?.exceptionDetails)),
    (err) => marcarExecucao(tabId, idExec, { fim: Date.now(), ok: false, erro: String(err) }),
  );

  let res: Awaited<typeof bruto>;
  try {
    res = await comTemporizadorDeAbandono(bruto, timeoutMs);
  } catch (err) {
    // So no ESTOURO (a extensao desistiu de esperar, o CDP ja tinha recebido
    // o comando) da para afirmar que o script CHEGOU A INICIAR. Qualquer
    // outro erro (debugger desanexado, aba fechada) sobe intacto — anexar a
    // mesma frase ali seria afirmar algo que nao foi observado.
    if (!ehEstouroDeTimeout(err)) throw err;
    throw new Error(
      `${(err as Error).message} O script CHEGOU A INICIAR (id_exec="${idExec}") — confira com `
      + `browser_javascript_conferir { id_exec: "${idExec}" } se ele terminou bem, terminou com erro, `
      + 'ou ainda esta rodando.',
    );
  }
  tratarExcecao(res?.exceptionDetails, emSomenteLeitura);
  return res?.result?.value;
}

/**
 * Roda `codigo` como CORPO de uma funcao (obra 15), com `args` chegando por
 * `Runtime.callFunctionOn { arguments: [{value}] }` — o mesmo mecanismo que
 * `preencherCampo` (`formulario.ts`) ja usa — em vez de interpolados na
 * string do script. Motivo: `JSON.stringify` manual (como `baixarComoBase64`
 * faz para uma UNICA url) nao escala para texto livre de peticao — aspas,
 * crase, template literal ou quebra de linha no meio do texto quebravam o
 * script quando o dado ia colado dentro do `codigo`.
 *
 * `async function(...args) { codigo }`: o `async` e para o `await` do corpo
 * funcionar (mesmo formato de qualquer funcao async comum); nao "detectamos"
 * `return` nem embrulhamos o codigo de outro jeito — documentado no briefing
 * como magica que erra com `return` dentro de funcao interna.
 *
 * O objectId de `window` (via `Runtime.evaluate` sem side effect nenhum, so
 * para obter a referencia) e liberado com `Runtime.releaseObject` no
 * `finally` — sem isto cada chamada com `args` deixaria um handle preso no
 * heap do V8 da aba. Falha ao liberar so vira aviso: a pagina pode ter
 * navegado enquanto o script rodava, e isso nao invalida o RESULTADO que ja
 * foi obtido — so o handle que ficou orfao.
 */
async function executarComArgs(
  tabId: number,
  codigo: string,
  emSomenteLeitura: boolean,
  args: unknown[],
  timeoutMs?: number,
): Promise<unknown> {
  const janela = await dm.send<{ result?: { objectId?: string } }>(tabId, 'Runtime.evaluate', {
    expression: 'window',
    returnByValue: false,
  });
  const objectId = janela?.result?.objectId;
  if (!objectId) throw new Error('nao foi possivel obter o contexto da pagina para rodar o script com args');

  const idExec = gerarIdExec();
  await marcarExecucao(tabId, idExec, { inicio: Date.now(), fim: null, ok: null });

  try {
    const bruto = dm.send<{
      result: { value?: unknown };
      exceptionDetails?: ExceptionDetails;
    }>(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `async function(...args) {\n${codigo}\n}`,
      arguments: args.map((valor) => ({ value: valor })),
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      ...(emSomenteLeitura ? { throwOnSideEffect: true } : {}),
      ...(typeof timeoutMs === 'number' && timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    });
    bruto.then(
      (r) => marcarExecucao(tabId, idExec, marcaDeFim(r?.exceptionDetails)),
      (err) => marcarExecucao(tabId, idExec, { fim: Date.now(), ok: false, erro: String(err) }),
    );

    let res: Awaited<typeof bruto>;
    try {
      res = await comTemporizadorDeAbandono(bruto, timeoutMs);
    } catch (err) {
      if (!ehEstouroDeTimeout(err)) throw err;
      throw new Error(
        `${(err as Error).message} O script CHEGOU A INICIAR (id_exec="${idExec}") — confira com `
        + `browser_javascript_conferir { id_exec: "${idExec}" } se ele terminou bem, terminou com erro, `
        + 'ou ainda esta rodando.',
      );
    }
    tratarExcecao(res?.exceptionDetails, emSomenteLeitura);
    return res?.result?.value;
  } finally {
    try {
      await dm.send(tabId, 'Runtime.releaseObject', { objectId });
    } catch (err) {
      console.warn('[executarJs] releaseObject do contexto "window" falhou (provavel navegacao):', err);
    }
  }
}

/**
 * `args === undefined` mantem o caminho de hoje (`Runtime.evaluate` direto,
 * codigo interpolado como expressao). Com `args`, `codigo` passa a ser o
 * CORPO de uma funcao e os valores chegam pelo array `args`, nunca
 * interpolados na string — ver `executarComArgs`. So JSON-serializavel
 * entra em `args` (o CDP faz o transporte via `arguments: [{value}]`, que
 * exige isso).
 */
async function executarJsSemFreio(
  tabId: number,
  codigo: string,
  emSomenteLeitura: boolean,
  args?: unknown[],
  timeoutMs?: number,
): Promise<unknown> {
  if (args === undefined) return executarSemArgs(tabId, codigo, emSomenteLeitura, timeoutMs);
  return executarComArgs(tabId, codigo, emSomenteLeitura, args, timeoutMs);
}

/**
 * ── S1 (20/10/2026): o JS tambem passa pelo freio ──────────────────────────
 *
 * MEDIDO antes deste conserto (test/js-freio.js, fixture em 127.0.0.1): com a
 * aba do PROPRIO agente, `browser_javascript` com
 * `document.querySelector('#assinar').click()` clicava no botao "Assinar" sem
 * pedir confirmacao — o freio (policy.ts) so julga `click`/`type`/... e `cap_js`
 * decide so por CONTEUDO na aba do usuario (throwOnSideEffect). Nao existia
 * `confirm:true` para o JS.
 *
 * O conserto e um guarda em tempo de execucao, ligado so durante o script do
 * agente: troca `HTMLElement.prototype.click`, `HTMLFormElement.prototype
 * .submit/requestSubmit` e `EventTarget.prototype.dispatchEvent` (so eventos de
 * clique/envio em elemento) por versoes que olham o elemento — o MESMO criterio
 * do clique (`TEXTOS_DESTRUTIVOS`, texto visivel OU aria-label, aba nao conta,
 * agora sem diferenciar acento) — e LANCAM `[bloqueado]` sem confirm. Em site
 * financeiro, qualquer um desses disparos exige confirm (regra 3 do freio).
 * Leitura, extracao, scroll, querySelector, getBoundingClientRect... nao tocam
 * em nada disto.
 *
 * Limites, ditos de frente: o guarda protege contra o erro do agente, nao
 * contra um script feito para fugir (um iframe novo traz o `click` nativo;
 * `el.onclick()` chamado direto, `location=`, `fetch(POST)` nao passam por
 * aqui). Esses ficam como estavam.
 *
 * Aplica-se so quando `freio` e passado (cap_js). As demais capacidades que
 * reaproveitam `executarJs` (autocomplete, upload-lote, download) clicam de
 * proposito e ja tem o freio delas — nao levam o guarda. Na aba do usuario em
 * somente leitura o V8 ja aborta a escrita (obra 20); o guarda nao liga ali.
 */
export interface FreioDoJs {
  /** `confirm: true` no comando — o agente ja perguntou ao usuario. */
  confirmado: boolean;
}

const SCRIPT_FREIO = String.raw`(function (cfg) {
  var W = window, K = '__ponteFreio';
  var est = W[K];
  if (est) { est.n++; est.cfg.confirmado = est.cfg.confirmado && cfg.confirmado; return 'reusado'; }
  est = W[K] = { n: 1, cfg: cfg, bloqueios: [], orig: [] };
  var norm = function (s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  };
  var BOTAO = ['button', 'submit', 'image', 'reset'];
  var rotulos = function (c) {
    var r = [];
    var tipo = c.type ? String(c.type).toLowerCase() : '';
    if (c.tagName !== 'INPUT' || BOTAO.indexOf(tipo) >= 0) {
      r.push(c.innerText); r.push(c.tagName === 'INPUT' ? c.value : '');
    }
    r.push(c.getAttribute && c.getAttribute('aria-label'));
    r.push(c.getAttribute && c.getAttribute('title'));
    return r.filter(function (x) { return x && String(x).trim(); });
  };
  // Aba nao e a acao que o texto dela cita ("PROTOCOLAR INICIAL" no PJe): mesma
  // prova do clique (execution-engine/index.ts, ehAba) -- cabecalho de aba
  // (role tab/tablist ou classe rich-tab*) ou ancora de navegacao, desde que o
  // clicavel nao seja botao/submit, nao tenha onclick e nao esteja num form.
  var ehAba = function (c) {
    var tipo = c.type ? String(c.type).toLowerCase() : '';
    var acao = c.tagName === 'BUTTON' || (c.tagName === 'INPUT' && BOTAO.indexOf(tipo) >= 0)
      || (c.getAttribute('role') || '').toLowerCase() === 'button';
    if (acao || c.hasAttribute('onclick') || typeof c.onclick === 'function' || (c.closest && c.closest('form'))) return false;
    for (var no = c; no && no !== document.body; no = no.parentElement) {
      var r = ((no.getAttribute && no.getAttribute('role')) || '').toLowerCase();
      if (r === 'tab' || r === 'tablist') return true;
      var cl = no.classList || [];
      for (var k = 0; k < cl.length; k++) {
        if (cl[k] === 'rich-tab' || cl[k].indexOf('rich-tab-header') === 0 || cl[k].indexOf('rich-tabhdr') === 0) return true;
      }
    }
    var href = ((c.getAttribute && c.getAttribute('href')) || '').trim().toLowerCase();
    return c.tagName === 'A' && href.indexOf('javascript:') !== 0;
  };
  var gatilhoDe = function (el) {
    if (!el || el.nodeType !== 1) return null;
    var c = el.closest ? (el.closest('button,a,[role="button"],input,summary,[onclick]') || el) : el;
    if (ehAba(c)) return null;
    var rs = rotulos(c);
    // Liberado pelo usuário (22/10/2026): "Protocolar Inicial" no PJe do TJ-RO
    // so abre o resumo; texto exato e host (policy.ts, LIBERADOS_POR_SITE).
    var hostAqui = String(location.hostname || '').toLowerCase();
    if ((hostAqui === 'tjro.jus.br' || /\.tjro\.jus\.br$/.test(hostAqui)) && rs.length
      && rs.every(function (x) { return norm(x).trim().replace(/\s+/g, ' ') === 'protocolar inicial'; })) return null;
    for (var i = 0; i < rs.length; i++) {
      var t = norm(rs[i]);
      for (var j = 0; j < cfg.destrutivos.length; j++) {
        if (t.indexOf(cfg.destrutivos[j]) >= 0) {
          return { texto: String(rs[i]).trim().slice(0, 80), gatilho: cfg.destrutivos[j] };
        }
      }
    }
    return null;
  };
  var botoesDoForm = function (f) {
    return Array.prototype.slice.call(f.querySelectorAll('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]'));
  };
  var barrar = function (como, el, achado) {
    var onde = el && el.tagName ? el.tagName.toLowerCase() : 'elemento';
    var motivo = achado
      ? como + ' em "' + achado.texto + '" (' + onde + ') parece irreversivel (casou com "' + achado.gatilho + '")'
      : como + ' dentro de ' + est.cfg.financeiro + ', que e banco ou meio de pagamento';
    est.bloqueios.push(motivo);
    throw new Error('[bloqueado] ' + motivo + '. Confirme com o usuario e repita browser_javascript com confirm: true.');
  };
  var julgar = function (como, el, alvos) {
    if (est.cfg.confirmado) return;
    if (est.cfg.financeiro) barrar(como, el, null);
    var lista = alvos || [el];
    for (var i = 0; i < lista.length; i++) {
      var a = gatilhoDe(lista[i]);
      if (a) barrar(como, lista[i], a);
    }
  };
  var trocar = function (obj, nome, fazer) {
    var orig = obj[nome];
    if (typeof orig !== 'function') return;
    est.orig.push([obj, nome, orig]);
    obj[nome] = fazer(orig);
  };
  trocar(HTMLElement.prototype, 'click', function (orig) {
    return function () { julgar('click()', this); return orig.apply(this, arguments); };
  });
  trocar(HTMLFormElement.prototype, 'submit', function (orig) {
    return function () { julgar('form.submit()', this, botoesDoForm(this)); return orig.apply(this, arguments); };
  });
  trocar(HTMLFormElement.prototype, 'requestSubmit', function (orig) {
    return function (sub) {
      julgar('form.requestSubmit()', this, sub ? [sub] : botoesDoForm(this));
      return orig.apply(this, arguments);
    };
  });
  var EVENTOS = /^(click|dblclick|auxclick|mousedown|mouseup|pointerdown|pointerup)$/;
  trocar(EventTarget.prototype, 'dispatchEvent', function (orig) {
    return function (ev) {
      if (ev && this && this.nodeType === 1) {
        if (EVENTOS.test(ev.type)) julgar('dispatchEvent(' + ev.type + ')', this);
        else if (ev.type === 'submit' && this.tagName === 'FORM') julgar('dispatchEvent(submit)', this, botoesDoForm(this));
      }
      return orig.apply(this, arguments);
    };
  });
  return 'instalado';
})`;

async function instalarFreioDoJs(tabId: number, freio: FreioDoJs): Promise<void> {
  const url = await chrome.tabs.get(tabId).then((t) => t.url).catch(() => undefined);
  const cfg = {
    destrutivos: TEXTOS_DESTRUTIVOS,
    confirmado: freio.confirmado,
    financeiro: hostFinanceiro(url),
  };
  // Se a instalacao falhar o erro sobe e o script nao roda: falha FECHADO.
  await dm.send(tabId, 'Runtime.evaluate', {
    expression: `${SCRIPT_FREIO}(${JSON.stringify(cfg)})`,
    returnByValue: true,
  });
}

/** Desliga o guarda (se for o ultimo script) e devolve o que ele barrou. */
async function retirarFreioDoJs(tabId: number): Promise<string[]> {
  try {
    const r = await dm.send<{ result?: { value?: string[] } }>(tabId, 'Runtime.evaluate', {
      expression: `(function(){
        var e = window.__ponteFreio; if (!e) return [];
        var b = e.bloqueios.slice(); e.bloqueios.length = 0;
        if (--e.n <= 0) {
          e.orig.forEach(function (t) { t[0][t[1]] = t[2]; });
          delete window.__ponteFreio;
        }
        return b;
      })()`,
      returnByValue: true,
    });
    return r?.result?.value ?? [];
  } catch (err) {
    console.warn('[executarJs] nao consegui retirar o guarda do freio (pagina navegou?):', err);
    return [];
  }
}

export async function executarJs(
  tabId: number,
  codigo: string,
  emSomenteLeitura = false,
  args?: unknown[],
  timeoutMs?: number,
  freio?: FreioDoJs,
): Promise<unknown> {
  // Modo simples (Flow): o freio troca click/dispatchEvent do proprio site enquanto roda.
  if (!freio || emSomenteLeitura || (await siteSimples(tabId))) return executarJsSemFreio(tabId, codigo, emSomenteLeitura, args, timeoutMs);

  await instalarFreioDoJs(tabId, freio);
  let resultado: unknown;
  let erro: unknown;
  let abandonado = false;
  try {
    resultado = await executarJsSemFreio(tabId, codigo, emSomenteLeitura, args, timeoutMs);
  } catch (err) {
    erro = err;
    // Estourou o prazo mas o script segue na pagina: deixa o guarda LIGADO.
    abandonado = ehEstouroDeTimeout(err);
  }
  const barrados = abandonado ? [] : await retirarFreioDoJs(tabId);
  // O script pode ter engolido o erro do guarda (try/catch) e seguido: o agente
  // precisa saber que um clique NAO aconteceu, mesmo com o retorno "ok".
  if (barrados.length > 0 && !(erro instanceof Error && erro.message.includes('[bloqueado]'))) {
    throw new Error(
      `[bloqueado] o script tentou ${barrados[0]}${barrados.length > 1 ? ` (+${barrados.length - 1})` : ''}; `
      + 'o freio barrou esse disparo (o resto do script rodou). Confirme com o usuario e repita '
      + 'browser_javascript com confirm: true.',
    );
  }
  if (erro) throw erro;
  return resultado;
}

export const modulo: ModuloCapacidades = {
  nome: 'js',
  capacidades: [
    {
      nome: 'cap_js',
      // Sem `altera: true` de proposito — decisao por conteudo, nao por nome
      // (ver comentario de `executarJs` acima). Nao remova sem reler a obra 20.
      // timeout_ms (obra 16): so o `cap_js` tem piso default de 55 s -- as
      // outras chamadas de `executarJs` (autocomplete.ts, upload-lote.ts,
      // arquivos.ts) continuam SEM teto de pagina, exatamente como hoje,
      // porque nao passam o 5o argumento.
      executar: (ctx) => executarJs(
        ctx.tabId,
        ctx.params.codigo,
        ctx.emSomenteLeitura,
        ctx.params.args,
        (ctx.params.timeout_ms as number | undefined) ?? 55_000,
        { confirmado: ctx.confirm === true },
      ),
    },
    {
      // Tool pequena e separada (nao um param novo em cap_js): cap_js exige
      // `codigo` no schema MCP, e forcar quem so quer CONFERIR a passar um
      // `codigo` de mentira seria pior do que uma segunda tool com input
      // proprio (so `id_exec`). Nunca altera a pagina, so LE a marca.
      nome: 'cap_js_conferir',
      executar: (ctx) => conferirExecucaoJs(ctx.tabId, ctx.params.id_exec as string),
    },
  ],
};
