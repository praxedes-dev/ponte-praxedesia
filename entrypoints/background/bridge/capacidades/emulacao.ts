import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';

/** Emula um aparelho, para testar layout sem Playwright. */
export async function emularAparelho(
  tabId: number,
  opts: { largura: number; altura: number; escala?: number; movel?: boolean },
): Promise<string> {
  await dm.send(tabId, 'Emulation.setDeviceMetricsOverride', {
    width: opts.largura,
    height: opts.altura,
    deviceScaleFactor: opts.escala ?? 1,
    mobile: opts.movel ?? false,
  });
  if (opts.movel) {
    await dm.send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  return `emulando ${opts.largura}x${opts.altura}${opts.movel ? ' (movel)' : ''}`;
}

export async function pararEmulacao(tabId: number): Promise<string> {
  await dm.send(tabId, 'Emulation.clearDeviceMetricsOverride', {});
  await dm.send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
  return 'emulacao desligada';
}

export const modulo: ModuloCapacidades = {
  nome: 'emulacao',
  capacidades: [
    {
      nome: 'cap_emular',
      altera: true,
      executar: (ctx) => (ctx.params.desligar
        ? pararEmulacao(ctx.tabId)
        : emularAparelho(ctx.tabId, {
          largura: ctx.params.largura, altura: ctx.params.altura, escala: ctx.params.escala, movel: ctx.params.movel,
        })),
    },
  ],
};
