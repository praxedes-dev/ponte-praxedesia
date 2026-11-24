/**
 * Indicador visual de "a ponte esta trabalhando nesta aba".
 *
 * Borda "fumaca laranja + brilho girando 10 s" em WebGL2 (canvas em meia resolucao,
 * pointer-events:none, estatica com prefers-reduced-motion). A arte vive em
 * shared/borda-fumaca.ts; sem WebGL2, shared/borda.ts cai na borda CSS de ondas
 * (shared/borda-css.ts). Ciclo de vida: o canvas e o contexto WebGL nascem ao
 * ligar (SHOW) e sao DESTRUIDOS ao desligar (HIDE): rAF cancelado, contexto
 * liberado. Aba oculta ou indicador escondido para screenshot param o desenho.
 * Nao ha botao nem pilula: o indicador e so a borda.
 *
 * ┌─ POR QUE TUDO ISSO VIVE NUM SHADOW ROOT FECHADO ────────────────────┐
 * O agente le a pagina por `document.body.innerText` (wait_for_text,
 * wait_for_change, extract). Enquanto a pilula era um <div> comum no body,
 * o texto da pilula (antiga) entrava nessa leitura — a extensao aparecia na
 * propria leitura que ela faz.
 *
 * Em 19/08/2026 isso travou um `wait_for_text de um texto
 * do proprio indicador` por 180s: o proprio wait mandava desenhar a pilula, lia o
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

import { montarBorda, type Borda } from '../shared/borda';

/** Host unico de toda a UI da extensao na pagina. */
const ID_HOST = 'praxedes-agent-ui';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Flow (08/11/2026): barra a geracao com "extensoes que modificam a pagina";
  // a pilula/borda injetada no DOM e o sinal. Nessas origens a ponte fica so no CDP.
  excludeMatches: ['https://flow.google.com/*', 'https://labs.google/*'],
  allFrames: false,
  runAt: 'document_idle',
  main() {
    let host: HTMLDivElement | null = null;
    let raiz: ShadowRoot | null = null;
    let borda: Borda | null = null;
    let isActive = false;
    let wasActiveBeforeHide = false;

    /** Isola o host do CSS da pagina. Os filhos sao position:fixed. */
    const CSS_HOST = 'all: initial;';

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
      // Fora do <body>: assim nem por acidente entra em body.innerText.
      document.documentElement.appendChild(host);
      return raiz;
    }

    // ─── Mostrar ──────────────────────────────────────────────────────
    function showIndicators(): void {
      const r = garantirRaiz();
      const naTela = !!borda && r.contains(borda.raiz);
      if (isActive && naTela) return;

      isActive = true;
      if (!naTela) {
        borda?.destruir();
        borda = montarBorda(r);
        // Marca qual desenho subiu (so atributo, nenhum texto): o teste ao vivo le daqui.
        host?.setAttribute('data-borda', borda.modo);
      }
      const b = borda;
      requestAnimationFrame(() => b?.raiz.classList.add('active'));
    }

    // ─── Esconder ─────────────────────────────────────────────────────
    function hideIndicators(): void {
      if (!isActive) return;
      isActive = false;

      borda?.raiz.classList.remove('active');

      setTimeout(() => {
        if (isActive) return;
        desmontarTudo();
      }, 1500); // o fade de saida da borda (CSS) dura 0,9 a 1,4 s
    }

    /** Destroi a borda (rAF, contexto WebGL) e tira o host da pagina. */
    function desmontarTudo(): void {
      borda?.destruir();
      borda = null;
      host?.remove();
      host = null;
      raiz = null;
    }

    /** Some da tela sem desmontar nada — usado no instante do screenshot. */
    function setVisivel(visivel: boolean): void {
      if (!host) return;
      host.style.cssText = visivel ? CSS_HOST : `${CSS_HOST} display: none !important;`;
      // Escondida nao desenha: poupa GPU e nao pisca no screenshot.
      if (visivel) borda?.retomar?.();
      else borda?.pausar?.();
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
    // Pagina indo para o bfcache ou saindo: nao deixa canvas/contexto WebGL para tras.
    window.addEventListener('pagehide', () => {
      isActive = false;
      desmontarTudo();
    });
  },
});
