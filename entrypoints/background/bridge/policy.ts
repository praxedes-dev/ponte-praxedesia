import type { AgentWorkspace, ActionTarget } from '../../../shared/types';
import {
  resolverAlvoDaAcao,
  type AlvoResolvido,
  type DescritorDeElemento,
  type Resolucao,
} from '../execution-engine';
import { normaliseKey, teclaImprimivel, MODIFICADOR_DE_COMANDO } from '../execution-engine/cdp-tools';

/**
 * Freio da ponte.
 *
 * O PolicyEngine da extensao nao serve aqui por dois motivos: ele so reconhece
 * clique destrutivo quando o alvo tem TEXTO, e pela ponte o agente clica por
 * `ref`; e o bloqueio de dominio e `url.includes('bank')`, que pega "databank" e
 * deixa passar "bb.com.br".
 *
 * Aqui a decisao e por hostname de verdade e pelo elemento real, lido do DOM
 * antes da acao. Quando algo exige confirmacao, a ponte devolve ERRO ao agente
 * com o motivo, e o agente repete com `confirm: true` depois de perguntar ao
 * usuario. Modal no side panel nao serve: ninguem esta olhando para ele.
 *
 * OBRA 25 (06/09/2026) — este arquivo NAO resolve mais alvo nenhum. Quem
 * resolve e `resolverAlvoDaAcao` (execution-engine/index.ts), UMA vez por
 * comando, e o mesmo objeto vai para o freio e para o motor. Antes daqui
 * saiam duas chamadas CDP proprias (`resolveTarget` + `document.elementFromPoint`)
 * que reabriam, a cada acao, a pergunta "qual elemento e este?" — e a resposta
 * podia nao ser a mesma que o motor obteria um instante depois. As regras
 * abaixo passaram a ser decisao PURA sobre `AlvoResolvido`: sao testaveis sem
 * Chrome e nao tem como olhar um elemento diferente do que vai ser tocado.
 */

export interface Veredito {
  permitido: boolean;
  /** true quando `confirm: true` resolve; false quando e proibido de todo jeito. */
  confirmavel?: boolean;
  motivo?: string;
}

const LIBERADO: Veredito = { permitido: true };

/** Bancos, meios de pagamento e corretoras. Casa por sufixo de hostname. */
const HOSTS_FINANCEIROS = [
  'bb.com.br', 'caixa.gov.br', 'bradesco.com.br', 'itau.com.br', 'santander.com.br',
  'nubank.com.br', 'bancointer.com.br', 'inter.co', 'c6bank.com.br', 'sicoob.com.br',
  'sicredi.com.br', 'safra.com.br', 'btgpactual.com', 'banconeon.com.br', 'original.com.br',
  'picpay.com', 'mercadopago.com.br', 'infinitepay.io', 'pagseguro.uol.com.br',
  'paypal.com', 'stripe.com', 'wise.com', 'binance.com', 'coinbase.com',
  'mercadobitcoin.com.br', 'foxbit.com.br',
];

const TEXTOS_DESTRUTIVOS = [
  'excluir', 'exclusao', 'deletar', 'delete', 'remover', 'remove', 'apagar',
  'cancelar assinatura', 'encerrar conta', 'desativar conta',
  'comprar', 'buy now', 'finalizar compra', 'pagar', 'transferir', 'enviar pix',
  'confirmar pagamento', 'assinar', 'protocolar', 'peticionar', 'enviar peticao',
];

/**
 * Acoes que despacham input e por isso podem causar efeito na pagina (regra 3).
 *
 * As `cap_*` estao aqui porque ate a obra 25 elas chegavam a `avaliar` fingindo
 * ser `click`/`type` (`cap_form_input` montava `{type:'type'}`) e por isso
 * ganhavam a regra 3 de carona. Agora cada uma chega com o proprio nome — para
 * a travessia do alvo ser a dela —, e sem esta lista a cobertura de site
 * financeiro que elas ja tinham teria sumido em silencio.
 */
const ACOES_DE_INPUT = new Set([
  'click', 'type', 'press_key', 'drag',
  'cap_click_xy', 'cap_form_input', 'cap_form_fill', 'cap_digitar', 'cap_autocomplete',
]);

/**
 * Acoes cujo motor ESCREVE TEXTO no elemento resolvido — as que a regra 1
 * (senha) julga, olhando `alvo.efetivo` (o no que de fato recebe o texto,
 * depois da travessia, e nao o que foi nomeado: furo 7-C).
 *
 * `press_key` entra por um caminho proprio (so quando a tecla insere texto).
 */
const ACOES_QUE_ESCREVEM_TEXTO = new Set([
  'type', 'cap_digitar', 'cap_form_input', 'cap_form_fill', 'cap_autocomplete',
]);

/**
 * Acoes cujo motor DESPACHA CLIQUE no elemento resolvido — as que a regra 4
 * (irreversivel) julga.
 *
 * `type` COM alvo entra aqui tambem, e esse e o furo 7-B: o `case 'type'` do
 * motor clica de verdade antes de digitar (`cdpClickByRef` no ramo por ref,
 * `cdpClick(ponto)` no semantico), e a regra 4 so rodava para
 * `action.type === 'click'` — bastava mandar o clique embrulhado num `type`
 * para o botao "Protocolar inicial" ser clicado sem ninguem olhar. MEDIDO ao
 * vivo em 06/09/2026 (test/cetico-setimo-furo.js, caso 7-B: `window.__cliques`
 * foi para 1).
 *
 * `drag` entra porque `cdpDrag` despacha mousePressed + mouseReleased com
 * clickCount 1 — com `from == to` isso e, literalmente, um clique (MEDIDO: o
 * mesmo botao que `browser_click` barrava, `browser_drag` clicava).
 */
const ACOES_QUE_CLICAM = new Set(['click', 'drag', 'cap_click_xy']);

/**
 * Teclas que ATIVAM o controle focado (viram clique) — ver regra 4.
 *
 * Nomes JA NORMALIZADOS por `normaliseKey` (cdp-tools.ts): a lista antiga
 * misturava os dois vocabularios ('enter', 'return', ' ', 'space', 'spacebar')
 * e por isso tinha de adivinhar cada alias que o modelo inventasse. Agora o
 * alias e resolvido pela MESMA funcao do motor e sobram os dois nomes reais.
 */
const TECLAS_QUE_ATIVAM = new Set(['Enter', ' ']);

function hostFinanceiro(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOSTS_FINANCEIROS.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Le a tecla EXATAMENTE como o motor le.
 *
 * Monta a combinacao do mesmo jeito que o `case 'press_key'` do motor monta
 * (`modifiers.join('+') + '+' + key`) e entrega a `normaliseKey`, de
 * `cdp-tools.ts` — a MESMA funcao que `cdpPressKey` usa para decidir o que
 * despachar. Uma definicao so.
 *
 * OBRA 26, o que isto fechou: aqui existia uma copia "deliberadamente mais
 * simples" (`partesDaTecla`), e as duas discordavam. MEDIDO: `{key:'space'}`
 * era `'space'` para o freio (5 caracteres, "nao insere texto") e `' '` para o
 * motor (1 caractere, insere). Com senha focada, `browser_press_key
 * {key:'space'}` escrevia no campo de senha sem a regra 1 rodar.
 */
function lerTecla(key: string, modifiersParam: string[] | undefined): { key: string; modifiers: number } {
  const combo = modifiersParam && modifiersParam.length > 0
    ? `${modifiersParam.join('+')}+${key}`
    : key;
  return normaliseKey(combo);
}

/**
 * Decide se `press_key` vai INSERIR TEXTO no elemento focado — pela MESMA
 * funcao que `cdpPressKey` usa (`teclaImprimivel`, cdp-tools.ts), sobre a
 * MESMA leitura da tecla. Exportada para o teste poder confrontar,
 * alias por alias, o que o freio acha com o que o motor faz.
 */
export function pressKeyEscreveTexto(key: string, modifiersParam: string[] | undefined): boolean {
  const t = lerTecla(key, modifiersParam);
  return teclaImprimivel(t.key, t.modifiers);
}

/**
 * Decide se `press_key` vai ATIVAR o controle focado — Enter/Espaco sobre um
 * botao, link ou input de acao e um CLIQUE, mesmo sem mouse nenhum.
 *
 * ACHADO MEDIDO (06/09/2026): com `<button>Excluir conta</button>` focado,
 * `browser_press_key({key:'space'})` levou o contador do onclick de 0 para 1 —
 * e a regra 4 nao cobria `press_key`, que so passava pela regra 1 (senha). O
 * foco se consegue sem clique nenhum (`press_key Tab` nao passa por freio).
 *
 * So vale para controle de ACAO: Enter num `<input type=text>` (o caso comum
 * de submeter formulario do PJe digitando) nao entra aqui, senao a regra
 * viraria falso positivo em todo formulario.
 */
function pressKeyAtiva(key: string, modifiersParam: string[] | undefined, d: DescritorDeElemento): boolean {
  const t = lerTecla(key, modifiersParam);
  if ((t.modifiers & MODIFICADOR_DE_COMANDO) !== 0) return false;
  if (!TECLAS_QUE_ATIVAM.has(t.key)) return false;
  return d.tag === 'button' || d.tag === 'a' || d.role === 'button'
    || ['submit', 'button', 'image', 'reset'].includes(d.tipo);
}

/**
 * Regra 4, decisao pura: o elemento diz alguma coisa irreversivel?
 *
 * Casa a palavra destrutiva contra texto visivel E aria-label — os dois sao "o
 * que o elemento diz", e a busca semantica pode ter achado o alvo por qualquer
 * um dos dois (FURO 4: um botao com innerText "Opcoes avancadas" e aria-label
 * "Excluir conta definitivamente" escapava quando so `texto` era julgado).
 *
 * Aba de conferencia do PJe (ex.: "PROTOCOLAR INICIAL") nao e a acao
 * "protocolar" so por casar o texto; quem prova o contrario e o DOM (`ehAba`),
 * nunca a posicao na tela ou a cor.
 */
function cliqueEhIrreversivel(d: DescritorDeElemento): { gatilho: string; textoExibido: string } | null {
  const candidatos = [d.texto, d.ariaLabel].filter((c): c is string => Boolean(c && c.trim()));
  const gatilho = candidatos.reduce<string | undefined>(
    (achado, c) => achado ?? TEXTOS_DESTRUTIVOS.find((t) => c.toLowerCase().includes(t)),
    undefined,
  );
  if (!gatilho || d.ehAba) return null;
  return { gatilho, textoExibido: (d.texto || d.ariaLabel || '').trim().slice(0, 80) };
}

/** A forma minima que `avaliar` le. `PlannedAction` cabe aqui, e as
 * capacidades `cap_*` montam a acao delas com o proprio nome. */
export interface AcaoAvaliavel {
  type: string;
  target?: ActionTarget;
  params?: Record<string, unknown>;
}

/** Esta acao precisa de um alvo resolvido para ser julgada? */
function precisaDeAlvo(tipo: string): boolean {
  return ACOES_QUE_ESCREVEM_TEXTO.has(tipo) || ACOES_QUE_CLICAM.has(tipo) || tipo === 'press_key';
}

/**
 * Traduz um "nao consegui resolver" em veredito.
 *
 * A regra e falhar FECHADO — foi o `undefined !== 'password'` que criou o furo
 * 7-A, e e o `if (el)` sem `else` que deixava a regra 4 liberar no escuro
 * (ACHADO do cetico, medido com botao abaixo da dobra respondendo `ok`).
 *
 * As DUAS excecoes sao os casos em que o motor vai falhar pelo MESMO motivo,
 * pela MESMA identidade, um instante depois — barrar ali nao protege ninguem e
 * troca a mensagem util do motor ("releia a pagina com browser_read_page") por
 * um "[bloqueado]" que nao diz o que fazer:
 *
 * - `no-inexistente`: o `ref` sumiu. O motor chama `cdpClickByRefOrThrow` com
 *   o MESMO backendNodeId e lanca o erro que explica o que aconteceu.
 * - `sem-alvo`: a acao nao nomeia alvo nenhum (`drag` sem fromX/fromY, `click`
 *   sem target). O motor devolve o erro dele sem tocar na pagina.
 */
function vereditoDeResolucaoFalha(acao: string, r: Extract<Resolucao, { ok: false }>): Veredito {
  if (r.causa === 'no-inexistente' || r.causa === 'sem-alvo') return LIBERADO;
  return {
    permitido: false,
    // `confirm: true` nao resolve: o problema nao e permissao, e nao saber em
    // que elemento a acao vai cair. Dizer "confirmavel" aqui mandaria o agente
    // repetir a acao as cegas com confirmacao — que e justamente o que nao pode.
    confirmavel: false,
    motivo: `${acao}: nao consegui identificar com seguranca o elemento que esta acao vai tocar `
      + `(${r.motivo}). Releia a pagina com browser_read_page, role ate o elemento ficar visivel `
      + 'e repita com uma ref atual.',
  };
}

/**
 * @param alvo Alvo JA resolvido por `resolverAlvoDaAcao`. A ponte
 * (`bridge/index.ts`) resolve uma vez e passa o mesmo objeto para ca e para o
 * motor. As capacidades `cap_*` que chamam `avaliar` direto resolvem elas
 * mesmas (com a travessia da propria acao) e passam aqui — nunca deixam o
 * freio resolver "por fora" um alvo diferente do que elas vao usar.
 */
export async function avaliar(
  action: AcaoAvaliavel,
  ws: AgentWorkspace,
  confirmado: boolean,
  alvo?: AlvoResolvido,
): Promise<Veredito> {
  const tabId = ws.activeTabId;
  // A URL tem de vir da aba, nao do workspace: `ws.tabs[].url` guarda o endereco
  // de quando a aba foi observada, entao continua "about:blank" depois de navegar
  // e o freio deixaria passar clique dentro de site financeiro.
  const urlAtual = await chrome.tabs.get(tabId).then((t) => t.url).catch(() => ws.tabs[tabId]?.url);

  // ── 0. O alvo, uma vez so ──────────────────────────────────────────────
  let alvoResolvido: AlvoResolvido | undefined = alvo;
  if (!alvoResolvido && precisaDeAlvo(action.type)) {
    const r = await resolverAlvoDaAcao(action, tabId);
    if (!r.ok) {
      const v = vereditoDeResolucaoFalha(action.type, r);
      if (!v.permitido) return v;
    } else {
      alvoResolvido = r.alvo;
    }
  }

  // ── 0.1. O CLIQUE que esta acao despacha, e o que ele diz ──────────────
  //
  // Decisao PURA sobre o descritor, calculada antes da regra 1 de proposito: o
  // clique acontece ANTES da escrita, e quando as duas regras batem na mesma
  // acao a mensagem tem de contar as duas. Sem isto, um `type` num botao
  // "Protocolar inicial" com um campo de senha focado atras respondia so
  // "campo de senha" — verdade, mas escondia do agente que aquilo ali tambem
  // ia clicar um botao irreversivel.
  const clicaDeAcao = Boolean(alvoResolvido) && (
    ACOES_QUE_CLICAM.has(action.type)
    // FURO 7-B: `type` com alvo clica de verdade antes de digitar. So conta
    // quando o alvo NAO e um campo digitavel: clicar num `<input type=text>`
    // para focar nao dispara acao nenhuma, e julgar o texto dele daria falso
    // positivo bobo (um campo de busca com "pagar" digitado dentro barraria a
    // digitacao seguinte). Ja `<input type=submit value="Pagar">` casa
    // `input` mas NAO e campo digitavel — e botao, e continua sob a regra 4.
    //
    // OBRA 26: a pergunta vem pronta da resolucao (`cliqueApenasFoca`), e nao
    // mais de `efetivoEhCampoDigitavel(efetivo)`. Depois que o `efetivo`
    // passou a poder ser o elemento FOCADO, aquela conta respondia sobre o
    // RECEPTOR e nao sobre o que vai ser clicado: com um campo de texto
    // focado, `type` num botao "Pagar" voltaria a passar.
    || (action.type === 'type' && alvoResolvido!.como !== 'foco'
      && !alvoResolvido!.cliqueApenasFoca)
    || (action.type === 'press_key' && pressKeyAtiva(
      (action.params?.key as string | undefined) ?? '',
      action.params?.modifiers as string[] | undefined,
      alvoResolvido!.descritor,
    ))
  );
  const achadoDoClique = clicaDeAcao ? cliqueEhIrreversivel(alvoResolvido!.descritor) : null;

  // 1. Digitar em campo de senha nao passa nem com confirmacao. O elemento
  // examinado e `alvo.efetivo`: o no que de fato RECEBE o texto, com a
  // travessia do motor daquela acao ja aplicada.
  //
  // FURO 3 (fechado antes desta obra): a versao antiga so examinava quando
  // `action.target?.agentId !== undefined`. Um `type` puramente semantico
  // nunca caia no `if` — nao "escolhia o elemento errado", simplesmente NUNCA
  // ERA EXAMINADO.
  //
  // FURO 6 (fechado antes desta obra): `type` SEM target pulava a regra
  // inteira, e o motor digita direto no `document.activeElement`.
  //
  // FURO 7-A (fechado AQUI): alvo semantico que NAO resolve fazia a versao
  // antiga devolver `undefined`, e `undefined !== 'password'` LIBERAVA —
  // enquanto o motor, no mesmo caso, nao clicava em nada e caia no
  // `document.activeElement`. Agora quem resolve devolve `como: 'foco'` nesse
  // caso (espelhando o motor), e o campo focado E examinado.
  //
  // FURO 7-C (fechado AQUI): ref de wrapper (`<label>`, `<div role=textbox>`).
  // O freio SUBIA ate o ancestral clicavel e via "label"; o `cdpType` DESCIA
  // por `findRealInput` e escrevia no `<input type=password>` de dentro.
  // `efetivo` faz a mesma descida, uma vez so, antes de julgar.
  //
  // A1 (fechado na obra 26): quando a travessia NAO acha campo nenhum — o
  // `<span>` do select2, um `<div>` qualquer —, o motor nao escreve no no
  // nomeado: cai em quem esta com FOCO. O `efetivo` agora ja vem desviado para
  // esse elemento (`escritaCaiuNoFoco`), entao a linha abaixo continua a mesma
  // e passou a examinar o campo que de fato recebe. MEDIDO antes do conserto:
  // com `<input type=password>` focado e `type` no span, a senha recebia o
  // texto e o freio nunca a viu.
  if (alvoResolvido && ACOES_QUE_ESCREVEM_TEXTO.has(action.type)) {
    if (alvoResolvido.efetivo.tipo === 'password') return vetoDeSenha(achadoDoClique);
  } else if (action.type === 'press_key') {
    const key = action.params?.key as string | undefined;
    const modifiers = action.params?.modifiers as string[] | undefined;
    if (key && alvoResolvido && pressKeyEscreveTexto(key, modifiers)
      && alvoResolvido.efetivo.tipo === 'password') {
      return vetoDeSenha(achadoDoClique);
    }
  }

  // 2. Navegar para banco ou meio de pagamento exige confirmacao explicita.
  if (action.type === 'navigate') {
    const destino = hostFinanceiro(action.params?.url as string | undefined);
    if (destino && !confirmado) {
      return {
        permitido: false,
        confirmavel: true,
        motivo: `${destino} e banco ou meio de pagamento. Confirme com o usuario e repita com confirm: true.`,
      };
    }
  }

  // 3. Qualquer input dentro de site financeiro exige confirmacao a cada acao.
  if (ACOES_DE_INPUT.has(action.type)) {
    const aqui = hostFinanceiro(urlAtual);
    if (aqui && !confirmado) {
      return {
        permitido: false,
        confirmavel: true,
        motivo: `acao dentro de ${aqui}, que e banco ou meio de pagamento. `
          + `Confirme com o usuario e repita com confirm: true.`,
      };
    }
  }

  // 4. Clique em algo destrutivo. O elemento examinado e o MESMO que o motor
  // vai clicar — nao a string de busca (FURO 4), nao um `agentId` que o motor
  // ignoraria (FURO 2), e nao um segundo `resolveTarget` num instante
  // diferente (obra 25).
  if (!confirmado && achadoDoClique && alvoResolvido) {
    const d = alvoResolvido.descritor;
    const diagnostico = ` (tag=${d.tag}${d.role ? `, role=${d.role}` : ''}${d.temOnclick ? ', onclick=sim' : ''})`;
    const comoChegou = action.type === 'click' ? '' : ` [${action.type} despacha clique]`;
    return {
      permitido: false,
      confirmavel: true,
      motivo: `o elemento diz "${achadoDoClique.textoExibido}"${diagnostico} e parece irreversivel `
        + `(casou com "${achadoDoClique.gatilho}")${comoChegou}. Confirme com o usuario e repita com confirm: true.`,
    };
  }

  return LIBERADO;
}

/**
 * Veto de credencial. Quando a MESMA acao tambem despacha um clique
 * irreversivel, a mensagem conta as duas coisas: o veto continua nao sendo
 * confirmavel, mas o agente fica sabendo que aquilo ali ia clicar um botao de
 * "Protocolar inicial" — antes essa metade sumia porque a regra 1 respondia
 * primeiro e encerrava.
 */
function vetoDeSenha(achadoDoClique: { gatilho: string; textoExibido: string } | null = null): Veredito {
  return {
    permitido: false,
    confirmavel: false,
    motivo: 'campo de senha: a ponte nao preenche credencial. Peca ao usuario para digitar.'
      + (achadoDoClique
        ? ` (e esta acao ainda despacharia um clique em "${achadoDoClique.textoExibido}", que parece `
          + `irreversivel — casou com "${achadoDoClique.gatilho}")`
        : ''),
  };
}
