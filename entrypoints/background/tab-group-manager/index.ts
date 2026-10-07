const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  'blue',
  'cyan',
  'green',
  'grey',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
];

let colorIndex = 0;

class TabGroupManager {
  /** Maps groupId → main (root) tabId */
  private mainTabs = new Map<number, number>();

  /** Ultima falha de agrupamento, para diagnostico pela ponte. */
  lastGroupError: {
    message: string;
    windowId?: number;
    windowType?: string;
    janelas?: Array<{ id?: number; type?: string; state?: string; incognito?: boolean }>;
  } | null = null;

  private async groupWithRetry(tabId: number, tentativas = 4): Promise<number> {
    let ultimoErro: unknown;
    for (let i = 0; i < tentativas; i++) {
      try {
        return await chrome.tabs.group({ tabIds: [tabId] });
      } catch (err) {
        ultimoErro = err;
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }
    throw ultimoErro;
  }

  /**
   * Agrupa a aba, ou devolve TAB_GROUP_ID_NONE se a janela nao aceitar grupos
   * (popup, app, DevTools). O grupo e conveniencia visual: nao pode derrubar a
   * automacao inteira quando a aba nasce numa janela que nao suporta.
   */
  async createOrGetGroup(tabId: number, title: string): Promise<number> {
    const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
    colorIndex++;
    try {
      // Aba recem-criada as vezes ainda nao assentou na janela, e o agrupamento
      // imediato falha. Vale insistir um pouco antes de desistir.
      const groupId = await this.groupWithRetry(tabId);
      await chrome.tabGroups.update(groupId, { title, color, collapsed: false });
      this.mainTabs.set(groupId, tabId);
      this.lastGroupError = null;
      return groupId;
    } catch (err) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const win = tab ? await chrome.windows.get(tab.windowId).catch(() => null) : null;
      const todas = await chrome.windows.getAll({}).catch(() => []);
      this.lastGroupError = {
        message: err instanceof Error ? err.message : String(err),
        windowId: tab?.windowId,
        windowType: win?.type,
        janelas: todas.map((w) => ({
          id: w.id,
          type: w.type,
          state: w.state,
          incognito: w.incognito,
        })),
      };
      console.warn(
        `[TabGroupManager] sem agrupamento para a aba ${tabId} `
        + `(janela ${tab?.windowId} tipo "${win?.type}"): ${this.lastGroupError.message}`,
      );
      return chrome.tabGroups.TAB_GROUP_ID_NONE;
    }
  }

  async addTabToGroup(tabId: number, groupId: number): Promise<void> {
    if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;
    await chrome.tabs.group({ tabIds: [tabId], groupId });
  }

  async getTabsInGroup(groupId: number): Promise<chrome.tabs.Tab[]> {
    return chrome.tabs.query({ groupId });
  }

  async focusTab(tabId: number): Promise<void> {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  }

  async closeGroup(groupId: number): Promise<void> {
    const tabs = await this.getTabsInGroup(groupId);
    for (const tab of tabs) {
      await chrome.tabs.remove(tab.id!);
    }
    this.mainTabs.delete(groupId);
  }

  /** Find which group a tab belongs to */
  async findGroupByTab(tabId: number): Promise<{ groupId: number; isMainTab: boolean } | null> {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.groupId === undefined || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        return null;
      }
      const isMainTab = this.mainTabs.get(tab.groupId) === tabId;
      return { groupId: tab.groupId, isMainTab };
    } catch {
      return null;
    }
  }

  /** Given any tab in a group, return the main (root) tab ID */
  async getMainTabId(tabId: number): Promise<number | null> {
    const group = await this.findGroupByTab(tabId);
    if (!group) return null;
    return this.mainTabs.get(group.groupId) ?? null;
  }

  /** Recover a group after SW restart by re-registering its main tab */
  async adoptOrphanedGroup(tabId: number, groupId: number): Promise<void> {
    if (!this.mainTabs.has(groupId)) {
      this.mainTabs.set(groupId, tabId);
    }
  }

  /** Ungroup all known tab groups (called when sidepanel is closed) */
  async ungroupAll(): Promise<void> {
    const groupIds = Array.from(this.mainTabs.keys());
    for (const groupId of groupIds) {
      try {
        const tabs = await this.getTabsInGroup(groupId);
        const tabIds = tabs.map((t) => t.id!).filter(Boolean);
        if (tabIds.length > 0) {
          await chrome.tabs.ungroup(tabIds);
        }
      } catch { /* group may have already been removed */ }
    }
    this.mainTabs.clear();
  }
}

export const tabGroupManager = new TabGroupManager();

