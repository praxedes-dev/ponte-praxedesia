import { aguardarEstavel } from './espera-estavel';
import { esperarCondicao } from './espera-condicao';
import { safeExecuteScript } from './safe-scripting';
import type { ActionTarget } from '../../../shared/types';
import { debuggerManager as dm } from '../debugger-manager';
import { HOSTS_SO_DOM_PADRAO, avaliarAssentamento, criarAcompanhante, hostSoDom, lerContadorDeMutacoes } from './assentamento';

export async function cdpClick(tabId: number, x: number, y: number): Promise<void> {
  const base = { type: 'mouseMoved', x, y, button: 'left' as const, clickCount: 0 };
  await dm.send(tabId, 'Input.dispatchMouseEvent', base);
  await dm.send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', clickCount: 1 });
  await dm.send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', clickCount: 1 });
}

/**
 * V1: "um quadro" no lugar de um sleep. Espera o proximo requestAnimationFrame da
 * pagina, mas com teto do LADO DA EXTENSAO: aba escondida/janela minimizada nao
 * pinta e o rAF nunca dispara, entao o teto garante que isto nunca custa mais do
 * que o tempo fixo que substitui.
 */
export async function umQuadro(tabId: number, tetoMs = 50): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      dm.send(tabId, 'Runtime.evaluate', {
        expression: 'new Promise(function (r) { requestAnimationFrame(function () { r(1); }); })',
        awaitPromise: true,
      }).catch(() => {}),
      new Promise<void>((r) => { timer = setTimeout(r, tetoMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const FOCO_NO_ALVO = 'function() { var a = document.activeElement; return a === this || (!!a && this.contains(a)) || (!!a && a.contains(this) && a.isContentEditable); }';

/**
 * V1: no lugar de "dorme 80/150 ms depois de focar". Espera o foco CHEGAR no
 * campo (poll 30 ms, ate `tetoMs`); com o foco confirmado espera um quadro e
 * confere DE NOVO — editor que re-renderiza ao ganhar foco (ProseMirror,
 * contenteditable do PJe) pode soltar o foco no quadro seguinte, e so o que
 * continua focado depois dele conta. Devolve se terminou focado; quem chama
 * segue de qualquer jeito (a conferencia de foco/leitura de volta continua
 * logo depois, como estava) — no pior caso custa o mesmo tempo fixo de antes.
 */
export async function aguardarFocoAssentado(
  tabId: number,
  backendNodeId: number,
  tetoMs: number,
): Promise<boolean> {
  const focado = async (): Promise<boolean> => {
    const o = await dm.send<{ object?: { objectId?: string } }>(tabId, 'DOM.resolveNode', { backendNodeId });
    const objectId = o?.object?.objectId;
    if (!objectId) return false;
    const r = await dm.send<{ result?: { value?: boolean } }>(tabId, 'Runtime.callFunctionOn', {
      objectId, returnByValue: true, functionDeclaration: FOCO_NO_ALVO,
    });
    return r?.result?.value === true;
  };
  const inicio = Date.now();
  const { ok } = await esperarCondicao(async () => {
    if (!(await focado())) return false;
    const restante = Math.max(20, tetoMs - (Date.now() - inicio));
    await umQuadro(tabId, Math.min(50, restante));
    return focado();
  }, { intervaloMs: 30, tetoMs });
  return ok;
}

export async function cdpType(
  tabId: number,
  text: string,
  clear = false,
  targetAgentId?: number,
): Promise<{ outcome: string; elementInfo?: string }> {

  // ── Step 1: Ensure focus via CDP (hardware-level) ──────────────────────
  // DOM.focus is a CDP command that sets focus at the browser engine level,
  // bypassing any JavaScript framework state. This is critical for CM6.
  //
  // OBRA 26: a falha do foco deixou de ser so um `console.warn`. Ela nao
  // impede a escrita quando o texto vai por `objectId` (campo nativo e
  // `<select>`, passos 3 e 4: quem recebe e o no pedido, focado ou nao), mas o
  // passo 5 escreve por `Input.insertText`, que NAO aceita alvo — vai para
  // quem estiver com foco. Escrever ali depois de o foco ter FALHADO e mandar
  // o texto para um elemento que ninguem examinou; por isso o passo 5 recusa.
  let focoFalhou = false;
  if (targetAgentId !== undefined) {
    try {
      await dm.send(tabId, 'DOM.focus', { backendNodeId: targetAgentId });
    } catch (err) {
      focoFalhou = true;
      console.warn(`[cdpType] DOM.focus failed for backendNodeId ${targetAgentId}:`, err);
    }
  }

  // ── Step 2: Detect what kind of element we're dealing with ─────────────
  // We run a lightweight probe to classify the element (input/textarea/select/contenteditable)
  // and handle native inputs inline. Contenteditable will be handled via CDP after.
  const probeFunc = `
    function() {
      let active = this;
      if (!active || active === window || active === document) {
        active = document.activeElement;
      }
      if (!active || active === document.body || active === document.documentElement) {
        return JSON.stringify({ type: 'no-focus' });
      }

      // Shadow DOM & Wrapper Piercing
      const findRealInput = (el) => {
        if (!el) return null;
        if (el.isContentEditable || el.matches('input,textarea,select')) return el;
        if (el.shadowRoot) {
          const s = el.shadowRoot.querySelector('input,textarea,select,[contenteditable]');
          if (s) return findRealInput(s);
        }
        const c = el.querySelector('input,textarea,select,[contenteditable]');
        if (c) return findRealInput(c);
        return null;
      };
      const real = findRealInput(active);
      if (real) active = real;

      const info = active.tagName + '.' + (active.className?.split?.(' ')?.[0] || '') +
        ' ce=' + active.getAttribute('contenteditable') +
        ' ph=' + (active.getAttribute('placeholder') || '');

      // Native <input>/<textarea>
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const skip = ['file','checkbox','radio','submit','button','reset','image','range','color'];
        if (skip.includes(active.type)) return JSON.stringify({ type: 'non-typeable', info });
        return JSON.stringify({ type: 'native-input', info });
      }
      // <select>
      if (active instanceof HTMLSelectElement) return JSON.stringify({ type: 'select', info });
      // contenteditable
      const ce = active.getAttribute('contenteditable');
      if (active.isContentEditable || ce === 'true' || ce === '' || ce === 'plaintext-only') {
        return JSON.stringify({ type: 'contenteditable', info });
      }
      return JSON.stringify({ type: 'unknown', info });
    }
  `;

  let objectId: string | undefined;
  if (targetAgentId !== undefined) {
    try {
      const r = await dm.send<{ object: { objectId: string } }>(tabId, 'DOM.resolveNode', { backendNodeId: targetAgentId });
      objectId = r?.object?.objectId;
    } catch {}
  }

  let probeRaw: string | undefined;
  try {
    if (objectId) {
      const r = await dm.send<{ result: { value: string } }>(tabId, 'Runtime.callFunctionOn', {
        objectId, functionDeclaration: probeFunc, returnByValue: true,
      });
      probeRaw = r?.result?.value;
    } else {
      const r = await dm.send<{ result: { value: string } }>(tabId, 'Runtime.evaluate', {
        expression: `(${probeFunc}).call(document.activeElement)`, returnByValue: true,
      });
      probeRaw = r?.result?.value;
    }
  } catch {}

  let probe: { type: string; info?: string } = { type: 'unknown' };
  try { if (probeRaw) probe = JSON.parse(probeRaw); } catch {}

  const elementInfo = probe.info;

  // ── Step 3: Handle native <input>/<textarea> via value setter ──────────
  if (probe.type === 'native-input') {
    const setFunc = `
      function(t, shouldClear) {
        let active = this;
        if (!active || active === window || active === document) active = document.activeElement;
        // Pierce wrappers
        const find = (el) => {
          if (!el) return null;
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
          if (el.shadowRoot) { const s = el.shadowRoot.querySelector('input,textarea'); if (s) return find(s); }
          const c = el.querySelector('input,textarea'); if (c) return find(c);
          return null;
        };
        const real = find(active) || active;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(real), 'value')?.set;
        if (setter) {
          setter.call(real, shouldClear ? t : real.value + t);
          real.dispatchEvent(new Event('input', { bubbles: true }));
          real.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }
    `;
    try {
      if (objectId) {
        await dm.send(tabId, 'Runtime.callFunctionOn', {
          objectId, functionDeclaration: setFunc,
          arguments: [{ value: text }, { value: clear }], returnByValue: true,
        });
      } else {
        await dm.send(tabId, 'Runtime.evaluate', {
          expression: `(${setFunc}).call(document.activeElement, ${JSON.stringify(text)}, ${clear})`,
          returnByValue: true,
        });
      }
    } catch {}
    return { outcome: 'native-setter', elementInfo };
  }

  // ── Step 4: Handle <select> ────────────────────────────────────────────
  if (probe.type === 'select') {
    const selFunc = `
      function(t) {
        let el = this;
        if (!el || !(el instanceof HTMLSelectElement)) el = document.activeElement;
        if (!(el instanceof HTMLSelectElement)) return false;
        const lt = t.toLowerCase();
        const opt = Array.from(el.options).find(o => o.value.toLowerCase() === lt || o.text.toLowerCase().includes(lt));
        if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }
        return false;
      }
    `;
    try {
      if (objectId) {
        await dm.send(tabId, 'Runtime.callFunctionOn', {
          objectId, functionDeclaration: selFunc,
          arguments: [{ value: text }], returnByValue: true,
        });
      } else {
        await dm.send(tabId, 'Runtime.evaluate', {
          expression: `(${selFunc}).call(document.activeElement, ${JSON.stringify(text)})`,
          returnByValue: true,
        });
      }
    } catch {}
    return { outcome: 'select', elementInfo };
  }

  // ── Step 5: ContentEditable — THE FIX ─────────────────────────────────
  // CodeMirror 6 ignores execCommand('insertText'). It silently returns true
  // but inserts nothing. The correct approach is CDP Input.insertText which
  // generates trusted InputEvent that CM6 processes natively.
  if (probe.type === 'contenteditable' || probe.type === 'unknown' || probe.type === 'no-focus') {

    // OBRA 26 — este ramo escreve por `Input.insertText`, que nao aceita alvo:
    // o texto cai em quem estiver com FOCO. Duas situacoes em que isso deixa de
    // ser "escrever no elemento pedido" e vira "escrever num elemento que
    // ninguem examinou" — e as duas recusam, alto, em vez de escrever:
    //  - `focoFalhou`: o Chrome recusou focar o no pedido (nao focavel,
    //    escondido, `disabled`) e o foco continua onde estava;
    //  - `no-focus`: nao ha campo focado nenhum (o probe achou body/html) —
    //    antes o texto simplesmente sumia e a tool respondia sucesso.
    if (focoFalhou || probe.type === 'no-focus') {
      throw new Error(
        focoFalhou
          ? `nao consegui colocar o foco no elemento pedido (backendNodeId ${targetAgentId}) e este campo `
            + 'so recebe texto por foco. Recusei em vez de digitar no elemento que estava focado antes. '
            + 'Releia a pagina com browser_read_page e confira se o elemento aceita texto.'
          : 'nao ha campo focado para receber o texto (o alvo nao e um campo digitavel e nada esta com '
            + 'foco). Clique no campo antes, ou passe a ref do proprio campo.',
      );
    }

    // 5a. Clear existing content — scoped to the element (avoids selecting entire page)
    if (clear) {
      if (objectId) {
        // Preferred: use Runtime.callFunctionOn to select ONLY content within this element,
        // then Backspace. This avoids the global Ctrl+A which selects the entire page.
        await dm.send(tabId, 'Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function() {
            try {
              const range = document.createRange();
              range.selectNodeContents(this);
              const sel = window.getSelection();
              if (sel) { sel.removeAllRanges(); sel.addRange(range); }
            } catch {}
          }`,
        }).catch(() => {});
        // V1: um quadro para a selecao assentar (era 30 ms fixos) ...
        await umQuadro(tabId, 30);
        await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        // ... e ate o campo ESVAZIAR (era 50 ms fixos). Editor com texto de
        // enchimento que nunca zera cai no teto de 50 ms, igual a antes.
        await esperarCondicao(async () => {
          const r = await dm.send<{ result?: { value?: boolean } }>(tabId, 'Runtime.callFunctionOn', {
            objectId, returnByValue: true,
            functionDeclaration: 'function() { return (this.textContent || "").length === 0; }',
          });
          return r?.result?.value === true;
        }, { intervaloMs: 15, tetoMs: 50 });
      } else {
        // Fallback when no objectId: Ctrl+A then Backspace (may select whole page on some sites)
        await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await umQuadro(tabId, 50);
        await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await umQuadro(tabId, 50);
      }
    }

    // 5b. Insert text via CDP Input.insertText — the Comet way
    // This is a single CDP call that inserts the full string as a trusted
    // browser-level input event. CM6, ProseMirror, Monaco, etc. all handle it.
    await dm.send(tabId, 'Input.insertText', { text });

    return { outcome: 'cdp-insertText', elementInfo };
  }

  // Should not reach here, but just in case
  await dm.send(tabId, 'Input.insertText', { text });
  return { outcome: 'cdp-insertText-fallback', elementInfo };
}

/**
 * Confere se o ponto (x, y) onde o clique vai cair realmente pertence ao
 * elemento pedido (`objectId`), ANTES de despachar o clique por coordenada.
 *
 * Defeito que isto fecha (medido por um cetico, 05/09/2026): `browser_click`
 * por `ref` num elemento coberto por outro (mesma posicao, z-index maior) ou
 * de tamanho zero devolvia `ok: true` com `{ element: "backendNodeId:X" }` —
 * mas o clique real, despachado por coordenada (`Input.dispatchMouseEvent`),
 * caia no elemento COBRIDOR, nao no pedido. Medicao ao vivo: o contador do
 * cobridor foi a 1, o do elemento pedido ficou em 0, e a ponte respondeu que
 * clicou no que foi pedido. Mesma familia do defeito que a obra 24 fechou
 * ("clicou em nada e disse ok"); este e "clicou no errado e disse ok".
 *
 * Casos legitimos que a checagem tem de deixar passar (senao troca um
 * defeito por outro — overlay transparente de framework e comum em UI de
 * tribunal): um `<label>` sobre o proprio `<input>`, um `<span>` dentro do
 * `<button>` pedido. Cobertos pelo ramo DESCENDENTE (`alvo.contains(el)`,
 * abaixo) — o elemento no ponto e filho do alvo, ou o proprio alvo.
 *
 * CONSERTO (medido duas vezes em build limpo, 05/09/2026): existia tambem um
 * ramo ASCENDENTE (`el.contains(alvo)` — aceitava qualquer ANCESTRAL do alvo
 * no ponto clicado) que foi removido por estar errado por construcao.
 * `document.elementFromPoint` so devolve um ancestral ESTRITO do alvo quando
 * o ponto NAO caiu no alvo — se tivesse caido, devolveria o proprio alvo ou
 * um descendente dele (que ja e o caso `el === alvo` ou o ramo descendente
 * acima). Ou seja, o ramo ascendente aceitava exatamente os casos em que o
 * clique ERRA o elemento — e foi ele quem sustentava, junto com a guarda de
 * tamanho zero abaixo, o defeito medido: um `<button>` de 200x0 dentro de um
 * `<div>` (retangulo com area zero, entao os 5 pontos testados caem todos no
 * `<div>` pai) fazia `el.contains(alvo)` bater (o pai contem o botao) e a
 * checagem responder `ok:true` com o clique caindo fora do alvo. Removido; e
 * o teste `clique-que-nao-mente.js` (casos 8 e "sem falso positivo") prova
 * que os dois casos legitimos do paragrafo acima continuam passando so pelo
 * ramo descendente.
 *
 * Cobertura PARCIAL (centro coberto, canto livre): em vez de desistir no
 * primeiro ponto, testa tambem os quatro quadrantes do retangulo antes de
 * declarar "coberto". Decisao: um elemento que tem QUALQUER ponto clicavel
 * dentro do seu proprio retangulo e um elemento clicavel de verdade — barrar
 * esse caso teria custo (falso positivo em overlay parcial, comum) sem
 * reduzir o risco real (o clique, quando aceito, cai dentro do proprio
 * elemento, nunca no cobridor). So falha quando TODOS os pontos testados
 * caem em outro elemento que nao e o pedido nem ancestral/descendente dele.
 *
 * Falha da propria checagem (objectId ficou obsoleto entre o calculo do
 * retangulo e aqui, por exemplo) e tratada como FAIL-OPEN: loga aviso e
 * deixa o clique no centro geometrico seguir — a checagem e uma rede de
 * seguranca extra, nao pode ela mesma virar fonte de falso positivo quando
 * o CDP tropeca por motivo alheio ao defeito que estamos fechando.
 *
 * CONSERTADO (06/09/2026, o defeito de IFRAME achado pelo auditor de
 * 05/09/2026): `document.elementFromPoint` acima roda no `Runtime` do
 * documento DONO do `objectId` — para um elemento dentro de um `<iframe>`,
 * isso e o documento do FRAME, e as coordenadas de `rect` (vindas de
 * `getBoundingClientRect`/`DOM.getBoxModel` do proprio elemento) tambem sao
 * relativas ao frame. Mas `cdpClick` (que despacha o `Input.dispatchMouseEvent`
 * de verdade) manda a coordenada em viewport do frame de NIVEL SUPERIOR da
 * aba. As duas contas so batiam quando o iframe estava na origem (0,0) do
 * documento pai — em qualquer outro caso a checagem aprovava um ponto que,
 * na hora do clique real, caia fora do iframe (ou dentro dele mas deslocado).
 *
 * MEDIDO ao vivo antes do conserto (servidor HTTP local proprio, iframe
 * deslocado 220x300px da pagina pai, botao dentro do iframe em (50,50) LOCAL
 * — centro (110,70) local): `browser_click` por `ref` no botao (a) NAO
 * lancava erro, (b) a checagem APROVAVA (`elementFromPoint(110,70)` rodando
 * DENTRO do documento do iframe encontrava o proprio botao — o ponto e o
 * alvo estao no MESMO sistema de coordenadas local, entao batem), mas (c) o
 * clique real, despachado em `Input.dispatchMouseEvent(110,70)` — coordenada
 * de TOPO, nao do frame — caiu num elemento "decoy" da pagina PAI colocado
 * de proposito nesse ponto (fora do iframe, que comeca em x=220). Contador
 * do decoy foi a 1, contador do botao real ficou em 0 — exatamente a mesma
 * familia de "aprovou e clicou no lugar errado" que este arquivo ja fechou
 * para cobertura (fora de iframe). Pre-existente: o clique por ref, antes
 * desta checagem existir, ja despachava por coordenada de viewport do topo
 * sem nenhuma conversao de frame; a checagem apenas herdou a mesma premissa.
 *
 * CONSERTO, 2a VERSAO (07/09/2026 — ver `confirmarCadeiaAteTopo` e
 * `quadTopoDoElemento`/`mapearLocalParaTopo`, abaixo, para a medicao que
 * decidiu esta versao): a 1a versao (06/09/2026) somava o deslocamento de
 * cada `<iframe>` ancestral via `window.frameElement.getBoundingClientRect()`
 * — nunca chegou a rodar contra o Chrome (trava presa) e foi escrita so por
 * analogia com o Puppeteer. MEDIDO nesta sessao (Chrome real, headless,
 * isolado — scripts em `bridge-server/test/_medir-boxmodel-*-standalone.mjs`)
 * que essa soma erra por construcao sempre que o `<iframe>` tem
 * `border`/`padding` (a soma usa a BORDA EXTERNA do elemento, nao soma
 * `clientLeft`/`clientTop` nem padding — erro de 25px no caso de teste, o
 * buraco que um cetico ja tinha apontado por raciocinio) e nao tem como
 * cobrir `transform`/`zoom` de ancestral (soma aditiva simples nao acompanha
 * escala/rotacao). A MESMA MEDICAO confirmou a hipotese alternativa que o
 * briefing pediu para testar: `DOM.getBoxModel`/`DOM.getContentQuads`,
 * chamados pelo `backendNodeId` do PROPRIO elemento clicado (nao dos
 * `<iframe>` ancestrais), JA devolvem o quad em coordenada de VIEWPORT DO
 * TOPO da aba — certo nos 3 casos medidos (offset simples, border+padding,
 * `transform:scale` de ancestral: distancia do centro medido para o
 * esperado, nos 3 casos, 0.0px). Por isso a aritmetica manual de somar
 * retangulo de iframe foi APAGADA: `resolverEClicarPorRef` agora pega o quad
 * de `DOM.getBoxModel` para o elemento e mapeia o ponto que a checagem
 * aprovou (LOCAL) para esse quad (`mapearLocalParaTopo`) — a checagem em si
 * continua rodando em coordenada local (certo: e o sistema em que
 * `elementFromPoint` do proprio frame enxerga), so o DESPACHO final passa a
 * ir em coordenada de topo. `window.frameElement` continua em uso, mas so
 * como DETECTOR de cross-origin (`confirmarCadeiaAteTopo`) — e o unico sinal
 * com garantia de especificacao (devolve `null` cruzando origem) que o JS
 * enxerga; `DOM.getBoxModel` e comando privilegiado do processo do browser e
 * NAO respeita essa fronteira sozinho. Cross-origin (em qualquer nivel da
 * cadeia), iframe aninhado profundo demais, e quad que nao e um
 * paralelogramo (perspectiva 3D real): falha FECHADA — ver os comentarios de
 * `confirmarCadeiaAteTopo` e `mapearLocalParaTopo` para o porque.
 *
 * RESSALVA HONESTA DESTA SESSAO: a medicao acima rodou num Chrome PROPRIO,
 * isolado (`puppeteer-core`, headless, processo descartavel — nunca tocou o
 * Chrome do usuário nem a extensao/ponte), porque a `.obra-lock` ficou
 * presa com outro pedreiro (`operador-bancada-final`) pelo tempo inteiro
 * desta sessao (5 tentativas de 60s, nunca liberou). Isso prova a
 * COORDENADA (CDP puro, sem a extensao). NAO prova a integracao com
 * `chrome.debugger` da extensao real nem rodou `medicao-clique-iframe.js` /
 * a bateria de regressao / mutation testing contra o build de verdade — quem
 * pegar a trava livre precisa fazer isso antes de considerar esta obra
 * fechada (ver o relatorio desta sessao para o roteiro exato).
 */
async function pontoPertenceAoElemento(
  tabId: number,
  objectId: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<{ ok: true; x: number; y: number } | { ok: false; cobridor?: string }> {
  const inset = Math.min(rect.w, rect.h) > 8 ? Math.min(rect.w, rect.h) * 0.2 : 0;
  const pontos: [number, number][] = [
    [rect.x + rect.w / 2, rect.y + rect.h / 2], // centro — testado primeiro
    [rect.x + inset, rect.y + inset],
    [rect.x + rect.w - inset, rect.y + inset],
    [rect.x + inset, rect.y + rect.h - inset],
    [rect.x + rect.w - inset, rect.y + rect.h - inset],
  ];

  const checagem = `
    function(pontos) {
      const alvo = this;
      function combina(el) {
        if (!el) return false;
        if (el === alvo) return true;
        if (alvo.contains && alvo.contains(el)) return true;
        // Ramo ascendente (el.contains(alvo)) REMOVIDO de proposito — ver o
        // comentario do CONSERTO acima da funcao. Aceitar um ancestral do
        // alvo aqui e aceitar exatamente os casos em que o clique erra.
        // Ramo ROTULO (22/10/2026, Portal OAB/MUI): radio/checkbox escondido
        // sob a bolinha desenhada. Clicar em qualquer ponto do <label> do
        // proprio controle aciona o controle (regra do HTML), desde que o
        // ponto nao caia em OUTRO controle dentro do rotulo (link, botao...).
        const labels = alvo.labels ? Array.prototype.slice.call(alvo.labels) : [];
        if (labels.some(function (l) { return l.contains(el); })) {
          const outro = el.closest && el.closest('a,button,input,select,textarea,[role=button],[role=link]');
          if (!outro || outro === alvo) return true;
        }
        return false;
      }
      for (const p of pontos) {
        const noPonto = document.elementFromPoint(p[0], p[1]);
        if (combina(noPonto)) return { ok: true, x: p[0], y: p[1] };
      }
      const primeiro = document.elementFromPoint(pontos[0][0], pontos[0][1]);
      let desc = null;
      if (primeiro) {
        const cls = typeof primeiro.className === 'string' ? primeiro.className.split(' ')[0] : '';
        const texto = (primeiro.textContent || '').trim().slice(0, 40);
        desc = primeiro.tagName.toLowerCase()
          + (primeiro.id ? '#' + primeiro.id : '')
          + (cls ? '.' + cls : '')
          + (texto ? ' ("' + texto + '")' : '');
        // O que fazer depende de QUEM cobre (23/09/2026, 36 relatos de clique
        // coberto): modal aberto, lista de sugestoes aberta, ou aviso/banner.
        const sel = function (q) { try { return primeiro.closest(q); } catch (e) { return null; } };
        if (sel('.modal, .modal-backdrop, [role=dialog], [role=alertdialog], [aria-modal=true], .rich-mpnl-body, .rich-modalpanel, .cdk-overlay-container')) {
          desc += ' -- e um MODAL/JANELA aberto por cima: termine ou feche esse modal (botao Fechar/X ou tecla Escape) e tente de novo';
        } else if (sel('.rich-sb-common-container, .rich-sb-int, [role=listbox], .ui-autocomplete, .autocomplete, .select2-dropdown, .tt-menu, .dropdown-menu')) {
          desc += ' -- e uma LISTA DE SUGESTOES/menu aberto por cima: escolha nela ou tecle Escape para fecha-la';
        } else if (sel('[class*=cookie], [id*=cookie], [class*=banner], [class*=toast], [class*=survey], [class*=pesquisa], [id*=survey]')) {
          desc += ' -- parece AVISO/banner/pesquisa por cima: feche-o (recusando o que for opcional) e tente de novo';
        }
      } else {
        desc = 'nenhum elemento no ponto: o alvo esta FORA DA AREA VISIVEL da janela -- role ate ele (browser_scroll) e tente de novo';
      }
      return { ok: false, cobridor: desc };
    }
  `;

  try {
    const r = await dm.send<{ result: { value: { ok: boolean; x?: number; y?: number; cobridor?: string } } }>(
      tabId, 'Runtime.callFunctionOn',
      { objectId, functionDeclaration: checagem, arguments: [{ value: pontos }], returnByValue: true },
    );
    const v = r?.result?.value;
    if (!v) throw new Error('checagem nao devolveu valor');
    if (v.ok && v.x !== undefined && v.y !== undefined) return { ok: true, x: v.x, y: v.y };
    return { ok: false, cobridor: v.cobridor };
  } catch (err) {
    // Fail-open: a checagem em si tropecou (nao um "coberto" de verdade).
    console.warn('[pontoPertenceAoElemento] checagem de cobertura falhou, seguindo com o clique no centro:', err);
    return { ok: true, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }
}

/**
 * Confirma se a cadeia de `<iframe>` que contem o elemento (`objectId`) e
 * SAME-ORIGIN ate o topo da aba — ou seja, se e seguro converter um ponto
 * LOCAL do documento do elemento para VIEWPORT DO TOPO (onde
 * `Input.dispatchMouseEvent`, usado por `cdpClick`, sempre despacha).
 *
 * NAO calcula mais o deslocamento em si (dx/dy) — so a CONFIRMACAO de que a
 * cadeia e valida, mais a profundidade (quantos niveis de `<iframe>` ate o
 * topo, 0 = fora de iframe). A conta em si (a coordenada de verdade) saiu
 * daqui: ver `quadTopoDoElemento`/`mapearLocalParaTopo`, abaixo, e o
 * comentario no topo do arquivo (busque "CONSERTO, 2a VERSAO") para a
 * medicao que decidiu essa separacao — em resumo: `window.frameElement`
 * (usado aqui) e o UNICO sinal com garantia de especificacao para detectar
 * cross-origin (devolve `null` cruzando origem, "the frameElement getter
 * steps" do HTML Standard), mas a SOMA de `getBoundingClientRect()` de cada
 * `<iframe>` ancestral, que a 1a versao deste conserto fazia, erra com
 * border/padding no proprio `<iframe>` e nao acompanha `transform`/`zoom` —
 * `DOM.getBoxModel` (comando CDP, nao JS) resolve os dois de graca porque
 * vem direto do layout/compositor, entao a coordenada agora vem de la.
 *
 * Por que `window.frameElement` funciona aqui: o `objectId` que chega e do
 * documento do PROPRIO frame (`this.ownerDocument.defaultView` e a window do
 * frame). Subindo `win = win.parent` ate `win === win.top`, cada volta
 * confirma que `win.frameElement` (visto de DENTRO da propria window) nao
 * veio `null` — o que so acontece cruzando uma fronteira cross-origin.
 * MEDIDO (07/09/2026, `_medir-boxmodel-crossorigin-standalone.mjs`):
 * `window.frameElement` dentro de um iframe cross-origin de verdade veio
 * `null`, confirmando que o sinal dispara. Cobre IFRAME ANINHADO de
 * qualquer profundidade numa unica chamada de `Runtime.callFunctionOn`.
 *
 * FALHA FECHADA (`bloqueado: true`) sempre que a cadeia nao pode ser
 * confirmada ate o topo: `frameElement` veio `null` no meio do caminho
 * (fronteira cross-origin — pode ser o proprio frame do elemento OU
 * qualquer ancestral entre ele e o topo), o documento nao tem `defaultView`
 * (no desanexado), ou profundidade > 20 (guarda contra loop patologico). Um
 * so hop cross-origin em QUALQUER nivel bloqueia a cadeia inteira — nao ha
 * "confirmacao parcial aceitavel". Fora de iframe (o caso comum, sem
 * regressao): o `while` abaixo nunca entra (`win === win.top` de saida),
 * devolve `{bloqueado:false, profundidade:0}` de graca, sem round-trip a
 * mais que valha a pena medir.
 */
async function confirmarCadeiaAteTopo(
  tabId: number,
  objectId: string,
): Promise<{ bloqueado: boolean; motivo: string | null; profundidade: number }> {
  const calculo = `
    function() {
      var doc = this.ownerDocument || (this.nodeType === 9 ? this : null);
      var win = doc ? doc.defaultView : null;
      if (!win) return { bloqueado: true, motivo: 'sem-view', profundidade: 0 };
      var profundidade = 0;
      while (win !== win.top) {
        var frameEl;
        try { frameEl = win.frameElement; } catch (e) { frameEl = null; }
        if (!frameEl) return { bloqueado: true, motivo: 'cross-origin', profundidade: profundidade };
        profundidade++;
        if (profundidade > 20) {
          return { bloqueado: true, motivo: 'profundidade-excessiva', profundidade: profundidade };
        }
        var pai = win.parent;
        if (pai === win) return { bloqueado: true, motivo: 'loop', profundidade: profundidade };
        win = pai;
      }
      return { bloqueado: false, motivo: null, profundidade: profundidade };
    }
  `;
  try {
    const r = await dm.send<{
      result: { value: { bloqueado: boolean; motivo: string | null; profundidade: number } };
    }>(tabId, 'Runtime.callFunctionOn', { objectId, functionDeclaration: calculo, returnByValue: true });
    const v = r?.result?.value;
    if (!v) return { bloqueado: true, motivo: 'sem-retorno', profundidade: 0 };
    return v;
  } catch (err) {
    return {
      bloqueado: true,
      motivo: `excecao: ${err instanceof Error ? err.message : String(err)}`,
      profundidade: 0,
    };
  }
}

/**
 * Devolve o quad de CONTEUDO do elemento `backendNodeId` (8 numeros,
 * `[x0,y0, x1,y1, x2,y2, x3,y3]`, sentido horario a partir do canto
 * superior-esquerdo — mesmo formato que `DOM.getBoxModel.model.content`),
 * JA EM COORDENADA DE VIEWPORT DO TOPO DA ABA. `null` se o comando CDP
 * falhar (por exemplo, o elemento foi desanexado entre a checagem de
 * cobertura e esta chamada).
 *
 * MEDIDO (07/09/2026, `_medir-boxmodel-iframe-standalone.mjs` e
 * `_medir-boxmodel-transform-standalone.mjs`, Chrome real headless isolado):
 * para um elemento dentro de um `<iframe>` (aninhado ou nao, com
 * border/padding no `<iframe>`, ou com `transform:scale` num ancestral), o
 * centro deste quad bate com o centro visual REAL na tela, distancia 0.0px
 * em todos os casos testados — `DOM.getBoxModel` ja resolve a conversao de
 * frame de graca, vindo direto do layout/compositor do browser (nao passa
 * por JS, entao nao herda a fronteira same-origin nem o erro de
 * clientLeft/clientTop/padding que a soma manual tinha).
 */
async function quadTopoDoElemento(tabId: number, backendNodeId: number): Promise<number[] | null> {
  try {
    const r = await dm.send<{ model: { content: number[] } }>(tabId, 'DOM.getBoxModel', { backendNodeId });
    const c = r?.model?.content;
    return c && c.length === 8 ? c : null;
  } catch {
    return null;
  }
}

// Tolerancia (px) para o quad de `quadTopoDoElemento` se afastar de um
// PARALELOGRAMO perfeito antes de `mapearLocalParaTopo` desistir e mandar
// falhar fechado — ver o comentario da funcao para o porque.
const TOLERANCIA_PARALELOGRAMO_PX = 1.5;

/**
 * Mapeia um ponto em coordenada LOCAL (`ponto`, dentro de `rectLocal` — que
 * veio de `getBoundingClientRect()` executado NO PROPRIO documento do
 * elemento, o mesmo sistema em que `elementFromPoint` de
 * `pontoPertenceAoElemento` avalia) para coordenada de VIEWPORT DO TOPO,
 * usando o quad de 4 cantos de `quadTopoDoElemento` (do MESMO elemento, ja
 * em coordenada de topo).
 *
 * Interpolacao AFIM pelos 3 cantos TL/TR/BL do quad — matematicamente EXATA
 * para qualquer transform CSS 2D (translate/scale/rotate/skew, isolados ou
 * combinados: todos preservam paralelogramo, entao a fracao (fx,fy) do
 * ponto dentro do retangulo LOCAL mapeia linearmente para a mesma fracao
 * dentro do paralelogramo de TOPO). O 4o canto (BR) MEDIDO no quad e
 * comparado contra o BR PREVISTO pelo paralelogramo (`TR + BL - TL`); um
 * desvio maior que `TOLERANCIA_PARALELOGRAMO_PX` e o unico sinal disponivel
 * de que o quad NAO e um paralelogramo — perspectiva 3D de verdade
 * (`perspective()`, `rotateX`/`rotateY` com profundidade real) ou algum
 * outro efeito que este mapeamento nao cobre. O CHAMADOR falha fechado
 * nesse caso, em vez de arriscar uma coordenada errada.
 */
function mapearLocalParaTopo(
  quadTopo: number[],
  rectLocal: { x: number; y: number; w: number; h: number },
  ponto: { x: number; y: number },
): { x: number; y: number; desvioParalelogramo: number } {
  const TLx = quadTopo[0], TLy = quadTopo[1];
  const TRx = quadTopo[2], TRy = quadTopo[3];
  const BRx = quadTopo[4], BRy = quadTopo[5];
  const BLx = quadTopo[6], BLy = quadTopo[7];

  const brPrevistoX = TRx + BLx - TLx;
  const brPrevistoY = TRy + BLy - TLy;
  const desvioParalelogramo = Math.hypot(BRx - brPrevistoX, BRy - brPrevistoY);

  // rectLocal.w/h <= 0 ja e barrado antes de qualquer chamador chegar aqui
  // (guarda de tamanho zero, mais abaixo em `resolverEClicarPorRef`) — a
  // divisao por zero abaixo e so defensiva, nunca deve disparar em producao.
  const fx = rectLocal.w > 0 ? (ponto.x - rectLocal.x) / rectLocal.w : 0.5;
  const fy = rectLocal.h > 0 ? (ponto.y - rectLocal.y) / rectLocal.h : 0.5;

  return {
    x: TLx + fx * (TRx - TLx) + fy * (BLx - TLx),
    y: TLy + fx * (TRy - TLy) + fy * (BLy - TLy),
    desvioParalelogramo,
  };
}

/**
 * Nucleo do clique por ref: resolve o backendNodeId para coordenadas de tela
 * e clica. LANCA erro descritivo (nunca silencioso) quando o ref nao existe
 * mais na pagina, quando o elemento nao tem posicao visivel, quando ele esta
 * dentro de um iframe cuja posicao nao pode ser confirmada com seguranca
 * (cross-origin em qualquer nivel — ver `confirmarCadeiaAteTopo`), ou quando
 * o ponto de clique cai em outro elemento (coberto — ver `pontoPertenceAoElemento`).
 *
 * Existem dois chamadores com necessidades opostas (ver abaixo de proposito,
 * nao fundir): `cdpClickByRefOrThrow` (clique direto por ref, `case 'click'`
 * do execution-engine) precisa saber quando NAO clicou; `cdpClickByRef`
 * (clique-para-focar auxiliar de `type`/`drag`) e melhor-esforco por design
 * e continua engolindo a falha, exatamente como sempre fez.
 */
async function resolverEClicarPorRef(tabId: number, backendNodeId: number): Promise<{ x: number; y: number }> {
  // 1. Resolve node id -> objectId. Um ref que nao existe mais na pagina (de
  // uma leitura antiga, ou que nunca existiu) faz o CDP rejeitar aqui.
  let objectId: string | undefined;
  try {
    const res = await dm.send<{ object: { objectId: string } }>(tabId, 'DOM.resolveNode', { backendNodeId });
    objectId = res?.object?.objectId;
  } catch (err) {
    throw new Error(
      `ref ${backendNodeId} nao existe mais na pagina (DOM.resolveNode: `
      + `${err instanceof Error ? err.message : String(err)}). Releia a pagina com browser_read_page `
      + 'e clique de novo com um ref atual.',
    );
  }
  if (!objectId) {
    throw new Error(
      `ref ${backendNodeId} nao resolveu para nenhum elemento (DOM.resolveNode devolveu sem `
      + 'objectId). Releia a pagina com browser_read_page e clique de novo com um ref atual.',
    );
  }

  // 2. Scroll into view and force focus — melhor esforco: uma destas falhar
  // nao impede o clique, o elemento pode ja estar visivel e focavel sem isso.
  await dm.send(tabId, 'DOM.focus', { backendNodeId }).catch(() => {});
  await dm.send(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); if (typeof this.focus === "function") this.focus(); }',
  }).catch(() => {});

  // V2: espera o retangulo assentar (2 leituras iguais, 30 ms, teto 500 ms) em vez de
  // 150 ms parados. O hit-test e a conferencia mais abaixo continuam como estavam.
  await aguardarEstavel(async () => {
    const r = await dm.send<{ result: { value: { x: number; y: number; w: number; h: number } } }>(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }',
      returnByValue: true,
    });
    return r?.result?.value;
  }, { intervaloMs: 30, tetoMs: 500 });

  // 3a. Fast path: getBoundingClientRect via JS. Pode falhar se o objectId
  // ficou obsoleto entre o resolveNode e aqui (pagina re-renderizou no meio
  // do caminho) — cai para o 3b em vez de propagar, porque o 3b resolve de
  // novo pelo backendNodeId (que continua valido), nao pelo objectId.
  const rectInfo = await dm.send<{ result: { value: { x: number; y: number; w: number; h: number } } }>(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }',
    returnByValue: true,
  }).catch(() => null);

  let centerX: number | undefined;
  let centerY: number | undefined;
  let rect: { x: number; y: number; w: number; h: number } | undefined;
  // Marca se `rect` veio do fallback 3b (DOM.getBoxModel) em vez do fast path
  // 3a (getBoundingClientRect via JS). Importa para o passo 4b: o fallback
  // devolve coordenada de VIEWPORT DO TOPO (CDP puro), nao LOCAL — dentro de
  // um iframe, os dois sistemas divergem, e `pontoPertenceAoElemento` (passo
  // 5) precisa de LOCAL. Ver a guarda logo apos `confirmarCadeiaAteTopo`.
  let rectVeioDoFallbackTopo = false;

  const rv = rectInfo?.result?.value;
  if (rv && (rv.w > 0 || rv.h > 0)) {
    centerX = rv.x + rv.w / 2;
    centerY = rv.y + rv.h / 2;
    rect = rv;
  } else {
    // 3b. Fallback: DOM.getBoxModel — CDP-native, works with Shadow DOM and iframes
    // getBoundingClientRect can return 0 for elements inside Shadow DOM trees.
    // DOM.getBoxModel queries the layout engine directly, bypassing JS entirely.
    const boxModel = await dm.send<{ model: { content: number[] } }>(
      tabId, 'DOM.getBoxModel', { backendNodeId }
    ).catch(() => null);

    if (boxModel?.model?.content) {
      // content quad: [x0,y0, x1,y1, x2,y2, x3,y3] clockwise from top-left
      const c = boxModel.model.content;
      centerX = (c[0] + c[2]) / 2;
      centerY = (c[1] + c[5]) / 2;
      rect = { x: c[0], y: c[1], w: c[2] - c[0], h: c[5] - c[1] };
      rectVeioDoFallbackTopo = true;
    }
  }

  if (centerX === undefined || centerY === undefined || !rect) {
    throw new Error(
      `ref ${backendNodeId} existe mas nao tem posicao visivel na pagina (getBoundingClientRect `
      + 'e DOM.getBoxModel nao acharam tamanho). O elemento pode estar oculto (display:none), fora '
      + 'da tela, desanexado do DOM, ou ter sido removido num re-render depois da leitura. Releia a '
      + 'pagina com browser_read_page antes de tentar de novo.',
    );
  }

  // 4. Tamanho zero numa dimensao (0x0 OU largura/altura zero sozinha).
  // `DOM.getBoxModel` as vezes devolve um quad degenerado (as quatro pontas
  // no mesmo lugar) para um elemento que ESTA no layout mas nao ocupa area
  // nenhuma — isso passaria pelo check acima (nao e undefined) e, sem esta
  // guarda, seguiria para o clique como se tivesse posicao valida. E
  // exatamente o "clicou sem reclamar" que o criterio de pronto pede para
  // fechar.
  //
  // CONSERTO (medido duas vezes em build limpo, 05/09/2026): a guarda usava
  // `&&`, entao so pegava 0x0 exato — um elemento de 200x0 (ou 0x200)
  // escapava por aqui, e o "clique" seguia para `pontoPertenceAoElemento`
  // com um retangulo sem area nenhuma. Como QUALQUER dimensao zero ja torna
  // o elemento sem ponto valido para clicar (nao ha "meio caminho" clicavel
  // num retangulo de altura zero), a checagem certa e `||`.
  if (rect.w <= 0 || rect.h <= 0) {
    throw new Error(
      `ref ${backendNodeId} tem tamanho zero numa dimensao (${rect.w}x${rect.h}): o elemento existe `
      + 'e tem uma posicao no layout, mas nao ocupa area nenhuma da tela (largura ou altura zero), '
      + 'entao nao ha ponto valido para clicar. Confira se e o elemento certo, ou se ele esta oculto '
      + 'por CSS (width/height zero, sem conteudo, overflow:hidden num pai colapsado). Releia a '
      + 'pagina com browser_read_page antes de tentar de novo.',
    );
  }

  // 4b. IFRAME: confirma se a cadeia de `<iframe>` ate o topo da aba e
  // SAME-ORIGIN em todos os niveis — ver `confirmarCadeiaAteTopo` para o
  // porque e a medicao que decidiu esta versao do conserto. Roda ANTES da
  // checagem de cobertura porque, se bloqueado, nao ha nem sentido em gastar
  // o round-trip da checagem.
  const cadeia = await confirmarCadeiaAteTopo(tabId, objectId);
  if (cadeia.bloqueado) {
    const motivoTexto = cadeia.motivo === 'cross-origin'
      ? 'esta dentro de um <iframe> de origem DIFERENTE da pagina que o contem (cross-origin) — daqui '
        + 'nao ha como confirmar onde ele realmente fica na tela'
      : `a posicao do elemento na pagina nao pode ser confirmada (${cadeia.motivo})`;
    throw new Error(
      `ref ${backendNodeId} nao pode ser clicado com seguranca: o elemento ${motivoTexto}`
      + (cadeia.profundidade > 0 ? ` (a ${cadeia.profundidade} nivel(is) de iframe do topo da aba)` : '')
      + '. O clique foi recusado em vez de arriscar cair em outro elemento. Se for realmente preciso, '
      + 'clique por coordenada (browser_click com x/y em vez de ref) sabendo do risco.',
    );
  }

  // 4c. Combinacao rara e perigosa: `rect` veio do fallback 3b (coordenada de
  // TOPO — DOM.getBoxModel puro, sem passar por JS) E o elemento esta dentro
  // de um iframe confirmado (profundidade > 0). Nesse caso `rect` NAO serve
  // como retangulo LOCAL para o passo 5 (`pontoPertenceAoElemento` roda
  // `elementFromPoint` DENTRO do documento do proprio iframe — precisa de
  // coordenada LOCAL, nao de topo). Isso so acontece quando o fast path 3a
  // (getBoundingClientRect via JS) falhou para um elemento QUE TAMBEM esta
  // em iframe (ex.: Shadow DOM com getBoundingClientRect vazio, dentro de um
  // iframe) — combinacao rara o bastante para nao valer a pena resolver com
  // mais uma chamada; falha fechada com mensagem clara em vez de arriscar
  // testar cobertura no sistema de coordenadas errado.
  if (rectVeioDoFallbackTopo && cadeia.profundidade > 0) {
    throw new Error(
      `ref ${backendNodeId} esta dentro de um iframe e nao tem retangulo LOCAL confiavel `
      + '(getBoundingClientRect nao achou tamanho, e o fallback DOM.getBoxModel so da coordenada de '
      + 'topo, nao serve para confirmar cobertura dentro do proprio documento do iframe). Combinacao '
      + 'rara (Shadow DOM ou CSS incomum dentro de iframe) — o clique foi recusado em vez de arriscar. '
      + 'Releia a pagina com browser_read_page e tente de novo, ou clique por coordenada (x/y) sabendo '
      + 'do risco.',
    );
  }

  // 5. Confere que o ponto onde o clique vai cair pertence de fato ao
  // elemento pedido — nao a outro elemento que o cobre (ver
  // `pontoPertenceAoElemento` acima para o porque e o desenho). `checagem.x/y`
  // sai em coordenada LOCAL ao documento do proprio elemento (garantido pela
  // guarda 4c acima: se chegamos aqui, `rect` e mesmo LOCAL).
  const checagem = await pontoPertenceAoElemento(tabId, objectId, rect);
  if (!checagem.ok) {
    throw new Error(
      `ref ${backendNodeId} esta coberto por outro elemento`
      + (checagem.cobridor ? ` (${checagem.cobridor})` : '')
      + ' em todos os pontos testados do seu proprio retangulo — o clique por coordenada cairia '
      + 'nesse cobridor, nao no elemento pedido. Role a pagina, feche o que estiver sobrepondo, ou '
      + 'releia com browser_read_page e confira se o ref ainda e o elemento certo.',
    );
  }

  // 6. `cdpClick` despacha SEMPRE em coordenada de viewport do TOPO da aba.
  // Fora de iframe (`cadeia.profundidade === 0`, o caso comum): LOCAL e TOPO
  // sao o MESMO sistema, despacha o ponto aprovado direto — sem regressao,
  // sem round-trip a mais (comportamento identico a antes desta obra).
  let xTopo = checagem.x;
  let yTopo = checagem.y;

  if (cadeia.profundidade > 0) {
    // Dentro de um iframe confirmado same-origin ate o topo: converte o
    // ponto aprovado (LOCAL) para VIEWPORT DO TOPO usando o quad REAL do
    // PROPRIO elemento (`DOM.getBoxModel`, comando CDP nativo — MEDIDO que
    // ja vem em coordenada de topo, corrigindo border/padding do <iframe> e
    // transform CSS de ancestral automaticamente; ver `quadTopoDoElemento` e
    // `mapearLocalParaTopo`, acima).
    const quadTopo = await quadTopoDoElemento(tabId, backendNodeId);
    if (!quadTopo) {
      throw new Error(
        `ref ${backendNodeId} esta dentro de um iframe mas a posicao final na tela nao pode ser `
        + 'confirmada (DOM.getBoxModel falhou depois da checagem de cobertura — o elemento pode ter '
        + 'sido desanexado no meio do caminho). Releia a pagina com browser_read_page e tente de novo.',
      );
    }
    const mapeado = mapearLocalParaTopo(quadTopo, rect, checagem);
    if (mapeado.desvioParalelogramo > TOLERANCIA_PARALELOGRAMO_PX) {
      throw new Error(
        `ref ${backendNodeId} esta dentro de um iframe com uma transformacao que nao e um simples `
        + `deslocamento/escala/rotacao 2D (desvio de ${mapeado.desvioParalelogramo.toFixed(1)}px do `
        + 'paralelogramo esperado — provavel perspectiva 3D). Nao e seguro calcular a posicao final na '
        + 'tela com confianca. O clique foi recusado. Se for realmente preciso, clique por coordenada '
        + '(browser_click com x/y) sabendo do risco.',
      );
    }
    xTopo = mapeado.x;
    yTopo = mapeado.y;
  }

  await cdpClick(tabId, xTopo, yTopo);
  return { x: xTopo, y: yTopo };
}

/**
 * Clique por ref que ADMITE FALHA — usado por `browser_click` quando o alvo
 * veio de um `ref` de leitura de pagina (`case 'click'` do execution-engine).
 *
 * Existe porque a versao antiga (`cdpClickByRef`, abaixo) engolia toda
 * falha — um `ref` inexistente devolvia `ok:true` sem ter clicado em nada.
 * Nesta ponte isso e grave: o usuário opera o PJe por protocolo passo a
 * passo, e um "ok" que mente sobre um clique faz o agente seguir em cima de
 * um passo que nunca aconteceu — por exemplo anexar documento na tela errada
 * sem ninguem descobrir na hora (obra 24, 05/09/2026).
 */
export async function cdpClickByRefOrThrow(tabId: number, backendNodeId: number): Promise<{ x: number; y: number }> {
  return resolverEClicarPorRef(tabId, backendNodeId);
}

/**
 * Clique por ref de MELHOR ESFORCO — usado como clique-para-focar auxiliar
 * por `type` e `drag` (execution-engine/index.ts) antes de resolver a
 * posicao real por outro caminho. Comportamento historico preservado DE
 * PROPOSITO (engole erro, so loga aviso): esses dois fluxos contam com o
 * "melhor esforco" continuar em frente mesmo quando o clique de foco falha, e
 * mudar isso e fora do escopo desta obra (24), que e so o clique direto por
 * ref. Ver `cdpClickByRefOrThrow` para a versao que lanca.
 */
export async function cdpClickByRef(tabId: number, backendNodeId: number): Promise<void> {
  try {
    await resolverEClicarPorRef(tabId, backendNodeId);
  } catch (err) {
    console.warn(`[cdpClickByRef] melhor esforco falhou para backendNodeId ${backendNodeId}:`, err);
  }
}


// Key name normalisation map — models use various names for the same key
const KEY_ALIASES: Record<string, string> = {
  return: 'Enter', enter: 'Enter',
  esc: 'Escape', escape: 'Escape',
  space: ' ', spacebar: ' ',
  backspace: 'Backspace', del: 'Delete', delete: 'Delete',
  tab: 'Tab',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  pgup: 'PageUp', pageup: 'PageUp', pgdn: 'PageDown', pagedown: 'PageDown',
  home: 'Home', end: 'End',
  ctrl: 'Control', cmd: 'Meta', command: 'Meta', alt: 'Alt', shift: 'Shift',
};

/**
 * UMA definicao do nome da tecla, para o motor E para o freio (obra 26).
 *
 * Era `function` privada. O freio (`bridge/policy.ts`) tinha a copia dele
 * (`partesDaTecla`), deliberadamente "mais simples", e as duas discordavam:
 * MEDIDO em 06/09/2026, `press_key {key:'space'}` era `'space'` para o freio
 * (5 caracteres, "nao insere texto", regra da senha nem rodava) e `' '` para o
 * motor (1 caractere, insere no campo focado). Com a senha focada o espaco
 * entrava no campo de senha sem o freio olhar. Duas definicoes do MESMO nome
 * sao a familia de furo inteira desta ponte em escala de teclado — a receita
 * que fechou os furos 1 a 6 e esta: exportar e usar uma so.
 */
export function normaliseKey(raw: string): { key: string; modifiers: number } {
  // Parse combos like "Ctrl+A", "Shift+Enter", "Ctrl+Shift+K"
  const parts = raw.split(/\+(?=[^+])/);
  let modifiers = 0;
  const modMap: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

  const keyParts: string[] = [];
  for (const part of parts) {
    const lower = part.trim().toLowerCase();
    if (modMap[lower] !== undefined) {
      modifiers |= modMap[lower];
    } else {
      keyParts.push(part.trim());
    }
  }

  const rawKey = keyParts.join('+');
  const lower = rawKey.toLowerCase();
  const key = KEY_ALIASES[lower] ?? (rawKey.length === 1 ? rawKey : rawKey);
  return { key, modifiers };
}

// Bit dos modificadores de COMANDO (Alt, Control, Meta). Shift fica de fora
// de proposito: "Shift+a" e digitacao de verdade (deve escrever "A"), so
// Ctrl/Meta/Alt viram atalho de edicao (Ctrl+A = selecionar tudo).
export const MODIFICADOR_DE_COMANDO = 1 /* Alt */ | 2 /* Control */ | 4 /* Meta */;

/**
 * A tecla vai INSERIR CARACTERE no elemento focado? UMA definicao, usada pelo
 * `cdpPressKey` (que manda o `text` no evento quando isto e verdade) e pelo
 * freio (regra 1, senha). Ver a nota de `normaliseKey`: e a divergencia entre
 * as duas leituras desta mesma pergunta que deixou `space` vazar.
 */
export function teclaImprimivel(key: string, modifiers: number): boolean {
  return key.length === 1 && (modifiers & MODIFICADOR_DE_COMANDO) === 0;
}

// Teclas de controle: o Chrome so executa a acao NATIVA de edicao
// (Backspace apaga, setas movem o cursor, Home/End pulam) quando o evento
// carrega `windowsVirtualKeyCode`/`nativeVirtualKeyCode`/`code` de verdade.
// MEDIDO (obra 21, 05/09/2026, contra https://example.com): rawKeyDown so
// com `key: "Backspace"` chega no campo mas nao apaga nada — falta esse
// trio. Numeros da tabela de Virtual-Key do Windows (a mesma que o Chrome
// usa em windowsVirtualKeyCode).
const TECLA_DE_CONTROLE: Record<string, { code: string; keyCode: number }> = {
  Backspace: { code: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', keyCode: 9 },
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  End: { code: 'End', keyCode: 35 },
  Home: { code: 'Home', keyCode: 36 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Delete: { code: 'Delete', keyCode: 46 },
};

// Letra unica (a-z). Usada para gerar `code`/`keyCode` de Ctrl/Alt/Meta+letra
// (obra 21, parte 2) sem precisar de uma segunda lista chumbada — ver nota
// abaixo, em `infoControle`.
const LETRA_UNICA = /^[a-zA-Z]$/;

export async function cdpPressKey(tabId: number, keyCombo: string): Promise<void> {
  const { key, modifiers } = normaliseKey(keyCombo);

  // Press modifier keys down first
  const modKeys: { bit: number; name: string }[] = [
    { bit: 1, name: 'Alt' },
    { bit: 2, name: 'Control' },
    { bit: 4, name: 'Meta' },
    { bit: 8, name: 'Shift' },
  ];
  for (const mod of modKeys) {
    if (modifiers & mod.bit) {
      await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: mod.name, modifiers });
    }
  }

  // Caractere imprimivel vai como keyDown COM `text`: e o `text` que insere o
  // caractere no campo. Antes ia `rawKeyDown` + `char` sem `text`, e o campo
  // recebia o evento e nenhum caractere — press_key "7" devolvia ok com o
  // campo vazio (HANDOFF-DIGITACAO-REAL-20260819). Tecla de controle (Enter,
  // Tab, Escape, setas) segue como rawKeyDown, que e o que ela precisa.
  //
  // REGRESSAO (03/09, consertada aqui em 05/09 — obra 21): esse `imprimivel`
  // so olhava `key.length === 1`, e "Ctrl+A" normaliza para key="a" — mandava
  // `text: "a"` e o Chrome INSERIA a letra por cima do atalho, mesmo com o
  // Control pressionado (medido: campo "LIXO" virou "LIXOa"). Regra certa:
  // so mandar `text` quando NAO houver modificador de COMANDO (Control,
  // Meta, Alt) — Shift nao conta, "Shift+a" continua sendo texto de verdade.
  const semComando = (modifiers & MODIFICADOR_DE_COMANDO) === 0;
  const imprimivel = teclaImprimivel(key, modifiers);

  // Com Shift sozinho numa letra, o texto inserido tem de sair maiusculo
  // (Shift+a -> "A"), como o teclado fisico faria. MEDIDO: mandar
  // `text: "a"` com `modifiers` carregando o bit do Shift NAO faz o Chrome
  // maiusculizar sozinho — grava "a". Por isso a troca e feita aqui.
  const comSoShift = (modifiers & 8) !== 0 && semComando;
  const textoDigitado = imprimivel && comSoShift && /^[a-zA-Z]$/.test(key) ? key.toUpperCase() : key;

  // OBRA 21, PARTE 2 (05/09/2026): a mesma exigencia do Chrome que vale para
  // Backspace/setas (precisa de `code`+`windowsVirtualKeyCode`/
  // `nativeVirtualKeyCode` de verdade para executar a acao NATIVA) tambem
  // vale para letra com modificador de comando — Ctrl+A, Ctrl+C, Ctrl+V,
  // Ctrl+Z etc. Sem esse trio o Chrome recebe o rawKeyDown e nao faz nada:
  // MEDIDO, campo "LIXO1234" (8 chars) apos Ctrl+A ficava com
  // `selectionStart/End` em {8,8} (cursor no fim, zero selecao) em vez de
  // {0,8}. `semComando` aqui e sempre `false` neste ramo (e o caso que a
  // TECLA_DE_CONTROLE nao cobre): letra sozinha, sem Ctrl/Alt/Meta, ja vai
  // pelo caminho `imprimivel` com `text`, que funciona sem este trio — por
  // isso o fallback so entra quando HA modificador de comando, para nao
  // mexer no que digitacao-real.js e autocomplete.js ja provam funcionar.
  // Regra geral por A-Z (`code: 'Key'+letra`, keyCode = charCode da letra
  // maiuscula) em vez de lista chumbada A/C/V/Z: cobre Y, X e qualquer outro
  // atalho de letra sem precisar prever cada um (o pedido do briefing).
  const infoControle = TECLA_DE_CONTROLE[key]
    ?? (!semComando && LETRA_UNICA.test(key)
      ? { code: 'Key' + key.toUpperCase(), keyCode: key.toUpperCase().charCodeAt(0) }
      : undefined);
  const camposDeControle = infoControle
    ? { code: infoControle.code, windowsVirtualKeyCode: infoControle.keyCode, nativeVirtualKeyCode: infoControle.keyCode }
    : {};

  await dm.send(tabId, 'Input.dispatchKeyEvent', {
    type: imprimivel ? 'keyDown' : 'rawKeyDown',
    key,
    modifiers,
    ...camposDeControle,
    ...(imprimivel && { text: textoDigitado, unmodifiedText: key }),
  });
  await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, ...camposDeControle });

  // Release modifier keys
  for (const mod of modKeys.reverse()) {
    if (modifiers & mod.bit) {
      await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: mod.name, modifiers: 0 });
    }
  }
}

export async function cdpScroll(
  tabId: number,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  // First try mouseWheel on the element at (x,y)
  await dm.send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
  });

  // Also scroll the nearest scrollable container via JS (for chat divs, modals, etc.)
  await safeExecuteScript({
    target: { tabId },
    func: (px: number, py: number, dy: number) => {
      // Find the topmost scrollable element at the given coordinates
      const el = document.elementFromPoint(px, py);
      if (!el) return;
      let node: Element | null = el;
      while (node && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
        if (canScroll) {
          node.scrollTop += dy;
          return;
        }
        node = node.parentElement;
      }
      // Fallback to window scroll
      window.scrollBy(0, dy);
    },
    args: [x, y, deltaY],
  });
}

/**
 * Simulates a drag-and-drop gesture via CDP mouse events.
 * Works with Shadow DOM and any element reachable via CDP coordinates.
 *
 * @param fromX - Source X coordinate (viewport)
 * @param fromY - Source Y coordinate (viewport)
 * @param toX   - Destination X coordinate (viewport)
 * @param toY   - Destination Y coordinate (viewport)
 * @param steps - Number of intermediate mouse-move events (default: 10)
 */
export async function cdpDrag(
  tabId: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 10,
): Promise<void> {
  const button = 'left';
  const buttons = 1; // left button held

  // 1. Press mouse button at source
  await dm.send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: fromX, y: fromY, button, buttons, clickCount: 1,
  });
  await new Promise((r) => setTimeout(r, 50));

  // 2. Move mouse in small increments (smooth drag)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mx = fromX + (toX - fromX) * t;
    const my = fromY + (toY - fromY) * t;
    await dm.send(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: mx, y: my, button, buttons,
    });
    await new Promise((r) => setTimeout(r, 20));
  }

  // 3. Release mouse button at destination
  await dm.send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: toX, y: toY, button, buttons: 0, clickCount: 1,
  });
}

/**
 * Espera a rede da pagina ACALMAR depois de navegar.
 *
 * CONEXAO LONGA NAO CONTA (26/09/2026, gemini.google.com): a versao antiga
 * contava requisicoes abertas e esperava zerar. O Gemini (e todo site com
 * canal ao vivo: streaming, long-poll, EventSource) mantem conexao aberta o
 * tempo todo, a conta nunca zerava e TODA navegacao pagava o teto de 15 s.
 * Agora requisicao aberta ha mais de LONGA_MS e tratada como conexao longa e
 * sai da conta; o que importa e nao haver requisicao NOVA em voo.
 */
export const LONGA_MS = 2000;

/**
 * X9: janela de silencio mais curta, SO depois do `load` e SO enquanto a pagina
 * nao fez nenhum pedido depois dele. Pagina que continua pedindo coisa depois do
 * `load` (SPA, hidratacao, AJAX de inicializacao do PJe) volta para a janela
 * inteira de `idleThresholdMs` — a mesma de antes.
 */
export const SILENCIO_POS_LOAD_MS = 250;

export async function waitForNetworkIdle(
  tabId: number,
  options?: { maxWaitMs?: number; idleThresholdMs?: number; silencioCurtoPosLoad?: boolean; soDom?: boolean },
): Promise<void> {
  const maxWait = options?.maxWaitMs ?? 15000;
  const idleThreshold = options?.idleThresholdMs ?? 500;
  const curto = options?.silencioCurtoPosLoad === true;
  // v6.1 (c): site de conexao viva (Gmail, WhatsApp Web) nunca zera a rede: so o DOM conta, com teto proprio.
  const soDom = options?.soDom === true;
  const inicio = Date.now();

  const emVoo = new Map<string, number>();
  let pintou = false;
  let carregou = false;
  let pedidoPosLoad = false;
  let ultimaAtividade = Date.now();
  // v6.1 (c): mudancas de DOM contam como atividade (ver assentamento.ts).
  const acompanhante = criarAcompanhante({ documentoNovoConta: false });
  let mutacoes = 0;
  let ultimaMutacao = inicio;
  let redeAssentouEm: number | undefined;
  const sondarDom = async () => {
    const n = await lerContadorDeMutacoes((metodo, params) => dm.send(tabId, metodo, params));
    if (acompanhante.registrar(n)) { mutacoes += 1; ultimaMutacao = Date.now(); }
  };

  const onReq = (p: any) => {
    emVoo.set(String(p.requestId), Date.now());
    ultimaAtividade = Date.now();
    if (carregou) pedidoPosLoad = true;
  };
  const onFim = (p: any) => {
    if (emVoo.delete(String(p.requestId))) ultimaAtividade = Date.now();
  };
  const onLifecycle = (p: any) => {
    if (p.name === 'firstContentfulPaint' || p.name === 'load' || p.name === 'DOMContentLoaded') pintou = true;
    if (p.name === 'load') carregou = true;
  };

  const offs = [
    dm.on(tabId, 'Network.requestWillBeSent', onReq),
    dm.on(tabId, 'Network.loadingFinished', onFim),
    dm.on(tabId, 'Network.loadingFailed', onFim),
    dm.on(tabId, 'Page.lifecycleEvent', onLifecycle),
  ];
  dm.send(tabId, 'Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => {});

  try {
    for (;;) {
      const agora = Date.now();
      if (agora - inicio >= maxWait) return;
      if (soDom && agora - inicio >= TETO_SO_DOM_MS) return;
      await sondarDom();
      let recentes = 0;
      for (const t of emVoo.values()) if (agora - t < LONGA_MS) recentes += 1;
      const silencio = curto && carregou && !pedidoPosLoad ? Math.min(idleThreshold, SILENCIO_POS_LOAD_MS) : idleThreshold;
      const v = avaliarAssentamento({
        agora: Date.now(), armadoEm: inicio, emVooRecentes: recentes, navegou: false, carregou: true,
        requisicoes: 1, ultimaAtividade, mutacoes, ultimaMutacao, redeAssentouEm,
      }, { soDom, quietoRedeMs: silencio, quietoSemRedeMs: silencio });
      if (pintou && v.redeAssentou && redeAssentouEm === undefined) redeAssentouEm = Date.now();
      if (pintou && v.assentou) return;
      await new Promise((r) => setTimeout(r, curto ? 50 : 100));
    }
  } finally {
    for (const off of offs) off();
  }
}

/** Teto da espera so-DOM na navegacao (host de conexao viva): nao faz sentido esperar os 15 s da rede. */
const TETO_SO_DOM_MS = 6000;

async function hostsSoDomDaConfig(): Promise<string[]> {
  try {
    const { esperaSoDomHosts } = await chrome.storage.local.get('esperaSoDomHosts');
    return Array.isArray(esperaSoDomHosts) ? (esperaSoDomHosts as string[]) : HOSTS_SO_DOM_PADRAO;
  } catch {
    return HOSTS_SO_DOM_PADRAO;
  }
}

export async function cdpNavigate(tabId: number, url: string): Promise<void> {
  // Indo para site do modo simples (Flow) com a aba ja anexada: desliga o que
  // foi ligado antes, em outro site (ver debugger-manager, HOSTS_SIMPLES).
  if (/^https:\/\/(flow\.google\.com|labs\.google)\//.test(url)) {
    for (const m of ['Fetch.disable', 'Network.disable', 'Runtime.disable']) await dm.send(tabId, m, {}).catch(() => {});
  }
  // Com muitos agentes no Chrome (01/11/2026, 8 abas no Flow) o Page.navigate
  // chegou a nao responder e o comando estourava 90 s. Sem resposta em 20 s:
  // se a aba ja esta no endereco, segue; senao navega pela API de abas.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<'prazo'>((r) => { timer = setTimeout(() => r('prazo'), 20_000); });
  const r = await Promise.race([dm.send(tabId, 'Page.navigate', { url }), prazo]).finally(() => clearTimeout(timer));
  if (r === 'prazo') {
    const aba = await chrome.tabs.get(tabId);
    const atual = aba.pendingUrl || aba.url || '';
    if (!atual.startsWith(url.split('#')[0])) await chrome.tabs.update(tabId, { url });
  }
  await waitForNetworkIdle(tabId, { silencioCurtoPosLoad: true, soDom: hostSoDom(url, await hostsSoDomDaConfig()) });
}

async function getViewport(tabId: number): Promise<{ width: number; height: number }> {
  const result = await safeExecuteScript({
    target: { tabId },
    func: () => ({ width: window.innerWidth, height: window.innerHeight }),
  });
  return (result?.[0]?.result as { width: number; height: number }) ?? { width: 1280, height: 720 };
}

export async function resolveTarget(
  tabId: number,
  target: ActionTarget,
): Promise<{ x: number; y: number } | null> {
  if (target.strategy === 'coordinates') {
    let { x, y } = { x: target.x!, y: target.y! };
    if (x <= 1 && y <= 1) {
      const vp = await getViewport(tabId);
      x = Math.round(x * vp.width);
      y = Math.round(y * vp.height);
    }
    return { x, y };
  }

  if (target.strategy === 'agent-id') {
    // Guard: model sometimes emits strategy:"agent-id" with no agentId value.
    // In that case, fall through to semantic search rather than crashing.
    if (target.agentId === undefined || target.agentId === null) {
      // treat as semantic (fall through below)
    } else {
      const result = await safeExecuteScript({
        target: { tabId },
        func: (agentId: number) => {
          const el = document.querySelector(`[data-agent-id='${agentId}']`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return null;
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        },
        args: [target.agentId],
      });
      return (result?.[0]?.result as { x: number; y: number } | null) ?? null;
    }
  }

  // Auto-correct: "semantic" + agentId combo → try agent-id first
  if (target.strategy === 'semantic' && target.agentId !== undefined) {
    const result = await safeExecuteScript({
      target: { tabId },
      func: (agentId: number) => {
        const el = document.querySelector(`[data-agent-id='${agentId}']`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      args: [target.agentId],
    });
    const coords = (result?.[0]?.result as { x: number; y: number } | null) ?? null;
    if (coords) return coords;
    // Fall through to semantic search if agentId element not found
  }

  // strategy: 'semantic' — require at least one criterion
  const { role = '', text = '', placeholder = '', ariaLabel = '' } = target;
  if (!role && !text && !placeholder && !ariaLabel) {
    // Last resort: find the first visible textbox / contenteditable on the page.
    // This handles cases where the model forgot to supply any matching criteria.
    const fallback = await safeExecuteScript({
      target: { tabId },
      func: () => {
        const selectors = [
          'textarea',
          '[contenteditable="true"]',
          '[contenteditable=""]',
          '[contenteditable="plaintext-only"]',
          '[role="textbox"]',
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
        ];
        const searchKeywords = ['search', 'pesquisar', 'buscar', 'find', 'procurar'];
        
        // 1. First pass: find a "content" input (avoiding search bars)
        for (const sel of selectors) {
          const elements = Array.from(document.querySelectorAll<HTMLElement>(sel));
          for (const el of elements) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            
            const metadata = (el.getAttribute('placeholder') || '') + (el.getAttribute('aria-label') || '') + (el.getAttribute('name') || '') + el.id;
            const isSearch = searchKeywords.some(kw => metadata.toLowerCase().includes(kw));
            if (!isSearch) {
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
        }
        
        // 2. Second pass: last resort (allow search bars if nothing else found)
        for (const sel of selectors) {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
        return null;
      },
    });
    return (fallback?.[0]?.result as { x: number; y: number } | null) ?? null;
  }

  const result = await safeExecuteScript({
    target: { tabId },
    func: async (role: string, searchText: string, placeholder: string, ariaLabel: string, exato: boolean) => {
      const selectors =
        'a,button,input,textarea,select,[role],[tabindex],[contenteditable="true"],[contenteditable=""]';
      const seen = new Set<Element>();
      // Elemento FORA da vista (abaixo da dobra, janela minimizada) tambem e
      // candidato: o que exclui e display:none/visibility:hidden/tamanho zero.
      // Com a viewport zerada (janela minimizada) nao ha tamanho para medir,
      // entao so vale checkVisibility; a posicao sai do scrollIntoView abaixo.
      const semViewport = window.innerWidth === 0 || window.innerHeight === 0;
      const elements = Array.from(document.querySelectorAll(selectors)).filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        const visivel = (el as HTMLElement).checkVisibility
          ? (el as HTMLElement).checkVisibility({ visibilityProperty: true } as never)
          : el.getClientRects().length > 0;
        if (!visivel) return false;
        if (semViewport) return true;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      // Papel ARIA implicito: `role:"link"` tem de casar <a href>, como o
      // browser_find/read_page (arvore de acessibilidade) chamam o elemento.
      // Antes so valiam o atributo role ou o nome da tag, entao text+role:"link"
      // nunca achava um <a>.
      const papeisDoEl = (el: Element): string[] => {
        const tag = el.tagName.toLowerCase();
        const lista = [tag];
        const explicito = el.getAttribute('role');
        if (explicito) lista.push(explicito.toLowerCase());
        const tipo = ((el as HTMLInputElement).type || '').toLowerCase();
        if (tag === 'a' && el.hasAttribute('href')) lista.push('link');
        else if (tag === 'button') lista.push('button');
        else if (tag === 'select') lista.push('combobox', 'listbox');
        else if (tag === 'textarea') lista.push('textbox');
        else if (/^h[1-6]$/.test(tag)) lista.push('heading');
        else if (tag === 'img') lista.push('img');
        else if (tag === 'input') {
          if (['button', 'submit', 'reset', 'image'].includes(tipo)) lista.push('button');
          else if (tipo === 'checkbox') lista.push('checkbox');
          else if (tipo === 'radio') lista.push('radio');
          else if (tipo === 'range') lista.push('slider');
          else if (tipo === 'search') lista.push('searchbox', 'textbox');
          else lista.push('textbox');
        }
        return lista;
      };
      const casaPapel = (el: Element, pedido: string) => !pedido || papeisDoEl(el).includes(pedido.toLowerCase());
      // Rola ate o elemento ANTES de medir: o ponto devolvido tem de cair
      // dentro da viewport, senao o hit-test (DOM.getNodeForLocation) nao acha
      // no nenhum e o clique por texto falha enquanto o browser_find acha.
      const centro = async (el: Element) => {
        (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        // Deixa o scroll assentar antes do hit-test do CDP.
        await new Promise((ok) => setTimeout(ok, 60));
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      };

      // S2 (20/10/2026): `exato:true` casa o NOME inteiro (texto, aria-label ou
      // placeholder iguais ao pedido, sem diferenciar maiuscula nem espaco
      // sobrando) e, se mais de um elemento casar, devolve a lista em vez de
      // escolher o primeiro. Sem `exato` o comportamento e o de sempre: substring,
      // primeiro candidato.
      if (exato) {
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
        const alvoTexto = norm(searchText);
        const alvoPh = norm(placeholder);
        const alvoAria = norm(ariaLabel);
        const exatos = elements.filter((el) => {
          const elRole = el.getAttribute('role') || el.tagName.toLowerCase();
          const elText = norm((el as HTMLElement).innerText || (el as HTMLInputElement).value || '');
          const elPlaceholder = norm(el.getAttribute('placeholder') || '');
          const elAriaLabel = norm(el.getAttribute('aria-label') || '');
          const roleOk = casaPapel(el, role);
          const textoOk = !alvoTexto || elText === alvoTexto || elAriaLabel === alvoTexto || elPlaceholder === alvoTexto;
          const phOk = !alvoPh || elPlaceholder === alvoPh;
          const ariaOk = !alvoAria || elAriaLabel === alvoAria;
          return roleOk && textoOk && phOk && ariaOk;
        });
        if (exatos.length === 0) return null;
        if (exatos.length > 1) {
          return {
            ambiguos: exatos.slice(0, 8).map((el) => {
              const r = el.getBoundingClientRect();
              const nome = ((el as HTMLElement).innerText || (el as HTMLInputElement).value
                || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 60);
              return `${el.getAttribute('role') || el.tagName.toLowerCase()} "${nome}" (${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)})`;
            }),
            total: exatos.length,
          };
        }
        return await centro(exatos[0]);
      }

      const match = elements.find((el) => {
        const elRole = el.getAttribute('role') || el.tagName.toLowerCase();
        const elText = (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).value || '';
        const elPlaceholder = el.getAttribute('placeholder') || '';
        const elAriaLabel = el.getAttribute('aria-label') || '';

        const roleMatch = casaPapel(el, role);
        const textMatch =
          !searchText ||
          elText.toLowerCase().includes(searchText.toLowerCase()) ||
          elPlaceholder.toLowerCase().includes(searchText.toLowerCase()) ||
          elAriaLabel.toLowerCase().includes(searchText.toLowerCase());
        const phMatch = !placeholder || elPlaceholder.toLowerCase().includes(placeholder.toLowerCase());
        const ariaMatch = !ariaLabel || elAriaLabel.toLowerCase().includes(ariaLabel.toLowerCase());

        return roleMatch && textMatch && phMatch && ariaMatch;
      });

      if (!match) return null;
      return await centro(match);
    },
    args: [role, text, placeholder, ariaLabel, target.exato === true],
  });
  const achado = result?.[0]?.result as
    | { x: number; y: number }
    | { ambiguos: string[]; total: number }
    | null
    | undefined;
  if (achado && 'ambiguos' in achado) {
    const criterio = [text && `texto "${text}"`, role && `papel "${role}"`,
      placeholder && `placeholder "${placeholder}"`, ariaLabel && `aria-label "${ariaLabel}"`]
      .filter(Boolean).join(', ');
    throw new AlvoAmbiguoError(
      `exato:true — ${achado.total} elementos casam exatamente com ${criterio}: `
      + `${achado.ambiguos.join('; ')}${achado.total > achado.ambiguos.length ? '; ...' : ''}. `
      + 'Nao cliquei em nenhum. Use a ref de browser_read_page/browser_find, ou acrescente role/placeholder/ariaLabel '
      + 'para desempatar.',
    );
  }
  return achado ?? null;
}

/**
 * Busca semantica com `exato:true` achou MAIS DE UM elemento: o motor nao
 * escolhe o primeiro, recusa e lista os candidatos (S2, 20/10/2026).
 */
export class AlvoAmbiguoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'AlvoAmbiguoError';
  }
}
