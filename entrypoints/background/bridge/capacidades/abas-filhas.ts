import type { ContextoCapacidade, ModuloCapacidades } from './registro';

/**
 * Aba filha da ponte (obra 08, docs/obra-20260904/08-abas-filhas-download-nativo-e-aba-do-usuario.md).
 *
 * Quando uma pagina abre outra aba (window.open, target="_blank", um popup de
 * login), o agente precisa achar essa aba nova para trabalhar nela — "clique
 * aqui e pegue o PDF onde ele aparecer" so funciona se alguem souber que ele
 * apareceu. `bridge/index.ts` registra aqui, no `chrome.tabs.onCreated`, toda
 * aba cujo `openerTabId` e uma aba que a ponte conhece (dela ou adotada do
 * usuario); `cap_wait_new_tab` consome esse registro.
 *
 * Este modulo so guarda o registro e serve `cap_wait_new_tab` — quem decide
 * SE a filha entra em `abasCriadasPelaPonte` (so quando o opener e da ponte) e
 * `bridge/index.ts`, porque so ele tem esse conjunto.
 */

export interface FilhaRegistrada {
  tabId: number;
  url: string;
  quando: number;
  /** true quando o opener era aba da PONTE; false quando era aba adotada do usuario. */
  daPonte: boolean;
  reportada: boolean;
}

/** Filhas por openerTabId. So existe entrada enquanto alguma ainda nao foi reportada a um wait. */
const filhasPorOpener = new Map<number, FilhaRegistrada[]>();

/** Chamado por `bridge/index.ts` no `chrome.tabs.onCreated`, nunca por aqui. */
export function registrarFilha(
  openerTabId: number,
  filha: { tabId: number; url: string; quando: number; daPonte: boolean },
): void {
  const lista = filhasPorOpener.get(openerTabId) ?? [];
  lista.push({ ...filha, reportada: false });
  filhasPorOpener.set(openerTabId, lista);
}

/** A primeira filha ainda nao reportada deste opener, marcando-a reportada. */
function pegarNaoReportada(openerTabId: number): FilhaRegistrada | undefined {
  const lista = filhasPorOpener.get(openerTabId);
  if (!lista) return undefined;
  const filha = lista.find((f) => !f.reportada);
  if (filha) filha.reportada = true;
  return filha;
}

// Aba opener fechada: ninguem mais vai esperar filha dela. Sem isto o mapa
// cresce para sempre com abas que ja sumiram (vazamento pequeno, sem uso).
chrome.tabs.onRemoved.addListener((tabId) => {
  filhasPorOpener.delete(tabId);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const modulo: ModuloCapacidades = {
  nome: 'abas-filhas',
  capacidades: [
    {
      nome: 'cap_wait_new_tab',
      // Nao altera a pagina nem despacha input: so LE um registro e, no
      // maximo, `chrome.tabs.get` da filha. Roda liso na aba do usuario
      // tambem (achar que abriu uma filha e leitura, nao acao).
      async executar(ctx: ContextoCapacidade): Promise<unknown> {
        const timeoutMs = (ctx.params.timeout_ms as number | undefined) ?? 10_000;
        const inicio = Date.now();

        let filha: FilhaRegistrada | undefined;
        while (Date.now() - inicio < timeoutMs) {
          filha = pegarNaoReportada(ctx.tabId);
          if (filha) break;
          await sleep(200);
        }

        if (!filha) {
          // NAO e erro: a pagina provavelmente navegou na propria aba (o caso
          // mais comum de emissao de guia no PJe). Um throw aqui reproduziria
          // a guia orfa do achado que abriu esta obra — o agente leria "falhou"
          // quando na verdade so nao abriu aba nenhuma.
          return {
            abaNova: null,
            mensagem: `nenhuma aba filha em ${Math.round(timeoutMs / 1000)}s — a pagina provavelmente `
              + 'navegou na propria aba; leia-a com browser_read_page antes de repetir qualquer clique',
          };
        }

        // `tab.url`/`pendingUrl` no onCreated e so um palpite — a URL final so
        // chega no onUpdated. Espera ate 3s por 'complete' e releo agora.
        const fimEspera = Date.now() + 3000;
        let tab: chrome.tabs.Tab | undefined;
        while (Date.now() < fimEspera) {
          try {
            tab = await chrome.tabs.get(filha.tabId);
            if (tab.status === 'complete') break;
          } catch {
            break; // a aba sumiu antes mesmo de terminar de carregar
          }
          await sleep(150);
        }

        return {
          abaNova: {
            tabId: filha.tabId,
            url: tab?.url ?? filha.url,
            titulo: tab?.title ?? '',
            janela: tab?.windowId,
            daPonte: filha.daPonte,
          },
          mensagem: 'use browser_tab_switch { tabId } para trabalhar nela',
        };
      },
    },
  ],
};
