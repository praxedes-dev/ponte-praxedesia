import type { AgentWorkspace } from '../../../../shared/types';

/**
 * Registro de capacidades da ponte, por modulo de dominio.
 *
 * Existe para que uma capacidade nova entre num arquivo proprio, sem editar o
 * `switch` de `bridge/index.ts` nem os `Set` fixos que decidiam quem altera a
 * pagina e quem exige a aba pintada. Ver docs/obra-20260904/01-refatoracao-registro-e-ganchos.md.
 */

/** O que uma capacidade recebe para executar. Monta-se uma vez por comando. */
export interface ContextoCapacidade {
  clientId: string;
  /** Nome do agente (`cmd.name`). Hoje ninguem manda; a obra 10 vai mandar. */
  nome?: string;
  ws: AgentWorkspace;
  tabId: number;
  ref?: number;
  params: Record<string, never>;
  /** Usuario ja confirmou uma acao que o freio barrou. */
  confirm: boolean;
  /** A action recebida (`cmd.action`), para o caso de a capacidade precisar saber quem ela e. */
  acao: string;
  /**
   * Esta aba e do usuario e o cliente NAO tem `permitir_acao` — o mesmo sinal
   * que `bridge/index.ts` consulta em `this.somenteLeitura` antes de montar
   * este `ctx`. Existe para a obra 20
   * (docs/obra-20260904/20-javascript-fura-o-modo-somente-leitura.md):
   * `cap_js` nao declara `altera` (bloquear TODO js na aba do usuario, leitura
   * inclusive, quebraria "olha isso aqui"), entao a unica forma de barrar so
   * o JS com efeito colateral e decidir DENTRO da capacidade, por conteudo —
   * e ela precisa saber se esta na aba do usuario sem permissao para isso.
   * Populado em `bridge/index.ts` onde `ctx` e montado; nenhuma outra
   * capacidade e obrigada a le-lo.
   */
  emSomenteLeitura: boolean;
}

export interface Resultado {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface Capacidade {
  /** O nome pelo qual `cmd.action` chega — sempre `cap_algumacoisa`. */
  nome: string;
  /** Declarar altera-a-pagina e o que substitui o `Set` fixo ACOES_QUE_ALTERAM. */
  altera?: boolean;
  /** Declarar input e o que substitui o `Set` fixo INPUT_ACTIONS. */
  input?: boolean;
  executar(ctx: ContextoCapacidade): Promise<unknown>;
}

export interface Ganchos {
  /** Roda no `attach()` do debugger-manager e tambem no reattach — nao so na primeira vez. */
  aoAnexar?(tabId: number): void | Promise<void>;
  /** Roda antes do freio (`avaliar`), para poder barrar antes de qualquer chamada CDP. */
  antes?(ctx: ContextoCapacidade): void | Promise<void>;
  /** Roda depois de qualquer despacho, inclusive os barrados ([somente leitura], [bloqueado]). */
  depois?(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado>;
}

export interface ModuloCapacidades {
  nome: string;
  capacidades: Capacidade[];
  ganchos?: Ganchos;
}

const modulos: ModuloCapacidades[] = [];
const porNome = new Map<string, Capacidade>();

/**
 * Registra um modulo inteiro: suas capacidades entram no mapa por nome, seus
 * ganchos na ordem.
 *
 * Duas checagens (achados F6 e F7 do cetico, 05/09/2026):
 *
 * - Nome duplicado: antes `porNome.set` vencia em silencio — duas obras
 *   registrando o mesmo `cap_x` faziam a ultima ganhar sem aviso nenhum. Com
 *   16 obras futuras escrevendo cada uma no seu arquivo (mas todas chamando
 *   este `registrar`), colisao muda de "eu erro e vejo na hora" para "alguem
 *   erra daqui a semanas e o defeito e mudo".
 * - Prefixo `cap_`: o despacho de `bridge/index.ts` decide se chama
 *   `executarCapacidade` por `cmd.action.startsWith('cap_')` — nada no tipo
 *   `Capacidade` obrigava o nome a comecar assim. Um modulo futuro registrando
 *   `nome: 'voltar'` entraria em `alteraAPagina`/`exigeAbaPintada` (que
 *   consultam o registro por nome) mas o despacho nunca chegaria a chamar
 *   `capacidade.executar` — a acao cairia no `executionEngine`, que nao
 *   conhece esse nome, e o erro apareceria longe da causa.
 *
 * `throw` aqui aponta a causa exata (stack na linha certa, mensagem com o
 * nome do modulo culpado) — mas quem decide o EFEITO do erro e quem chama
 * `registrar()`, nao esta funcao. Ate a 2a rodada de vistoria (05/09/2026) o
 * chamador (`capacidades/index.ts`) deixava o throw propagar pelo `for` de
 * modulo em modulo, e como o registro roda em escopo de modulo (sem
 * try/catch, no boot do service worker), um nome errado em QUALQUER modulo
 * derrubava a ponte inteira para TODOS os agentes — pior que o problema que o
 * throw evitava. `capacidades/index.ts` agora captura por modulo e junta em
 * `errosDeRegistro`; esta funcao continua dando `throw` para quem quiser
 * chama-la direto (ou testa-la) sem essa rede.
 */
export function registrar(modulo: ModuloCapacidades): void {
  modulos.push(modulo);
  for (const cap of modulo.capacidades) {
    if (!cap.nome.startsWith('cap_')) {
      throw new Error(
        `modulo "${modulo.nome}": capacidade "${cap.nome}" nao comeca com "cap_" — o despacho de `
        + 'bridge/index.ts so chama executarCapacidade para acoes com esse prefixo. Renomeie a capacidade.',
      );
    }
    if (porNome.has(cap.nome)) {
      throw new Error(
        `modulo "${modulo.nome}": capacidade "${cap.nome}" ja registrada por outro modulo — nome `
        + 'duplicado. Escolha um nome unico (o ultimo registrar() venceria em silencio, sem isto).',
      );
    }
    porNome.set(cap.nome, cap);
  }
}

export function capacidadePorNome(nome: string): Capacidade | undefined {
  return porNome.get(nome);
}

/** Nomes de capacidade que alteram a pagina — para a barreira de somente leitura. */
export function nomesQueAlteram(): Set<string> {
  return new Set([...porNome.values()].filter((c) => c.altera === true).map((c) => c.nome));
}

/** Nomes de capacidade que despacham input e por isso exigem a aba pintada. */
export function nomesDeInput(): Set<string> {
  return new Set([...porNome.values()].filter((c) => c.input === true).map((c) => c.nome));
}

/** Os ganchos de todos os modulos registrados, na ordem de registro. */
export function ganchos(): Ganchos[] {
  return modulos.map((m) => m.ganchos).filter((g): g is Ganchos => Boolean(g));
}

/** Para diagnostico (`cap_listar`): toda capacidade registrada, com suas flags. */
export function listarCapacidades(): Array<{ nome: string; altera: boolean; input: boolean }> {
  return [...porNome.values()].map((c) => ({
    nome: c.nome,
    altera: c.altera === true,
    input: c.input === true,
  }));
}
