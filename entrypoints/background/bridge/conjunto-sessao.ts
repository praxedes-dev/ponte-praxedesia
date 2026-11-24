/**
 * Conjunto de ids de aba espelhado em chrome.storage.session.
 *
 * O service worker MV3 morre e leva as variaveis junto. Sem espelho, a ponte
 * esquecia quais abas ela mesma abriu (nunca mais as fechava) e quais eram do
 * usuario por adocao.
 *
 * `local` (29/10/2026): storage.session tambem some ao RECARREGAR a extensao, e
 * as abas de antes da recarga ficavam abertas para sempre na janela da ponte.
 * Com `local` a lista sobrevive; ao abrir o Chrome (ids novos) ela e zerada.
 */
export class ConjuntoSessao extends Set<number> {
  private salvando: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly chave: string, private readonly area: 'session' | 'local' = 'session') {
    super();
    if (area === 'local') {
      chrome.runtime.onStartup.addListener(() => { void chrome.storage.local.remove(chave); });
    }
  }

  /** Recarrega do storage, descartando o que ja nao e aba viva. Chamar uma vez ao iniciar. */
  async restaurar(): Promise<number> {
    try {
      const guardado = (await chrome.storage[this.area].get(this.chave))[this.chave];
      if (!Array.isArray(guardado)) return 0;
      for (const id of guardado) {
        if (typeof id !== 'number') continue;
        const viva = await chrome.tabs.get(id).then(() => true, () => false);
        if (viva) super.add(id);
      }
    } catch {
      // Sem storage.session: segue so com a memoria, como antes.
    }
    return this.size;
  }

  override add(id: number): this {
    super.add(id);
    this.agendar();
    return this;
  }

  override delete(id: number): boolean {
    const r = super.delete(id);
    if (r) this.agendar();
    return r;
  }

  override clear(): void {
    super.clear();
    this.agendar();
  }

  private agendar(): void {
    if (this.salvando) return;
    // Janela curta so para juntar varias alteracoes seguidas numa gravacao.
    this.salvando = setTimeout(() => {
      this.salvando = null;
      chrome.storage[this.area].set({ [this.chave]: [...this] }).catch(() => {});
    }, 100);
  }
}
