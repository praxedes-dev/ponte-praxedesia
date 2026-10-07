type AnyParams = Record<string, unknown>;
type MethodListener = (params: AnyParams, sessionId?: string) => void;
type GanchoAoAnexar = (tabId: number) => void | Promise<void>;

class DebuggerManager {
  private sessions = new Set<number>();
  private initialized = false;
  // tabId -> method -> Set<listener>
  private listeners = new Map<number, Map<string, Set<MethodListener>>>();
  /** Funcoes que rodam a cada attach — e a cada reattach, que apaga os listeners da aba. */
  private ganchosAoAnexar: GanchoAoAnexar[] = [];

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    chrome.debugger.onEvent.addListener((source, method, params) => {
      const tabId = source.tabId;
      if (!tabId) return;
      // Evento de sessao FILHA (moldura de outro site, ver molduras.ts): so os
      // de Target.* interessam. O resto (Network, Page, dialogo) e da pagina
      // principal, e os ouvintes antigos nao sabem distinguir de onde veio.
      const sessionId = (source as { sessionId?: string }).sessionId;
      if (sessionId && !method.startsWith('Target.')) return;

      const tabListeners = this.listeners.get(tabId);
      if (tabListeners) {
        const methodListeners = tabListeners.get(method);
        if (methodListeners) {
          methodListeners.forEach((cb) => cb(params as AnyParams, sessionId));
        }
      }
    });

    chrome.debugger.onDetach.addListener((source, reason) => {
      const tabId = source.tabId;
      if (tabId) {
        console.warn(`[Debugger] Detached from tab ${tabId} (${reason})`);
        this.sessions.delete(tabId);
        this.listeners.delete(tabId);
      }
    });
  }

  /**
   * Registra uma funcao para rodar toda vez que o debugger anexa numa aba —
   * no `attach()` inicial e em todo reattach dentro de `send()`.
   *
   * Existe porque `onDetach` (acima) apaga TODOS os listeners da aba: sem isto,
   * o handler de dialogo (ou qualquer outro `on()` de modulo) some depois do
   * primeiro detach e nunca mais volta.
   */
  aoAnexar(fn: GanchoAoAnexar): void {
    this.ganchosAoAnexar.push(fn);
  }

  /** Roda os ganchos de anexar. Um gancho quebrado nao pode impedir o attach. */
  private async rodarGanchosAoAnexar(tabId: number): Promise<void> {
    for (const fn of this.ganchosAoAnexar) {
      try {
        await fn(tabId);
      } catch (err) {
        console.warn('[Debugger] gancho aoAnexar falhou:', err);
      }
    }
  }

  on(tabId: number, method: string, callback: MethodListener): () => void {
    if (!this.listeners.has(tabId)) {
      this.listeners.set(tabId, new Map());
    }
    const tabListeners = this.listeners.get(tabId)!;
    if (!tabListeners.has(method)) {
      tabListeners.set(method, new Set());
    }
    tabListeners.get(method)!.add(callback);

    // Return off() function
    return () => {
      const tls = this.listeners.get(tabId);
      if (tls) {
        const mls = tls.get(method);
        if (mls) mls.delete(callback);
      }
    };
  }

  async attach(tabId: number): Promise<void> {
    this.init();
    if (this.sessions.has(tabId)) return;
    
    await chrome.debugger.attach({ tabId }, '1.3');
    this.sessions.add(tabId);
    
    await this.send(tabId, 'Page.enable');
    await this.send(tabId, 'Runtime.enable');
    await this.send(tabId, 'Network.enable');

    await this.rodarGanchosAoAnexar(tabId);
  }

  async detach(tabId: number): Promise<void> {
    if (!this.sessions.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Tab may already be closed
    }
    this.sessions.delete(tabId);
    this.listeners.delete(tabId);
  }

  async send<T = unknown>(tabId: number, method: string, params?: object, retryCount = 0): Promise<T> {
    try {
      return (await chrome.debugger.sendCommand({ tabId }, method, params ?? {})) as T;
    } catch (err) {
      const msg = String(err);
      
      // Auto-reconnect if detached
      if (msg.includes('Debugger is not attached to the tab') && retryCount < 3) {
        console.log(`[Debugger] Re-attaching to tab ${tabId} (attempt ${retryCount + 1})`);
        this.sessions.delete(tabId);
        await chrome.debugger.attach({ tabId }, '1.3');
        this.sessions.add(tabId);
        
        await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
        await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

        await this.rodarGanchosAoAnexar(tabId);

        return this.send(tabId, method, params, retryCount + 1);
      }
      
      // Reload on timeout
      if (msg.includes('Debugger command timed out') && retryCount < 1) {
        console.log(`[Debugger] Timeout on tab ${tabId}, reloading to recover`);
        await chrome.tabs.reload(tabId);
        await new Promise((r) => setTimeout(r, 2000));
        return this.send(tabId, method, params, retryCount + 1);
      }
      
      throw err;
    }
  }

  /**
   * Comando numa SESSAO FILHA (moldura de outro site anexada por
   * Target.setAutoAttach com flatten). chrome.debugger aceita `sessionId` no
   * Debuggee desde o Chrome 125; os tipos instalados ainda nao sabem disso.
   */
  async sendSessao<T = unknown>(tabId: number, sessionId: string, method: string, params?: object): Promise<T> {
    return (await chrome.debugger.sendCommand(
      { tabId, sessionId } as chrome.debugger.Debuggee, method, params ?? {},
    )) as T;
  }

  isAttached(tabId: number): boolean {
    return this.sessions.has(tabId);
  }

  async screenshot(tabId: number): Promise<string> {
    // A imagem sai em PIXELS CSS, os mesmos de browser_click {x,y}. Sem isto o
    // print vinha em pixel de tela (DPR 1,25 no notebook do Cezar) e o agente
    // que media a coordenada na imagem clicava 25% ao lado (relato de
    // 23/09/2026, "fator ~1.29 sem informar o fator").
    let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
    try {
      const m = await this.send<{ cssVisualViewport?: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } }>(
        tabId, 'Page.getLayoutMetrics', {},
      );
      const dpr = await this.send<{ result?: { value?: number } }>(
        tabId, 'Runtime.evaluate', { expression: 'window.devicePixelRatio', returnByValue: true },
      );
      const vv = m?.cssVisualViewport;
      const razao = Number(dpr?.result?.value) || 1;
      if (vv && razao !== 1) {
        clip = { x: vv.pageX, y: vv.pageY, width: vv.clientWidth, height: vv.clientHeight, scale: 1 / razao };
      }
    } catch {
      // Sem metrica: cai no print cru, como sempre foi.
    }
    const res = await this.send<{ data: string }>(
      tabId,
      'Page.captureScreenshot',
      { format: 'jpeg', quality: 75, optimizeForSpeed: true, ...(clip ? { clip } : {}) },
    );
    return res.data;
  }
}

export const debuggerManager = new DebuggerManager();
