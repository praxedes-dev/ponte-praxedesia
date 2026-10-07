import type { ModuloCapacidades } from './registro';

/**
 * Ritmo de navegacao por host de tribunal/JusBrasil — global para todos os
 * agentes da ponte, porque a extensao e UM processo so.
 *
 * Em 03/09/2026 cinco agentes abriram o SCON em sequencia e prenderam a aba
 * do Chrome real no desafio da Cloudflare por mais de dez minutos (memoria
 * `reference_stj-scon-cloudflare.md`); o WAF do TJ-RO bloqueia por ritmo
 * devolvendo 200 com "suspeita de robotizacao" (memoria
 * `reference_juris-tjro-backend.md`). "Espace as requisicoes" era so texto de
 * skill, facil de esquecer — este gancho espaca sozinho, sem bloquear:
 * atrasa o `navigate` o quanto falte para completar `ritmoMs` desde a ultima
 * vez que ALGUM agente navegou para aquele host (mapa de MODULO, nao por
 * agente — e a rajada de 03/09 foi cinco agentes, uma abertura cada).
 *
 * Nao bloqueia com erro de proposito: um erro faria o agente repetir a
 * navegacao, o que so piora a rajada que isto existe para evitar.
 */

const HOSTS_PADRAO = ['.jus.br', 'jusbrasil.com.br'];
const RITMO_MS_PADRAO = 4000;

/** Ultimo `navigate` bem-sucedido por host, de TODOS os agentes. */
const ultimoNavigate = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Casa por sufixo, no padrao de `policy.ts:47-55` (`hostFinanceiro`) — com uma
 * diferenca: aqui a lista ja guarda o ponto do sufixo quando faz falta
 * (`.jus.br`), entao o teste e so `===`/`endsWith` direto, sem inserir outro
 * ponto (`jusbrasil.com.br` casa `www.jusbrasil.com.br` do jeito que esta).
 */
function casaHost(host: string, hosts: string[]): string | undefined {
  return hosts.find((h) => host === h || host.endsWith(h));
}

export const modulo: ModuloCapacidades = {
  nome: 'ritmo',
  capacidades: [],
  ganchos: {
    async antes(ctx) {
      if (ctx.acao !== 'navigate') return;

      const url = ctx.params.url as string | undefined;
      if (!url) return;

      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        // URL invalida: quem vai reclamar e o proprio `navigate` (execution-engine),
        // nao este gancho.
        return;
      }

      const { ritmoHosts, ritmoMs } = await chrome.storage.local.get(['ritmoHosts', 'ritmoMs']);
      const hosts = Array.isArray(ritmoHosts) ? (ritmoHosts as string[]) : HOSTS_PADRAO;
      if (!casaHost(host, hosts)) return;

      const n = typeof ritmoMs === 'number' ? ritmoMs : RITMO_MS_PADRAO;
      const anterior = ultimoNavigate.get(host);
      if (anterior !== undefined) {
        const delta = Date.now() - anterior;
        if (delta < n) {
          const espera = n - delta;
          console.log(`[ritmo] esperei ${espera}ms antes de navegar em ${host}`);
          await sleep(espera);
        }
      }
      // Registra DEPOIS da espera: e o timestamp da navegacao que esta prestes
      // a acontecer, nao o do pedido que chegou.
      ultimoNavigate.set(host, Date.now());
    },
  },
};
