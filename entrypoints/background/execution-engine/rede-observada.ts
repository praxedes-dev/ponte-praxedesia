import { debuggerManager as dm } from '../debugger-manager';
import { LONGA_MS } from './cdp-tools';

/**
 * V1: observa a rede da aba durante uma acao (preencher campo, rolar, escolher
 * sugestao), para trocar "dorme N ms para o framework assentar" por uma
 * condicao: a acao disparou AJAX? Se disparou, espera ele TERMINAR; se nao,
 * basta o piso curto. Mesma regra de conexao longa do assentar.ts: pedido
 * aberto ha mais de LONGA_MS (canal ao vivo) nao conta. Arme ANTES da acao.
 */
export function observarRede(tabId: number) {
  const emVoo = new Map<string, number>();
  let ultima = Date.now();
  let viu = 0;
  const offs = [
    dm.on(tabId, 'Network.requestWillBeSent', (p: any) => { emVoo.set(String(p.requestId), Date.now()); ultima = Date.now(); viu += 1; }),
    dm.on(tabId, 'Network.loadingFinished', (p: any) => { if (emVoo.delete(String(p.requestId))) ultima = Date.now(); }),
    dm.on(tabId, 'Network.loadingFailed', (p: any) => { if (emVoo.delete(String(p.requestId))) ultima = Date.now(); }),
  ];
  return {
    viu: () => viu,
    /** Sem pedido recente em voo e quieta ha pelo menos `quietoMs`. */
    quieta(quietoMs: number): boolean {
      const agora = Date.now();
      for (const t of emVoo.values()) if (agora - t < LONGA_MS) return false;
      return agora - ultima >= quietoMs;
    },
    parar() { for (const off of offs) off(); },
  };
}
