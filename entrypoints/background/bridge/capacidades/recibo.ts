import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';
import { filhasDesde } from './abas-filhas';

/**
 * C1 (fase 4): recibo em click / type / press_key / navigate. O que a acao CAUSOU, so os
 * campos que aconteceram (nenhum campo = resposta identica a de antes):
 *   aba_nova  -> abriu aba/popup (openerTabId); usar browser_tab_switch {tabId}
 *   url       -> a URL da aba mudou
 *   download  -> um download comecou durante a acao (provavel: o Chrome nao diz de que aba)
 * Dialogo nativo NAO entra aqui: o modulo `dialogo` ja transforma em erro [dialogo aberto].
 *
 * Roda DEPOIS de assentar/confirmar (ordem em capacidades/index.ts), entao ja viu o que o
 * clique disparou. Nao espera nada: custo = dois chrome.tabs.get.
 */
const ACOES = new Set(['click', 'cap_click_xy', 'type', 'cap_digitar', 'press_key', 'navigate']);

interface Antes { inicio: number; url?: string }
const porCtx = new WeakMap<ContextoCapacidade, Antes>();

const downloadsRecentes: Array<{ quando: number; nome: string }> = [];
try {
  chrome.downloads?.onCreated?.addListener((item) => {
    const bruto = item.filename || item.finalUrl || item.url || '';
    const nome = decodeURIComponent(bruto.split(/[\/]/).filter(Boolean).pop() ?? '').slice(0, 120);
    downloadsRecentes.push({ quando: Date.now(), nome });
    while (downloadsRecentes.length > 20) downloadsRecentes.shift();
  });
} catch { /* sem permissao de downloads: sem esse campo */ }

const urlDa = async (tabId: number): Promise<string | undefined> => {
  try { return (await chrome.tabs.get(tabId)).url; } catch { return undefined; }
};

export const modulo: ModuloCapacidades = {
  nome: 'recibo',
  capacidades: [],
  ganchos: {
    async antes(ctx: ContextoCapacidade) {
      if (!ACOES.has(ctx.acao)) return;
      try { porCtx.set(ctx, { inicio: Date.now(), url: await urlDa(ctx.tabId) }); } catch { /* anotacao nunca custa a acao */ }
    },
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      const a = porCtx.get(ctx);
      if (!a || !r.ok) return r;
      try {
        const recibo: Record<string, unknown> = {};
        const filhas = filhasDesde(ctx.tabId, a.inicio);
        if (filhas.length) {
          recibo.aba_nova = await Promise.all(filhas.map(async (f) => {
            // a URL do onCreated costuma vir vazia; a aba ja existe, entao pergunta de novo
            const t = await chrome.tabs.get(f.tabId).catch(() => undefined);
            return { tabId: f.tabId, url: t?.url || t?.pendingUrl || f.url };
          }));
        }
        const url = await urlDa(ctx.tabId);
        if (url && a.url && url !== a.url) recibo.url = url;
        const dl = downloadsRecentes.filter((d) => d.quando >= a.inicio);
        if (dl.length) recibo.download = dl.map((d) => d.nome).join(', ') || 'iniciado';
        if (!Object.keys(recibo).length) return r;
        const d = r.data;
        if (d === undefined || d === null) return { ...r, data: { recibo } };
        if (typeof d === 'object' && !Array.isArray(d)) return { ...r, data: { ...(d as object), recibo } };
        return r;
      } catch {
        return r;
      }
    },
  },
};
