import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades, ContextoCapacidade } from './registro';

/**
 * Screenshot recortado a um elemento (por `ref`) ou a uma regiao explicita —
 * conferir so o campo preenchido ou o numero do protocolo sem gastar a tela
 * inteira (nem a janela do agente com uma imagem que ele vai ignorar em 90%).
 *
 * Docs: docs/obra-20260904/14-diagnostico-screenshot-recorte-e-console-cdp.md.
 */

interface Regiao { x: number; y: number; w: number; h: number; }

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
