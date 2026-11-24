/**
 * Borda da ponte: "a ponte esta conduzindo esta aba". Escolhe o desenho:
 *
 *   1. fumaca + giro 10 s em WebGL2 (`borda-fumaca.ts`), a aprovada em 21/10/2026;
 *   2. se o navegador nao der WebGL2 (ou o shader nao compilar), a borda CSS de
 *      ondas (`borda-css.ts`), que fica como reserva.
 *
 * Mesma interface para o chamador (agent-indicator.content.ts): `montarBorda`
 * devolve `{ modo, raiz, redimensionar, pausar?, retomar?, destruir }`; a borda
 * nasce invisivel e aparece quando o chamador poe a classe `active` em `raiz`.
 */

import { montarBordaCss, type Borda, type OpcoesBorda } from './borda-css';
import { montarBordaFumaca, type OpcoesFumaca } from './borda-fumaca';

export type { Borda, OpcoesBorda, NivelBorda } from './borda-css';

export interface OpcoesMontagem extends OpcoesFumaca {
  /** Forca a borda CSS de ondas (teste e medicao). */
  forcarCss?: boolean;
}

/** Monta a borda dentro de `shadow` (invisivel; chame `.raiz.classList.add('active')`). */
export function montarBorda(shadow: ShadowRoot, opcoes: OpcoesMontagem = {}): Borda {
  if (!opcoes.forcarCss) {
    try {
      const fumaca = montarBordaFumaca(shadow, opcoes);
      if (fumaca) return fumaca;
    } catch (err) {
      console.debug('[borda] fumaca falhou, usando a borda CSS:', err);
      shadow.querySelectorAll('#agent-borda, style').forEach((e) => e.remove()); // so ha coisa nossa aqui
    }
  }
  return montarBordaCss(shadow, opcoes);
}
