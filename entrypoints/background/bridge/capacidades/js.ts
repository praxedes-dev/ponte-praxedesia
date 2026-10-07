import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';

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
 * `document.querySelector('form').submit()` rodava liso na aba do Dr. Cezar
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
 * MEDIDO na ponte de verdade em 05/09/2026 (aba-cobaia, nunca a do Cezar —
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
 *     NENHUM JS assincrono que use `await` funciona na aba do Dr. Cezar em
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
 * MEDIDO na ponte de verdade (Chrome do Dr. Cezar), tres vezes, sempre igual:
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
export async function executarJs(
  tabId: number,
  codigo: string,
  emSomenteLeitura = false,
  args?: unknown[],
  timeoutMs?: number,
): Promise<unknown> {
  if (args === undefined) return executarSemArgs(tabId, codigo, emSomenteLeitura, timeoutMs);
  return executarComArgs(tabId, codigo, emSomenteLeitura, args, timeoutMs);
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
