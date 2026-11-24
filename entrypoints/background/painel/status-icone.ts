/**
 * Icone da barra do Chrome como termometro da ponte:
 *  - badge com o numero de agentes conectados (laranja; some quando e zero);
 *  - icone LARANJA enquanto algum comando roda, CINZA quando ocioso.
 *
 * Leve de proposito: so troca o que mudou. O badge so e reescrito quando o numero
 * muda; o icone so quando muda entre "rodando" e "ocioso" — nada de redesenhar a
 * cada comando. Os dois conjuntos (16 e 32 px) sao PNGs prontos da marca F, laranja
 * e cinza, gerados a partir de public/logo/F-16.svg, F-32.svg e F-cinza-*.svg. Sao
 * lidos uma vez e ficam em cache.
 */

export type Estilo = 'ocioso' | 'rodando';

const LARANJA = '#ff7a00';
const TAMANHOS = [16, 32];

/** O que `atualizarStatus` deve fazer dado o estado anterior e o novo. Pura, para o teste. */
export function decidirMudanca(
  antes: { agentes: number | null; rodando: boolean | null },
  agentes: number,
  rodando: boolean,
): { badge: boolean; icone: boolean } {
  return { badge: antes.agentes !== agentes, icone: antes.rodando !== rodando };
}

const ultimo: { agentes: number | null; rodando: boolean | null } = { agentes: null, rodando: null };
/** Para diagnostico (`cap_painel`): o que foi aplicado de verdade. */
export const aplicado: { estilo: Estilo | null; badge: string | null; icones: number } = {
  estilo: null, badge: null, icones: 0,
};

const cache = new Map<Estilo, Record<string, ImageData>>();

async function desenhar(estilo: Estilo): Promise<Record<string, ImageData>> {
  const pronto = cache.get(estilo);
  if (pronto) return pronto;

  const out: Record<string, ImageData> = {};
  for (const S of TAMANHOS) {
    const resp = await fetch(chrome.runtime.getURL(`icon-status-${estilo}-${S}.png`));
    const bitmap = await createImageBitmap(await resp.blob());
    const tela = new OffscreenCanvas(S, S);
    const g = tela.getContext('2d')!;
    g.drawImage(bitmap, 0, 0, S, S);
    out[String(S)] = g.getImageData(0, 0, S, S);
  }
  cache.set(estilo, out);
  return out;
}

let emCurso: Promise<void> = Promise.resolve();
let pedido: { agentes: number; rodando: boolean } | null = null;

/** Aplica o estado mais recente; chamadas em rajada colapsam numa so (ultima vence). */
export function atualizarStatus(agentes: number, rodando: boolean): Promise<void> {
  pedido = { agentes, rodando };
  emCurso = emCurso.then(async () => {
    const p = pedido;
    pedido = null;
    if (!p) return;
    const mudou = decidirMudanca(ultimo, p.agentes, p.rodando);
    try {
      if (mudou.badge) {
        const texto = p.agentes > 0 ? String(p.agentes) : '';
        await chrome.action.setBadgeText({ text: texto });
        if (p.agentes > 0) {
          await chrome.action.setBadgeBackgroundColor({ color: LARANJA });
          await (chrome.action as unknown as { setBadgeTextColor?: (d: { color: string }) => Promise<void> })
            .setBadgeTextColor?.({ color: '#1a1006' });
        }
        ultimo.agentes = p.agentes;
        aplicado.badge = texto;
      }
      if (mudou.icone) {
        const estilo: Estilo = p.rodando ? 'rodando' : 'ocioso';
        await chrome.action.setIcon({ imageData: await desenhar(estilo) });
        ultimo.rodando = p.rodando;
        aplicado.estilo = estilo;
        aplicado.icones++;
      }
    } catch (err) {
      // Icone e enfeite: nunca derruba comando. Tenta de novo na proxima mudanca.
      console.warn('[Status] nao consegui atualizar o icone:', err);
    }
  });
  return emCurso;
}
