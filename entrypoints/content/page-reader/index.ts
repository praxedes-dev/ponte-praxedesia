import type { PageState, InteractiveElement } from '../../../shared/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Expose for direct executeScript access from background
    (window as unknown as Record<string, unknown>).__readPage = readPage;

    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (msg.type !== 'READ_PAGE') return;
      respond(readPage());
      return true;
    });
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
