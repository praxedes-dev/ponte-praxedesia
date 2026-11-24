import { ehHostLocal } from '../../painel/avisos';
import { registrarUso } from '../../painel/consumo-sites';
import { tamanhoBruto } from './auditoria';
import type { ContextoCapacidade, ModuloCapacidades, Resultado } from './registro';

/**
 * Alimenta o ranking de sites do painel (painel/consumo-sites.ts): a cada resposta, o
 * host da aba e os caracteres brutos devolvidos; print conta como print, nao como texto
 * (e base64 de imagem). So observa; devolve `r` intacto. Host local/de teste nao entra.
 */
const ACOES_DE_PRINT = new Set(['screenshot', 'cap_print', 'cap_screenshot_ref']);

export const modulo: ModuloCapacidades = {
  nome: 'consumo-ponte',
  capacidades: [],
  ganchos: {
    async depois(ctx: ContextoCapacidade, r: Resultado): Promise<Resultado> {
      try {
        const url = (await chrome.tabs.get(ctx.tabId)).url;
        const host = url ? new URL(url).host : '';
        if (!host || ehHostLocal(host)) return r;
        const print = r.ok && ACOES_DE_PRINT.has(ctx.acao);
        await registrarUso(host, print ? 0 : tamanhoBruto(r), print);
      } catch { /* aba sumiu */ }
      return r;
    },
  },
};
