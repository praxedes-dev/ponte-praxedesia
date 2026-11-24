import type { AgentWorkspace } from '../../../../shared/types';
import { resolverAlvoDaAcao } from '../../execution-engine';
import { umQuadro } from '../../execution-engine/cdp-tools';
import { observarRede } from '../../execution-engine/rede-observada';
import { esperarCondicao } from '../../execution-engine/espera-condicao';
import { avaliar } from '../policy';
import { preencherCampo } from './formulario';
import type { ModuloCapacidades } from './registro';

/**
 * `browser_form_fill` — obra 07 (docs/obra-20260904/07-form-fill.md).
 *
 * Existe porque a qualificacao de parte no PJe tem de 8 a 15 campos e hoje sao
 * 8 a 15 chamadas separadas de `browser_form_input`, cada uma esperando o PJe.
 * Reaproveita `preencherCampo` (formulario.ts) por campo -- ele ja resolve
 * Select2/option-climbing, dispara input/change e RELE o valor, falhando se
 * nao bater. Este modulo so orquestra a sequencia; nao reimplementa nada
 * disso.
 */

export interface CampoLote {
  ref: number;
  valor: string | boolean;
}

export interface ResultadoCampo {
  ref: number;
  ok: boolean;
  detalhe?: string;
  erro?: string;
}

export interface RelatorioLote {
  total: number;
  preenchidos: number;
  campos: ResultadoCampo[];
}

/**
 * Valida a entrada ANTES de tocar a pagina: `campos` vazio ou com `ref` que
 * nao e numero e erro claro na hora, nao um "opcao nao encontrada" confuso
 * vindo de dentro do loop.
 */
function validarCampos(campos: unknown): CampoLote[] {
  if (!Array.isArray(campos) || campos.length === 0) {
    throw new Error('informe "campos": [{ ref, valor }], com pelo menos um campo');
  }
  for (const c of campos) {
    if (typeof c !== 'object' || c === null || typeof (c as { ref?: unknown }).ref !== 'number') {
      throw new Error(`campo sem "ref" numerico: ${JSON.stringify(c)}`);
    }
  }
  return campos as CampoLote[];
}

/** Piso sem atividade de rede entre campos (so no modo por condicao, sem `intervalo_ms` explicito). */
const PISO_ENTRE_CAMPOS_MS = 80;
/** Teto da espera por AJAX do `change` — depois disso segue, como o tempo fixo de antes seguia. */
const TETO_AJAX_ENTRE_CAMPOS_MS = 2500;

/**
 * Preenche varios campos em sequencia (NUNCA `Promise.all`: no PJe um `change`
 * pode disparar um ciclo AJAX que re-renderiza o campo seguinte -- aplicar
 * varios `change` de uma vez e o que fez 4 de 47 selects voltarem para
 * "Selecione o tipo", achado da skill `protocolo-pje-ponte`, 338-342).
 *
 * `pararNoErro` (padrao true) decide o que fazer quando um campo no meio nao
 * bate: parar ali e marcar os restantes como "nao tentado", em vez de seguir
 * escrevendo em cima de uma pagina cujo proximo combo pode ja ter mudado por
 * causa do campo anterior. Ver a nota de decisao no modulo (`modulo`, abaixo)
 * para a medicao que sustenta esse padrao.
 */
export async function preencherLote(
  tabId: number,
  campos: CampoLote[],
  ws: AgentWorkspace,
  confirmado: boolean,
  opts: { pararNoErro?: boolean; intervaloMs?: number } = {},
): Promise<RelatorioLote> {
  const pararNoErro = opts.pararNoErro !== false;
  // `intervalo_ms` explicito = o agente pediu aquele tempo: respeita, fixo. Sem ele, por condicao.
  const porCondicao = opts.intervaloMs === undefined;
  const intervaloMs = opts.intervaloMs ?? 150;

  const resultados: ResultadoCampo[] = [];
  let parado = false;

  for (let i = 0; i < campos.length; i++) {
    const campo = campos[i];

    if (parado) {
      resultados.push({ ref: campo.ref, ok: false, erro: 'nao tentado' });
      continue;
    }

    const rede = porCondicao ? observarRede(tabId) : undefined;
    try {
      // Freio campo a campo (o dispatch de bridge/index.ts NAO chama avaliar()
      // para acoes cap_*): um lote pode ter campo de senha misturado com campos
      // comuns, e cada um e um alvo diferente para o freio avaliar.
      //
      // Obra 25: o alvo de cada campo e resolvido UMA vez, com a travessia de
      // `cap_form_fill` (a mesma de `preencherCampo`), e o mesmo objeto vai
      // para o freio e para a escrita. A resolucao e por campo, nunca por lote:
      // no PJe o `change` de um campo re-renderiza o proximo, e reaproveitar
      // handle resolvido antes do lote e o incidente que sumiu com 9 de 47
      // documentos.
      const acao = { type: 'cap_form_fill', target: { strategy: 'agent-id' as const, agentId: campo.ref } };
      const alvo = await resolverAlvoDaAcao(acao, tabId);
      if (!alvo.ok) {
        throw new Error(
          `nao consegui identificar o campo (${alvo.motivo}). Releia a pagina com browser_read_page `
          + 'e repita com uma ref atual.',
        );
      }
      const veredito = await avaliar(acao, ws, confirmado, alvo.alvo);
      if (!veredito.permitido) throw new Error(`[bloqueado] ${veredito.motivo}`);

      const detalhe = await preencherCampo(tabId, alvo.alvo.efetivo.backendNodeId, campo.valor);
      resultados.push({ ref: campo.ref, ok: true, detalhe });
    } catch (err) {
      resultados.push({ ref: campo.ref, ok: false, erro: err instanceof Error ? err.message : String(err) });
      if (pararNoErro) parado = true;
    }

    // O framework re-renderiza depois do `change` (RichFaces, no caso do PJe);
    // so espera se ainda vai tentar outro campo -- nao ha motivo para atrasar
    // a resposta quando o resto ja esta marcado "nao tentado".
    if (!parado && i < campos.length - 1) {
      if (rede) {
        // Um quadro (o `change` roda e o framework agenda o AJAX), depois: rede quieta
        // por PISO ms, e nenhum pedido novo em voo. Teto 150 ms sem AJAX algum (igual
        // ao tempo fixo de antes); com AJAX, ate TETO_AJAX para ele terminar.
        await umQuadro(tabId, 50);
        await esperarCondicao(async () => rede.quieta(PISO_ENTRE_CAMPOS_MS), {
          intervaloMs: 20,
          tetoMs: rede.viu() > 0 ? TETO_AJAX_ENTRE_CAMPOS_MS : intervaloMs,
        });
      } else {
        await new Promise((r) => setTimeout(r, intervaloMs));
      }
    }
    rede?.parar();
  }

  const preenchidos = resultados.filter((r) => r.ok).length;
  return { total: campos.length, preenchidos, campos: resultados };
}

/** Texto do erro: relatorio inteiro + o remedio, no padrao da casa (`[aba trocou]`, bridge/index.ts). */
function formatarFalha(r: RelatorioLote): string {
  const linhas = r.campos.map((c) => (
    c.ok ? `ref ${c.ref}: ok — ${c.detalhe}` : `ref ${c.ref}: FALHOU — ${c.erro}`
  ));
  return `${r.preenchidos}/${r.total} campos preenchidos.\n${linhas.join('\n')}\n`
    + 'releia a pagina (as refs podem ter mudado depois de um campo re-renderizar) e mande de novo so os que faltaram.';
}

export const modulo: ModuloCapacidades = {
  nome: 'formulario-lote',
  capacidades: [
    {
      nome: 'cap_form_fill',
      // Mesma paridade de cap_form_input (formulario.ts): quem altera a
      // pagina e faz input tem de declarar as duas -- esquecer uma delas e
      // exatamente o "defeito irmao" que o registro existe para evitar (a
      // capacidade escaparia do modo somente leitura e/ou da fila de aba
      // pintada).
      altera: true,
      input: true,
      executar: async (ctx) => {
        const campos = validarCampos(ctx.params.campos);

        // `preencherLote` ja trata undefined como "parar_no_erro: true" (o
        // padrao); repassar direto evita reconstruir essa regra aqui.
        const relatorio = await preencherLote(ctx.tabId, campos, ctx.ws, ctx.confirm, {
          pararNoErro: ctx.params.parar_no_erro,
          intervaloMs: ctx.params.intervalo_ms,
        });

        // Algum campo falhou -> resposta inteira e erro (`ok: false` para o
        // agente), mesmo com parar_no_erro:false: um relatorio "parcialmente
        // ok" incentivaria o agente a seguir como se a qualificacao inteira
        // tivesse entrado, quando o PJe pode ter aceitado so parte dela.
        if (relatorio.preenchidos < relatorio.total) {
          throw new Error(formatarFalha(relatorio));
        }

        return relatorio;
      },
    },
  ],
};
