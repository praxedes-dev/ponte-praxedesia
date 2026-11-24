import { debuggerManager as dm } from '../../debugger-manager';
import { cdpClick } from '../../execution-engine/cdp-tools';
import { esperarCondicao } from '../../execution-engine/espera-condicao';
import { observarRede } from '../../execution-engine/rede-observada';
import { resolverAlvoDaAcao } from '../../execution-engine';
import { avaliar } from '../policy';
import { executarJs } from './js';
import { digitarTeclaATecla, lerValorDoElemento } from './formulario';
import type { ContextoCapacidade, ModuloCapacidades } from './registro';

/**
 * `browser_autocomplete`: digita de verdade, espera a lista de sugestoes do
 * RichFaces (ou qualquer outro widget de suggest) aparecer, acha a sugestao
 * pelo texto e clica nela com mouse real — tirando da skill `protocolo-pje-ponte`
 * a gambiarra de ler o `<script>` inline do componente e remontar o
 * `A4J.AJAX.Submit` na mao (o `similarityGroupingId`/`containerId` muda a cada
 * abertura do modal). Ver docs/obra-20260904/06-autocomplete-richfaces.md.
 *
 * Por que o campo existe assim: o `onchange` do suggest do PJe e
 * `if (this.value != '') return false; A4J.AJAX.Submit(...)` — valor colado
 * nunca dispara o ciclo. `digitarTeclaATecla` (formulario.ts) resolve a
 * digitacao (keyDown/keyUp de verdade, isTrusted); aqui falta so achar a
 * sugestao e clicar nela tambem com mouse de verdade (`cdpClick`), porque a
 * linha e criada na hora e por isso nunca tem `ref` na arvore de
 * acessibilidade (achado do pedreiro da obra 02, plano §18: `ax-tree.ts` nao
 * lista `cell`/`listitem` como interativos).
 */

const SELETORES_PADRAO = [
  '[id$=":suggest"] tr',
  '.rich-sb-int',
  '[role="option"]',
  '[role="listbox"] li',
  '.ui-autocomplete li',
  '.select2-results__option',
  '.tt-suggestion',
  '.autocomplete-suggestion',
].join(', ');

interface Candidato {
  texto: string;
  x: number;
  y: number;
}

/** minusculas, sem acento, espacos colapsados — mesma regra dos dois lados (aqui e na pagina). */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Le, no contexto da pagina (via `executarJs`/`Runtime.evaluate`, o mesmo
 * caminho de `cap_js`), as sugestoes visiveis agora. Sem `seletor_sugestoes`
 * explicito tenta a lista padrao de widgets conhecidos e, so se ela nao achar
 * nada, cai no ultimo recurso: qualquer elemento-folha cujo texto normalizado
 * contenha o `escolher` normalizado (§ "o que construir" do briefing, item 2).
 *
 * Sem `replMode` de proposito (armadilha conhecida da casa): ligado, ele
 * quebra a serializacao e o array voltaria como `{}`.
 */
async function listarCandidatosVisiveis(
  tabId: number,
  seletorSugestoes: string | undefined,
  escolher: string,
): Promise<Candidato[]> {
  const expressao = `(function () {
    function normalizar(s) {
      return String(s).normalize('NFD').replace(/\\p{Diacritic}/gu, '').toLowerCase().replace(/\\s+/g, ' ').trim();
    }
    function visivel(el) {
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var cs = window.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      return true;
    }
    var seletor = ${JSON.stringify(seletorSugestoes ?? null)};
    var padrao = ${JSON.stringify(SELETORES_PADRAO)};
    var escolherNorm = normalizar(${JSON.stringify(escolher)});
    var lista = [];
    if (seletor) {
      lista = Array.prototype.slice.call(document.querySelectorAll(seletor));
    } else {
      lista = Array.prototype.slice.call(document.querySelectorAll(padrao));
      if (lista.length === 0 && escolherNorm) {
        var todos = document.querySelectorAll('body *');
        for (var i = 0; i < todos.length; i++) {
          var el = todos[i];
          if (el.children.length > 0) continue; // so folha
          if (el.closest && el.closest('input,textarea,select')) continue;
          var t = (el.textContent || '').trim();
          if (!t || normalizar(t).indexOf(escolherNorm) === -1) continue;
          lista.push(el);
        }
      }
    }
    var candidatos = [];
    for (var j = 0; j < lista.length; j++) {
      var el = lista[j];
      if (!visivel(el)) continue;
      var texto = (el.textContent || el.innerText || '').trim();
      if (!texto) continue;
      var r = el.getBoundingClientRect();
      candidatos.push({ texto: texto, x: r.x + r.width / 2, y: r.y + r.height / 2 });
      if (candidatos.length >= 30) break;
    }
    return candidatos;
  })()`;

  const res = await executarJs(tabId, expressao);
  return Array.isArray(res) ? (res as Candidato[]) : [];
}

/** Igualdade normalizada > comeca com > contem. Empate (mesmo nivel) vence o primeiro. */
function escolherMelhorCandidato(candidatos: Candidato[], escolher: string): Candidato | undefined {
  const alvo = normalizar(escolher);
  if (!alvo) return undefined;
  return candidatos.find((c) => normalizar(c.texto) === alvo)
    ?? candidatos.find((c) => normalizar(c.texto).startsWith(alvo))
    ?? candidatos.find((c) => normalizar(c.texto).includes(alvo));
}

/**
 * Apaga o campo antes de digitar.
 *
 * O briefing sugeria `Ctrl+A` + `Backspace` via `cdpPressKey` (o mesmo caminho
 * de `browser_press_key`). MEDIDO (05/09/2026, contra https://example.com,
 * fora do widget falso — achado independente dele): nao funciona num `<input>`
 * de verdade. `Input.dispatchKeyEvent` para "Ctrl+A" **insere o caractere
 * "a"** (o campo virou "LIXOa", nao "LIXO" selecionado) — o modificador nao
 * vira o comando de edicao "selecionar tudo" sem o `windowsVirtualKeyCode`
 * que o dispatch nao manda, e o `text: 'a'` insere o caractere de qualquer
 * jeito. "Backspace" nao apagou nada: sem acao padrao nativa, so o
 * `KeyboardEvent` (que a pagina pode escutar, mas o campo nao apaga sozinho).
 * `cdpPressKey`/`cdp-tools.ts` estao fora do escopo desta obra (arquivo que
 * nao posso tocar) — o consto aqui e local: apagar direto no DOM, sem
 * `Input.dispatchKeyEvent`, e sem disparar `input`/`change` de proposito (so
 * a digitacao de VERDADE que vem a seguir deve acordar o `onchange` do
 * RichFaces; disparar `change` com o campo vazio arriscaria chamar o
 * `A4J.AJAX.Submit` cedo demais, com o campo ainda sem o texto pretendido).
 */
async function limparCampo(tabId: number, backendNodeId: number): Promise<void> {
  const resolvido = await dm.send<{ object: { objectId: string } }>(
    tabId, 'DOM.resolveNode', { backendNodeId },
  );
  const objectId = resolvido?.object?.objectId;
  if (!objectId) return;
  await dm.send(tabId, 'Runtime.callFunctionOn', {
    objectId,
    returnByValue: true,
    functionDeclaration: `function () { this.value = ''; }`,
  });
}

async function executarAutocomplete(ctx: ContextoCapacidade): Promise<unknown> {
  const { tabId, ref, ws, confirm } = ctx;
  const p = ctx.params;
  if (ref === undefined) throw new Error('[autocomplete] informe a ref do campo (backendNodeId)');

  const texto = String(p.texto ?? '');
  const escolher = String(p.escolher ?? p.texto ?? '');
  const timeoutMs = Number(p.timeout_ms ?? 8000);
  const seletorSugestoes: string | undefined = p.seletor_sugestoes;

  // FURO 8 (medido ao vivo em 06/09/2026, irmao exato do furo 5): esta
  // capacidade DIGITAVA antes de qualquer `avaliar()` -- o freio dela so cobria
  // o clique na sugestao, la embaixo. Resultado medido: digitou uma senha
  // inteira num `<input type=password>` e so entao falhou por nao achar
  // sugestao. O freio tem de rodar ANTES de a primeira tecla sair, como em
  // `cap_digitar`.
  const acaoDigitar = { type: 'cap_autocomplete', target: { strategy: 'agent-id' as const, agentId: ref } };
  const alvo = await resolverAlvoDaAcao(acaoDigitar, tabId);
  if (!alvo.ok) {
    throw new Error(
      `[autocomplete] nao consegui identificar com seguranca o campo (${alvo.motivo}). `
      + 'Releia a pagina com browser_read_page e repita com uma ref atual.',
    );
  }
  const vereditoDigitar = await avaliar(acaoDigitar, ws, confirm, alvo.alvo);
  if (!vereditoDigitar.permitido) throw new Error(`[bloqueado] ${vereditoDigitar.motivo}`);

  // Limpa e digita no no EFETIVO -- o mesmo que o freio acabou de julgar.
  //
  // OBRA 26: `efetivo` passou a ser, de verdade, quem RECEBE as teclas. Quando
  // a ref nao aponta para um campo que aceita texto, ele ja vem desviado para o
  // elemento FOCADO — porque e la que `Input.dispatchKeyEvent` cai — e e esse
  // que o `avaliar()` acima examinou. Antes o freio julgava a ref e as teclas
  // iam para outro lugar.
  const campo = alvo.alvo.efetivo.backendNodeId;
  if (p.limpar === true) await limparCampo(tabId, campo);

  const { digitado } = await digitarTeclaATecla(tabId, campo, texto, p.delay_ms);

  // Junta o que ja viu em cada rodada de polling, sem duplicar — e o que
  // permite o agente se corrigir sem tentativa e erro quando ninguem bate.
  const vistos: string[] = [];
  const marcarVistos = (cands: Candidato[]) => {
    for (const c of cands) if (!vistos.includes(c.texto)) vistos.push(c.texto);
  };

  const prazo = Date.now() + timeoutMs;
  let escolhida: Candidato | undefined;
  do {
    const candidatos = await listarCandidatosVisiveis(tabId, seletorSugestoes, escolher);
    marcarVistos(candidatos);
    escolhida = escolherMelhorCandidato(candidatos, escolher);
    if (escolhida) break;
    await new Promise((r) => setTimeout(r, 60)); // V1: era 250 ms entre leituras da lista
  } while (Date.now() < prazo);

  if (!escolhida) {
    const segundos = (timeoutMs / 1000).toFixed(1).replace(/\.0$/, '');
    const listaVista = vistos.length > 0 ? vistos.slice(0, 10).join(' | ') : '(nenhuma sugestao apareceu)';
    throw new Error(
      `[autocomplete] digitei "${texto}" e nenhuma sugestao com "${escolher}" apareceu em ${segundos}s. `
      + `Vi: ${listaVista}. Confira o texto ou passe seletor_sugestoes.`,
    );
  }

  // Freio como em cap_click_xy (dispatch de bridge/index.ts NAO chama avaliar()
  // para acoes cap_* — cada capacidade que clica tem de fazer isso sozinha):
  // descobre o no real naquele ponto e avalia como se fosse clique por ref,
  // ANTES do clique de verdade.
  //
  // `DOM.getNodeForLocation` exige x/y INTEIROS (int32 — devtools-protocol,
  // GetNodeForLocationRequest). `escolhida.x/y` vem de
  // `getBoundingClientRect().x + width/2`, quase sempre fracionario. Sem
  // arredondar, o CDP respondia "Failed to deserialize params.x - BINDINGS:
  // int32 value expected" — e esse erro caia no antigo `.catch(() => null)`
  // de baixo: `no` virava `null`, `if (no?.backendNodeId)` nunca entrava, e o
  // freio NUNCA rodava, pra clique nenhum de autocomplete (destrutivo ou nao)
  // — achado do pedreiro, confirmado ao vivo com "Excluir conta" passando
  // direto. `cdpClick` (mais abaixo) ja aceitava fracionario de verdade —
  // o defeito era so aqui, na chamada que exige inteiro.
  // O clique na sugestao e um clique por COORDENADA, igualzinho ao de
  // `cap_click_xy` — e agora passa pelo MESMO resolvedor (obra 25), em vez de
  // ter aqui uma copia do hit-test. A copia ja custou um defeito: o CDP exige
  // x/y INTEIROS e o `escolhida.x` vem fracionario de `getBoundingClientRect`,
  // entao o erro de deserializacao caia num `catch` que zerava o `no` e o freio
  // NUNCA rodava, para clique nenhum de autocomplete.
  const acaoClique = { type: 'cap_click_xy', params: { x: escolhida.x, y: escolhida.y } };
  const alvoClique = await resolverAlvoDaAcao(acaoClique, tabId);
  let backendNodeId: number | undefined;
  if (alvoClique.ok) {
    backendNodeId = alvoClique.alvo.backendNodeId;
    const veredito = await avaliar(acaoClique, ws, confirm, alvoClique.alvo);
    if (!veredito.permitido) throw new Error(`[bloqueado] ${veredito.motivo}`);
  } else if (alvoClique.causa !== 'sem-no-no-ponto') {
    // Qualquer erro que NAO seja "nao ha no aqui" e o CDP recusando a chamada:
    // falha FECHADO, aborta antes de clicar em vez de clicar sem avaliar.
    throw new Error(
      `[autocomplete] freio nao conseguiu avaliar o clique em `
      + `(${Math.round(escolhida.x)}, ${Math.round(escolhida.y)}): ${alvoClique.motivo}`,
    );
  }

  // V1: era 300 ms parados depois do clique. Agora: o campo MUDOU do que foi digitado,
  // ficou igual em duas leituras seguidas (50 ms) E a selecao nao deixou pedido de
  // rede em voo (o `onselect` do RichFaces dispara AJAX que re-renderiza o campo;
  // com ele, espera terminar, ate 2,5 s). Sem pedido nenhum, teto de 300 ms como
  // antes. Se a selecao nao pegou, a leitura e o erro abaixo continuam iguais.
  const rede = observarRede(tabId);
  try {
    await cdpClick(tabId, escolhida.x, escolhida.y);
    let anteriorLido: string | null = null;
    const inicioEspera = Date.now();
    await esperarCondicao(async () => {
      const v = await lerValorDoElemento(tabId, campo);
      const pegou = !!v && v !== texto && v === anteriorLido;
      anteriorLido = v;
      if (!pegou) return false;
      return rede.viu() === 0 || rede.quieta(100) || Date.now() - inicioEspera >= 2500;
    }, { intervaloMs: 50, tetoMs: 2500 });
  } finally {
    rede.parar();
  }
  const lido = await lerValorDoElemento(tabId, campo);

  // O PJe quase nunca da erro: aceita o valor errado e segue. A leitura de
  // volta e a unica defesa (padrao da casa, formulario.ts/preencherCampo) — se
  // o campo ficou vazio ou com o texto DIGITADO (a sugestao nunca "pegou"), e
  // erro, nunca "ok".
  if (!lido || lido === texto) {
    throw new Error(
      `[autocomplete] cliquei em "${escolhida.texto}" e o campo ficou com "${lido ?? ''}" — a selecao nao pegou. `
      + 'Se for RichFaces, confira o seletor_sugestoes ou se o widget so aceita evento sintetico.',
    );
  }

  return {
    digitado,
    sugestoes_vistas: vistos.slice(0, 10),
    escolhida: escolhida.texto,
    lido,
  };
}

export const modulo: ModuloCapacidades = {
  nome: 'autocomplete',
  capacidades: [
    {
      nome: 'cap_autocomplete',
      altera: true,
      input: true,
      executar: (ctx) => executarAutocomplete(ctx),
    },
  ],
};
