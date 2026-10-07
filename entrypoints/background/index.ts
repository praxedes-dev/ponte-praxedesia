import { workspaceManager } from './workspace-manager';
import { bridgeClient } from './bridge';
import { auditLogger } from './audit';
import { debuggerManager } from './debugger-manager';
import { tabGroupManager } from './tab-group-manager';

/** Marca no titulo do grupo — mesma marca usada pela ponte (ver bridge/index.ts). */
const PREFIXO_GRUPO_PONTE = '🤖 ';

type IncomingMessage =
  | { type: 'DELETE_WORKSPACE'; workspaceId: string }
  | { type: 'LIST_WORKSPACES' }
  | { type: 'GET_AUDIT_LOG'; workspaceId: string }
  | { type: 'SW_KEEPALIVE' }
  | { type: 'STOP_AGENT'; fromTabId?: number | 'CURRENT_TAB' }
  | { type: 'PLAY_NOTIFICATION_SOUND'; audioUrl?: string; volume?: number }
  | { type: 'SIDEPANEL_CLOSING' }
  | { type: 'LIMPAR_GRUPOS' };

// ═══════════════════════════════════════════════════════════════════════
// OFFSCREEN DOCUMENT SETUP (SW Keepalive + GIF + Audio)
// ═══════════════════════════════════════════════════════════════════════
async function setupOffscreenDocument(): Promise<void> {
  const existingContexts = await (chrome.runtime as any).getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts?.length > 0) return;

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'Keep service worker alive, play sounds, and generate GIFs',
    });
    console.log('[Background] Offscreen document created');
  } catch (err) {
    console.warn('[Background] Offscreen document setup:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// VISUAL INDICATOR HELPERS
// ═══════════════════════════════════════════════════════════════════════
function broadcastToTab(tabId: number, msg: Record<string, unknown>): void {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

function hideAgentIndicators(tabId: number): void {
  console.log('[DEBUG] hideAgentIndicators called for tab:', tabId);
  broadcastToTab(tabId, { type: 'HIDE_AGENT_INDICATORS' });
}

// ═══════════════════════════════════════════════════════════════════════
// NOTIFICATION SOUND
// ═══════════════════════════════════════════════════════════════════════
export type NotificationTiming = 'none' | 'started' | 'completed' | 'both';

export async function playNotificationSound(when: NotificationTiming): Promise<void> {
  console.log('[DEBUG] playNotificationSound called for:', when);
  try {
    const result = await chrome.storage.local.get('praxedes_sound_settings_v3');
    const settings = result['praxedes_sound_settings_v3'] as {
      enabled?: boolean;
      selectedSoundId?: string;
      volume?: number;
      customSounds?: { id: string; dataUrl: string }[];
      when?: NotificationTiming;
    } | undefined;

    console.log('[DEBUG] sound settings:', settings);

    if (!settings?.enabled) {
      console.log('[DEBUG] sound disabled, skipping');
      return;
    }

    // Check if we should play for this timing
    const soundWhen = settings.when ?? 'completed';
    if (soundWhen !== 'both' && soundWhen !== when) {
      console.log('[DEBUG] sound timing mismatch, skipping. soundWhen:', soundWhen, 'when:', when);
      return;
    }

    let audioUrl: string;
    if (!settings.selectedSoundId || settings.selectedSoundId === 'default') {
      audioUrl = chrome.runtime.getURL('sounds/ElevenLabs_Efeito_sonoro_de_notificação_de_sino_para_uma_nova_mensagem,_suave_e_convidativo.mp3');
    } else {
      const custom = settings.customSounds?.find((s) => s.id === settings.selectedSoundId);
      if (!custom) return;
      audioUrl = custom.dataUrl;
    }

    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_PLAY_SOUND',
      audioUrl,
      volume: settings.volume ?? 0.6,
    }).catch(() => {});
  } catch (err) {
    console.warn('[Background] playNotificationSound failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// CHROME NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════
export async function showChromeNotification(
  title: string,
  message: string,
  when: NotificationTiming,
): Promise<void> {
  console.log('[DEBUG] showChromeNotification called for:', when, '| title:', title);
  try {
    const result = await chrome.storage.local.get('praxedes_notification_settings_v1');
    const settings = result['praxedes_notification_settings_v1'] as {
      enabled?: boolean;
      when?: NotificationTiming;
    } | undefined;

    console.log('[DEBUG] notification settings:', settings);

    if (!settings?.enabled) {
      console.log('[DEBUG] notifications disabled, skipping');
      return;
    }

    // Check if we should notify for this timing
    const notifWhen = settings.when ?? 'completed';
    if (notifWhen !== 'both' && notifWhen !== when) {
      console.log('[DEBUG] notification timing mismatch, skipping. notifWhen:', notifWhen, 'when:', when);
      return;
    }

    const iconUrl = chrome.runtime.getURL('icon-128.png');
    const notificationId = `praxedes_${when}_${Date.now()}`;

    chrome.notifications.create(notificationId, {
      type: 'basic',
      title,
      message,
      iconUrl,
      priority: 1,
    }, () => {
      // Auto-clear after 5 seconds
      setTimeout(() => {
        chrome.notifications.clear(notificationId, () => {});
      }, 5000);
    });

    console.log('[DEBUG] Chrome notification created:', title);
  } catch (err) {
    console.warn('[Background] showChromeNotification failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// USER-AGENT SPOOFING via declarativeNetRequest
// ═══════════════════════════════════════════════════════════════════════
async function setupUserAgentSpoofing(): Promise<void> {
  try {
    const manifest = chrome.runtime.getManifest();
    const userAgent = `browser-agent/${manifest.version} (multi-llm) ${navigator.userAgent}`;

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: 'User-Agent',
                operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                value: userAgent,
              },
            ],
          },
          condition: {
            urlFilter: 'http://localhost:*/*',
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              chrome.declarativeNetRequest.ResourceType.OTHER,
            ],
          },
        },
      ],
    });
    console.log('[Background] User-Agent spoofing configured');
  } catch (err) {
    console.warn('[Background] User-Agent setup failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LIMPAR GRUPOS DA PONTE — botao manual do painel de status
// ═══════════════════════════════════════════════════════════════════════
/**
 * Fecha as abas de qualquer grupo cujo titulo comece com a marca da ponte
 * (🤖 ). Nao mexe em bridge/index.ts de proposito — e um botao de faxina
 * manual do usuario, independente da faxina automatica que a propria ponte
 * ja faz ao (re)conectar e ao encerrar (ver limparGruposOrfaos/cap_limpar).
 */
async function limparGruposDaPonte(): Promise<number> {
  const grupos = await chrome.tabGroups.query({});
  let totalFechadas = 0;

  for (const g of grupos) {
    if (!(g.title ?? '').startsWith(PREFIXO_GRUPO_PONTE)) continue;

    const abas = await chrome.tabs.query({ groupId: g.id });
    const ids = abas.map((t) => t.id).filter((id): id is number => id !== undefined);
    if (ids.length) {
      await chrome.tabs.remove(ids).catch(() => {});
      totalFechadas += ids.length;
    }
  }

  return totalFechadas;
}

// ═══════════════════════════════════════════════════════════════════════
// DEEP LINK HANDLER — agent://action patterns
// ═══════════════════════════════════════════════════════════════════════
async function handleDeepLink(url: string, tabId: number): Promise<boolean> {
  try {
    const parsed = new URL(url);

    // Support patterns like chrome-extension://<id>/agent/<action>
    // or custom scheme intercepted via webNavigation
    const pathname = parsed.pathname.toLowerCase();

    if (pathname.includes('/agent/reconnect')) {
      // Re-init offscreen and debugger
      await setupOffscreenDocument();
      console.log('[DeepLink] Reconnect triggered');
      try { await chrome.tabs.remove(tabId); } catch {}
      return true;
    }

    if (pathname.includes('/agent/settings') || pathname.includes('/agent/permissions')) {
      // Open options/settings page
      const optionsUrl = chrome.runtime.getURL('sidepanel.html');
      await chrome.tabs.create({ url: optionsUrl });
      try { await chrome.tabs.remove(tabId); } catch {}
      return true;
    }

    if (pathname.includes('/agent/tab/')) {
      const match = pathname.match(/\/agent\/tab\/(\d+)/);
      if (match) {
        const targetTabId = parseInt(match[1], 10);
        try {
          const tab = await chrome.tabs.get(targetTabId);
          if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(targetTabId, { active: true });
        } catch {}
        try { await chrome.tabs.remove(tabId); } catch {}
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SIDEPANEL PER-TAB STATE
let activeSidePanelTabId: number | null = null;
const workingTabs = new Set<number>();

async function openSidePanelForTab(tabId: number): Promise<void> {
  try {
    // Validate tab exists and is not a restricted page
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      console.warn('[SidePanel] Cannot open — tab does not exist:', tabId);
      return;
    }
    const url = tab.pendingUrl || tab.url || '';
    if (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://')
    ) {
      console.warn('[SidePanel] Cannot open for restricted tab:', tabId, url);
      return;
    }
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: true,
      path: 'sidepanel.html',
    });
    await chrome.sidePanel.open({ tabId });
    activeSidePanelTabId = tabId;
  } catch (err) {
    // Treat as non-fatal — may happen during rapid tab switches
    console.warn('[SidePanel] Failed to open (non-fatal):', err);
  }
}

function markTabWorking(tabId: number, working: boolean): void {
  if (working) {
    workingTabs.add(tabId);
  } else {
    workingTabs.delete(tabId);
  }
}

// MAIN — defineBackground
export default defineBackground(() => {
  debuggerManager.init();
  auditLogger.init();
  setupOffscreenDocument();

  // Ponte com os agentes locais. Reconecta sozinha, entao pode subir aqui sem
  // esperar nada: se o servidor ainda nao estiver de pe, ela tenta de novo.
  void bridgeClient.start();

  // THE MOST RELIABLE APPROACH:
  // openPanelOnActionClick:true makes Chrome open the side panel DIRECTLY
  // when the user clicks the icon — no Service Worker user-gesture window
  // issues. The SW only wakes up AFTER the panel has already opened.
  // This bypasses the root cause of the "click does nothing" bug.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // We still need setOptions per-tab when navigating to restricted pages
  // to disable the panel (otherwise Chrome tries to open it on chrome:// pages
  // which fails silently).
  // But we DON'T use onClicked at all — Chrome handles it automatically.
  // Keep onClicked only as a fallback for the keyboard shortcut path.
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-side-panel') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id) {
          openSidePanelForTab(tab.id);
        }
      });
    }
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // Do not forcibly close the side panel on tab switch.
    // Chrome manages per-tab panel visibility automatically when the user
    // navigates between tabs. Manually intervening here caused the panel
    // to become invisible after the first tab switch, making it appear as
    // if clicking the icon had no effect.
    // We just track which tab has the panel open for reference.
    if (activeSidePanelTabId !== null && activeSidePanelTabId !== activeInfo.tabId) {
      // Just update tracking — do NOT call closeSidePanelForTab
      // which was resetting activeSidePanelTabId to null.
      activeSidePanelTabId = activeInfo.tabId;
    }
  });

  // ─── Message Router ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(
    (msg: IncomingMessage, sender, respond) => {
      if (msg.type === 'SW_KEEPALIVE') return;

      switch (msg.type) {
        case 'DELETE_WORKSPACE': {
          workspaceManager.destroy(msg.workspaceId)
            .then(() => respond({ ok: true }))
            .catch((err) => respond({ ok: false, error: String(err) }));
          return true;
        }

        case 'STOP_AGENT': {
          // Sem agent-loop nem chat-handler (a extensao agora e so a ponte),
          // isto so limpa o indicador visual e avisa o usuario — o
          // agent-indicator.content.ts continua mandando esta mensagem
          // quando alguem clica no botao de parar.
          const tabId = msg.fromTabId === 'CURRENT_TAB' ? sender.tab?.id : msg.fromTabId;
          if (tabId) {
            markTabWorking(tabId, false);
            hideAgentIndicators(tabId);
            playNotificationSound('completed');
            showChromeNotification(
              '❌ Tarefa',
              'Tarefa cancelada pelo usuário',
              'completed',
            );
          }
          respond({ ok: true });
          break;
        }

        case 'PLAY_NOTIFICATION_SOUND': {
          // Used by off-screen document - play for 'completed' as default
          playNotificationSound('completed');
          respond({ ok: true });
          break;
        }

        case 'SIDEPANEL_CLOSING': {
          tabGroupManager.ungroupAll().catch(() => {});
          respond({ ok: true });
          break;
        }

        case 'LIMPAR_GRUPOS': {
          limparGruposDaPonte()
            .then((fechadas) => respond({ ok: true, fechadas }))
            .catch((err) => respond({ ok: false, error: String(err) }));
          return true;
        }

        case 'LIST_WORKSPACES': {
          workspaceManager.ready().then(() => {
            respond({ workspaces: workspaceManager.list() });
          });
          return true;
        }

        case 'GET_AUDIT_LOG': {
          auditLogger.getByWorkspace(msg.workspaceId).then((events) => {
            respond({ events });
          });
          return true;
        }
      }
    },
  );

  // ─── Tab cleanup ───────────────────────────────────────────────
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (debuggerManager.isAttached(tabId)) {
      await debuggerManager.detach(tabId);
    }
  });

  // ─── Deep Link Interception ─────────────────────────────────────
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;
    if (details.url.includes('/agent/')) {
      await handleDeepLink(details.url, details.tabId);
    }
  });

  // ─── Lifecycle Events ──────────────────────────────────────────
  chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[Background] Installed (${details.reason})`);
    await setupUserAgentSpoofing();
  });

  chrome.runtime.onStartup.addListener(async () => {
    console.log('[Background] Startup');
    setupOffscreenDocument();
    await setupUserAgentSpoofing();
  });
});
