import { avisarComDecisao } from './avisos';
import {
  BOTOES, CofreDeDecisoes, chaveDaAcao, descreverDecisao, resumoParaNotificacao,
  type Decisao, type TipoDecisao,
} from './decisoes';

/**
 * v6.1 (f) — decisao do usuário por notificacao: a parte que fala com o Chrome.
 * A logica (quem aprova o que, validade, uma vez so) mora em `decisoes.ts` e e testada sem Chrome.
 *
 * O cofre e espelhado em `chrome.storage.session`: o service worker dorme em 30 s e o clique no
 * botao pode acordar uma instancia nova. Toda operacao recarrega antes e grava depois.
 */

const CHAVE_STORAGE = 'decisoes';
const PREFIXO_NOTIFICACAO = 'praxedes_espera_';
const cofre = new CofreDeDecisoes();

async function recarregar(): Promise<void> {
  try {
    const v = (await chrome.storage.session.get(CHAVE_STORAGE))[CHAVE_STORAGE];
    if (Array.isArray(v)) cofre.importar(v as Decisao[]);
  } catch { /* sem espelho: so memoria */ }
}
async function salvar(): Promise<void> {
  try { await chrome.storage.session.set({ [CHAVE_STORAGE]: cofre.exportar() }); } catch { /* idem */ }
}

async function hostDaAba(tabId: number): Promise<string> {
  try {
    const u = (await chrome.tabs.get(tabId)).url;
    return u ? new URL(u).host : 'navegador';
  } catch { return 'navegador'; }
}

/**
 * Abre a decisao e manda a notificacao com botoes. Devolve a decisao, ou null se nao ha como
 * perguntar (host local/teste, avisos desligados, erro do Windows): ai o comando segue com a
 * mensagem de sempre, e NADA vira "aguardando".
 */
export async function solicitarDecisao(p: {
  tabId: number; tipo: TipoDecisao; chave: string; motivo: string; siteAlvo?: string;
}): Promise<Decisao | null> {
  await recarregar();
  const site = p.siteAlvo || await hostDaAba(p.tabId);
  const criada = cofre.criar({ tipo: p.tipo, tabId: p.tabId, chave: p.chave, motivo: p.motivo, site });
  if (!criada) { await salvar(); return null; }
  if (!criada.nova) { await salvar(); return criada.decisao; }
  const notificacaoId = await avisarComDecisao(p.tabId, resumoParaNotificacao(p.motivo), BOTOES[p.tipo], p.siteAlvo);
  if (!notificacaoId) { cofre.remover(criada.decisao.id); await salvar(); return null; }
  cofre.vincularNotificacao(criada.decisao.id, notificacaoId);
  await salvar();
  return cofre.obter(criada.decisao.id);
}

export async function consumirAprovacao(tabId: number, chave: string): Promise<boolean> {
  await recarregar();
  const d = cofre.consumirAprovacao(tabId, chave);
  if (d) await salvar();
  return d !== null;
}

/** O clique no botao. E o UNICO lugar do codigo que aprova alguma coisa. */
export async function tratarBotao(notificacaoId: string, indice: number): Promise<Decisao | null> {
  await recarregar();
  const d = cofre.responderPorBotao(notificacaoId, indice);
  if (d) await salvar();
  try { chrome.notifications.clear(notificacaoId, () => { void chrome.runtime.lastError; }); } catch { /* ja sumiu */ }
  return d;
}

/** So teste: o id da notificacao ligada a uma decisao (para o teste ao vivo NEGAR, nunca aprovar). */
export async function notificacaoDaDecisao(id: string): Promise<string | undefined> {
  await recarregar();
  return cofre.obter(id)?.notificacaoId;
}

export async function cancelarTodasAsDecisoes(): Promise<number> {
  await recarregar();
  const n = cofre.cancelarTodas();
  await salvar();
  return n;
}

export interface RelatorioDecisao {
  id: string; tipo: TipoDecisao; estado: string; site: string; acao_barrada: string; mensagem: string;
}

const relatar = (d: Decisao, agora: number): RelatorioDecisao => ({
  id: d.id, tipo: d.tipo, estado: d.estado, site: d.site,
  acao_barrada: d.motivo.replace(/\s+/g, ' ').slice(0, 200), mensagem: descreverDecisao(d, agora),
});

/**
 * Para o agente ESPERAR a resposta (so leitura: nao decide nada). Com `id`: essa decisao. Sem `id`: as
 * da aba dele. Volta assim que alguma deixa de estar "aguardando", ou no fim do prazo.
 */
export async function esperarDecisao(p: { tabId: number; id?: string; segundos?: number }): Promise<{
  decisoes: RelatorioDecisao[]; esperou_ms: number; vazio?: string;
}> {
  const prazo = Math.max(0, Math.min(120, Number.isFinite(p.segundos) ? Number(p.segundos) : 30)) * 1000;
  const inicio = Date.now();
  const escolher = (): Decisao[] => {
    if (p.id) { const d = cofre.obter(p.id); return d ? [d] : []; }
    const t = Date.now();
    return cofre.daAba(p.tabId).filter((d) => d.estado === 'aguardando' || t - (d.decididaEm ?? d.criadaEm) < 120_000);
  };
  for (;;) {
    await recarregar();
    const lista = escolher();
    const aguardando = lista.some((d) => d.estado === 'aguardando');
    const esgotou = Date.now() - inicio >= prazo;
    if (!aguardando || esgotou) {
      const agora = Date.now();
      return lista.length
        ? { decisoes: lista.map((d) => relatar(d, agora)), esperou_ms: agora - inicio }
        : {
          decisoes: [], esperou_ms: agora - inicio,
          vazio: p.id ? `decisao ${p.id} nao encontrada (expirou ou nunca existiu)` : 'nenhuma decisao pendente ou recente nesta aba',
        };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

export interface ResultadoDoFreio { permitido: boolean; confirmavel?: boolean; motivo?: string; decisaoId?: string }

/**
 * O freio barrou algo CONFIRMAVEL. Antes de devolver o erro ao agente:
 *   1. ha aprovacao valida para esta acao exata? Gasta e libera (uma vez).
 *   2. o usuário acabou de negar esta acao? Diz que foi negada (sem outro aviso).
 *   3. senao, abre a decisao e manda a notificacao; o erro passa a dizer que esta aguardando.
 * Sem como notificar (host local/teste), devolve o veredito intacto.
 */
export async function aplicarDecisao(
  v: ResultadoDoFreio,
  action: { type: string; target?: unknown; params?: Record<string, unknown> },
  tabId: number,
  textoDoAlvo?: string,
): Promise<ResultadoDoFreio> {
  const chave = chaveDaAcao(action, textoDoAlvo);
  if (await consumirAprovacao(tabId, chave)) return { permitido: true };

  await recarregar();
  const negada = cofre.negadaRecente('freio', tabId, chave);
  if (negada) {
    return {
      ...v, decisaoId: negada.id,
      motivo: `${v.motivo ?? ''} || NEGADA pelo usuário ha instantes (decisao ${negada.id}). Nao repita nem contorne: diga a ele no chat o que ficou sem fazer.`,
    };
  }

  let siteAlvo: string | undefined;
  if (action.type === 'navigate') {
    try { siteAlvo = new URL(String(action.params?.url ?? '')).host || undefined; } catch { /* url invalida */ }
  }
  const semPedidoDeConfirm = (v.motivo ?? '').replace(/\s*Confirme com o usuario e repita com confirm: true\.?/i, '').trim();
  const dec = await solicitarDecisao({ tabId, tipo: 'freio', chave, motivo: semPedidoDeConfirm, siteAlvo });
  if (!dec) return v;
  return {
    ...v,
    decisaoId: dec.id,
    motivo: `${semPedidoDeConfirm} || aguardando decisão do usuário: ele foi avisado no Windows (Aprovar uma vez / Negar), decisao ${dec.id}. `
      + `NAO repita com confirm. Chame browser_decisao {id:"${dec.id}", esperar_s:30}; se vier APROVADA, repita a MESMA acao (sem confirm, em ate 60 s, vale uma vez).`,
  };
}

export async function loginDecididoParaAgente(tabId: number): Promise<RelatorioDecisao | null> {
  await recarregar();
  const d = cofre.loginNovoParaAgente(tabId);
  if (!d) return null;
  await salvar();
  return relatar(d, Date.now());
}

export async function loginPendenteDaAba(tabId: number): Promise<Decisao | null> {
  await recarregar();
  return cofre.pendentesDaAba(tabId, 'login')[0] ?? null;
}

/** Chamar uma vez no carregamento do service worker (junto de `iniciarAvisos`). */
export function iniciarDecisoes(): void {
  try {
    chrome.notifications.onButtonClicked.addListener((id, indice) => {
      if (id.startsWith(PREFIXO_NOTIFICACAO)) void tratarBotao(id, indice);
    });
  } catch { /* sem notifications: nada a ouvir */ }
}
