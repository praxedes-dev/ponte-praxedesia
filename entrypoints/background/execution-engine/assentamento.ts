/**
 * v6.1 (c) â€” decisao pura de "a pagina assentou", somando REDE e MUDANCA DE DOM.
 *
 * Antes o assentamento olhava so a rede (requisicoes em voo + silencio). Pagina que desenha
 * depois da resposta (SPA, hidratacao) ainda estava mudando quando a ponte devolvia a leitura.
 * Agora cada mudanca real do DOM (no adicionado/removido, texto, atributo exceto `style`) conta
 * como atividade, e depois de qualquer atividade o silencio exigido e de 500 ms.
 *
 * Duas salvaguardas contra pagina que nunca para de mexer (carrossel, relogio):
 *  - o DOM so segura a espera por ate `extraDomMs` depois que a rede ja assentou;
 *  - o teto de quem chama (2,5 s no clique, 15 s na navegacao) continua valendo.
 *
 * Excecao por host (`hostSoDom`): site com conexao viva permanente (Gmail, WhatsApp Web) nunca
 * zera a rede; ali SO a mudanca de DOM conta e a rede e ignorada. Lista em
 * `chrome.storage.local.esperaSoDomHosts` (array de sufixos de dominio) sobrescreve o padrao.
 *
 * Modulo puro (sem `chrome.*`) para o teste unitario importar direto.
 */

export const HOSTS_SO_DOM_PADRAO = ['mail.google.com', 'web.whatsapp.com', 'forca-so-dom.localhost'];

/** Casa por igualdade ou sufixo de dominio, nunca por substring solta. */
export function hostSoDom(url: string | undefined | null, hosts: string[] = HOSTS_SO_DOM_PADRAO): boolean {
  if (!url) return false;
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return hosts.some((h) => {
    const alvo = h.toLowerCase().replace(/^\./, '');
    return host === alvo || host.endsWith(`.${alvo}`);
  });
}

export const IDLE_MS = 500;
export const EXTRA_DOM_MS = 1500;

export interface Medida {
  agora: number;
  armadoEm: number;
  /** Requisicoes em voo que nao sao conexao longa. */
  emVooRecentes: number;
  navegou: boolean;
  carregou: boolean;
  requisicoes: number;
  /** Ultima mudanca de rede/navegacao (base do silencio de rede). */
  ultimaAtividade: number;
  mutacoes: number;
  ultimaMutacao: number;
  /** Quando a rede assentou pela primeira vez (limita o quanto o DOM segura). */
  redeAssentouEm?: number;
}

export interface Politica {
  soDom: boolean;
  /** Silencio de rede apos requisicao (400 ms desde a fase 4). */
  quietoRedeMs: number;
  /** Silencio quando nada de rede aconteceu (250 ms desde a fase 4). */
  quietoSemRedeMs: number;
  idleMs?: number;
  extraDomMs?: number;
}

export interface Veredito { assentou: boolean; redeAssentou: boolean }

export function avaliarAssentamento(m: Medida, p: Politica): Veredito {
  const idle = p.idleMs ?? IDLE_MS;
  const extra = p.extraDomMs ?? EXTRA_DOM_MS;

  if (p.soDom) {
    const necessario = m.mutacoes > 0 ? idle : p.quietoSemRedeMs;
    return { redeAssentou: true, assentou: m.agora - Math.max(m.armadoEm, m.ultimaMutacao) >= necessario };
  }

  const redeLivre = m.emVooRecentes === 0 && (!m.navegou || m.carregou);
  const semRede = m.requisicoes === 0 && !m.navegou;
  const silencioRede = semRede ? p.quietoSemRedeMs : p.quietoRedeMs;
  const redeAssentou = redeLivre && m.agora - m.ultimaAtividade >= silencioRede;
  if (!redeAssentou) return { redeAssentou: false, assentou: false };

  if (m.mutacoes === 0) return { redeAssentou: true, assentou: true };
  const domQuieto = m.agora - m.ultimaMutacao >= idle;
  const estourouExtra = m.redeAssentouEm !== undefined && m.agora - m.redeAssentouEm >= extra;
  return { redeAssentou: true, assentou: domQuieto || estourouExtra };
}

/**
 * Instala (uma vez por documento) um MutationObserver que conta mudancas reais e devolve o
 * contador. Idempotente: chamar de novo so le. Mudanca de `style` nao conta (animacao inline).
 */
export const EXPRESSAO_CONTADOR_DE_MUTACOES = `(function(){
  var w = window, s = w.__ponteMut;
  if (!s) {
    s = w.__ponteMut = { n: 0 };
    try {
      // A propria interface da ponte (#praxedes-agent-ui, o indicador na aba) mexe no DOM ao anexar e nao e
      // a pagina desenhando: se contasse, toda navegacao ganharia ~450 ms (achado ao vivo, esperas X9b).
      var minha = function (n) {
        try {
          var e = n && n.nodeType === 1 ? n : (n && n.parentElement);
          return !!(e && (e.id === 'praxedes-agent-ui' || (e.closest && e.closest('#praxedes-agent-ui'))));
        } catch (x) { return false; }
      };
      var soMinhas = function (lista) {
        for (var j = 0; j < lista.length; j++) if (!minha(lista[j])) return false;
        return true;
      };
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var m = ms[i];
          if (m.type === 'attributes' && m.attributeName === 'style') continue;
          if (m.type === 'childList' && !m.addedNodes.length && !m.removedNodes.length) continue;
          if (m.target && minha(m.target)) continue;
          // <meta> que OUTRA extensao do Chrome coloca no <head>: invisivel, e nao e a pagina desenhando.
          if (m.type === 'childList' && m.target && m.target.nodeName === 'HEAD' && !m.removedNodes.length) {
            var soMeta = true;
            for (var k = 0; k < m.addedNodes.length; k++) if (m.addedNodes[k].nodeName !== 'META') soMeta = false;
            if (soMeta) continue;
          }
          if (m.type === 'childList' && soMinhas(m.addedNodes) && soMinhas(m.removedNodes)) continue;
          s.n++;
        }
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    } catch (e) {}
  }
  return s.n;
})()`;

type Enviar = (metodo: string, params: object) => Promise<unknown>;

/** Le o contador; null se a pagina nao deixou (navegando, sem contexto). Nunca lanca. */
export async function lerContadorDeMutacoes(enviar: Enviar): Promise<number | null> {
  try {
    const r = await enviar('Runtime.evaluate', { expression: EXPRESSAO_CONTADOR_DE_MUTACOES, returnByValue: true }) as
      { result?: { value?: unknown } } | undefined;
    const v = r?.result?.value;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Acompanha o contador entre sondagens: a primeira leitura e so a linha de base; depois, contador
 * diferente (inclusive MENOR, que e documento novo) conta como mudanca — salvo `documentoNovoConta: false`.
 */
export function criarAcompanhante(opcoes: { documentoNovoConta?: boolean } = {}) {
  const documentoNovoConta = opcoes.documentoNovoConta !== false;
  let ultimo: number | null = null;
  return {
    /** Devolve true se houve mudanca desde a sondagem anterior. */
    registrar(n: number | null): boolean {
      if (n === null) return false;
      // Na navegacao (`documentoNovoConta: false`) o contador menor so quer dizer que a leitura anterior foi do documento
      // ANTIGO (o evento de ciclo de vida da aba velha chega primeiro): vira a nova linha de base, nao uma mudanca.
      const mudou = ultimo !== null && n !== ultimo && (documentoNovoConta || n > ultimo);
      ultimo = n;
      return mudou;
    },
  };
}
