/**
 * v6.1 (f) — decisao do usuário por NOTIFICACAO do Windows, logica pura (sem `chrome.*`).
 *
 * Duas situacoes viram uma decisao com dois botoes:
 *   freio  -> o freio barrou uma acao irreversivel/financeira que pede confirmacao.
 *             Botoes: "Aprovar uma vez" / "Negar".
 *   login  -> a pagina pede login e a senha nao esta preenchida (a ponte nunca digita senha).
 *             Botoes: "Já entrei" / "Cancelar".
 *
 * Regras que este modulo garante (e o teste prova):
 *   - So `responderPorBotao` aprova, e ele so e chamado pelo clique no botao da notificacao.
 *     Nenhum caminho do agente (tool MCP, comando, parametro) chega aqui: o agente so CONSULTA.
 *   - "Aprovar uma vez" libera SO aquela acao exata: mesma aba, mesma chave (acao + alvo + parametros),
 *     dentro de 60 s, e uma unica vez (`consumirAprovacao` gasta).
 *   - Decisao pendente velha expira; clique tardio em decisao expirada nao aprova nada.
 */

export type TipoDecisao = 'freio' | 'login';
export type EstadoDecisao = 'aguardando' | 'aprovada' | 'usada' | 'negada' | 'entrou' | 'cancelada' | 'expirada';

export interface Decisao {
  id: string;
  tipo: TipoDecisao;
  tabId: number;
  /** Identidade da acao (freio) ou da pagina (login). */
  chave: string;
  motivo: string;
  site: string;
  criadaEm: number;
  estado: EstadoDecisao;
  decididaEm?: number;
  /** So aprovada: ate quando vale. */
  validaAte?: number;
  notificacaoId?: string;
  /** Login ja decidido e ja contado ao agente na resposta de algum comando. */
  contadaAoAgente?: boolean;
}

export const VALIDADE_APROVACAO_MS = 60_000;
export const VALIDADE_PENDENTE_MS = 30 * 60_000;
export const MAX_PENDENTES = 6;
const MAX_HISTORICO = 40;

export const BOTOES: Record<TipoDecisao, [string, string]> = {
  freio: ['Aprovar uma vez', 'Negar'],
  login: ['Já entrei', 'Cancelar'],
};

const ESTADOS_FINAIS: EstadoDecisao[] = ['aprovada', 'usada', 'negada', 'entrou', 'cancelada', 'expirada'];

/** FNV-1a de 32 bits em hex: chave curta e estavel. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Parametros que mudam a espera ou o transporte, nao a ACAO: ficam fora da chave. */
const PARAMS_FORA_DA_CHAVE = new Set([
  'esperar', 'esperar_ms', 'esperar_texto', 'esperar_url', 'confirmar_ms', 'timeout_ms', 'confirm',
]);

/**
 * Identidade da acao para "aprovar uma vez": tipo + alvo pedido + parametros que mudam o efeito
 * (x,y, url, tecla, texto...) + o texto do elemento resolvido, quando se conhece. A mesma chamada
 * repetida da a mesma chave; outra ref, outro texto ou outra coordenada da outra.
 */
export function chaveDaAcao(
  action: { type: string; target?: unknown; params?: Record<string, unknown> },
  textoDoAlvo?: string,
): string {
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(action.params ?? {})) if (!PARAMS_FORA_DA_CHAVE.has(k)) params[k] = v;
  return hash(estavel({ t: action.type, a: action.target ?? null, p: params, x: (textoDoAlvo ?? '').trim().slice(0, 80) }));
}

export class CofreDeDecisoes {
  private itens: Decisao[];
  private contador = 0;
  private agora: () => number;

  // Sem "parameter property": o teste importa este .ts direto no Node (strip-only).
  constructor(agora: () => number = () => Date.now(), itens: Decisao[] = []) {
    this.agora = agora;
    this.itens = itens.map((d) => ({ ...d }));
  }

  exportar(): Decisao[] { return this.itens.map((d) => ({ ...d })); }

  /** Troca o conteudo (outra instancia do service worker pode ter gravado). */
  importar(itens: Decisao[]): void { this.itens = itens.map((d) => ({ ...d })); }

  /** Vence o que passou do prazo e apara o historico. */
  varrer(): void {
    const t = this.agora();
    for (const d of this.itens) {
      if (d.estado === 'aguardando' && t - d.criadaEm > VALIDADE_PENDENTE_MS) { d.estado = 'expirada'; d.decididaEm = t; }
      if (d.estado === 'aprovada' && d.validaAte !== undefined && t > d.validaAte) { d.estado = 'expirada'; d.decididaEm = t; }
    }
    if (this.itens.length > MAX_HISTORICO) {
      const pendentes = this.itens.filter((d) => d.estado === 'aguardando' || d.estado === 'aprovada');
      const resto = this.itens.filter((d) => !(d.estado === 'aguardando' || d.estado === 'aprovada'))
        .sort((a, b) => (b.decididaEm ?? b.criadaEm) - (a.decididaEm ?? a.criadaEm)).slice(0, MAX_HISTORICO - pendentes.length);
      this.itens = [...pendentes, ...resto];
    }
  }

  /**
   * Abre uma decisao. Mesma (tipo, aba, chave) ainda aguardando devolve a MESMA (o agente repetiu a
   * chamada: nao vira outra notificacao). `null` = pendentes demais.
   */
  criar(p: { tipo: TipoDecisao; tabId: number; chave: string; motivo: string; site: string }): { decisao: Decisao; nova: boolean } | null {
    this.varrer();
    const igual = this.itens.find((d) => d.estado === 'aguardando' && d.tipo === p.tipo && d.tabId === p.tabId && d.chave === p.chave);
    if (igual) return { decisao: { ...igual }, nova: false };
    if (this.itens.filter((d) => d.estado === 'aguardando').length >= MAX_PENDENTES) return null;
    const decisao: Decisao = {
      id: `d${this.agora().toString(36)}${(this.contador++).toString(36)}`,
      tipo: p.tipo, tabId: p.tabId, chave: p.chave, motivo: p.motivo, site: p.site,
      criadaEm: this.agora(), estado: 'aguardando',
    };
    this.itens.push(decisao);
    return { decisao: { ...decisao }, nova: true };
  }

  vincularNotificacao(id: string, notificacaoId: string): void {
    const d = this.itens.find((x) => x.id === id);
    if (d) d.notificacaoId = notificacaoId;
  }

  /** A notificacao nao saiu (host local, avisos desligados, erro): a decisao nunca existiu. */
  remover(id: string): void { this.itens = this.itens.filter((d) => d.id !== id); }

  /**
   * O UNICO caminho que decide. Chamado pelo clique num botao da notificacao: 0 = primeiro botao
   * (aprovar / ja entrei), 1 = segundo (negar / cancelar). Ignora decisao que nao esta aguardando.
   */
  responderPorBotao(notificacaoId: string, botao: number): Decisao | null {
    this.varrer();
    const d = this.itens.find((x) => x.notificacaoId === notificacaoId && x.estado === 'aguardando');
    if (!d || (botao !== 0 && botao !== 1)) return null;
    const t = this.agora();
    d.decididaEm = t;
    if (d.tipo === 'freio') {
      if (botao === 0) { d.estado = 'aprovada'; d.validaAte = t + VALIDADE_APROVACAO_MS; } else d.estado = 'negada';
    } else {
      d.estado = botao === 0 ? 'entrou' : 'cancelada';
    }
    return { ...d };
  }

  /** O freio perguntando: ha aprovacao valida para ESTA acao nesta aba? Se ha, gasta (uma vez). */
  consumirAprovacao(tabId: number, chave: string): Decisao | null {
    this.varrer();
    const d = this.itens.find((x) => x.tipo === 'freio' && x.estado === 'aprovada' && x.tabId === tabId && x.chave === chave
      && (x.validaAte ?? 0) >= this.agora());
    if (!d) return null;
    d.estado = 'usada';
    return { ...d };
  }

  obter(id: string): Decisao | null {
    this.varrer();
    const d = this.itens.find((x) => x.id === id);
    return d ? { ...d } : null;
  }

  daAba(tabId: number): Decisao[] {
    this.varrer();
    return this.itens.filter((d) => d.tabId === tabId).map((d) => ({ ...d }));
  }

  pendentesDaAba(tabId: number, tipo?: TipoDecisao): Decisao[] {
    return this.daAba(tabId).filter((d) => d.estado === 'aguardando' && (!tipo || d.tipo === tipo));
  }

  /** Login decidido que o agente ainda nao foi avisado; marca como avisado. */
  loginNovoParaAgente(tabId: number): Decisao | null {
    this.varrer();
    const d = this.itens.find((x) => x.tipo === 'login' && x.tabId === tabId && !x.contadaAoAgente
      && (x.estado === 'entrou' || x.estado === 'cancelada'));
    if (!d) return null;
    d.contadaAoAgente = true;
    return { ...d };
  }

  /** O usuário negou ESTA acao ha pouco? Evita o agente insistir e encher a tela de avisos. */
  negadaRecente(tipo: TipoDecisao, tabId: number, chave: string, janelaMs = 120_000): Decisao | null {
    this.varrer();
    const t = this.agora();
    const d = this.itens.find((x) => x.tipo === tipo && x.tabId === tabId && x.chave === chave
      && x.estado === 'negada' && t - (x.decididaEm ?? 0) <= janelaMs);
    return d ? { ...d } : null;
  }

  /** "Parar tudo": nada pendente sobrevive e nenhuma aprovacao solta fica valendo. */
  cancelarTodas(): number {
    let n = 0;
    const t = this.agora();
    for (const d of this.itens) {
      if (d.estado === 'aguardando') { d.estado = 'cancelada'; d.decididaEm = t; n++; }
      else if (d.estado === 'aprovada') { d.estado = 'expirada'; d.decididaEm = t; n++; }
    }
    return n;
  }

  ehFinal(estado: EstadoDecisao): boolean { return ESTADOS_FINAIS.includes(estado); }
}

/** Texto curto da notificacao: o Windows corta mensagem longa. */
export function resumoParaNotificacao(motivo: string, limite = 120): string {
  const um = motivo.replace(/\s+/g, ' ').replace(/Confirme com o usuario e repita com confirm: true\.?/i, '').trim();
  return um.length > limite ? `${um.slice(0, limite - 1)}…` : um;
}

/** Como o agente fica sabendo do estado de uma decisao. */
export function descreverDecisao(d: Decisao, agora: number): string {
  switch (d.estado) {
    case 'aguardando':
      return `AGUARDANDO DECISAO do usuário (${d.tipo === 'freio' ? 'aprovar ou negar a acao' : 'entrar no site e confirmar'}). Ainda sem resposta.`;
    case 'aprovada':
      return `APROVADA pelo usuário. Repita AGORA a MESMA acao (mesmo alvo, mesma aba), sem confirm: vale uma vez, `
        + `mais ${Math.max(0, Math.round(((d.validaAte ?? agora) - agora) / 1000))} s.`;
    case 'usada':
      return 'aprovada e JA USADA (uma vez so). Para repetir, uma nova acao barrada gera uma nova decisao.';
    case 'negada':
      return 'NEGADA pelo usuário. Nao repita nem contorne; diga a ele no chat o que ficou sem fazer.';
    case 'entrou':
      return 'o usuário disse que JA ENTROU no site. Releia a pagina (browser_read_page) e continue.';
    case 'cancelada':
      return d.tipo === 'login'
        ? 'o usuário CANCELOU o login. Pare esta tarefa e avise-o no chat.'
        : 'cancelada (Parar tudo). Nao repita.';
    case 'expirada':
      return 'EXPIRADA sem resposta (ou a aprovacao passou dos 60 s). Nada foi liberado; repita a acao para pedir de novo.';
  }
}
