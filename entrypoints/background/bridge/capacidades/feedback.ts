import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Obra 22 — canal de feedback DO AGENTE (ideia do Dr. Cezar, 05/09/2026,
 * docs/obra-20260904/00-PLANO-DE-OBRA.md §21). "Um lugar feito pra agente, nao
 * pra humano" — onde um agente no meio de um protocolo do PJe registra um
 * defeito ou uma melhoria em duas segundos, em vez de precisar parar e
 * escrever um HANDOFF-*.md a mao (o que so aconteceu, nesta mesma rodada,
 * porque o agente teve disciplina — a maioria nao para).
 *
 * Duas capacidades:
 *
 * - `cap_feedback`: relato MANUAL. O schema forca o formato "como quebra" —
 *   o mesmo que se exige dos ceticos desta obra (§10 do plano) — e RECUSA
 *   relato vago dizendo exatamente o que falta. Essa recusa e a alma da obra:
 *   sem ela, "nao funcionou" vira deposito que ninguem consegue agir em cima
 *   (§21, "risco a nascer com defesa").
 * - `cap_feedback_drenar`: uso interno de `bridge_feedback_ler`
 *   (bridge-server/src/tools/feedback.js) — esvazia o buffer de captura
 *   AUTOMATICA (gancho `depois` abaixo) e devolve ao servidor, que e quem tem
 *   disco (`~/.praxedes-bridge/feedback.jsonl`; a extensao MV3 nao tem
 *   sistema de arquivos).
 *
 * A ponte preenche sozinha URL, hostname, aba, agente, hora e versao do
 * build — o agente so escreve o julgamento. Nenhuma capacidade daqui declara
 * `altera`: relatar feedback nunca toca a pagina, entao nunca pode ser
 * barrado pelo modo somente leitura (a barreira e sobre ALTERAR a aba do
 * usuario, nao sobre isto).
 *
 * Captura automatica — o que ela registra e por que:
 *
 * Toda resposta de erro passa pelo gancho `depois` (bridge/index.ts:501-511,
 * `responder()`, roda para QUALQUER `cmd.action`, cap_* e do ExecutionEngine,
 * inclusive [somente leitura] e [bloqueado]). Registrar TODO erro encheria o
 * arquivo de ruido (timeout de rede, aba fechada no meio, o proprio freio
 * funcionando como desenhado) — o que a obra pede para medir e decidir
 * (§21, "cuidados"). Decisao, sem medicao formal porque a mensagem de cada
 * caso e literal e conhecida na fonte:
 *
 * 1. Excluir os TRES marcadores que sao comportamento intencional documentado,
 *    nao defeito: `[somente leitura]`, `[bloqueado]`, `[dialogo aberto]`. Um
 *    agente barrado de proposito nao e um bug da tool.
 * 2. Excluir timeout de TRANSPORTE (`hub.js`, "estourou Ns sem resposta") —
 *    e rede/carga da maquina, nao a tool que respondeu errado.
 * 3. Tudo o mais registra: excecao real de CDP, elemento nao encontrado,
 *    capacidade que lancou erro por conteudo invalido etc.
 * 4. Dedupe por (tool, hostname, 80 primeiros caracteres da mensagem) numa
 *    janela de 10 min — um mesmo defeito reincidindo (ex.: elemento que nunca
 *    aparece numa pagina em loop) nao pode gerar um relato por tentativa.
 *
 * Privacidade: a captura automatica grava so METADADO (tool, mensagem de erro
 * truncada, HOSTNAME) — nunca a URL completa (que pode levar id de processo
 * ou query string) nem conteudo da pagina. O relato MANUAL pode incluir URL
 * porque e o agente escrevendo por decisao propria — mesma responsabilidade
 * que ja vale para o que ele escreve nos campos de texto.
 */

const TIPOS_VALIDOS: readonly string[] = ['erro', 'mentiu', 'faltou', 'confuso'];

/** Respostas curtas demais para servirem de "como quebra" — recusadas mesmo passando do tamanho minimo em alguns casos (ex.: "ok" e curta E vaga). */
const RESPOSTAS_VAGAS = new Set([
  '', '-', '--', '—', 'n/a', 'na', 'ok', 'nada', 'erro', 'bug', 'quebrou',
  'nao funcionou', 'não funcionou', 'nao sei', 'não sei', 'teste', 'test',
  '?', '??', '...', 'idk', 'nenhum', 'nenhuma', 'sim', 'nao', 'não',
]);

const TAMANHO_MINIMO = 6;

function normalizado(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function ehVago(v: string): boolean {
  return v.length < TAMANHO_MINIMO || RESPOSTAS_VAGAS.has(v.toLowerCase());
}

/** `ctx.params` e tipado `Record<string, never>` de proposito (ver registro.ts) — o formato real e por convencao de cada capacidade, nao pelo tipo. */
function parametros(ctx: ContextoCapacidade): Record<string, unknown> {
  return ctx.params as unknown as Record<string, unknown>;
}

const CAMPOS_DE_TEXTO: Array<[string, string]> = [
  ['tool', 'tool (o nome exato da tool que voce chamou)'],
  ['o_que_eu_queria', 'o_que_eu_queria (o objetivo, o que voce estava tentando fazer)'],
  ['o_que_eu_chamei', 'o_que_eu_chamei (a chamada exata — tool e argumentos)'],
  ['o_que_veio', 'o_que_veio (a resposta EXATA que voltou, cole o texto)'],
  ['o_que_eu_esperava', 'o_que_eu_esperava (o que deveria ter voltado)'],
  ['como_descobri', 'como_descobri (o que te fez perceber a diferenca)'],
];

/** Lista de problemas achados no relato — vazia quando esta tudo certo. Nunca para no primeiro erro: o agente corrige tudo de uma vez, nao campo por campo. */
function validar(p: Record<string, unknown>): string[] {
  const problemas: string[] = [];

  const tipo = normalizado(p.tipo);
  if (!TIPOS_VALIDOS.includes(tipo)) {
    problemas.push(`tipo precisa ser um de ${TIPOS_VALIDOS.join('|')} (veio "${tipo || '(vazio)'}")`);
  }

  for (const [campo, rotulo] of CAMPOS_DE_TEXTO) {
    const valor = normalizado(p[campo]);
    if (ehVago(valor)) {
      problemas.push(`${rotulo} esta vazio ou vago demais ("${valor}") — descreva com o dado concreto, nao um resumo`);
    }
  }

  const veio = normalizado(p.o_que_veio).toLowerCase();
  const esperava = normalizado(p.o_que_eu_esperava).toLowerCase();
  if (veio && esperava && veio === esperava) {
    problemas.push('o_que_veio e o_que_eu_esperava estao identicos — se bateu, isso nao e um relato de quebra');
  }

  return problemas;
}

async function urlEHostnameDaAba(tabId: number): Promise<{ url: string; hostname: string }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? '';
    const hostname = url ? new URL(url).hostname.toLowerCase() : '';
    return { url, hostname };
  } catch {
    return { url: '', hostname: '' };
  }
}

// ---- captura automatica: buffer em chrome.storage.local (sobrevive a bridge_reload; nao ha fs na extensao) ----

const CHAVE_STORAGE = 'feedbackAutomaticoPendente';
const CAP_BUFFER_AUTOMATICO = 300;

const MARCADORES_ESPERADOS = [/^\[somente leitura\]/i, /^\[bloqueado\]/i, /^\[dialogo aberto\]/i];

function mensagemEhRuido(mensagem: string): boolean {
  if (MARCADORES_ESPERADOS.some((re) => re.test(mensagem))) return true;
  if (/estourou \d+ ?s sem resposta/i.test(mensagem)) return true;
  return false;
}

/** Dedupe em memoria: `depois` roda muito mais vezes do que a obra precisa registrar. Some ao dormir o service worker — aceitavel, o pior caso e um relato repetido a mais, nunca um perdido. */
const JANELA_DEDUPE_MS = 10 * 60_000;
const ultimoAutomaticoPorChave = new Map<string, number>();

async function registrarAutomatico(registro: Record<string, unknown>): Promise<void> {
  try {
    const atual = (await chrome.storage.local.get(CHAVE_STORAGE))[CHAVE_STORAGE];
    const lista = Array.isArray(atual) ? atual : [];
    lista.push(registro);
    const podado = lista.length > CAP_BUFFER_AUTOMATICO ? lista.slice(lista.length - CAP_BUFFER_AUTOMATICO) : lista;
    await chrome.storage.local.set({ [CHAVE_STORAGE]: podado });
  } catch {
    // Sem storage disponivel: nao ha fallback melhor do que perder ESTE
    // registro automatico. O relato manual (cap_feedback) nao depende disto.
  }
}

export const modulo: ModuloCapacidades = {
  nome: 'feedback',
  capacidades: [
    {
      nome: 'cap_feedback',
      async executar(ctx: ContextoCapacidade) {
        const p = parametros(ctx);
        const problemas = validar(p);
        if (problemas.length > 0) {
          throw new Error(`relato recusado — falta: ${problemas.join('; ')}.`);
        }

        const { url, hostname } = await urlEHostnameDaAba(ctx.tabId);
        return {
          origem: 'manual',
          tipo: normalizado(p.tipo),
          tool: normalizado(p.tool),
          o_que_eu_queria: normalizado(p.o_que_eu_queria),
          o_que_eu_chamei: normalizado(p.o_que_eu_chamei),
          o_que_veio: normalizado(p.o_que_veio),
          o_que_eu_esperava: normalizado(p.o_que_eu_esperava),
          como_descobri: normalizado(p.como_descobri),
          hostname,
          url,
          tabId: ctx.tabId,
          agente: ctx.nome ?? null,
          clientId: ctx.clientId,
          hora: new Date().toISOString(),
          versaoBuild: chrome.runtime.getManifest().version,
        };
      },
    },
    {
      // Nao e exposta como tool MCP propria — bridge_feedback_ler (servidor)
      // chama isto antes de ler o arquivo, para o buffer automatico virar
      // parte do que ele agrupa.
      nome: 'cap_feedback_drenar',
      async executar(_ctx: ContextoCapacidade): Promise<unknown[]> {
        const atual = (await chrome.storage.local.get(CHAVE_STORAGE))[CHAVE_STORAGE];
        const lista = Array.isArray(atual) ? atual : [];
        await chrome.storage.local.set({ [CHAVE_STORAGE]: [] });
        return lista;
      },
    },
  ],
  ganchos: {
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      if (r.ok) return r;
      if (ctx.acao === 'cap_feedback' || ctx.acao === 'cap_feedback_drenar') return r;

      const mensagem = r.error ?? '';
      if (!mensagem || mensagemEhRuido(mensagem)) return r;

      const { hostname } = await urlEHostnameDaAba(ctx.tabId);
      const agora = Date.now();

      for (const [chave, quando] of ultimoAutomaticoPorChave) {
        if (agora - quando > JANELA_DEDUPE_MS) ultimoAutomaticoPorChave.delete(chave);
      }
      const chave = `${ctx.acao}::${hostname}::${mensagem.slice(0, 80)}`;
      if (ultimoAutomaticoPorChave.has(chave)) return r;
      ultimoAutomaticoPorChave.set(chave, agora);

      await registrarAutomatico({
        origem: 'automatica',
        tipo: 'erro',
        tool: ctx.acao,
        mensagem: mensagem.slice(0, 500),
        hostname,
        tabId: ctx.tabId,
        agente: ctx.nome ?? null,
        clientId: ctx.clientId,
        hora: new Date(agora).toISOString(),
        versaoBuild: chrome.runtime.getManifest().version,
      });

      return r;
    },
  },
};
