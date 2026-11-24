import { debuggerManager as dm } from '../../debugger-manager';
import { avisarEspera, ehHostLocal, modoTesteDecisaoLigado, vale } from '../../painel/avisos';
import { chaveDaAcao } from '../../painel/decisoes';
import { loginDecididoParaAgente, loginPendenteDaAba, solicitarDecisao } from '../../painel/decisao-runtime';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Pagina de login com a senha por preencher = o agente esta esperando o usuário (a ponte nunca
 * digita senha; o freio veta). Depois de uma leitura/navegacao/clique bem-sucedido, uma sonda curta
 * olha se ha UM campo de senha visivel e vazio e, se houver, manda a notificacao do Windows.
 *
 * v6.1 (f): a notificacao agora tem dois botoes, "Já entrei" e "Cancelar" (decisoes.ts). O resultado
 * do comando ganha `decisao_login` (ou `aviso`, na leitura) dizendo que esta aguardando e como
 * esperar (browser_decisao); quando o usuário responde, o proximo resultado desta aba conta o que
 * ele disse, uma vez. Host local/teste nunca notifica (segue o caminho de antes, so registra).
 *
 * A sonda so roda se o aviso ainda "vale" (ligado no painel e fora da janela de 2 min daquela aba),
 * entao pagina lida muitas vezes nao custa uma chamada CDP cada. Campo `autocomplete="new-password"`
 * ou mais de um campo de senha (cadastro, troca de senha) nao contam: o objetivo e o login.
 */

const ACOES_OBSERVADAS = new Set(['navigate', 'read_page', 'extract', 'click']);

export const SONDA_LOGIN = `
  function () {
    var campos = [].slice.call(document.querySelectorAll('input[type=password]')).filter(function (e) {
      var r = e.getBoundingClientRect();
      var cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.disabled && !e.readOnly;
    });
    return {
      visiveis: campos.length,
      vazios: campos.filter(function (e) { return !e.value; }).length,
      cadastro: campos.some(function (e) { return /new-password/i.test(e.getAttribute('autocomplete') || ''); }),
    };
  }
`;

export function ehLoginSemSenha(s: { visiveis: number; vazios: number; cadastro: boolean } | undefined): boolean {
  return !!s && s.visiveis === 1 && s.vazios === 1 && !s.cadastro;
}

export const textoLoginPendente = (id: string): string =>
  'a pagina pede LOGIN e a senha nao esta preenchida (a ponte nunca digita senha). O usuário foi avisado no Windows '
  + `(Já entrei / Cancelar): aguardando decisão do usuário (decisao ${id}). NAO tente digitar a senha. `
  + `Chame browser_decisao {id:"${id}", esperar_s:60} e, quando ele disser que entrou, releia a pagina.`;

/** Anota o texto no resultado sem perder o que ele ja traz. */
export function anotarLogin(acao: string, r: Resultado, texto: string): Resultado {
  const d = r.data;
  if (acao === 'extract') return typeof d === 'string' ? { ...r, data: `[aviso] ${texto}\n${d}` } : r;
  if (acao === 'read_page') {
    const base = d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
    const antes = typeof base.aviso === 'string' && base.aviso ? `${base.aviso} | ` : '';
    return { ...r, data: { ...base, aviso: antes + texto } };
  }
  if (d === undefined || d === null) return { ...r, data: { decisao_login: texto } };
  if (typeof d === 'object' && !Array.isArray(d)) return { ...r, data: { ...(d as object), decisao_login: texto } };
  return r;
}

async function depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
  if (!r.ok || !ACOES_OBSERVADAS.has(ctx.acao)) return r;
  try {
    // 1. o usuário ja respondeu e o agente ainda nao soube
    const decidido = await loginDecididoParaAgente(ctx.tabId);
    if (decidido) return anotarLogin(ctx.acao, r, `login: ${decidido.mensagem}`);
    // 2. ainda aguardando: lembra em todo resultado desta aba
    const pendente = await loginPendenteDaAba(ctx.tabId);
    if (pendente) return anotarLogin(ctx.acao, r, textoLoginPendente(pendente.id));

    if (!(await vale(ctx.tabId))) return r;
    const res = await dm.send<{ result?: { value?: { visiveis: number; vazios: number; cadastro: boolean } } }>(
      ctx.tabId, 'Runtime.evaluate', { expression: `(${SONDA_LOGIN})()`, returnByValue: true },
    );
    if (!ehLoginSemSenha(res?.result?.value)) return r;

    const motivo = 'página de login com a senha por preencher';
    const url = (await chrome.tabs.get(ctx.tabId).catch(() => null))?.url;
    let host = '';
    try { host = url ? new URL(url).host : ''; } catch { /* sem host */ }
    // Host local/teste: nunca notifica; o aviso simples so registra (como sempre foi).
    if (host && ehHostLocal(host) && !(await modoTesteDecisaoLigado())) {
      void avisarEspera(ctx.tabId, motivo);
      return r;
    }
    const dec = await solicitarDecisao({
      tabId: ctx.tabId, tipo: 'login', motivo, chave: chaveDaAcao({ type: 'login', params: { host } }),
    });
    if (!dec) {
      void avisarEspera(ctx.tabId, motivo); // sem como abrir decisao: aviso simples, como antes
      return r;
    }
    return anotarLogin(ctx.acao, r, textoLoginPendente(dec.id));
  } catch {
    // Aba navegando ou sem CDP: sem aviso, e o comando segue como estava.
  }
  return r;
}

export const modulo: ModuloCapacidades = {
  nome: 'espera-login',
  capacidades: [],
  ganchos: { depois },
};
