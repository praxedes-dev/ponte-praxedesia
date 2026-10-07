import { v4 as uuidv4 } from 'uuid';
import { debuggerManager } from '../debugger-manager';
import type {
  AgentWorkspace,
  ProviderConfig,
  WorkspaceStatus,
} from '../../../shared/types';

class WorkspaceManager {
  private readyPromise: Promise<void>;
  private workspaces = new Map<string, AgentWorkspace>();

  private async saveWorkspaces() {
    const serializedWorkspaces = Object.fromEntries(this.workspaces.entries());
    await chrome.storage.local.set({ workspaces: serializedWorkspaces });
  }

  private async loadWorkspaces() {
    const storedData = await chrome.storage.local.get('workspaces');
    const raw = storedData.workspaces as Record<string, AgentWorkspace> | undefined;
    if (!raw) return;

    this.workspaces = new Map(
      Object.entries(raw).map(([workspaceId, workspace]) => [
        workspaceId,
        {
          ...workspace,
          tabs: workspace.tabs ?? {},
          queue: workspace.queue ?? [],
          executedActions: workspace.executedActions ?? [],
          conversationHistory: workspace.conversationHistory ?? [],
          pageObservations: workspace.pageObservations ?? [],
          tokenUsage: workspace.tokenUsage ?? { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
        },
      ]),
    );
    console.log('[WorkspaceManager] Workspaces successfully loaded.');
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  private persistSoon(): void {
    void this.saveWorkspaces();
  }

  constructor() {
    this.readyPromise = this.loadWorkspaces().catch(err => {
      console.error('[WorkspaceManager] Failed to load workspaces:', err);
    });
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      // Chrome unloads tabs to save memory. When discarding happens, the debugger detaches.
      // We automatically reload the tab and re-attach the debugger to keep the agent running.
      if (changeInfo.discarded) {
        const ws = Array.from(this.workspaces.values()).find(w => w.tabs[tabId] != null);
        if (ws) {
          console.log(`[WorkspaceManager] Tab ${tabId} was discarded by Chrome. Recovering...`);
          try {
            await chrome.tabs.reload(tabId);
            await new Promise(r => setTimeout(r, 2000));
            await debuggerManager.attach(tabId);
            console.log(`[WorkspaceManager] Tab ${tabId} recovered successfully.`);
          } catch (err) {
            console.error(`[WorkspaceManager] Failed to recover tab ${tabId}:`, err);
          }
        }
      }
    });

     chrome.tabs.onRemoved.addListener((tabId) => {
        const ws = Array.from(this.workspaces.values()).find(w => w.tabs[tabId] != null);
        if (ws) {
            delete ws.tabs[tabId];
            ws.updatedAt = Date.now();
            this.persistSoon();
            // If no tabs left, we might want to cancel the workspace, but we handle that in background/index.ts usually
        }
     });
  }

  async create(opts: {
    goal: string;
    name: string;
    tabId: number;
    provider: ProviderConfig;
    mode?: 'task' | 'chat';
  }): Promise<AgentWorkspace> {
    const tabInfo = await chrome.tabs.get(opts.tabId);
    // A ponte NAO agrupa. Agrupar exigia focar a janela (o Chrome recusa agrupar
    // aba de janela sem foco) e deixava um grupo no Chrome a cada execucao. Como
    // ela trabalha na aba que o usuario ja tem aberta, nao ha nada a agrupar.
    const groupId = chrome.tabGroups.TAB_GROUP_ID_NONE;

    const ws: AgentWorkspace = {
      workspaceId: uuidv4(),
      name: opts.name,
      goal: opts.goal,
      mode: opts.mode,
      status: 'idle',
      rootTabId: opts.tabId,
      tabGroupId: groupId,
      activeTabId: opts.tabId,
      provider: opts.provider,
      tabs: {
        [opts.tabId]: {
          tabId: opts.tabId,
          windowId: tabInfo.windowId,
          groupId,
          url: tabInfo.url ?? '',
          title: tabInfo.title,
          isActive: true,
          lastObservedAt: Date.now(),
        },
      },
      queue: [],
      executedActions: [],
      conversationHistory: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
      pageObservations: [],
      cycleCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.workspaces.set(ws.workspaceId, ws);
    await this.saveWorkspaces();
    try {
      await debuggerManager.attach(opts.tabId);
    } catch (err) {
      // Debugger may already be attached (e.g. service worker restarted but Chrome still has session).
      // Workspace is still valid — the execution engine will re-attach when needed.
      console.warn('[WorkspaceManager] Debugger attach failed (non-fatal):', err);
    }
    return ws;
  }

  get(workspaceId: string): AgentWorkspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  list(): AgentWorkspace[] {
    return Array.from(this.workspaces.values());
  }

  update(workspaceId: string, patch: Partial<AgentWorkspace>): void {
    const ws = this.workspaces.get(workspaceId);
    if (ws) {
      Object.assign(ws, patch);
      ws.updatedAt = Date.now();
      this.persistSoon();
    }
  }

  updateStatus(workspaceId: string, status: WorkspaceStatus): void {
    const ws = this.workspaces.get(workspaceId);
    if (ws) {
      ws.status = status;
      ws.updatedAt = Date.now();
      this.persistSoon();
    }
  }

  setFinalMessage(workspaceId: string, message: string): void {
    const ws = this.workspaces.get(workspaceId);
    if (ws) {
      ws.finalMessage = message;
      ws.updatedAt = Date.now();
      this.persistSoon();
    }
  }

  setFailureReason(workspaceId: string, reason: string): void {
    const ws = this.workspaces.get(workspaceId);
    if (ws) {
      ws.failureReason = reason;
      ws.updatedAt = Date.now();
      this.persistSoon();
    }
  }

  async addTab(workspaceId: string, url: string): Promise<number> {
    const ws = this.workspaces.get(workspaceId)!;
    const tab = await chrome.tabs.create({ url, active: false });
    await debuggerManager.attach(tab.id!);
    ws.tabs[tab.id!] = {
      tabId: tab.id!,
      windowId: tab.windowId!,
      groupId: ws.tabGroupId,
      url,
      isActive: false,
      lastObservedAt: Date.now(),
    };
    ws.updatedAt = Date.now();
    this.persistSoon();
    return tab.id!;
  }

  switchActiveTab(workspaceId: string, tabId: number): void {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return;
    Object.values(ws.tabs).forEach((t) => (t.isActive = false));
    if (ws.tabs[tabId]) ws.tabs[tabId].isActive = true;
    ws.activeTabId = tabId;
    ws.updatedAt = Date.now();
    this.persistSoon();
  }

  async destroy(workspaceId: string): Promise<void> {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return;
    for (const tabId of Object.keys(ws.tabs).map(Number)) {
      await debuggerManager.detach(tabId);
    }
    this.workspaces.delete(workspaceId);
    await this.saveWorkspaces();
  }
}

export const workspaceManager = new WorkspaceManager();
