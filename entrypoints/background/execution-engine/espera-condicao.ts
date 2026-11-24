/**
 * V1 (20/10/2026) — espera por CONDICAO com teto, no lugar de `setTimeout` fixo.
 *
 * Avalia `cond` logo de cara (sem dormir antes) e a cada `intervaloMs` ate ela
 * dar verdadeiro ou o `tetoMs` acabar. Nunca lanca: erro dentro de `cond` conta
 * como "ainda nao" (pagina re-renderizando, objeto obsoleto), e quem chamou
 * decide o que fazer quando `ok` vem falso — normalmente seguir como seguia
 * depois do tempo fixo, que era o teto.
 *
 * Modulo puro (sem `chrome.*`) para o teste unitario importar direto; `agora` e
 * `dormir` sao injetaveis so para o teste nao depender do relogio.
 */
export async function esperarCondicao(
  cond: () => Promise<boolean>,
  {
    intervaloMs = 50,
    tetoMs,
    agora = () => Date.now(),
    dormir = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }),
  }: {
    intervaloMs?: number;
    tetoMs: number;
    agora?: () => number;
    dormir?: (ms: number) => Promise<void>;
  },
): Promise<{ ok: boolean; ms: number; tentativas: number }> {
  const inicio = agora();
  let tentativas = 0;
  for (;;) {
    tentativas += 1;
    let ok = false;
    try { ok = (await cond()) === true; } catch { ok = false; }
    const decorrido = agora() - inicio;
    if (ok) return { ok: true, ms: decorrido, tentativas };
    const restante = tetoMs - decorrido;
    if (restante <= 0) return { ok: false, ms: decorrido, tentativas };
    await dormir(Math.min(intervaloMs, restante));
  }
}
