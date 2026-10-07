import { debuggerManager as dm } from '../../debugger-manager';
import { esperarRede } from './rede';
import type { ModuloCapacidades } from './registro';

/**
 * Voltar/avancar no historico da aba, sem passar por `navigate` de novo.
 *
 * O briefing (docs/obra-20260904/12-navegacao-voltar-e-ritmo-por-host.md)
 * supunha `chrome.tabs.goBack`/`goForward` — MEDIDO e descartado (05/09/2026):
 * logo depois de um `navigate` (que usa `Page.navigate` via CDP,
 * `cdp-tools.ts:823`), as duas rejeitam SEMPRE com "Cannot find a next page
 * in history.", mesmo com `history.length` mostrando as entradas certas e com
 * ate 800ms de espera entre o navigate e a chamada (sem padrao de tempo:
 * testei 0/50/100/200/300/500/800ms, todas falharam do mesmo jeito). Rodar
 * `history.back()`/`history.forward()` por JS ANTES fazia
 * `chrome.tabs.goBack` passar a funcionar depois — ou seja, o defeito e das
 * DUAS APIs de aba do proprio Chrome com entradas de historico criadas por
 * `Page.navigate`, nao de tempo de espera. Foram embora; ficou CDP puro
 * (`Page.getNavigationHistory` + `Page.navigateToHistoryEntry`), que opera
 * sobre a MESMA lista de sessao que `Page.navigate` escreve — sem essa
 * incompatibilidade. Isto contraria o "nao implemente back por
 * Page.navigateToHistoryEntry" do briefing, escrito supondo que a API de aba
 * bastava; a medicao mostrou o contrario e o relatorio desta obra registra o
 * porque.
 */

interface EntradaHistorico {
  id: number;
  url: string;
  title: string;
}

interface HistoricoDeNavegacao {
  currentIndex: number;
  entries: EntradaHistorico[];
}

async function navegarNoHistorico(
  tabId: number,
  direcao: 'back' | 'forward',
): Promise<{ url?: string; titulo?: string }> {
  const { currentIndex, entries } = await dm.send<HistoricoDeNavegacao>(tabId, 'Page.getNavigationHistory');
  const alvo = direcao === 'back' ? currentIndex - 1 : currentIndex + 1;

  if (alvo < 0 || alvo >= entries.length) {
    const sentido = direcao === 'back' ? 'anterior' : 'seguinte';
    throw new Error(`nao ha pagina ${sentido} no historico desta aba — use browser_navigate`);
  }

  await dm.send(tabId, 'Page.navigateToHistoryEntry', { entryId: entries[alvo].id });

  // Mesma pegadinha do `Page.navigate` (cdp-tools.ts:823-826): o comando
  // resolve antes de a pagina carregar. Sem esperar a rede, o agente leria a
  // pagina antiga ainda na tela.
  await esperarRede(tabId, 3000);
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url, titulo: tab.title };
}

export const modulo: ModuloCapacidades = {
  nome: 'historico',
  capacidades: [
    {
      nome: 'cap_back',
      // `altera: true` e o que faz `bridge/index.ts` barrar isto na aba do
      // usuario em modo leitura, antes mesmo de os ganchos "antes" rodarem —
      // sem isto, browser_back reabriria o furo que a obra 01 fechou para
      // browser_navigate (briefing, "Defeito irmao").
      altera: true,
      input: false,
      executar: (ctx) => navegarNoHistorico(ctx.tabId, 'back'),
    },
    {
      nome: 'cap_forward',
      altera: true,
      input: false,
      executar: (ctx) => navegarNoHistorico(ctx.tabId, 'forward'),
    },
  ],
};
