import { enviarComRetry } from './retry';

type AnyParams = Record<string, unknown>;
type MethodListener = (params: AnyParams, sessionId?: string) => void;
type GanchoAoAnexar = (tabId: number) => void | Promise<void>;

/**
 * Modo simples (Flow, 09/11/2026): a pedido do usuário, nessas paginas a ponte
 * so clica, digita e le. Nada de escutar ou interceptar rede (Network/Fetch),
 * console (Runtime.enable) nem observador instalado na pagina (__ponteMut):
 * a mao o Flow gera, pela ponte voltava "atividade incomum".
 */
const HOSTS_SIMPLES = ['https://flow.google.com/', 'https://labs.google/'];
const METODOS_FORA_DO_SIMPLES = new Set(['Network.enable', 'Runtime.enable', 'Fetch.enable']);
export async function siteSimples(tabId: number): Promise<boolean> {
  const aba = await chrome.tabs.get(tabId).catch(() => null);
  const url = aba?.pendingUrl || aba?.url || '';
  return HOSTS_SIMPLES.some((h) => url.startsWith(h));
}
function proibidoNoSimples(method: string, params?: object): boolean {
  if (METODOS_FORA_DO_SIMPLES.has(method)) return true;
  return method === 'Runtime.evaluate' && String((params as { expression?: string } | undefined)?.expression ?? '').includes('__ponteMut');
}

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

  /** Solta o debugger de TODAS as abas anexadas (botao "Parar tudo"). Devolve quantas soltou. */
  async detachAll(): Promise<number> {
    const abas = [...this.sessions];
    for (const id of abas) await this.detach(id);
    return abas.length;
  }

  /**
   * v6.1 (b): politica de retry em `retry.ts` (leitura repete, acao nunca repete o que pode ter
   * executado). O 4o parametro ficou so por compatibilidade de assinatura e nao e mais usado.
   */
  async send<T = unknown>(tabId: number, method: string, params?: object, _retryCount = 0): Promise<T> {
    if (proibidoNoSimples(method, params) && (await siteSimples(tabId))) return {} as T;
    return enviarComRetry<T>(method, {
      enviar: async () => (await chrome.debugger.sendCommand({ tabId }, method, params ?? {})) as T,
      reanexar: () => this.reanexar(tabId),
      recarregar: () => this.recarregar(tabId),
      log: (msg) => console.log(`[Debugger] tab ${tabId}: ${msg}`),
    });
  }

  /** Anexa de novo (a sessao morreu) e refaz os enables e os ganchos de modulo. */
  private async reanexar(tabId: number): Promise<void> {
    this.sessions.delete(tabId);
    try { await chrome.debugger.detach({ tabId }); } catch { /* ja solto */ }
    await chrome.debugger.attach({ tabId }, '1.3');
    this.sessions.add(tabId);

    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    if (!(await siteSimples(tabId))) {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    }

    await this.rodarGanchosAoAnexar(tabId);
  }

  /** Recarrega a aba e espera `status: complete` (ate 10 s). Leitura que travou, uma vez. */
  private async recarregar(tabId: number): Promise<void> {
    await chrome.tabs.reload(tabId);
    const limite = Date.now() + 10_000;
    await new Promise((r) => setTimeout(r, 500));
    while (Date.now() < limite) {
      const aba = await chrome.tabs.get(tabId).catch(() => null);
      if (!aba || aba.status === 'complete') break;
      await new Promise((r) => setTimeout(r, 200));
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
    // print vinha em pixel de tela (DPR 1,25 no notebook do usuário) e o agente
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
    const res = await this.capturarComReserva(tabId, { format: 'jpeg', quality: 75, optimizeForSpeed: true, ...(clip ? { clip } : {}) });
    return res.data;
  }

  /**
   * Janela da ponte minimizada que nunca foi desenhada (28/10/2026): o
   * Page.captureScreenshot espera um quadro que nao vem e trava 60 s. Sem
   * resposta em 2,5 s, abre a janela sem foco um instante para ela desenhar uma
   * vez e devolve ao minimizado (fromSurface:false o Chrome recusa). Depois do
   * primeiro desenho os prints minimizados voltam a sair sozinhos.
   */
  private async capturarComReserva(tabId: number, params: Record<string, unknown>): Promise<{ data: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<null>((r) => { timer = setTimeout(() => r(null), 2_500); });
    try {
      const rapido = await Promise.race([this.send<{ data: string }>(tabId, 'Page.captureScreenshot', params), prazo]);
      if (rapido) return rapido;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const { windowId } = await chrome.tabs.get(tabId);
    const { state } = await chrome.windows.get(windowId);
    if (state !== 'minimized') return this.send<{ data: string }>(tabId, 'Page.captureScreenshot', params);
    await chrome.windows.update(windowId, { state: 'normal', focused: false });
    try {
      // Teto (03/11/2026): este print segura a vez da janela; preso, travava a
      // digitacao dos outros agentes por 90 s.
      let t2: ReturnType<typeof setTimeout> | undefined;
      const teto = new Promise<never>((_, rej) => { t2 = setTimeout(() => rej(new Error('o print nao saiu em 15 s (janela da ponte ocupada); tente de novo')), 15_000); });
      return await Promise.race([this.send<{ data: string }>(tabId, 'Page.captureScreenshot', params), teto]).finally(() => clearTimeout(t2));
    } finally {
      await chrome.windows.update(windowId, { state: 'minimized' }).catch(() => {});
    }
  }

  /**
   * X5: print da janela em PIXELS CSS (os mesmos de browser_click {x,y}). `data` vem
   * SEM reducao; `fator` (< 1 quando a janela e maior que `maxW` x `maxH`, padrao 1280x800)
   * diz quanto quem chama deve reduzir; o agente divide a coordenada da imagem por ele.
   * Print de 1280x800 custa ~1.400 tokens; um de 1920x1080, ~2.700.
   */
  async capturarTela(
    tabId: number, { maxW = 1280, maxH = 800 }: { maxW?: number; maxH?: number } = {},
  ): Promise<{ data: string; fator: number; cssW: number; cssH: number; w: number; h: number }> {
    let cssW = 0;
    let cssH = 0;
    let pageX = 0;
    let pageY = 0;
    let razao = 1;
    try {
      const m = await this.send<{ cssVisualViewport?: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } }>(
        tabId, 'Page.getLayoutMetrics', {},
      );
      const dpr = await this.send<{ result?: { value?: number } }>(
        tabId, 'Runtime.evaluate', { expression: 'window.devicePixelRatio', returnByValue: true },
      );
      const vv = m?.cssVisualViewport;
      if (vv) { cssW = vv.clientWidth; cssH = vv.clientHeight; pageX = vv.pageX; pageY = vv.pageY; }
      razao = Number(dpr?.result?.value) || 1;
    } catch {
      // Sem metrica: print cru, sem reducao.
    }
    const fator = cssW > 0 && cssH > 0 ? Math.min(1, maxW / cssW, maxH / cssH) : 1;
    // Captura sempre em pixel CSS (escala 1/razao). A reducao por `fator` e feita depois, no canvas:
    // clip.scale < 1 travou o Page.captureScreenshot por 60 s com a janela emulada em 1920x1080.
    const clip = cssW > 0 && razao !== 1
      ? { x: pageX, y: pageY, width: cssW, height: cssH, scale: 1 / razao }
      : undefined;
    const res = await this.capturarComReserva(tabId, { format: 'jpeg', quality: 75, optimizeForSpeed: true, ...(clip ? { clip } : {}) });
    return {
      data: res.data, fator, cssW, cssH,
      w: Math.round(cssW * fator), h: Math.round(cssH * fator),
    };
  }
}

export const debuggerManager = new DebuggerManager();
