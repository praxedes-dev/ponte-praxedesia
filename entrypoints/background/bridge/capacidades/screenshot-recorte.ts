import { debuggerManager as dm } from '../../debugger-manager';
import { getPageStructureViaCDP } from '../../execution-engine/ax-tree';
import type { ModuloCapacidades, ContextoCapacidade } from './registro';

/**
 * Screenshot recortado a um elemento (por `ref`) ou a uma regiao explicita —
 * conferir so o campo preenchido ou o numero do protocolo sem gastar a tela
 * inteira (nem a janela do agente com uma imagem que ele vai ignorar em 90%).
 *
 * Docs: docs/obra-20260904/14-diagnostico-screenshot-recorte-e-console-cdp.md.
 */

interface Regiao { x: number; y: number; w: number; h: number; /** X5: true = coordenada da JANELA (a da imagem do print), nao da pagina. */ tela?: boolean }

/** X5: hash do ultimo print por aba, para `so_se_mudou`. Memoria do service worker; acordar zera. */
const ultimoPrint = new Map<number, string>();

async function hashDe(base64: string): Promise<string> {
  const bytes = new TextEncoder().encode(base64);
  const d = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ElementoRotulavel { agentId: number; rect: { x: number; y: number; w: number; h: number } }

/**
 * Reduz a imagem por `fator` (1 = tamanho de captura) e, se vierem elementos, desenha [N]
 * (o ref que browser_click aceita) sobre cada interativo visivel. Tudo no canvas, fora do DOM da pagina.
 */
async function reduzirEEtiquetar(base64: string, elementos: ElementoRotulavel[], fator: number): Promise<{ data: string; n: number }> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const W = Math.max(1, Math.round(bmp.width * fator));
  const H = Math.max(1, Math.round(bmp.height * fator));
  const cv = new OffscreenCanvas(W, H);
  const g = cv.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, W, H);
  g.font = 'bold 11px monospace';
  g.textBaseline = 'top';
  let n = 0;
  for (const e of elementos) {
    const x = e.rect.x * fator;
    const y = e.rect.y * fator;
    const w = e.rect.w * fator;
    const h = e.rect.h * fator;
    if (w < 6 || h < 6 || x > W || y > H || x + w < 0 || y + h < 0) continue;
    if (n >= 150) break;
    const texto = `[${e.agentId}]`;
    const tw = g.measureText(texto).width + 4;
    g.strokeStyle = '#e53935';
    g.lineWidth = 1;
    g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    // Etiqueta no canto de cima-esquerda, dentro da imagem.
    const ex = Math.max(0, Math.min(W - tw, x));
    const ey = Math.max(0, y - 13 < 0 ? y : y - 13);
    g.fillStyle = '#ffeb3b';
    g.fillRect(ex, ey, tw, 13);
    g.fillStyle = '#000';
    g.fillText(texto, ex + 2, ey + 1);
    n++;
  }
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bs = '';
  for (let i = 0; i < buf.length; i += 0x8000) bs += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { data: btoa(bs), n };
}

/**
 * Mesma coreografia de `execution-engine/index.ts:34-47` (screenshot inteiro):
 * esconde o indicador da propria extensao antes de capturar — o agente nao
 * pode "ver" a propria UI, nem em pixel — espera 50ms para o Chrome repintar
 * sem ele, e mostra de volta mesmo se a captura falhar.
 */
async function comIndicadorEscondido<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  chrome.tabs.sendMessage(tabId, { type: 'HIDE_FOR_TOOL_USE' }).catch(() => {});
  try {
    await new Promise((r) => setTimeout(r, 50));
    return await fn();
  } finally {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_AFTER_TOOL_USE' }).catch(() => {});
  }
}

/**
 * Retangulo do elemento em coordenadas ABSOLUTAS DE PAGINA — o que
 * `Page.captureScreenshot` espera no `clip` quando `captureBeyondViewport`
 * fica de fora (o padrao, e o que usamos aqui).
 *
 * MEDIDO nesta obra (05/09/2026), nao suposto: o proprio `puppeteer-core`
 * (`^24.4.0`, ja em node_modules/) resolve exatamente este problema em
 * `ElementHandle.screenshot()` —
 * `node_modules/puppeteer-core/lib/esm/puppeteer/api/ElementHandle.js:1249-1266` —
 * e a leitura da fonte bate com o teste ao vivo desta obra (pagina rolada,
 * `test/diagnostico.js` caso 5): o retangulo de `boundingBox()`
 * (viewport-relativo, muda com o scroll — o mesmo que `getBoundingClientRect`
 * e o `DOM.getBoxModel` usado abaixo) SOMA `window.visualViewport.pageLeft/
 * pageTop` (o offset de scroll atual, em pixels CSS) antes de virar `clip`.
 * E `Page._screenshot()` (`.../cdp/Page.js:824-830`) intersecta esse clip —
 * ja em coordenadas de pagina — com o viewport atual, TAMBEM convertido para
 * pagina pelo mesmo `pageLeft/pageTop`, antes de mandar ao `Page.
 * captureScreenshot` do CDP. Ou seja: o `clip` do CDP e absoluto ao
 * documento, nao ao que esta visivel agora — por isso ROLAR ATE O ELEMENTO
 * antes de medir e obrigatorio (senao o retangulo mede uma posicao que so
 * fazia sentido antes do scroll), e por isso somamos o offset de scroll
 * LIDO DEPOIS de rolar, nunca antes.
 */
async function retanguloDeReferencia(tabId: number, backendNodeId: number): Promise<Regiao> {
  // 1. Rola ate o elemento — melhor esforco: se ja estiver visivel, ou se o
  // elemento nao tiver layout (display:none), isto pode nao fazer nada ou
  // falhar; quem decide "sem area visivel" e o getBoxModel logo abaixo, nao
  // esta chamada por si so.
  await dm.send(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {});

  // 2. Caixa do elemento, no MESMO sistema de `getBoundingClientRect`
  // (viewport-relativo: muda com o scroll). Mesmo quad de conteudo usado em
  // `execution-engine/cdp-tools.ts:422-431` (fallback do clique por ref).
  const boxModel = await dm.send<{ model: { content: number[] } } | null>(
    tabId, 'DOM.getBoxModel', { backendNodeId },
  ).catch(() => null);

  if (!boxModel?.model?.content) {
    throw new Error('o elemento nao tem area visivel');
  }
  const c = boxModel.model.content;
  const x = Math.min(c[0], c[2], c[4], c[6]);
  const y = Math.min(c[1], c[3], c[5], c[7]);
  const w = Math.max(c[0], c[2], c[4], c[6]) - x;
  const h = Math.max(c[1], c[3], c[5], c[7]) - y;
  if (w <= 0 || h <= 0) {
    throw new Error('o elemento nao tem area visivel');
  }

  // 3. Offset de scroll ATUAL (depois do passo 1), em pixels CSS — a mesma
  // fonte que o puppeteer-core usa (comentario da funcao). Por CDP puro
  // (Runtime.evaluate, returnByValue — sem replMode, que quebra a
  // serializacao) em vez de resolver o objectId do proprio elemento: so
  // precisamos de dois numeros globais da pagina, nao de nada do no.
  const scroll = await dm.send<{ result?: { value?: { x: number; y: number } } }>(
    tabId, 'Runtime.evaluate',
    {
      expression: '({ x: window.visualViewport.pageLeft, y: window.visualViewport.pageTop })',
      returnByValue: true,
    },
  ).catch(() => undefined);
  const offsetX = scroll?.result?.value?.x ?? 0;
  const offsetY = scroll?.result?.value?.y ?? 0;

  return { x: x + offsetX, y: y + offsetY, w, h };
}

export const modulo: ModuloCapacidades = {
  nome: 'screenshot-recorte',
  capacidades: [
    {
      /**
       * X5: print da janela inteira. Reduz para 1280x800 quando a janela e maior
       * (`tamanho_real` desliga), `so_se_mudou` devolve so `{igual:true}` se a imagem
       * for identica a do ultimo print da aba, e `rotulos` desenha o [N] de cada
       * interativo visivel (o mesmo ref de browser_read_page).
       */
      nome: 'cap_print',
      executar: async (ctx: ContextoCapacidade) => {
        const params = ctx.params as unknown as { so_se_mudou?: boolean; rotulos?: boolean; tamanho_real?: boolean };
        const tabId = ctx.tabId;
        return comIndicadorEscondido(tabId, async () => {
          const cap = await dm.capturarTela(tabId, params.tamanho_real ? { maxW: 1e9, maxH: 1e9 } : {});
          let { data } = cap;
          let rotulados: number | undefined;
          if (params.rotulos || cap.fator < 1) {
            let els: ElementoRotulavel[] = [];
            if (params.rotulos) {
              const lido = await getPageStructureViaCDP(tabId, { scope: 'viewport' });
              els = (lido.interactiveElements ?? []) as unknown as ElementoRotulavel[];
            }
            const r = await reduzirEEtiquetar(data, els, cap.fator);
            data = r.data;
            if (params.rotulos) rotulados = r.n;
          }
          const hash = await hashDe(data);
          const igual = ultimoPrint.get(tabId) === hash;
          ultimoPrint.set(tabId, hash);
          if (params.so_se_mudou && igual) return { igual: true };
          return {
            data, escala: Number(cap.fator.toFixed(3)), largura: cap.w, altura: cap.h,
            largura_tela: cap.cssW, altura_tela: cap.cssH,
            ...(rotulados !== undefined ? { rotulos: rotulados } : {}),
          };
        });
      },
    },
    {
      nome: 'cap_screenshot_ref',
      // Le a tela, nao altera nada nela — mesma classificacao do screenshot
      // inteiro (nao esta em ACOES_QUE_ALTERAM nem em INPUT_ACTIONS: captura
      // funciona em segundo plano, sem exigir aba pintada — `bridge/index.ts:861`).
      executar: async (ctx: ContextoCapacidade) => {
        const params = ctx.params as unknown as { regiao?: Regiao; escala?: number };
        const tabId = ctx.tabId;

        let regiao: Regiao;
        if (ctx.ref !== undefined) {
          regiao = await retanguloDeReferencia(tabId, ctx.ref);
        } else if (params.regiao) {
          // Regiao explicita: usa direto — e responsabilidade de quem chamou
          // dar coordenadas ja no sistema que o CDP espera (absoluto de
          // pagina); nao passa pelo calculo de scroll acima.
          const r = params.regiao;
          if (!(r.w > 0) || !(r.h > 0)) {
            throw new Error('o elemento nao tem area visivel');
          }
          regiao = r;
          // X5: `tela:true` = coordenada da imagem do print (da janela); soma a rolagem atual.
          if (r.tela) {
            const sc = await dm.send<{ result?: { value?: { x: number; y: number } } }>(tabId, 'Runtime.evaluate', {
              expression: '({ x: window.visualViewport.pageLeft, y: window.visualViewport.pageTop })', returnByValue: true,
            }).catch(() => undefined);
            regiao = { x: r.x + (sc?.result?.value?.x ?? 0), y: r.y + (sc?.result?.value?.y ?? 0), w: r.w, h: r.h };
          }
        } else {
          throw new Error('cap_screenshot_ref exige ref ou regiao');
        }

        return comIndicadorEscondido(tabId, async () => {
          const res = await dm.send<{ data: string }>(tabId, 'Page.captureScreenshot', {
            format: 'jpeg',
            quality: 80,
            clip: {
              x: regiao.x,
              y: regiao.y,
              width: regiao.w,
              height: regiao.h,
              scale: params.escala ?? 1,
            },
          });
          return res.data;
        });
      },
    },
  ],
};
