import { debuggerManager as dm } from '../../debugger-manager';
import { extrairTextoDoDocs, fatiar, notaDeCorte, rotaGoogleDocs } from '../../execution-engine/google-docs';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * v6.1 (e) — Google Docs: `browser_extract` sem seletor devolve o documento INTEIRO, e a leitura
 * avisa que a arvore nao traz o texto (o Docs desenha em canvas). Ver execution-engine/google-docs.ts.
 *
 * Roda `depois` do extract do motor: se a rota do Docs falhar por qualquer motivo, o resultado
 * original (o que estava na tela) segue intacto.
 */

async function buscarNaPagina(tabId: number, url: string): Promise<string | null> {
  const r = await dm.send<{ result?: { value?: { t?: string } | null } }>(tabId, 'Runtime.evaluate', {
    expression: `(async () => { try { const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' }); `
      + 'if (!r.ok) return null; return { t: await r.text() }; } catch (e) { return null; } })()',
    awaitPromise: true,
    returnByValue: true,
  });
  return r?.result?.value?.t ?? null;
}

async function urlDaAba(tabId: number): Promise<string | undefined> {
  try { return (await chrome.tabs.get(tabId)).url; } catch { return undefined; }
}

async function depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
  if (!r.ok || (ctx.acao !== 'extract' && ctx.acao !== 'read_page')) return r;
  const p = ctx.params as { selector?: string; from_length?: number; max_chars?: number };
  if (ctx.acao === 'extract' && p.selector) return r; // seletor = o agente quer um pedaco da tela
  const rota = rotaGoogleDocs(await urlDaAba(ctx.tabId));
  if (!rota) return r;

  if (ctx.acao === 'read_page') {
    const base = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : {};
    const aviso = 'Google Docs desenha o texto em canvas: esta arvore nao traz o conteudo do documento. '
      + 'Use browser_extract (sem seletor) para ler o documento inteiro de uma vez.';
    const antes = typeof base.avisoLeitura === 'string' && base.avisoLeitura ? `${base.avisoLeitura}; ` : '';
    return { ...r, data: { ...base, avisoLeitura: antes + aviso } };
  }

  try {
    const achado = await extrairTextoDoDocs(rota, (url) => buscarNaPagina(ctx.tabId, url));
    if (!achado) return r;
    const from = typeof p.from_length === 'number' ? p.from_length : 0;
    const max = typeof p.max_chars === 'number' && p.max_chars > 0 ? p.max_chars : 5000;
    return { ...r, data: fatiar(achado.texto, from, max) + notaDeCorte(achado.texto.length, from, max) };
  } catch {
    return r;
  }
}

export const modulo: ModuloCapacidades = {
  nome: 'google-docs',
  capacidades: [],
  ganchos: { depois },
};
