/**
 * V2 (20/10/2026) — espera por CONDICAO no lugar do `setTimeout(150)` fixo
 * depois do scrollIntoView.
 *
 * Le o valor (aqui, o retangulo do elemento) a cada `intervaloMs` e para na
 * primeira vez que duas leituras seguidas dao o mesmo valor, ou quando chega
 * em `tetoMs`. Elemento ja parado custa uma leitura de ida e volta (~2 x 30 ms
 * no pior caso); rolagem suave ainda em curso espera ate o teto, como antes
 * esperava 150 ms de qualquer jeito.
 *
 * Modulo puro (sem `chrome.*`) para o teste unitario importar direto. `agora` e
 * `dormir` sao injetaveis so para o teste nao depender do relogio.
 */
export async function aguardarEstavel<T>(
  ler: () => Promise<T | null | undefined>,
  {
    intervaloMs = 30,
    tetoMs = 500,
    leiturasIguais = 2,
    agora = () => Date.now(),
    dormir = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); }),
  }: {
    intervaloMs?: number;
    tetoMs?: number;
    /** Quantas leituras SEGUIDAS iguais valem como "parou" (padrao 2). Rolagem com lazy-load pede 3. */
    leiturasIguais?: number;
    agora?: () => number;
    dormir?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ estavel: boolean; leituras: number; valor: T | null }> {
  const inicio = agora();
  let anterior: string | undefined;
  let seguidas = 1;
  let ultimo: T | null = null;
  let leituras = 0;
  for (;;) {
    let atual: T | null | undefined;
    try {
      atual = await ler();
    } catch {
      // Objeto obsoleto etc.: quem vem depois (passo 3a/3b) trata; nao e aqui que se falha.
      return { estavel: false, leituras, valor: ultimo };
    }
    leituras += 1;
    if (atual === null || atual === undefined) return { estavel: false, leituras, valor: ultimo };
    ultimo = atual;
    const chave = JSON.stringify(atual);
    if (chave === anterior) {
      seguidas += 1;
      if (seguidas >= leiturasIguais) return { estavel: true, leituras, valor: ultimo };
    } else {
      seguidas = 1;
    }
    anterior = chave;
    if (agora() - inicio >= tetoMs) return { estavel: false, leituras, valor: ultimo };
    await dormir(intervaloMs);
  }
}
