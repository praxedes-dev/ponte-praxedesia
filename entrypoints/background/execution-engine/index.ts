import { lerMolduras } from './molduras';
import { safeExecuteScript } from './safe-scripting';
import type { PlannedAction, AgentWorkspace, PageState, ActionTarget } from '../../../shared/types';
import { debuggerManager } from '../debugger-manager';
import { workspaceManager } from '../workspace-manager';
import {
  cdpClickByRef,
  cdpClickByRefOrThrow,
  cdpType,
  cdpPressKey,
  cdpScroll,
  cdpDrag,
  cdpNavigate,
  resolveTarget,
} from './cdp-tools';
import { getPageStructureViaCDP } from './ax-tree';

// Reexportado para o freio (`bridge/policy.ts`) poder resolver o MESMO alvo
// semantico que o motor usa em 'click'/'type' (FURO 2 e FURO 3), sem
// reimplementar a busca semantica em outro arquivo — reimplementar seria o
// mesmo defeito de novo, so que com um algoritmo de match ligeiramente
// diferente do motor.
export { resolveTarget } from './cdp-tools';

interface ExecutionResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Sonda de texto que roda DENTRO da pagina (mundo isolado da extensao, via
 * `chrome.scripting` — o DOM e o mesmo da pagina, so as variaveis JS nao).
 * Tem de ser autossuficiente: `executeScript` serializa a funcao e perde o
 * escopo do modulo.
 *
 * `incluirOculto: false` (padrao de sempre) le `innerText`, que so traz o que
 * esta RENDERIZADO: texto em `display:none`, `<template>` nao instanciado,
 * aba de acordeao fechada ficam de fora. `true` le `textContent`, que traz o
 * texto do DOM inteiro, visivel ou nao — inclusive o de `<script>`/`<style>`,
 * entao um texto que so existe no codigo da pagina tambem "aparece". Shadow
 * root NAO entra em nenhum dos dois (textContent do body nao desce nele) — o
 * motor nunca olhou shadow root aqui, e isto continua igual.
 *
 * `url` sai de `location.href`, que inclui o hash — e o que o clique com
 * `esperar_url` precisa numa SPA de roteamento por `#/rota`.
 */
function sondaDeTexto(t: string, caseSensitive: boolean, incluirOculto: boolean): { achou: boolean; url: string } {
  const corpo = document.body;
  const bruto = corpo ? (incluirOculto ? (corpo.textContent ?? '') : corpo.innerText) : '';
  const achou = t === ''
    ? false
    : caseSensitive ? bruto.includes(t) : bruto.toLowerCase().includes(t.toLowerCase());
  return { achou, url: location.href };
}

/**
 * Uma leitura so da pagina: o texto esta la? E qual a URL agora? Mesma sonda
 * que o `wait_for_text` usa no laco dele, exportada para o gancho de
 * confirmacao do clique (`capacidades/confirmar.ts`) nao reescrever outra.
 *
 * Falha de injecao (aba navegando, pagina interna do Chrome) vira
 * `achou: false` e `url` vazio — igual ao `wait_for_text` sempre tratou
 * (`safeExecuteScript` engole o erro e devolve `[]`).
 */
export async function lerTextoDaPagina(
  tabId: number,
  texto: string,
  opcoes: { caseSensitive?: boolean; incluirOculto?: boolean } = {},
): Promise<{ achou: boolean; url: string }> {
  const [res] = await safeExecuteScript({
    target: { tabId },
    func: sondaDeTexto,
    args: [texto, opcoes.caseSensitive === true, opcoes.incluirOculto === true],
  });
  const r = res?.result as { achou?: boolean; url?: string } | undefined;
  return { achou: r?.achou === true, url: typeof r?.url === 'string' ? r.url : '' };
}

/**
 * Resolve o tabId alvo de `close_tab` — a ÚNICA leitura de `params`/`target`
 * para essa ação. O freio (`bridge/index.ts`, antes do motor) e o motor
 * (`close_tab` logo abaixo) chamam esta MESMA função, para nunca mais
 * divergirem sobre "qual aba está sendo fechada".
 *
 * Achado dos dois auditores (06/09/2026): o freio calculava o alvo como
 * `params.tabId ?? ws.activeTabId` — NUNCA olhava `target.agentId` — enquanto
 * o motor aceitava `params.tabId || target.agentId || tabId`. Bastava mandar
 * `close_tab` com `target.agentId` preenchido e SEM `params.tabId`: o freio
 * verificava a aba ATIVA do próprio agente (que é dele, então libera) e o
 * motor fechava OUTRA aba — a de `target.agentId`, nunca checada por ninguém.
 * O conserto não é reforçar o freio com mais uma condição; é fazer o freio e
 * o motor lerem exatamente a mesma coisa, para essa classe de furo não voltar
 * na próxima vez que alguém mexer em um dos dois lados sem lembrar do outro.
 *
 * `target.agentId` aqui NÃO é o backendNodeId de elemento (uso normal do
 * campo em click/type/etc.) — em `close_tab`, a própria `PlannedAction`
 * (`shared/types/index.ts`) reaproveita esse número como tabId cru.
 * `padrao` é o valor a usar quando a action não manda nem `params.tabId` nem
 * `target.agentId` — hoje, a aba ativa de quem chamou.
 */
export function resolverAlvoDeCloseTab(
  action: Pick<PlannedAction, 'params' | 'target'>,
  padrao: number,
): number {
  const doParams = action.params?.tabId as number | undefined;
  const doTarget = action.target?.agentId;
  return doParams ?? doTarget ?? padrao;
}

/**
 * Resolve o tabId alvo de `switch_tab` — mesma disciplina do
 * `resolverAlvoDeCloseTab`: uma UNICA leitura de `params`/`target`, usada
 * pelo freio (`bridge/index.ts`) E pelo motor (`case 'switch_tab'` abaixo),
 * para as duas nunca mais divergirem sobre "para qual aba estou trocando".
 *
 * FURO 1 (06/09/2026, medido ao vivo antes do conserto): o freio calculava
 * `Number(params.tabId ?? target.agentId)` e testava `if (alvo && ...)` — com
 * `tabId: 0`, `alvo` vira `0`, FALSY, e o `if` inteiro era pulado, caindo
 * direto na linha que apaga o modo somente leitura do agente (medido:
 * `browser_tab_switch({tabId:0})` destravava `navigate` na aba do usuario
 * sem trocar de aba nenhuma). O motor, por sua vez, lia
 * `params.tabId || target.agentId` — outro `||` — entao com
 * `params:{tabId:0}` e `target:{agentId:A}` o motor ignorava o 0 e trocava
 * para `A`, um alvo que o freio nunca examinou (medido: a aba ativa virou A).
 *
 * Este resolvedor usa `??` (0 e um tabId valido, nao "ausente") e FALHA
 * FECHADO: devolve `null` — nunca um numero "falso" tipo 0/NaN — sempre que
 * o valor fornecido nao for um inteiro positivo (cobre negativo, NaN, string,
 * `null` isolado). Quem chama tem que tratar `null` como "sem alvo
 * utilizavel" e recusar a acao, nunca seguir em frente como se a troca nao
 * tivesse sido pedida.
 */
export function resolverAlvoDeSwitchTab(
  action: Pick<PlannedAction, 'params' | 'target'>,
): number | null {
  const bruto = (action.params?.tabId as unknown) ?? action.target?.agentId;
  if (typeof bruto !== 'number' || !Number.isInteger(bruto) || bruto <= 0) return null;
  return bruto;
}

/** Como uma acao de clique vai resolver o elemento — mesma decisao usada
 * pelo motor (`resolveTarget`, `cdp-tools.ts`) para saber se o clique vai por
 * backendNodeId cru ou por busca semantica. */
export type AlvoDeClique =
  | { modo: 'agent-id'; agentId: number }
  | { modo: 'semantic'; target: ActionTarget };

/**
 * Resolve COMO `click` vai escolher o elemento — a MESMA logica que o motor
 * usa (`case 'click'` abaixo), incluindo o bloco "Rescue". Compartilhada com
 * o freio (`policy.ts`, regra 4) para as duas nunca mais divergirem sobre
 * QUAL elemento uma acao de clique vai realmente tocar.
 *
 * FURO 2 (06/09/2026, medido ao vivo antes do conserto): o freio decidia
 * como ler o alvo só olhando `action.target?.agentId !== undefined` —
 * IGNORANDO `strategy`. O motor só usa `agentId` cru quando
 * `strategy === 'agent-id'`; em qualquer outro caso (`strategy: 'semantic'`),
 * resolve por busca semantica (texto/role/placeholder/ariaLabel), inclusive
 * quando `agentId` também vem preenchido (o motor simplesmente ignora esse
 * campo fora do modo agent-id). Bastava mandar
 * `click { strategy:'semantic', target:{ agentId:<inofensivo>, text:'Excluir conta' } }`:
 * o freio descrevia o elemento INOFENSIVO por `agentId` e liberava, e o motor
 * clicava no botão que casava com o TEXTO — nunca conferido. Segunda
 * variante medida: bloco Rescue (`params.text`) alimentando a busca
 * semântica enquanto o freio, de novo, só olhava `agentId`.
 *
 * Esta função devolve a mesma decisão que o motor toma — incluindo a
 * substituição do Rescue já aplicada no `target` devolvido — para quem
 * chama (freio ou motor) nunca mais precisar reimplementar esse julgamento.
 */
export function resolverAlvoDeClique(
  action: Pick<PlannedAction, 'target' | 'params'>,
): AlvoDeClique | null {
  const target = action.target;
  if (!target) return null;

  if (target.strategy === 'agent-id' && target.agentId !== undefined) {
    return { modo: 'agent-id', agentId: target.agentId };
  }

  // Rescue: o modelo às vezes manda o texto de busca em `params` em vez de
  // `target` (ex.: {"target":{"strategy":"semantic"},"params":{"text":"..."}}).
  let resolvedTarget = target;
  if (
    resolvedTarget.strategy === 'semantic' &&
    !resolvedTarget.role && !resolvedTarget.text &&
    !resolvedTarget.placeholder && !resolvedTarget.ariaLabel
  ) {
    const paramText = action.params?.text as string | undefined;
    const paramRole = action.params?.role as string | undefined;
    const paramPlaceholder = action.params?.placeholder as string | undefined;
    const paramAriaLabel = action.params?.ariaLabel as string | undefined;
    if (paramText || paramRole || paramPlaceholder || paramAriaLabel) {
      resolvedTarget = {
        ...resolvedTarget,
        ...(paramText && { text: paramText }),
        ...(paramRole && { role: paramRole }),
        ...(paramPlaceholder && { placeholder: paramPlaceholder }),
        ...(paramAriaLabel && { ariaLabel: paramAriaLabel }),
      };
    }
  }

  return { modo: 'semantic', target: resolvedTarget };
}

// ══════════════════════════════════════════════════════════════════════════
// ALVO ÚNICO — uma resolução por ação, carregada pelo comando inteiro
// ══════════════════════════════════════════════════════════════════════════
//
// Por que isto existe (obra 25, 06/09/2026). Oito defeitos medidos nesta ponte
// têm a MESMA forma: o freio confere uma coisa e o motor faz outra. Os quatro
// primeiros consertos (`resolverAlvoDeCloseTab`, `resolverAlvoDeSwitchTab`,
// `resolverAlvoDeClique`, `descreverElementoNoPonto`) unificaram a LEITURA DOS
// CAMPOS (`params` x `target`) — e isso fechou os furos 1 a 6. Não fecha os
// furos 7 e 8, porque eles não são de leitura de campo:
//
//   1. freio e motor RESOLVIAM DUAS VEZES (o freio chamava `resolveTarget` em
//      `policy.ts` e o motor chamava de novo no `case 'click'`) — dois
//      instantes, e o PJe re-renderiza por AJAX entre um e outro;
//   2. o freio SUBIA até o ancestral clicável e o motor DESCIA por
//      `findRealInput` — ref de wrapper escrevia num `<input type=password>`
//      que o freio nunca examinou (furo 7-C);
//   3. "não resolvi" virava `undefined` e LIBERAVA, enquanto o motor caía no
//      `document.activeElement` e escrevia ali (furo 7-A);
//   4. quem dizia ao freio o que havia no ponto era `document.elementFromPoint`,
//      avaliado no MUNDO DA PÁGINA — função que a própria página redefine.
//
// A resposta é um objeto de alvo resolvido UMA VEZ, produzido aqui e carregado
// pelo comando inteiro: o freio julga `descritor` (regra 4) e `efetivo` (regra
// 1), o motor age em `ponto`/`backendNodeId`/`efetivo`. Ninguém resolve de novo.

/** Apelido curto — este arquivo já importa o debugger-manager como `debuggerManager`. */
const dm = debuggerManager;

/** Por qual caminho o alvo foi encontrado. */
export type ComoResolveu = 'ref' | 'semantico' | 'coordenada' | 'foco';

/** Tudo que o FREIO precisa saber para julgar (regra 4). */
export interface DescritorDeElemento {
  /** tag do ancestral clicável (pode não ser a tag do nó original — ver `descreverPorObjectId`). */
  tag: string;
  tipo: string;
  /** role ARIA, sempre minúscula ('' quando ausente). */
  role: string;
  texto: string;
  /** aria-label CRU, separado de `texto` (FURO 4): rótulo perigoso não pode escapar. */
  ariaLabel: string;
  /** true quando o elemento PROVOU ser aba/link de navegação, e não ação. */
  ehAba: boolean;
  /** onclick por atributo/propriedade OU por addEventListener. */
  temOnclick: boolean;
  dentroDeForm: boolean;
}

/**
 * O nó que de fato RECEBE o efeito, já com a travessia do motor daquela ação
 * aplicada (wrapper/shadow → `<input>`; OPTION → `<select>`; select2 → o
 * `<select>` real ao lado). É este que a regra 1 (senha) julga, e é este que o
 * motor escreve — nunca mais um cada.
 *
 * OBRA 26: "de fato RECEBE" passou a ser verdade também quando a travessia NÃO
 * acha campo nenhum. Nessas ações (ver `ACOES_QUE_ESCREVEM_POR_FOCO`) o motor
 * não escreve no nó nomeado: `cdpType` cai no `Input.insertText`, que vai para
 * quem está com FOCO. Então é o elemento FOCADO que vira o `efetivo` — senão o
 * freio julgaria o `<span>` do select2 e o texto entraria no campo de senha
 * que estava focado atrás (MEDIDO, 06/09/2026).
 */
export interface AlvoEfetivo {
  backendNodeId: number;
  objectId: string;
  tag: string;
  tipo: string;
  /** contenteditable — campo digitável que não é input/textarea/select. */
  editavel: boolean;
  /** true quando a travessia MUDOU de nó (o caso do furo 7-C). */
  desceu: boolean;
}

export interface AlvoResolvido {
  tabId: number;
  como: ComoResolveu;
  /** Identidade estável do nó de origem. Sempre presente. */
  backendNodeId: number;
  objectId: string;
  /**
   * Ponto conferido que o motor vai clicar. `null` em `ref` e `foco`:
   * - `ref`: quem calcula o ponto é `cdpClickByRefOrThrow`, no instante do
   *   clique, com a guarda `pontoPertenceAoElemento` (que é uma checagem de
   *   SEGURANÇA — "o ponto ainda pertence a este elemento?" — e não uma
   *   escolha de alvo; a escolha é o `backendNodeId`, que os dois lados
   *   compartilham). Duplicar essa geometria aqui exigiria mexer em
   *   `cdp-tools.ts`, que esta obra não pode tocar.
   * - `foco`: não há clique nenhum.
   */
  ponto: { x: number; y: number } | null;
  descritor: DescritorDeElemento;
  efetivo: AlvoEfetivo;
  /**
   * O clique que esta ação despacha serve só para FOCAR? (obra 26)
   *
   * Pergunta da regra 4, e ela é sobre o nó NOMEADO, não sobre o receptor: um
   * `type` cujo alvo é um campo de texto clica só para focar (não dispara ação
   * nenhuma), e julgar o texto dele daria falso positivo bobo — um campo de
   * busca com "pagar" escrito dentro barraria a digitação seguinte. Já
   * `<input type=submit value="Pagar">` casa `input` e NÃO é campo digitável:
   * é botão, o clique é de AÇÃO, e continua sob a regra 4.
   *
   * Fica aqui, resolvido junto com o resto, porque é a travessia do nomeado —
   * e depois que o `efetivo` passou a poder ser o elemento FOCADO, perguntar
   * `efetivoEhCampoDigitavel(efetivo)` no freio responderia sobre o receptor,
   * não sobre o que vai ser clicado. Era a fresta por onde o `type` num botão
   * "Pagar" voltaria a passar quando houvesse um campo de texto focado.
   */
  cliqueApenasFoca: boolean;
  /**
   * `true` quando o `efetivo` NÃO é a travessia do nó nomeado, e sim o
   * elemento com foco — porque é ele que vai receber o texto. Serve de prova
   * nos testes e de diagnóstico no resultado do motor.
   */
  escritaCaiuNoFoco: boolean;
}

export type CausaDeNaoResolver =
  /** A ação não nomeia alvo nenhum (e o motor também não vai achar um). */
  | 'sem-alvo'
  /** Busca semântica/coordenada não achou elemento — o motor erraria igual. */
  | 'alvo-nao-resolvido'
  /** Há coordenada, mas o CDP diz que não existe nó ali (fora da viewport, etc.). */
  | 'sem-no-no-ponto'
  /** O `ref` não existe mais na página — o motor vai falhar pelo MESMO motivo. */
  | 'no-inexistente'
  /** O CDP recusou a conversa (nó vivo, mas não deu para ler). Falha FECHADA. */
  | 'cdp';

export type Resolucao =
  | { ok: true; alvo: AlvoResolvido }
  | {
    ok: false;
    causa: CausaDeNaoResolver;
    motivo: string;
    /**
     * O `ref` que a acao nomeou, quando havia um (causa `no-inexistente`).
     * Existe para o motor poder chamar `cdpClickByRefOrThrow` com o MESMO
     * numero e devolver a mensagem que diz o que fazer ("releia a pagina com
     * browser_read_page"), em vez de o freio trocar isso por um "[bloqueado]"
     * que nao ajuda ninguem. Nao e uma segunda resolucao: e o mesmo numero que
     * esta funcao ja tinha lido.
     */
    backendNodeId?: number;
  };

/**
 * Tipos de `<input>` que NAO recebem texto — mesma lista do probe de `cdpType`
 * (`cdp-tools.ts`, variavel `skip`), que classifica esses como 'non-typeable'.
 */
const TIPOS_DE_INPUT_NAO_DIGITAVEIS = new Set([
  'file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'range', 'color',
]);

/**
 * O no efetivo e um CAMPO que recebe texto?
 *
 * Uma definicao so, usada pelo motor (para decidir se manda o efetivo para o
 * `cdpType`) e pelo freio (para decidir se o clique que o `type` despacha e um
 * clique-para-focar ou um clique de ACAO). Duas definicoes aqui seriam a
 * familia de furo em escala menor: o motor escrevendo num lugar que o freio
 * classificou de outro jeito.
 *
 * `<input type=submit value="Pagar">` casa `input` e por isso passaria por
 * "campo" numa checagem so de tag — e e exatamente um botao. Por isso a lista
 * de tipos nao digitaveis, a MESMA de `cdpType`.
 */
export function efetivoEhCampoDigitavel(e: AlvoEfetivo): boolean {
  if (e.editavel) return true;
  if (e.tag === 'textarea' || e.tag === 'select') return true;
  return e.tag === 'input' && !TIPOS_DE_INPUT_NAO_DIGITAVEIS.has(e.tipo);
}

/** A forma mínima que `resolverAlvoDaAcao` lê. `PlannedAction` cabe aqui. */
export interface AcaoComAlvo {
  type: string;
  target?: ActionTarget;
  params?: Record<string, unknown>;
}

/**
 * Ações que passam pelo alvo único. Fora desta lista ninguém paga nada:
 * `read_page`, `extract`, `wait_*`, `screenshot`, `navigate` e `scroll` não
 * têm elemento para resolver.
 *
 * É a MESMA constante que `bridge/index.ts` usa para decidir quando resolver
 * e que o motor usa para EXIGIR o alvo resolvido (ver `run`): se as duas
 * listas pudessem divergir, uma ação entraria no motor sem alvo e o motor
 * voltaria a resolver sozinho — exatamente a família de defeito que esta obra
 * mata.
 */
export const ACOES_COM_ALVO_UNICO = new Set(['click', 'type', 'press_key', 'drag']);

/**
 * Ações cujo motor, quando a travessia NÃO acha campo que aceite texto,
 * escreve em quem está com FOCO — e não no nó nomeado (obra 26).
 *
 * Não é uma escolha desta função: é o que os três caminhos fazem hoje.
 * - `type` → `cdpType` cai no `Input.insertText`, que não aceita alvo;
 * - `cap_digitar` e `cap_autocomplete` → `digitarTeclaATecla` despacha
 *   `Input.dispatchKeyEvent`, que também vai para o foco.
 *
 * `cap_form_input` e `cap_form_fill` ficam FORA de propósito: `preencherCampo`
 * escreve pelo `objectId`, sem foco nenhum — para elas o receptor é sempre a
 * travessia do nó nomeado, e mandá-las para o foco seria inventar um desvio
 * que o motor delas não faz.
 */
const ACOES_QUE_ESCREVEM_POR_FOCO = new Set(['type', 'cap_digitar', 'cap_autocomplete']);

/**
 * Qual travessia aplicar para achar o nó EFETIVO. Espelha, ação por ação, o
 * que o motor daquela ação faz de verdade — nunca uma regra "geral" inventada
 * aqui:
 * - `campo-digitavel`: `findRealInput` de `cdpType` (cdp-tools.ts:44-56);
 * - `campo-de-formulario`: OPTION→`closest('select')` e select2→`<select>` real
 *   de `preencherCampo` (capacidades/formulario.ts:32-48);
 * - `nenhuma`: clique e tecla não descem para lugar nenhum.
 *
 * A travessia é IDEMPOTENTE de propósito: `findRealInput` a partir de um
 * `<input>` devolve o próprio `<input>`; `preencherCampo` a partir de um
 * `<select>` não lateraliza. Por isso o motor pode receber o nó efetivo já
 * percorrido e refazer a própria travessia sem mudar de alvo — é o que garante
 * que freio e motor terminem no MESMO nó.
 */
type Travessia = 'nenhuma' | 'campo-digitavel' | 'campo-de-formulario';

const TRAVESSIA_POR_ACAO: Record<string, Travessia> = {
  click: 'nenhuma',
  press_key: 'nenhuma',
  drag: 'nenhuma',
  cap_click_xy: 'nenhuma',
  type: 'campo-digitavel',
  cap_digitar: 'campo-digitavel',
  cap_autocomplete: 'campo-digitavel',
  cap_form_input: 'campo-de-formulario',
  cap_form_fill: 'campo-de-formulario',
};

/** Sobe até o ancestral clicável mais próximo e devolve ELE (por referência). */
const SUBIR_ATE_O_CLICAVEL = `function() {
  // [role] SO os papeis de controle. Antes qualquer [role] valia, e a subida
  // parava num CONTEINER (mat-nav-list, role=navigation, no Google Flow): o
  // freio julgava o texto do menu inteiro, que tinha o icone "delete" da
  // Lixeira, e barrava o clique em "Cenas" (30/09/2026). role=img (icone)
  // tambem nao e controle.
  var PAPEIS = /^(button|link|menuitem|menuitemcheckbox|menuitemradio|tab|option|checkbox|radio|switch|treeitem|gridcell|row|listitem|combobox|textbox|searchbox|slider|spinbutton)$/i;
  function ehClicavel(el) {
    if (!el.matches) return false;
    if (el.matches('a, button, input, select, textarea, li, td, [onclick]')) return true;
    var r = el.getAttribute && el.getAttribute('role');
    return !!r && PAPEIS.test(r);
  }
  // Parte do ELEMENTO, nunca do no de texto: getNodeForLocation devolve o texto
  // quando o ponto cai em cima dele, e se nada acima for clicavel o fallback
  // antigo devolvia o proprio no de texto -- o LER_DESCRICAO quebrava em
  // getAttribute e o freio recusava com "existe mas nao deu para descreve-lo"
  // (3x na barra do topo do PJe em 23/09/2026).
  // Raiz de shadow DOM (Gemini, 26/09/2026: "clicavel.getAttribute is not a
  // function"): nao tem parentElement; o caminho de volta e o .host.
  var inicio = this;
  while (inicio && !inicio.tagName) inicio = inicio.element || inicio.parentElement || inicio.host || inicio.parentNode;
  if (!inicio) return this;
  var clicavel = inicio;
  while (clicavel && clicavel !== document.body && !ehClicavel(clicavel)) {
    clicavel = clicavel.parentElement;
  }
  if (!clicavel || clicavel === document.body) clicavel = inicio;
  return clicavel;
}`;

/** Forma bruta que a página devolve, antes de misturar o achado do CDP. */
interface DescricaoBrutaDoDom {
  texto: string;
  ariaLabel: string;
  tipo: string;
  tag: string;
  role: string;
  dentroDeForm: boolean;
  temOnclickAttr: boolean;
  hrefJavascript: boolean;
  provaAbaPorAncestral: boolean;
  ehControleDeAcaoReal: boolean;
}

const LER_DESCRICAO = `function() {
  var clicavel = this;
  while (clicavel && typeof clicavel.getAttribute !== 'function') {
    clicavel = clicavel.element || clicavel.parentElement || clicavel.host || clicavel.parentNode;
  }
  if (!clicavel) {
    var t0 = this;
    return { __diag: 'sem getAttribute: typeof=' + (typeof t0) + ' nodeName=' + (t0 && t0.nodeName)
      + ' nodeType=' + (t0 && t0.nodeType) + ' ctor=' + (t0 && t0.constructor && t0.constructor.name)
      + ' ga=' + (t0 && typeof t0.getAttribute) + ' proto=' + (t0 && Object.getPrototypeOf(t0) && Object.getPrototypeOf(t0).constructor && Object.getPrototypeOf(t0).constructor.name) };
  }

  // Prova de aba/guia de navegacao, pelo papel do elemento no DOM:
  // role=tab, ancestral role=tablist, ou classe de HEADER do RichFaces
  // (rich-tab, rich-tab-header, rich-tabhdr-*). Nunca rich-tab-content
  // nem rich-tabpanel inteiro: sao o CORPO da aba, onde um botao de
  // verdade pode morar — so a classe do CABECALHO prova aba.
  function temClasseDeHeaderDeAba(el) {
    var lista = el.classList || [];
    for (var i = 0; i < lista.length; i++) {
      var c = lista[i];
      if (c === 'rich-tab' || c.indexOf('rich-tab-header') === 0 || c.indexOf('rich-tabhdr') === 0) return true;
    }
    return false;
  }

  var texto = (clicavel.innerText || clicavel.value || clicavel.getAttribute('aria-label') || '').slice(0, 200);
  // FURO 4: ariaLabel sai SEPARADO de texto (que so cai nele quando
  // innerText/value estao vazios). Um botao pode ter innerText inocente
  // ("Opcoes avancadas") e aria-label perigoso ("Excluir conta
  // definitivamente") -- a busca semantica acha o elemento pelo aria-label,
  // entao o julgamento da regra 4 tem de examinar os dois campos, nao so o
  // que texto prioriza. SEM CRASE aqui dentro: esta string e delimitada por
  // crase e uma crase de markdown fecharia o template literal antes da hora.
  var ariaLabel = (clicavel.getAttribute('aria-label') || '').slice(0, 200);
  var tag = (clicavel.tagName || '').toLowerCase();
  var tipo = (clicavel.getAttribute('type') || tag).toLowerCase();
  var role = (clicavel.getAttribute('role') || '').toLowerCase();
  var dentroDeForm = Boolean(clicavel.closest && clicavel.closest('form'));
  var temOnclickAttr = clicavel.hasAttribute('onclick') || typeof clicavel.onclick === 'function';
  // href="javascript:..." executa codigo no clique — nao e navegacao.
  var href = (clicavel.getAttribute && clicavel.getAttribute('href')) || '';
  var hrefJavascript = href.trim().toLowerCase().indexOf('javascript:') === 0;

  var provaAbaPorAncestral = false;
  var no = clicavel;
  while (!provaAbaPorAncestral && no && no !== document.body) {
    var r = (no.getAttribute && no.getAttribute('role') || '').toLowerCase();
    if (r === 'tab' || r === 'tablist') provaAbaPorAncestral = true;
    if (temClasseDeHeaderDeAba(no)) provaAbaPorAncestral = true;
    no = no.parentElement;
  }

  // Controle de acao real nunca vira aba so por estar perto de uma.
  var ehControleDeAcaoReal = tag === 'button' || tipo === 'submit' || tipo === 'button'
    || tipo === 'image' || role === 'button';

  return {
    texto: texto, ariaLabel: ariaLabel, tipo: tipo, tag: tag, role: role,
    dentroDeForm: dentroDeForm, temOnclickAttr: temOnclickAttr,
    hrefJavascript: hrefJavascript,
    provaAbaPorAncestral: provaAbaPorAncestral,
    ehControleDeAcaoReal: ehControleDeAcaoReal,
  };
}`;

/**
 * Travessia até o nó que RECEBE o efeito. Cada ramo é cópia deliberada da
 * regra do motor correspondente (ver `TRAVESSIA_POR_ACAO`): copiar é o preço
 * de `cdp-tools.ts` estar fora do escopo desta obra — e o que amarra as duas
 * cópias é o teste `type` por ref de wrapper (furo 7-C), que fica vermelho na
 * hora em que uma delas mudar sem a outra.
 *
 * A regra mora numa string só, usada pelas DUAS chamadas abaixo (a que lê
 * tag/tipo por valor e a que devolve o nó por referência): duas cópias aqui
 * dentro seriam a mesma doença em escala menor.
 */
const TRAVESSIA_JS = `
  function travessia(no, familia) {
    var alvo = no;
    if (familia === 'campo-digitavel') {
      // MESMA regra de findRealInput (cdp-tools.ts, dentro de cdpType): campo
      // proprio vence; senao shadowRoot; senao o primeiro campo descendente.
      // O bail em body/documentElement espelha o "no-focus" do probe de cdpType.
      if (no !== document.body && no !== document.documentElement) {
        var achar = function (el) {
          if (!el) return null;
          if (el.isContentEditable || (el.matches && el.matches('input,textarea,select'))) return el;
          if (el.shadowRoot) {
            var s = el.shadowRoot.querySelector('input,textarea,select,[contenteditable]');
            if (s) return achar(s);
          }
          var c = el.querySelector && el.querySelector('input,textarea,select,[contenteditable]');
          if (c) return achar(c);
          return null;
        };
        var real = achar(no);
        if (real) alvo = real;
      }
    } else if (familia === 'campo-de-formulario') {
      // MESMA regra de preencherCampo (capacidades/formulario.ts): OPTION sobe
      // para o <select>, e o span do select2 lateraliza para o <select> real.
      if (no.tagName === 'OPTION' && no.closest) alvo = no.closest('select') || no;
      if (alvo.tagName !== 'SELECT' && alvo.closest) {
        var container = alvo.closest('.select2, .select2-container');
        if (container) {
          var realS = container.previousElementSibling;
          if (!(realS && realS.tagName === 'SELECT') && container.parentElement) {
            realS = container.parentElement.querySelector('select.select2-hidden-accessible, select');
          }
          if (realS && realS.tagName === 'SELECT') alvo = realS;
        }
      }
    }
    return alvo;
  }
`;

/**
 * `DOM.getNodeForLocation` pode devolver um no de TEXTO (o texto dentro do
 * botao). Elemento e o que interessa nos dois lados: sem este ajuste, a
 * travessia devolveria "no sem tagName" e a acao inteira falharia FECHADA —
 * falso positivo em cima de clique legitimo.
 */
const ELEMENTO_DE_PARTIDA = `
  function elementoDePartida(no) {
    // Pseudo-elemento (::before de icone, Gemini 26/09/2026): o dono e .element.
    while (no && !no.tagName) no = no.element || no.parentElement || no.host || no.parentNode;
    return no || null;
  }
`;

/** Percorre e devolve, por VALOR, se mudou de nó e o tag/tipo de quem recebe. */
const DESCER_ATE_O_EFETIVO = `function(familia) {
  ${TRAVESSIA_JS}
  ${ELEMENTO_DE_PARTIDA}
  var no = elementoDePartida(this);
  if (!no) return { erro: 'no sem tagName' };
  var alvo = travessia(no, familia);
  var tag = (alvo.tagName || '').toLowerCase();
  var tipo = ((alvo.getAttribute && alvo.getAttribute('type')) || tag).toLowerCase();
  // \`mesmo\` so quando NADA mudou — nem a travessia, nem o ajuste de no de
  // texto para o elemento pai. Quando mudou, quem chama paga o round-trip
  // para ter a identidade (backendNodeId) de quem de fato recebe o efeito.
  return {
    mesmo: alvo === no && no === this,
    tag: tag, tipo: tipo, editavel: Boolean(alvo.isContentEditable),
  };
}`;

/** Mesma travessia, devolvendo o nó por REFERÊNCIA (para pegar o objectId). */
const DESCER_E_DEVOLVER = `function(familia) {
  ${TRAVESSIA_JS}
  ${ELEMENTO_DE_PARTIDA}
  var no = elementoDePartida(this);
  if (!no) return this;
  return travessia(no, familia);
}`;

/**
 * Lê texto, tipo e papel do elemento a partir de um `objectId` JÁ RESOLVIDO.
 *
 * Veio inteira de `bridge/policy.ts` (`descreverElementoPorObjectId`), sem
 * mudança de regra: o freio deixou de fazer chamada CDP para virar decisão
 * pura sobre o descritor. O objeto apontado pode ser um FILHO do elemento que
 * de fato recebe o clique (o `<span>` dentro do `<a>` de uma aba), por isso o
 * passo 1 sobe até o ancestral clicável antes de julgar tag/role/onclick/form.
 */
async function descreverPorObjectId(
  tabId: number,
  objectId: string,
): Promise<DescritorDeElemento | null> {
  try {
    // Passo 1: sobe até o ancestral clicável e pega o objectId DELE por
    // referência (returnByValue: false) — o passo 3 pergunta ao CDP
    // (DOMDebugger.getEventListeners) por esse objeto exato, e esse comando só
    // aceita objectId, nunca backendNodeId.
    const subiu = await dm.send<{ result?: { objectId?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      tabId, 'Runtime.callFunctionOn',
      { objectId, returnByValue: false, functionDeclaration: SUBIR_ATE_O_CLICAVEL },
    );
    // Se a subida LANCOU, `result` e o objeto do ERRO (com objectId proprio) —
    // usar ele como "o clicavel" fazia a leitura seguinte examinar a excecao,
    // nao o elemento (Gemini, 26/09/2026: "descricao vazia" em todo clique).
    // Sem subida, julga o proprio no do ponto.
    const clicavelObjectId = subiu?.exceptionDetails ? objectId : (subiu?.result?.objectId ?? objectId);

    const res = await dm.send<{ result: { value: DescricaoBrutaDoDom }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      tabId, 'Runtime.callFunctionOn',
      { objectId: clicavelObjectId, returnByValue: true, functionDeclaration: LER_DESCRICAO },
    );
    const desc = res?.result?.value;
    if (desc && (desc as unknown as { __diag?: string }).__diag) {
      ultimoErroDeDescricao = (desc as unknown as { __diag: string }).__diag;
      return null;
    }
    if (!desc) {
      const ex = res?.exceptionDetails;
      ultimoErroDeDescricao = String(ex?.exception?.description ?? ex?.text ?? '').split(/\r?\n/)[0].slice(0, 200)
        || `retorno cru: ${JSON.stringify(res).slice(0, 200)}`;
      return null;
    }

    // Passo 3: pergunta ao CDP se há listener de "click" ligado DIRETAMENTE no
    // ancestral clicável — cobre addEventListener, que nenhum atributo
    // denuncia. Só enxerga listener no PRÓPRIO nó: delegação num ancestral
    // (React na raiz) não aparece aqui, risco residual já documentado.
    let temListenerDeClique = false;
    try {
      const ev = await dm.send<{ listeners?: Array<{ type: string }> }>(
        tabId, 'DOMDebugger.getEventListeners', { objectId: clicavelObjectId },
      );
      temListenerDeClique = (ev?.listeners ?? []).some((l) => l.type === 'click');
    } catch {
      // Comando indisponível neste Chrome: não trava a prova, só deixa de
      // enxergar addEventListener neste nó.
    }

    const temOnclick = desc.temOnclickAttr || temListenerDeClique;
    // As duas provas de aba pedem o mesmo: o CLICÁVEL em si sem onclick, fora
    // de form, e não ser controle de ação real.
    const provaValida = !desc.ehControleDeAcaoReal && !temOnclick && !desc.dentroDeForm;
    const ancoraDeNavegacao = desc.tag === 'a' && !desc.hrefJavascript;
    const ehAba = provaValida && (desc.provaAbaPorAncestral || ancoraDeNavegacao);

    return {
      texto: desc.texto, ariaLabel: desc.ariaLabel, tipo: desc.tipo,
      tag: desc.tag, role: desc.role, dentroDeForm: desc.dentroDeForm,
      ehAba, temOnclick,
    };
  } catch (err) {
    ultimoErroDeDescricao = String((err as Error)?.message ?? err).slice(0, 200);
    return null;
  }
}

/** Por que a ultima descricao falhou -- vai junto no erro, para o proximo relato trazer a causa. */
let ultimoErroDeDescricao = '';

/** De onde a ação tira o elemento — a MESMA decisão que o motor de cada uma toma. */
type Origem =
  | { tipo: 'ref'; backendNodeId: number }
  | { tipo: 'semantico'; target: ActionTarget }
  | { tipo: 'coordenada'; x: number; y: number }
  | { tipo: 'foco' };

function origemDaAcao(acao: AcaoComAlvo): Origem | null {
  const t = acao.target;
  const porRef = t?.strategy === 'agent-id' && t.agentId !== undefined
    ? ({ tipo: 'ref', backendNodeId: t.agentId } as const)
    : null;

  switch (acao.type) {
    case 'click': {
      // Mesma decisão (Rescue incluído) que o `case 'click'` do motor toma.
      const alvo = resolverAlvoDeClique(acao);
      if (!alvo) return null;
      return alvo.modo === 'agent-id'
        ? { tipo: 'ref', backendNodeId: alvo.agentId }
        : { tipo: 'semantico', target: alvo.target };
    }
    case 'type':
      // `case 'type'` do motor: agentId cru só em strategy 'agent-id'; com
      // qualquer outro target, busca semântica; sem target nenhum — ou com um
      // target que não resolve (tratado adiante) — o texto cai no
      // `document.activeElement`, que é o que `cdpType(..., undefined)` faz.
      if (porRef) return porRef;
      return t ? { tipo: 'semantico', target: t } : { tipo: 'foco' };
    case 'cap_digitar':
    case 'cap_autocomplete':
    case 'cap_form_input':
    case 'cap_form_fill':
      // As capacidades NÃO têm ramo semântico: ou recebem `ref`, ou escrevem em
      // quem estiver com foco (`digitarTeclaATecla` sem backendNodeId). Cair na
      // busca semântica aqui faria o freio examinar "o primeiro campo que casa
      // com o texto" enquanto as teclas vão para o campo focado — a família de
      // furo de novo, por um caminho novo.
      return porRef ?? { tipo: 'foco' };
    case 'press_key':
      // O motor nunca olha target: despacha a tecla para quem tem foco.
      return { tipo: 'foco' };
    case 'cap_click_xy': {
      const x = acao.params?.x as number | undefined;
      const y = acao.params?.y as number | undefined;
      if (typeof x !== 'number' || typeof y !== 'number') return null;
      return { tipo: 'coordenada', x, y };
    }
    case 'drag': {
      const fromX = acao.params?.fromX as number | undefined;
      const fromY = acao.params?.fromY as number | undefined;
      if (typeof fromX === 'number' && typeof fromY === 'number') {
        return { tipo: 'coordenada', x: fromX, y: fromY };
      }
      // Ramo por target: hoje inalcançável pela ponte (`browser_drag` exige
      // fromX/fromY) e minado — o motor clicava DE VERDADE por ref antes de
      // resolver, e depois falhava. Sem ponto para conferir, é 'sem-alvo': o
      // motor devolve o erro dele sem ter clicado em nada.
      return null;
    }
    default:
      return null;
  }
}

const naoResolveu = (causa: CausaDeNaoResolver, motivo: string, backendNodeId?: number): Resolucao =>
  ({ ok: false, causa, motivo, ...(backendNodeId !== undefined && { backendNodeId }) });

/**
 * Passos 2 e 3 da resolucao: o DESCRITOR (o que o freio julga na regra 4) e o
 * no EFETIVO (o que a regra 1 julga e o motor escreve). Fica separado porque o
 * passo 1 tem duas saidas — a normal e o fallback para o FOCO de um `type`
 * cujo alvo semantico nao resolveu — e as duas terminam exatamente aqui.
 */
async function montarAlvo(
  acao: AcaoComAlvo,
  tabId: number,
  como: ComoResolveu,
  backendNodeId: number,
  objectId: string,
  ponto: { x: number; y: number } | null,
): Promise<Resolucao> {
  // ── 2. Descritor (o que o freio julga na regra 4) ──────────────────────
  ultimoErroDeDescricao = '';
  const descritor = await descreverPorObjectId(tabId, objectId);
  if (!descritor) {
    // O nó ESTÁ vivo (o passo 1 resolveu) e mesmo assim não deu para lê-lo:
    // aqui não há "o motor falharia igual" que justifique liberar. Falha
    // fechada — é o achado do cético sobre a regra 4 liberar no escuro.
    return naoResolveu('cdp', `o no ${backendNodeId} existe mas nao deu para descreve-lo${ultimoErroDeDescricao ? ` (${ultimoErroDeDescricao})` : ' (a pagina devolveu descricao vazia)'}`);
  }

  // ── 3. Nó efetivo (o que o freio julga na regra 1, e o motor escreve) ──
  const familia = TRAVESSIA_POR_ACAO[acao.type] ?? 'nenhuma';
  const doNomeado = await percorrerAteOEfetivo(tabId, objectId, backendNodeId, familia);
  if ('ok' in doNomeado) return doNomeado;

  // A travessia do nó NOMEADO deu num campo que aceita texto? É a pergunta da
  // regra 4 (`cliqueApenasFoca`) e também a que decide se o motor escreve nele
  // ou cai no foco — as duas sobre o MESMO nó, o nomeado.
  const cliqueApenasFoca = efetivoEhCampoDigitavel(doNomeado);

  // ── 4. Quem RECEBE o texto (obra 26) ───────────────────────────────────
  //
  // Espelhar o motor é o ponto desta função inteira, e aqui o motor faz uma
  // coisa que ela ainda não fazia: quando o nó nomeado não aceita texto, ele
  // NÃO escreve nele — `Input.insertText`/`Input.dispatchKeyEvent` vão para
  // quem está com FOCO. Sem este desvio o freio julgava o `<span>` do select2,
  // achava inocente, e o texto entrava no `<input type=password>` que estava
  // focado atrás (MEDIDO em bancada, 06/09/2026).
  //
  // `como === 'foco'` já é o elemento focado — resolver de novo só pagaria
  // dois round-trips para chegar no mesmo nó.
  let efetivo = doNomeado;
  let escritaCaiuNoFoco = false;
  if (!cliqueApenasFoca && como !== 'foco' && ACOES_QUE_ESCREVEM_POR_FOCO.has(acao.type)) {
    const f = await resolverFoco(tabId);
    if ('ok' in f) return f;
    // A MESMA travessia da ação, agora a partir do elemento focado — não
    // 'nenhuma'. É o furo 7-C aplicado ao foco: `cdpType` chamado com um
    // wrapper focado desce por `findRealInput` e escreve no `<input
    // type=password>` de dentro dele, e `digitarTeclaATecla` foca o efetivo
    // antes de digitar. Parar no wrapper faria o freio julgar a casca.
    const doFoco = await percorrerAteOEfetivo(tabId, f.objectId, f.backendNodeId, familia);
    if ('ok' in doFoco) return doFoco;
    efetivo = doFoco;
    escritaCaiuNoFoco = true;
  }

  return {
    ok: true,
    alvo: {
      tabId, como, backendNodeId, objectId, ponto, descritor, efetivo,
      cliqueApenasFoca, escritaCaiuNoFoco,
    },
  };
}

/**
 * Aplica a travessia de uma família e devolve o nó que ela nomeia, com
 * identidade (backendNodeId/objectId) e tag/tipo/editavel.
 *
 * Saiu de dentro de `montarAlvo` porque agora roda DUAS vezes: no nó nomeado e,
 * quando a escrita cai no foco, no elemento focado. Uma cópia para cada seria a
 * doença desta casa em escala menor.
 */
async function percorrerAteOEfetivo(
  tabId: number,
  objectId: string,
  backendNodeId: number,
  familia: Travessia,
): Promise<AlvoEfetivo | Extract<Resolucao, { ok: false }>> {
  try {
    const r = await dm.send<{ result: { value: { mesmo?: boolean; tag?: string; tipo?: string; editavel?: boolean; erro?: string } } }>(
      tabId, 'Runtime.callFunctionOn', {
        objectId, returnByValue: true, functionDeclaration: DESCER_ATE_O_EFETIVO,
        arguments: [{ value: familia }],
      },
    );
    const v = r?.result?.value;
    if (!v || v.erro || v.mesmo === undefined) {
      return naoResolveu('cdp', `nao consegui percorrer o alvo efetivo do no ${backendNodeId}${v?.erro ? ` (${v.erro})` : ''}`) as Extract<Resolucao, { ok: false }>;
    }
    if (v.mesmo) {
      return {
        backendNodeId, objectId, tag: v.tag ?? '', tipo: v.tipo ?? '',
        editavel: v.editavel === true, desceu: false,
      };
    }
    // Só quando a travessia MUDOU de nó vale pagar os dois round-trips para
    // ter a identidade dele (o caso raro: wrapper, OPTION, select2).
    const alvoRef = await dm.send<{ result?: { objectId?: string } }>(
      tabId, 'Runtime.callFunctionOn', {
        objectId, returnByValue: false, functionDeclaration: DESCER_E_DEVOLVER,
        arguments: [{ value: familia }],
      },
    );
    const objEfetivo = alvoRef?.result?.objectId;
    if (!objEfetivo) return naoResolveu('cdp', `a travessia do no ${backendNodeId} nao devolveu objectId`) as Extract<Resolucao, { ok: false }>;
    const d = await dm.send<{ node?: { backendNodeId?: number } }>(
      tabId, 'DOM.describeNode', { objectId: objEfetivo },
    );
    const bnEfetivo = d?.node?.backendNodeId;
    if (bnEfetivo === undefined) return naoResolveu('cdp', 'a travessia nao devolveu backendNodeId') as Extract<Resolucao, { ok: false }>;
    return {
      backendNodeId: bnEfetivo, objectId: objEfetivo,
      tag: v.tag ?? '', tipo: v.tipo ?? '', editavel: v.editavel === true, desceu: true,
    };
  } catch (err) {
    return naoResolveu('cdp', `nao consegui percorrer o alvo efetivo: ${String(err)}`) as Extract<Resolucao, { ok: false }>;
  }
}

/**
 * Quem esta com foco agora — a pergunta factual, nunca uma busca.
 *
 * Era um `const` dentro de `resolverAlvoDaAcao`; virou funcao do modulo porque
 * `montarAlvo` tambem precisa dela (obra 26: a escrita que cai no foco).
 */
async function resolverFoco(
  tabId: number,
): Promise<{ backendNodeId: number; objectId: string } | Extract<Resolucao, { ok: false }>> {
  try {
    const foco = await dm.send<{ result?: { objectId?: string } }>(
      tabId, 'Runtime.evaluate', { expression: 'document.activeElement' },
    );
    const id = foco?.result?.objectId;
    if (!id) return naoResolveu('cdp', 'nao consegui ler document.activeElement (Runtime.evaluate sem objectId)') as Extract<Resolucao, { ok: false }>;
    const desc = await dm.send<{ node?: { backendNodeId?: number } }>(
      tabId, 'DOM.describeNode', { objectId: id },
    );
    const bn = desc?.node?.backendNodeId;
    if (bn === undefined) return naoResolveu('cdp', 'nao consegui resolver o backendNodeId do elemento focado') as Extract<Resolucao, { ok: false }>;
    return { backendNodeId: bn, objectId: id };
  } catch (err) {
    return naoResolveu('cdp', `nao consegui identificar o elemento com foco: ${String(err)}`) as Extract<Resolucao, { ok: false }>;
  }
}

/**
 * Resolve, UMA VEZ, o alvo de uma ação — para o freio e para o motor.
 *
 * Devolve os dois lados de uma vez: o freio julga `descritor` (regra 4) e
 * `efetivo.tipo` (regra 1); o motor age em `ponto` / `backendNodeId` /
 * `efetivo`. Nunca devolve `undefined`/`null`: ou `{ok:true, alvo}` ou
 * `{ok:false, causa, motivo}` — foi o `undefined !== 'password'` que criou o
 * furo 7-A, e quem chama TEM de tratar o `ok:false`.
 *
 * Quem responde "quem está neste ponto" é o CDP (`DOM.getNodeForLocation`),
 * nunca `document.elementFromPoint`: a página pode redefinir a função e
 * mentir para o freio enquanto o motor clica no botão de verdade (medido).
 */
export async function resolverAlvoDaAcao(acao: AcaoComAlvo, tabId: number): Promise<Resolucao> {
  const origem = origemDaAcao(acao);
  if (!origem) {
    return naoResolveu('sem-alvo', `${acao.type}: a acao nao nomeia alvo nenhum`);
  }

  let como: ComoResolveu;
  let backendNodeId: number;
  let objectId: string;
  let ponto: { x: number; y: number } | null = null;

  // ── 1. Ponto de partida: um backendNodeId + objectId, e o ponto do clique ──
  //
  // `type` com alvo semantico que NAO RESOLVE cai no FOCO, e nao em erro: e o
  // que o motor faz (sem coordenada ele nao clica em nada e `cdpType(...,
  // undefined)` escreve no `document.activeElement`), e espelhar o motor e o
  // ponto desta funcao. O furo 7-A nao era o fallback existir — era o freio
  // devolver `undefined` e LIBERAR enquanto o motor escrevia no campo focado.
  // Com o foco resolvido, a regra 1 examina o campo que vai receber o texto:
  // senha focada barra, campo comum passa e continua funcionando.
  const caiNoFocoSemAlvo = acao.type === 'type';

  if (origem.tipo === 'ref') {
    como = 'ref';
    backendNodeId = origem.backendNodeId;
    try {
      const r = await dm.send<{ object?: { objectId?: string } }>(
        tabId, 'DOM.resolveNode', { backendNodeId },
      );
      const id = r?.object?.objectId;
      if (!id) {
        return naoResolveu(
          'no-inexistente',
          `ref ${backendNodeId} nao existe mais na pagina (DOM.resolveNode sem objectId)`,
          backendNodeId,
        );
      }
      objectId = id;
    } catch (err) {
      return naoResolveu(
        'no-inexistente', `ref ${backendNodeId} nao existe mais na pagina (${String(err)})`, backendNodeId,
      );
    }
  } else if (origem.tipo === 'foco') {
    como = 'foco';
    const f = await resolverFoco(tabId);
    if ('ok' in f) return f;
    backendNodeId = f.backendNodeId;
    objectId = f.objectId;
  } else {
    // Semântico e coordenada terminam no mesmo lugar: um PONTO, e o nó que o
    // CDP diz estar nele.
    let coords: { x: number; y: number } | null;
    if (origem.tipo === 'semantico') {
      como = 'semantico';
      coords = await resolveTarget(tabId, origem.target).catch(() => null);
      if (!coords) {
        if (!caiNoFocoSemAlvo) {
          return naoResolveu('alvo-nao-resolvido', `nao achei elemento para ${JSON.stringify(origem.target)}`);
        }
        const f = await resolverFoco(tabId);
        if ('ok' in f) return f;
        return montarAlvo(acao, tabId, 'foco', f.backendNodeId, f.objectId, null);
      }
      ponto = coords;
    } else {
      como = 'coordenada';
      ponto = { x: origem.x, y: origem.y };
    }

    // `DOM.getNodeForLocation` exige x/y INTEIROS (int32) e um documento já
    // pedido nesta sessão de CDP — os dois já custaram defeito nesta casa.
    await dm.send(tabId, 'DOM.getDocument', { depth: 0 }).catch(() => {});
    let noNoPonto: number | undefined;
    try {
      const no = await dm.send<{ backendNodeId?: number }>(tabId, 'DOM.getNodeForLocation', {
        x: Math.round(ponto.x), y: Math.round(ponto.y), includeUserAgentShadowDOM: false,
      });
      noNoPonto = no?.backendNodeId;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      // "No node found at given location" é resposta legítima do CDP (ponto
      // fora do documento, elemento abaixo da dobra); qualquer OUTRO erro é o
      // CDP recusando a chamada — os dois falham fechado, mas com causas
      // diferentes, porque quem chama trata cada uma de um jeito.
      return /no node/i.test(msg)
        ? naoResolveu('sem-no-no-ponto', `nao ha elemento em (${Math.round(ponto.x)}, ${Math.round(ponto.y)})`)
        : naoResolveu('cdp', `CDP recusou o hit-test em (${Math.round(ponto.x)}, ${Math.round(ponto.y)}): ${msg}`);
    }
    if (!noNoPonto) {
      return naoResolveu('sem-no-no-ponto', `nao ha elemento em (${Math.round(ponto.x)}, ${Math.round(ponto.y)})`);
    }
    backendNodeId = noNoPonto;
    try {
      const r = await dm.send<{ object?: { objectId?: string } }>(
        tabId, 'DOM.resolveNode', { backendNodeId },
      );
      const id = r?.object?.objectId;
      if (!id) return naoResolveu('cdp', `o no ${backendNodeId} do ponto nao resolveu para objectId`);
      objectId = id;
    } catch (err) {
      return naoResolveu('cdp', `o no ${backendNodeId} do ponto nao resolveu: ${String(err)}`);
    }
  }

  return montarAlvo(acao, tabId, como, backendNodeId, objectId, ponto);
}

class ExecutionEngine {
  /**
   * @param resolucao A resolucao de alvo que a ponte fez ANTES do freio - a
   * unica que existe. O motor nunca resolve nada por conta propria: recebe
   * `{ok:true, alvo}` e age nele, ou recebe a falha e devolve o erro certo.
   */
  async run(action: PlannedAction, ws: AgentWorkspace, resolucao?: Resolucao): Promise<ExecutionResult> {
    const tabId = ws.activeTabId;
    const alvo = resolucao?.ok ? resolucao.alvo : undefined;

    // Ninguém resolve duas vezes: ação da lista chega aqui COM o alvo que o
    // freio julgou, ou não roda. Sem esta guarda, um caminho novo em
    // `bridge/index.ts` que esquecesse de resolver faria o motor voltar a
    // escolher o alvo sozinho — a família de defeito inteira de novo.
    if (ACOES_COM_ALVO_UNICO.has(action.type) && !resolucao) {
      return {
        success: false,
        error: `[interno] ${action.type} chegou ao motor sem alvo resolvido. `
          + 'Toda acao de ACOES_COM_ALVO_UNICO tem de passar por resolverAlvoDaAcao antes do freio.',
      };
    }

    try {
      switch (action.type) {
        case 'read_page': {
          const res = await getPageStructureViaCDP(tabId);
          // Molduras de outro site: elementos com coordenada da tela, sem ref.
          const mold = await lerMolduras(tabId).catch(() => ({ elementos: [], ilegiveis: [] }));
          if (mold.elementos.length || mold.ilegiveis.length) {
            (res as unknown as Record<string, unknown>).molduras = mold;
          }
          return { success: true, data: res };
        }

        case 'screenshot': {
          // O agente nao pode enxergar a UI da propria extensao — nem em texto
          // nem em pixel. Com a pilula na foto, ele le "Agente rodando" e acha
          // que a PAGINA ainda esta processando. Some por um instante e volta.
          chrome.tabs.sendMessage(tabId, { type: 'HIDE_FOR_TOOL_USE' }).catch(() => {});
          try {
            // Um respiro para o Chrome repintar sem o indicador.
            await new Promise((r) => setTimeout(r, 50));
            const data = await debuggerManager.screenshot(tabId);
            return { success: true, data };
          } finally {
            chrome.tabs.sendMessage(tabId, { type: 'SHOW_AFTER_TOOL_USE' }).catch(() => {});
          }
        }

        case 'click': {
          // ALVO ÚNICO (obra 25): o elemento já veio resolvido — e é o MESMO
          // que o freio julgou. O `resolveTarget` que rodava aqui saiu: era a
          // segunda resolução, num instante diferente do freio, e o PJe
          // re-renderiza por AJAX entre as duas.
          if (!alvo) {
            // A resolucao falhou por um motivo que o freio deixa passar de
            // proposito (ver `vereditoDeResolucaoFalha`, policy.ts): o motor e
            // quem tem a mensagem util. Com `ref`, ela vem de
            // `cdpClickByRefOrThrow` - "releia a pagina com browser_read_page"
            // -, e nao um "[bloqueado]" que nao diz o que fazer.
            if (resolucao && !resolucao.ok && resolucao.backendNodeId !== undefined) {
              await cdpClickByRefOrThrow(tabId, resolucao.backendNodeId);
              return { success: true, data: { element: `backendNodeId:${resolucao.backendNodeId}` } };
            }
            return { success: false, error: 'No target for click action' };
          }

          if (alvo.como === 'ref') {
            // Obra 24 (05/09/2026): clique direto por ref tem de ADMITIR FALHA.
            // cdpClickByRefOrThrow lanca quando o ref nao existe mais na pagina,
            // quando o elemento nao tem posicao visivel ou quando o ponto do
            // clique cairia em cima de outro elemento (`pontoPertenceAoElemento`,
            // guarda de SEGURANCA, nao escolha de alvo — a escolha e o
            // backendNodeId, que o freio ja examinou).
            await cdpClickByRefOrThrow(tabId, alvo.backendNodeId);
            return { success: true, data: { element: `backendNodeId:${alvo.backendNodeId}` } };
          }

          // TOCTOU do ramo semantico (06/09/2026, medido ao vivo 3/3): o freio
          // julga o backendNodeId NUM INSTANTE (`resolverAlvoDaAcao`, com a
          // aba ainda em segundo plano — funciona assim de proposito). Entre
          // esse instante e este ponto, `comAbaPronta` (bridge/index.ts)
          // reativa a aba, e uma pagina que RE-RENDERIZA AO GANHAR FOCO — o
          // PJe faz isso por AJAX o tempo todo, nao precisa de pagina hostil
          // — pode trocar o que ocupa `alvo.ponto` por outra coisa antes do
          // clique sair. Despachar a COORDENADA CRUA (`cdpClick`) acertava o
          // que quer que tivesse tomado aquele lugar; a mesma
          // `cdpClickByRefOrThrow` do ramo `ref`, poucas linhas acima,
          // reconfere a IDENTIDADE (o `backendNodeId` que o freio examinou) e
          // FALHA FECHADO quando ela sumiu, em vez de clicar no substituto.
          await cdpClickByRefOrThrow(tabId, alvo.backendNodeId);
          return { success: true, data: { element: `backendNodeId:${alvo.backendNodeId}` } };
        }

        case 'type': {
          const text = action.params?.text as string | undefined;
          if (text === undefined) return { success: false, error: 'No text param for type action' };
          if (!alvo) return { success: false, error: 'type: sem alvo resolvido' };

          // O clique-para-focar continua sendo o mesmo de sempre (por ref, ou
          // por coordenada) — a diferenca e que agora ele cai no ponto/no que o
          // freio JULGOU. Antes, o ramo semantico chamava `resolveTarget` de
          // novo aqui dentro, e o ramo por ref clicava de verdade sem a regra 4
          // ter rodado (furo 7-B, fechado no freio).
          if (alvo.como === 'ref') {
            await cdpClickByRef(tabId, alvo.backendNodeId);
          } else if (alvo.como === 'semantico') {
            // MESMA TOCTOU do `case 'click'` (ver o comentario extenso la em
            // cima): aqui o clique so FOCA, nunca e a acao em si, entao
            // continua em MELHOR ESFORCO — `cdpClickByRef` ja engolia a falha
            // antes desta obra, e isso nao muda. O que muda e a BASE: agora
            // ela tambem reconfere a IDENTIDADE (`alvo.backendNodeId`) antes
            // de clicar, em vez de despachar `alvo.ponto` cru — uma pagina
            // que troca o que ocupa aquele ponto ao reganhar foco nao pode
            // mais fazer este clique-para-focar ativar um controle diferente
            // do que o freio examinou.
            await cdpClickByRef(tabId, alvo.backendNodeId);
          }

          // Wait for focus to settle — some editors (CM6/PM) take a tick
          await new Promise((r) => setTimeout(r, 150));

          // FURO 7-C: quem recebe o texto e o no EFETIVO (a travessia
          // `findRealInput` ja aplicada na resolucao), nao o no nomeado. Passar
          // o efetivo faz `cdpType` refazer a propria travessia a partir dele —
          // que e ponto fixo — e terminar exatamente onde o freio olhou.
          //
          // OBRA 26: SEMPRE o efetivo, nunca mais `undefined`. O `undefined`
          // mandava o `cdpType` sondar o `document.activeElement` DEPOIS do
          // clique — quer dizer, o motor escolhia sozinho, e depois do freio,
          // um alvo que o freio nunca examinou. Era a metade que sobrou da
          // familia: com um `<input type=password>` focado e um alvo que nao
          // aceita texto (o `<span>` do select2), o freio julgava o span e a
          // senha recebia o texto. Agora o desvio para o foco acontece na
          // RESOLUCAO (ver `escritaCaiuNoFoco`), antes do freio, e o motor so
          // escreve onde mandaram.
          const alvoDaEscrita = alvo.efetivo.backendNodeId;

          const clear = (action.params?.clear as boolean | undefined) ?? false;
          const typeResult = await cdpType(tabId, text, clear, alvoDaEscrita);
          return {
            success: true,
            data: {
              typeOutcome: typeResult.outcome,
              element: typeResult.elementInfo,
              alvo: {
                como: alvo.como, ref: alvo.backendNodeId, efetivo: alvo.efetivo.backendNodeId,
                ...(alvo.escritaCaiuNoFoco && { escritaCaiuNoFoco: true }),
              },
            },
          };
        }

        case 'press_key': {
          // `alvo` aqui e sempre `como: 'foco'`: a tecla vai para quem estiver
          // focado, e o motor nunca olhou target. Ele nao muda nada no despacho
          // — quem usa a resolucao e o freio (regra 1, senha; regra 4, quando a
          // tecla ATIVA o controle focado). Fica exigido mesmo assim pela guarda
          // de ACOES_COM_ALVO_UNICO, para nao existir caminho em que a tecla
          // chega ao Chrome sem ninguem ter olhado onde ela cai.
          const key = action.params?.key as string | undefined;
          const modifiers = action.params?.modifiers as string[] | undefined;
          if (!key) return { success: false, error: 'No key param for press_key action' };
          
          // Support modifiers in params (e.g., modifiers: ["Control"]) or in key combo (e.g., "Ctrl+C")
          let keyCombo = key;
          if (modifiers && modifiers.length > 0) {
            keyCombo = modifiers.join('+') + '+' + key;
          }
          
          await cdpPressKey(tabId, keyCombo);
          return { success: true };
        }

        case 'scroll': {
          const position = action.params?.position as string | undefined;

          // Named positions: scroll to top or bottom of page via JS
          if (position === 'bottom' || position === 'top') {
            await safeExecuteScript({
              target: { tabId },
              func: (pos: string) => {
                const isBottom = pos === 'bottom';
                // Find the LARGEST scrollable container on the page (works for SPAs
                // like Google AI Studio where the chat lives in an inner div, not body).
                const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
                const scrollables = allEls.filter((el) => {
                  if (el === document.body || el === document.documentElement) return false;
                  const style = window.getComputedStyle(el);
                  const oy = style.overflowY;
                  return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 50;
                });
                scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
                const container = scrollables[0];
                if (container) {
                  container.scrollTop = isBottom ? container.scrollHeight : 0;
                }
                window.scrollTo({ top: isBottom ? document.body.scrollHeight : 0, behavior: 'instant' });
              },
              args: [position],
            });
            // Brief pause to let scroll settle before next action reads content
            await new Promise((r) => setTimeout(r, 400));
            return { success: true };
          }

          // Pixel delta scroll — find the center of the largest scrollable container
          // so the mouseWheel event lands on the right element (not a sidebar or header).
          const deltaY = (action.params?.deltaY as number) ?? 500;
          const [scrollCenterRes] = await safeExecuteScript({
            target: { tabId },
            func: () => {
              const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
              const scrollables = allEls.filter((el) => {
                if (el === document.body || el === document.documentElement) return false;
                const oy = window.getComputedStyle(el).overflowY;
                return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 50;
              });
              scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
              const c = scrollables[0];
              if (c) {
                const r = c.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
              return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            },
          });
          const scrollCenter = (scrollCenterRes?.result as { x: number; y: number } | null)
            ?? { x: 760, y: 400 };
          const explicitX = action.params?.x as number | undefined;
          const explicitY = action.params?.y as number | undefined;
          await cdpScroll(
            tabId,
            explicitX ?? scrollCenter.x,
            explicitY ?? scrollCenter.y,
            deltaY,
          );
          return { success: true };
        }

        case 'navigate': {
          const url = action.params?.url as string | undefined;
          if (!url) return { success: false, error: 'No url param for navigate action' };
          await cdpNavigate(tabId, url);
          return { success: true };
        }

        case 'open_tab': {
          const newUrl = (action.params?.url as string | undefined) ?? 'about:blank';
          const newTabId = await workspaceManager.addTab(ws.workspaceId, newUrl);
          return { success: true, data: { newTabId } };
        }

        case 'switch_tab': {
          // FURO 1: mesma funcao que o freio usa (`resolverAlvoDeSwitchTab`)
          // — nunca mais um `||`/`??` proprio aqui que possa divergir do que
          // o freio checou. `null` cobre tabId ausente, 0, negativo, NaN e
          // string: todos falham fechado com o mesmo erro de antes.
          const switchTabId = resolverAlvoDeSwitchTab(action);
          if (switchTabId === null) {
            return {
              success: false,
              error: 'No tabId found for switch_tab. Ensure tabId is in params or agentId is in target.',
            };
          }
          // FURO 7b, a METADE QUE SOBROU (medida em 06/09/2026, 6 de 6 das
          // tentativas que pegaram a corrida): a ordem era `switchActiveTab`
          // ANTES de `chrome.tabs.update`. O workspace e o REGISTRO de onde o
          // agente esta; escrever nele antes de o Chrome confirmar transforma o
          // registro numa PROMESSA — e quando `chrome.tabs.update` lancava (a
          // aba alvo morreu na janela de corrida entre o freio e o motor),
          // `ws.activeTabId` ficava apontando para uma aba morta enquanto o
          // agente continuava, de fato, na aba do usuario.
          //
          // O estrago nao aparecia nesta linha, e sim no comando SEGUINTE:
          // `resolveWorkspace` (bridge/index.ts) via a aba morta, apagava o
          // `somenteLeitura` do cliente e entregava um workspace novo em modo
          // acao. Ou seja, a protecao caia pela porta dos fundos mesmo depois
          // do conserto que fez o `somenteLeitura.delete` esperar por
          // `result.success`. MEDIDO: `browser_javascript` com efeito, que
          // devia voltar "[somente leitura]", voltava "[aba trocou]" e o
          // agente saia do modo leitura sem nunca ter trocado de aba.
          //
          // Agora o Chrome confirma primeiro. Se ele recusar, o `throw` sobe
          // pelo catch do `run` (`{success:false}`), o registro fica como
          // estava, e o freio continua de pe onde o agente continua.
          await chrome.tabs.update(switchTabId, { active: true });
          workspaceManager.switchActiveTab(ws.workspaceId, switchTabId);
          return { success: true };
        }

        case 'close_tab': {
          const closeTabId = resolverAlvoDeCloseTab(action, tabId);
          await chrome.tabs.remove(closeTabId);
          return { success: true };
        }

        case 'wait_for': {
          const ms = (action.params?.ms as number | undefined) ?? 1000;
          await new Promise((resolve) => setTimeout(resolve, ms));
          return { success: true };
        }

        case 'wait_for_text': {
          // Polls until specific text appears or disappears from the page.
          // params: { text: "Stop", present: false } → waits until "Stop" is gone
          //         { text: "Run",  present: true  } → waits until "Run" appears
          // case_sensitive: true → exact case match (use when "Stop" would match "stop sequence")
          const searchText = (action.params?.text as string | undefined) ?? '';
          const present = (action.params?.present as boolean | undefined) ?? true;
          const timeoutMs = (action.params?.timeout_ms as number | undefined) ?? 300_000;
          const intervalMs = (action.params?.interval_ms as number | undefined) ?? 1500;
          const caseSensitive = (action.params?.case_sensitive as boolean | undefined) ?? false;
          // `incluir_oculto` (opcional, padrao false): sem ele a leitura e a de
          // sempre (`innerText`, so o renderizado). Com true, `textContent` —
          // acha texto em `display:none`. Ver `sondaDeTexto` no topo do arquivo.
          const incluirOculto = (action.params?.incluir_oculto as boolean | undefined) === true;

          if (!searchText) return { success: false, error: 'wait_for_text requires params.text' };

          const checkText = async (): Promise<boolean> =>
            (await lerTextoDaPagina(tabId, searchText, { caseSensitive, incluirOculto })).achou;

          // ── Race-condition fix ─────────────────────────────────────────────
          // When waiting for text to DISAPPEAR (present:false) and it is not yet
          // on the page, the old code returned immediately — treating "not here yet"
          // as "already gone". Fix: first wait up to appear_first_ms for the text
          // to appear, then wait for it to disappear. This handles the common
          // pattern of waiting for "Stop" to disappear after sending a message —
          // "Stop" only shows up ~1-2s after sending, so we must wait for it first.
          if (!present) {
            const appearTimeoutMs = (action.params?.appear_first_ms as number | undefined) ?? 8000;
            const appearDeadline = Date.now() + appearTimeoutMs;
            while (Date.now() < appearDeadline) {
              if (await checkText()) break; // text appeared — proceed to disappear wait
              await new Promise((r) => setTimeout(r, intervalMs));
            }
            // Whether or not it appeared, fall through to the main disappear loop below.
            // If it never appeared, the disappear loop will return immediately (correct —
            // model may have finished before we could observe "Stop").
          }

          // O indicador visual NAO e mantido aqui. Quem cuida do ciclo de vida
          // dele e a ponte (bridge/index.ts), que mostra ao receber comando e
          // apaga quando o agente para. Mandar SHOW daqui dentro criava o texto
          // "Agente rodando" na propria pagina que este laco estava lendo — e
          // um `wait_for_text {text:"Agente rodando", present:false}` nunca
          // terminava, porque a leitura fabricava o que esperava ver sumir.
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const found = await checkText();
            if (found === present) {
              return {
                success: true,
                data: { found, text: searchText, ...(incluirOculto ? { incluir_oculto: true } : {}) },
              };
            }
            await new Promise((r) => setTimeout(r, intervalMs));
          }
          return { success: true, data: { timedOut: true, text: searchText } };
        }

        case 'wait_for_change': {
          // Polls the page until DOM text content grows by at least minChange chars,
          // then waits for it to stop growing (stable) before returning.
          const timeoutMs = (action.params?.timeout_ms as number | undefined) ?? 30000;
          const intervalMs = (action.params?.interval_ms as number | undefined) ?? 1000;
          const minChange = (action.params?.min_change as number | undefined) ?? 50;
          const stableMs = (action.params?.stable_ms as number | undefined) ?? 1500;

          // from_length: optional known baseline from before the triggering action.
          // If provided and the page ALREADY grew past it, return immediately — avoids
          // double-waiting when the response arrived during the previous plan cycle.
          const fromLength = action.params?.from_length as number | undefined;

          // Capture live baseline (used for delta tracking)
          const [baselineRes] = await safeExecuteScript({
            target: { tabId },
            func: () => document.body.innerText.length,
          });
          const liveBase = (baselineRes?.result as number) ?? 0;

          // The effective baseline is the EARLIER of fromLength and liveBase.
          // This means if the page already grew (fromLength < liveBase), and that
          // growth is >= minChange, we return immediately.
          const baseLength = fromLength !== undefined ? Math.min(fromLength, liveBase) : liveBase;

          // If page content already exceeds baseline by minChange → already changed, return now
          if (liveBase - baseLength >= minChange) {
            return { success: true, data: { contentChanged: true, addedChars: liveBase - baseLength, immediate: true } };
          }

          const deadline = Date.now() + timeoutMs;
          let lastGrowthAt = 0;
          let lastLength = baseLength;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, intervalMs));

            const [cur] = await safeExecuteScript({
              target: { tabId },
              func: () => document.body.innerText.length,
            });
            const curLength = (cur?.result as number) ?? 0;

            if (curLength > lastLength + 20) {
              lastLength = curLength;
              lastGrowthAt = Date.now();
            }

            // Content changed enough AND has been stable for stableMs
            if (
              lastLength - baseLength >= minChange &&
              lastGrowthAt > 0 &&
              Date.now() - lastGrowthAt >= stableMs
            ) {
              return { success: true, data: { contentChanged: true, addedChars: lastLength - baseLength } };
            }
          }

          // Timed out — still return success so the agent can continue
          return { success: true, data: { contentChanged: lastLength > baseLength, timedOut: true } };
        }

        case 'get_console_logs': {
          const maxLogs = (action.params?.max as number | undefined) ?? 50;
          const [res] = await safeExecuteScript({
            target: { tabId },
            func: (max: number) => {
              const logs = (window as any).__agentConsoleLogs ?? [];
              return logs.slice(-max);
            },
            args: [maxLogs],
          });
          return { success: true, data: res?.result ?? [] };
        }

        case 'extract': {
          const selector = action.params?.selector as string | undefined;
          // from_length: if provided, return text starting at that character offset
          // (useful for reading new content that appeared since last read).
          // Default: return the LAST 5000 chars (tail) — best for chat pages where
          // the relevant content is always at the bottom.
          const fromLength = (action.params?.from_length as number | undefined) ?? 0;
          const maxChars = (action.params?.max_chars as number | undefined) ?? 5000;
          const [extracted] = await safeExecuteScript({
            target: { tabId },
            func: (sel: string, from: number, max: number) => {
              if (sel) {
                const els = Array.from(document.querySelectorAll(sel));
                return els.map((el) => (el as HTMLElement).innerText).join('\n').slice(0, max);
              }
              const full = document.body.innerText;
              // from >= 0 le a partir dali (0 = comeco, o padrao). Antes a condicao
              // era `from > 0`, entao o padrao caia na CAUDA: um subagente leu a
              // ultima sumula de uma lista do STF achando que era a primeira.
              // Cauda so quando pedida explicitamente, com from negativo.
              if (from >= 0 && from < full.length) {
                return full.slice(from, from + max);
              }
              return full.slice(-max);
            },
            args: [selector ?? '', fromLength, maxChars],
          });
          return { success: true, data: extracted?.result };
        }

        case 'drag': {
          // Drag from one set of coordinates to another.
          // Supports two modes:
          //   1. Explicit coords: params.fromX, fromY, toX, toY
          //   2. Target-based: "from" element resolved via action.target → coords,
          //      "to" coords from params.toX, toY  (or params.toAgentId resolved via CDP)
          const steps = (action.params?.steps as number | undefined) ?? 10;

          let fromX: number | undefined = action.params?.fromX as number | undefined;
          let fromY: number | undefined = action.params?.fromY as number | undefined;
          let toX: number | undefined = action.params?.toX as number | undefined;
          let toY: number | undefined = action.params?.toY as number | undefined;

          // O ramo "resolve o from por target" saiu (obra 25). Ele era uma mina:
          // com `strategy:'agent-id'` o motor chamava `cdpClickByRef` — um
          // CLIQUE REAL, sem freio nenhum — e SÓ DEPOIS chamava `resolveTarget`,
          // que no modo agent-id procura `[data-agent-id]`, atributo que a
          // ax-tree nunca escreve; então a ação terminava em "could not resolve
          // source coordinates" DEPOIS de já ter clicado. Inalcançável pela
          // ponte (`browser_drag` exige fromX/fromY), mas armado para quem
          // adicionasse `ref` à tool. Agora falha antes de tocar na página.
          if (fromX === undefined || fromY === undefined) {
            return {
              success: false,
              error: 'drag: informe fromX/fromY (arrasto por ref nao e suportado).',
            };
          }
          if (toX === undefined || toY === undefined) {
            return { success: false, error: 'drag: missing toX/toY params' };
          }

          await cdpDrag(tabId, fromX, fromY, toX, toY, steps);
          return { success: true };
        }

        case 'copy_to_clipboard': {
          // Three modes:
          // 1. params.text → copy this literal text
          // 2. params.selector → extract innerText from CSS selector, then copy
          // 3. action.target with agent-id → extract innerText from that node, then copy
          let textToCopy = action.params?.text as string | undefined;

          if (!textToCopy && action.params?.selector) {
            const sel = action.params.selector as string;
            const [res] = await safeExecuteScript({
              target: { tabId },
              func: (s: string) => {
                const el = document.querySelector(s);
                return el ? (el as HTMLElement).innerText : null;
              },
              args: [sel],
            });
            textToCopy = (res?.result as string | null) ?? undefined;
          }

          if (!textToCopy && action.target?.strategy === 'agent-id' && action.target.agentId !== undefined) {
            const refId = action.target.agentId;
            const [res] = await safeExecuteScript({
              target: { tabId },
              func: (id: number) => {
                const el = document.querySelector(`[data-agent-ref="${id}"]`);
                return el ? (el as HTMLElement).innerText : null;
              },
              args: [refId],
            });
            textToCopy = (res?.result as string | null) ?? undefined;
          }

          // Also support reading from memory bank
          if (!textToCopy && action.params?.key) {
            const memKey = action.params.key as string;
            const memBox = ws.memoryBox ?? {};
            textToCopy = memBox[memKey];
          }

          if (!textToCopy) {
            return { success: false, error: 'copy_to_clipboard: no text resolved. Provide params.text, params.selector, params.key (memory), or target with agent-id.' };
          }

          // Write to clipboard using CDP (more reliable than scripting API for clipboard)
          try {
            await safeExecuteScript({
              target: { tabId },
              func: async (txt: string) => {
                try {
                  await navigator.clipboard.writeText(txt);
                } catch {
                  // Fallback: execCommand
                  const ta = document.createElement('textarea');
                  ta.value = txt;
                  ta.style.position = 'fixed';
                  ta.style.left = '-9999px';
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand('copy');
                  document.body.removeChild(ta);
                }
              },
              args: [textToCopy],
            });
            return { success: true, data: { copiedLength: textToCopy.length, preview: textToCopy.slice(0, 100) } };
          } catch (err) {
            return { success: false, error: `copy_to_clipboard failed: ${String(err)}` };
          }
        }

        default:
          return { success: false, error: `Unknown action type: ${(action as PlannedAction).type}` };
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

export const executionEngine = new ExecutionEngine();
