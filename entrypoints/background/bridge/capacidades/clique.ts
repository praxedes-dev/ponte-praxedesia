import { debuggerManager as dm } from '../../debugger-manager';
import { cdpClick } from '../../execution-engine/cdp-tools';
import { resolverAlvoDaAcao } from '../../execution-engine';
import { avaliar } from '../policy';
import type { ModuloCapacidades } from './registro';

export const modulo: ModuloCapacidades = {
  nome: 'clique',
  capacidades: [
    {
      nome: 'cap_click_xy',
      altera: true,
      input: true,
      async executar(ctx) {
        // Clique real por coordenada, para item de lista que nao tem ref na
        // arvore (a sugestao de CEP do PJe e uma linha criada na hora). O freio
        // continua valendo: descobre-se o no naquele ponto e avalia-se ELE.
        //
        // Obra 25: quem faz o hit-test agora e `resolverAlvoDaAcao` — a MESMA
        // funcao que resolve `click`, `type`, `press_key` e `drag`. Antes cada
        // capacidade tinha a sua copia de `DOM.getDocument` +
        // `DOM.getNodeForLocation` + arredondamento, e cada copia ja custou um
        // defeito proprio (`x` fracionario recusado pelo CDP fazia o freio
        // sumir em silencio, medido em 05/09/2026 com "Excluir conta"
        // passando direto).
        const { tabId, params: p } = ctx;
        const acao = { type: 'cap_click_xy', params: { x: p.x, y: p.y } };
        const r = await resolverAlvoDaAcao(acao, tabId);

        let backendNodeId: number | undefined;
        if (r.ok) {
          backendNodeId = r.alvo.backendNodeId;
          const veredito = await avaliar(acao, ctx.ws, ctx.confirm, r.alvo);
          if (!veredito.permitido) throw new Error(`[bloqueado] ${veredito.motivo}`);
        } else if (r.causa !== 'sem-no-no-ponto') {
          // Qualquer erro que NAO seja "nao ha no aqui" (parametro invalido,
          // deserializacao, debugger desanexado...) e o CDP recusando a
          // conversa: falha FECHADO, aborta antes do clique em vez de clicar
          // sem avaliar.
          throw new Error(
            `[cap_click_xy] freio nao conseguiu avaliar o clique em `
            + `(${Math.round(p.x)}, ${Math.round(p.y)}): ${r.motivo}`,
          );
        }
        // `sem-no-no-ponto` e resposta legitima do CDP: nao ha elemento nenhum
        // naquela coordenada (fora do documento, elemento que sumiu). Segue sem
        // freio, como sempre foi nesta capacidade — aqui o contrato do agente e
        // "clique este pixel, eu medi", e nao "clique o elemento tal"; o clique
        // cai no vazio de qualquer jeito. E a UNICA excecao a falha fechada
        // desta obra, e ela tem teste proprio (freio-clique-xy, caso 6).
        // Ponto que cai num IFRAME de outro site (Google Payments no console do
        // Google Cloud, 23/09/2026): o CDP entrega o clique, mas a ponte nao
        // enxerga o que ha la dentro e nao tem como saber se acertou. Dizer
        // "clique real sobre o no X" ali foi relatado como [mentiu] — o no X e
        // a MOLDURA, nao o botao. Clica, mas avisa que nao ha conferencia.
        let moldura: string | null = null;
        if (r.ok && r.alvo.efetivo.tag === 'iframe') {
          try {
            const v = await dm.send<{ result?: { value?: string } }>(tabId, 'Runtime.callFunctionOn', {
              objectId: r.alvo.objectId, returnByValue: true,
              functionDeclaration: `function(){
                var src = this.src || '';
                try { if (this.contentDocument) return ''; } catch (e) {}
                try { return new URL(src, location.href).host || 'outro site'; } catch (e) { return 'outro site'; }
              }`,
            });
            moldura = v?.result?.value || null;
          } catch {
            moldura = 'outro site';
          }
        }

        await cdpClick(tabId, p.x, p.y);
        if (moldura) {
          return `clique ENVIADO a (${p.x}, ${p.y}), mas o ponto cai DENTRO de um iframe de outro site `
            + `(${moldura}). O clique chega la dentro, mas a ponte nao confere o EFEITO: NAO conte como `
            + 'feito. Mire pela coordenada que browser_read_page/browser_find listam em "DENTRO DE '
            + 'MOLDURAS DE OUTRO SITE" e confira com browser_screenshot (pixels CSS, os mesmos do clique) '
            + 'ou relendo a pagina. Se nada mudou, peca ao Dr. Cezar para clicar ali.';
        }
        if (!backendNodeId) {
          return `clique enviado a (${p.x}, ${p.y}), mas NAO HA ELEMENTO nesse ponto (fora da area visivel `
            + 'da janela, ou o elemento sumiu): o clique caiu no vazio. Role ate o alvo e releia a pagina '
            + 'para pegar a coordenada atual.';
        }
        return `clique real em (${p.x}, ${p.y}) sobre o no ${backendNodeId}`;
      },
    },
  ],
};
