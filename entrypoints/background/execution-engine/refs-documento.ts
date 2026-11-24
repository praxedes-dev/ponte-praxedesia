import { debuggerManager as dm } from '../debugger-manager';

/**
 * L4 (fase 4): o ref (backendNodeId) so vale no documento em que foi lido. Cada leitura
 * guarda o loaderId do frame principal da aba; clique/digitacao por ref com loaderId
 * diferente falham com mensagem clara em vez de agir num no que nao e mais o mesmo.
 *
 * Memoria + chrome.storage.session: o service worker MV3 dorme e perde o Map.
 * Sem leitura registrada (ref de outra sessao), nao ha o que comparar: deixa passar.
 */
const CHAVE = 'refsLoader';
const memoria = new Map<number, string>();

export async function registrarLeitura(tabId: number, loaderId: string): Promise<void> {
  memoria.set(tabId, loaderId);
  try {
    const atual = (await chrome.storage.session.get(CHAVE))[CHAVE] as Record<string, string> | undefined;
    await chrome.storage.session.set({ [CHAVE]: { ...(atual ?? {}), [String(tabId)]: loaderId } });
  } catch { /* sem storage.session: so memoria */ }
}

async function loaderGuardado(tabId: number): Promise<string | undefined> {
  const m = memoria.get(tabId);
  if (m) return m;
  try {
    const atual = (await chrome.storage.session.get(CHAVE))[CHAVE] as Record<string, string> | undefined;
    return atual?.[String(tabId)];
  } catch {
    return undefined;
  }
}

/** Devolve a mensagem de erro se o documento da aba trocou desde a ultima leitura; undefined se ok. */
export async function documentoTrocou(tabId: number): Promise<string | undefined> {
  const guardado = await loaderGuardado(tabId);
  if (!guardado) return undefined;
  let atual: string | undefined;
  try {
    const r = await dm.send<{ frameTree?: { frame?: { loaderId?: string } } }>(tabId, 'Page.getFrameTree');
    atual = r?.frameTree?.frame?.loaderId;
  } catch { return undefined; }
  if (!atual || atual === guardado) return undefined;
  return 'documento trocou desde a leitura (a pagina navegou ou recarregou): esse ref e de outra pagina. '
    + 'Releia com browser_read_page ou browser_find e use a ref nova.';
}

chrome.tabs.onRemoved.addListener((tabId) => { memoria.delete(tabId); });
