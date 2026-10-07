/**
 * Indicador visual de "a ponte esta trabalhando nesta aba".
 *
 * Tecnica do Perplexity Comet:
 * - borda em conic-gradient girando via CSS Houdini @property --agent-a
 * - paleta OKLCH azul-pastel (hue 220-235)
 * - blur(24px) na borda vira uma nebulosa suave
 * - sombra interna da a sensacao de pagina "mergulhada na luz"
 * - pilula de status (glassmorphism, embaixo ao centro) com botao de parar
 *
 * ┌─ POR QUE TUDO ISSO VIVE NUM SHADOW ROOT FECHADO ────────────────────┐
 * O agente le a pagina por `document.body.innerText` (wait_for_text,
 * wait_for_change, extract). Enquanto a pilula era um <div> comum no body,
 * o texto "Agente rodando" entrava nessa leitura — a extensao aparecia na
 * propria leitura que ela faz.
 *
 * Em 19/08/2026 isso travou um `wait_for_text {text:"Agente rodando",
 * present:false}` por 180s: o proprio wait mandava desenhar a pilula, lia o
 * texto dela e concluia que o "agente" nunca parava. Esperar por um texto que
 * a leitura mesma cria nunca termina.
 *
 * Conteudo de shadow root NAO entra em innerText nem em textContent do host,
 * entao a pilula some da leitura sem sumir da tela. O `aria-hidden` no host
 * cuida da outra leitura, a arvore de acessibilidade do `browser_read_page`
 * (ax-tree.ts pula no ignored).
 *
 * Regra para quem mexer aqui: **nada da extensao pode nascer fora do
 * shadow root**, senao o texto volta a vazar para o agente.
 * └────────────────────────────────────────────────────────────────────┘
 */

/** Host unico de toda a UI da extensao na pagina. */
const ID_HOST = 'praxedes-agent-ui';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false,
  runAt: 'document_idle',
  main() {
    let host: HTMLDivElement | null = null;
    let raiz: ShadowRoot | null = null;
    let glowBorder: HTMLDivElement | null = null;
    let innerShadow: HTMLDivElement | null = null;
    let statusPill: HTMLDivElement | null = null;
    let isActive = false;
    let wasActiveBeforeHide = false;

    /**
     * Registro do @property. Fica no documento porque registro de propriedade
     * customizada e global; as @keyframes e as regras ficam DENTRO do shadow
     * root, que e onde os elementos vivem (keyframes so valem na arvore em que
     * sao declaradas). O <style> nao aparece em innerText.
     */
    const CSS_PROPERTY = `
      @property --agent-a {
        syntax: '<angle>';
        initial-value: 0deg;
        inherits: false;
      }
    `;

    /** Isola o host do CSS da pagina. Os filhos sao position:fixed. */
    const CSS_HOST = 'all: initial;';

    function registrarProperty(): void {
      if (document.getElementById('agent-animation-styles')) return;
      const style = document.createElement('style');
      style.id = 'agent-animation-styles';
      style.textContent = CSS_PROPERTY;
      (document.head ?? document.documentElement).appendChild(style);
    }

    function cssDaRaiz(): string {
      return `
        ${CSS_PROPERTY}

        @keyframes agent-rotate {
          to { --agent-a: 1turn; }
        }

        @keyframes agent-dot-pulse {
          0%, 100% { opacity: 1;   box-shadow: 0 0 6px oklch(0.72 0.17 228 / .8); }
          50%       { opacity: 0.4; box-shadow: 0 0 3px oklch(0.72 0.17 228 / .3); }
        }

        /* ── Glow border (outer) ───────────────────────────────────────
         * Tecnica identica a do Perplexity Comet:
         *   - inset: -1.25em  →  a borda comeca FORA da viewport
         *   - border-width: 2.5em  →  borda grossa carrega o gradiente
         *   - filter: blur(24px)  →  amacia ate virar nebulosa
         *   - OKLCH absoluto  →  oklch() relativo falha calado dentro de
         *     conic-gradient/border-image em alguns contextos do Chrome
         *   - SEM contain  →  o blur precisa sangrar para dentro da pagina
         * ────────────────────────────────────────────────────────────── */
        #agent-glow-border {
          --cb: oklch(0.62 0.19 228);
          --c1: oklch(0.71 0.23 232);
          --c2: oklch(0.68 0.22 228);
          --c3: oklch(0.60 0.20 231);
          --c4: oklch(0.57 0.24 224);
          --c5: oklch(0.62 0.22 228);

          position: fixed;
          inset: -1.25em;
          border: solid;
          border-width: 2.5em;
          border-color: initial;
          border-image: conic-gradient(
            from var(--agent-a),
            var(--c1),
            var(--c2),
            var(--c3) 25%,
            var(--cb) 35%,
            var(--c5) 45%,
            var(--c4) 55%,
            var(--c5) 65%,
            var(--cb) 75%,
            var(--c3) 85%,
            var(--c2),
            var(--c1)
          ) 1;

          filter: blur(24px);
          z-index: 2147483644;
          pointer-events: none;
          opacity: 0;
          transition: opacity 1000ms cubic-bezier(0.4, 0, 0.2, 1);
          will-change: opacity;
        }

        #agent-glow-border.active {
          animation: agent-rotate 1250ms linear infinite;
          opacity: 1;
        }

        /* ── Sombra interna — a pagina "mergulhada" em luz azul ───────── */
        #agent-inner-shadow {
          position: fixed;
          inset: 0;
          z-index: 2147483643;
          pointer-events: none;
          box-shadow:
            inset 0 0  3px 1px oklch(0.42 0.19 228 / .55),
            inset 0 0 14px 7px oklch(0.52 0.17 228 / .20);
          opacity: 0;
          transition: opacity 1000ms cubic-bezier(0.4, 0, 0.2, 1);
        }

        #agent-inner-shadow.active {
          opacity: 1;
        }

        /* ── Pilula de status (glassmorphism) ────────────────────────── */
        #agent-status-pill {
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%) translateY(80px);
          z-index: 2147483647;
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          background: oklch(0.16 0.07 232 / .90);
          backdrop-filter: blur(16px) saturate(180%);
          -webkit-backdrop-filter: blur(16px) saturate(180%);
          border: 1px solid oklch(0.62 0.15 228 / .22);
          border-radius: 14px;
          box-shadow:
            0 8px 32px oklch(0.28 0.19 228 / .45),
            0 2px 8px  oklch(0 0 0 / .35),
            inset 0 1px 0 oklch(0.72 0.14 228 / .10);
          opacity: 0;
          transition:
            opacity   400ms cubic-bezier(0.4, 0, 0.2, 1),
            transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: nowrap;
          user-select: none;
        }

        #agent-status-pill.visible {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        #agent-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: oklch(0.72 0.17 228);
          box-shadow: 0 0 6px oklch(0.72 0.17 228 / .8);
          animation: agent-dot-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          flex-shrink: 0;
        }

        #agent-status-label {
          font-size: 12.5px;
          font-weight: 600;
          color: oklch(0.84 0.11 228);
          letter-spacing: 0.01em;
        }

        #agent-stop-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 8px;
          background: oklch(0.26 0.13 228 / .80);
          border: none;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 180ms ease;
          color: oklch(0.72 0.17 228);
        }

        #agent-stop-btn:hover {
          background: oklch(0.38 0.17 228);
          color: oklch(0.88 0.12 228);
        }
      `;
    }

    // ─── Host + shadow root ───────────────────────────────────────────
    /** Devolve o shadow root, criando o host se ele nao existir (ou se um
     *  re-render de SPA o arrancou do DOM). */
    function garantirRaiz(): ShadowRoot {
      if (host && document.contains(host) && raiz) return raiz;

      // Sobra de uma injecao anterior do content script.
      document.getElementById(ID_HOST)?.remove();

      host = document.createElement('div');
      host.id = ID_HOST;
      // Tira da arvore de acessibilidade: e o que faz o browser_read_page
      // ignorar a pilula (ax-tree.ts pula node.ignored).
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = CSS_HOST;

      // Fechado de proposito: nem a pagina nem a extensao tem motivo para
      // alcancar isto de fora.
      raiz = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = cssDaRaiz();
      raiz.appendChild(style);

      // Fora do <body>: assim nem por acidente entra em body.innerText.
      document.documentElement.appendChild(host);
      return raiz;
    }

    // ─── Elementos ────────────────────────────────────────────────────
    function createGlowBorder(r: ShadowRoot): HTMLDivElement {
      const el = document.createElement('div');
      el.id = 'agent-glow-border';
      r.appendChild(el);
      return el;
    }

    function createInnerShadow(r: ShadowRoot): HTMLDivElement {
      const el = document.createElement('div');
      el.id = 'agent-inner-shadow';
      r.appendChild(el);
      return el;
    }

    function createStatusPill(r: ShadowRoot): HTMLDivElement {
      const pill = document.createElement('div');
      pill.id = 'agent-status-pill';

      const dot = document.createElement('div');
      dot.id = 'agent-status-dot';

      const label = document.createElement('span');
      label.id = 'agent-status-label';
      label.textContent = 'Agente rodando';

      const stopBtn = document.createElement('button');
      stopBtn.id = 'agent-stop-btn';
      stopBtn.title = 'Parar agente';
      stopBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="3"/>
        </svg>
      `;
      stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'STOP_AGENT', fromTabId: 'CURRENT_TAB' }).catch(() => {});
      });

      pill.appendChild(dot);
      pill.appendChild(label);
      pill.appendChild(stopBtn);
      r.appendChild(pill);
      return pill;
    }

    // ─── Mostrar ──────────────────────────────────────────────────────
    function showIndicators(): void {
      const r = garantirRaiz();
      const borderInDom = !!glowBorder && r.contains(glowBorder);
      const pillInDom = !!statusPill && r.contains(statusPill);
      if (isActive && borderInDom && pillInDom) return;

      isActive = true;
      registrarProperty();

      if (!borderInDom) glowBorder = createGlowBorder(r);
      if (!r.getElementById('agent-inner-shadow')) innerShadow = createInnerShadow(r);
      if (!pillInDom) statusPill = createStatusPill(r);

      requestAnimationFrame(() => {
        glowBorder?.classList.add('active');
        innerShadow?.classList.add('active');
        requestAnimationFrame(() => {
          statusPill?.classList.add('visible');
        });
      });
    }

    // ─── Esconder ─────────────────────────────────────────────────────
    function hideIndicators(): void {
      if (!isActive) return;
      isActive = false;

      glowBorder?.classList.remove('active');
      innerShadow?.classList.remove('active');
      statusPill?.classList.remove('visible');

      setTimeout(() => {
        if (isActive) return;
        glowBorder?.remove();  glowBorder  = null;
        innerShadow?.remove(); innerShadow = null;
        statusPill?.remove();  statusPill  = null;
        host?.remove();        host        = null;
        raiz = null;
      }, 1000);
    }

    /** Some da tela sem desmontar nada — usado no instante do screenshot. */
    function setVisivel(visivel: boolean): void {
      if (!host) return;
      host.style.cssText = visivel ? CSS_HOST : `${CSS_HOST} display: none !important;`;
    }

    // ─── Mensagens ────────────────────────────────────────────────────
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg.type) {
        case 'SHOW_AGENT_INDICATORS':
          showIndicators();
          sendResponse({ success: true });
          break;
        case 'HIDE_AGENT_INDICATORS':
          hideIndicators();
          sendResponse({ success: true });
          break;
        case 'HIDE_FOR_TOOL_USE':
          wasActiveBeforeHide = isActive;
          setVisivel(false);
          sendResponse({ success: true });
          break;
        case 'SHOW_AFTER_TOOL_USE':
          if (wasActiveBeforeHide) setVisivel(true);
          wasActiveBeforeHide = false;
          sendResponse({ success: true });
          break;
      }
    });

    window.addEventListener('beforeunload', hideIndicators);
  },
});
