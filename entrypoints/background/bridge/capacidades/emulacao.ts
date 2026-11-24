import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';

/**
 * Abas com emulacao pedida pelo agente (browser_emulate_device). A ponte tambem emula 1280x800 numa
 * janela minimizada (garantirJanelaDesenhada); sem este registro ela sobrescrevia a emulacao do agente
 * a cada comando e o aparelho nunca "pegava" (achado ao vivo na v6.1, 21/10/2026).
 */
export const emulacaoDoAgente = new Set<number>();
try { chrome.tabs?.onRemoved?.addListener((id) => emulacaoDoAgente.delete(id)); } catch { /* teste sem chrome */ }

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
  emulacaoDoAgente.add(tabId);
  return `emulando ${opts.largura}x${opts.altura}${opts.movel ? ' (movel)' : ''}`;
}

export async function pararEmulacao(tabId: number): Promise<string> {
  emulacaoDoAgente.delete(tabId);
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
