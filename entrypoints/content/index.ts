import type { PageState, InteractiveElement } from '../../shared/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Intercept console to capture logs for the agent (runs in browser only)
    if (!(window as any).__agentConsoleSetup) {
      (window as any).__agentConsoleSetup = true;
      (window as any).__agentConsoleLogs = [];
      const maxLogs = 200;
      const orig = { log: console.log, warn: console.warn, error: console.error };
      (['log', 'warn', 'error'] as const).forEach((level) => {
        console[level] = (...args: any[]) => {
          orig[level](...args);
          (window as any).__agentConsoleLogs.push({
            level,
            message: args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
            timestamp: Date.now(),
          });
          if ((window as any).__agentConsoleLogs.length > maxLogs) {
            (window as any).__agentConsoleLogs.shift();
          }
        };
      });
    }

    (window as unknown as Record<string, unknown>).__readPage = readPage;

    // Guard against "Extension context invalidated" when the extension is
    // reloaded while this content script is still alive on the page.
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
        if (msg.type !== 'READ_PAGE') return;
        try {
          respond(readPage());
        } catch {
          // Context may have been invalidated between the message and the response
        }
        return true;
      });
    } catch {
      // Extension context already invalidated — nothing to do
    }
  },
});

function readPage(): PageState {
  const selectors =
    'a,button,input,textarea,select,[role="button"],[role="link"],[onclick],[tabindex]';
  const elements = Array.from(document.querySelectorAll(selectors));
  const interactiveElements: InteractiveElement[] = [];
  let agentId = 0;

  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    el.setAttribute('data-agent-id', String(agentId));
    interactiveElements.push({
      agentId: agentId++,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      text: (
        (el as HTMLElement).innerText ||
        (el as HTMLInputElement).value ||
        ''
      ).slice(0, 200),
      ariaLabel: el.getAttribute('aria-label') ?? undefined,
      placeholder: el.getAttribute('placeholder') ?? undefined,
      href: (el as HTMLAnchorElement).href || undefined,
      type: (el as HTMLInputElement).type || undefined,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    });
  });

  const bodyText = document.body.innerText;
  return {
    url: window.location.href,
    title: document.title,
    interactiveElements,
    textContent: bodyText.slice(0, 3000),
    contentLength: bodyText.length,
  };
}
