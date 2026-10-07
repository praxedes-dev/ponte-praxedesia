import { waitForNetworkIdle } from '../../execution-engine/cdp-tools';
import type { ModuloCapacidades } from './registro';

/** Espera a rede acalmar, para ler a pagina sem chutar um sleep. */
export async function esperarRede(tabId: number, maxWaitMs = 15000): Promise<void> {
  await waitForNetworkIdle(tabId, { maxWaitMs });
}

export const modulo: ModuloCapacidades = {
  nome: 'rede',
  capacidades: [
    {
      nome: 'cap_wait_network',
      executar: async (ctx) => {
        await esperarRede(ctx.tabId, ctx.params.max_wait_ms);
        return 'rede acalmou';
      },
    },
  ],
};
