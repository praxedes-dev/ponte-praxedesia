import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';

/**
 * Upload SEM a janela do Windows (30/09/2026, pedido do Dr. Cezar).
 *
 * Em site moderno (Google Flow, Gemini, Drive) o <input type=file> nao existe
 * na pagina: ele nasce no clique de "Enviar" e ja chama o seletor nativo do
 * Windows — que abria NA TELA do Dr. Cezar. A gambiarra (sobrescrever
 * HTMLInputElement.prototype.click) falhava no primeiro clique da pagina.
 *
 * O jeito certo e do proprio Chrome: `Page.setInterceptFileChooserDialog`.
 * Com ele ligado, o seletor nativo NAO abre; o Chrome avisa por
 * `Page.fileChooserOpened` qual input pediu o arquivo (backendNodeId), e a
 * ponte entrega os arquivos direto nele com `DOM.setFileInputFiles`.
 *
 * Fluxo (a tool browser_upload_por_clique do servidor amarra os tres):
 *   cap_seletor_armar  -> liga a interceptacao e fica ouvindo
 *   (clique normal no botao "Enviar", pelo freio de sempre)
 *   cap_seletor_entregar {caminhos} -> espera o aviso e entrega os arquivos
 * A interceptacao e desligada ao entregar e, de qualquer jeito, em 30 s.
 */

interface Pedido { backendNodeId: number; modo: string }

const pedidoPorAba = new Map<number, Pedido>();
const desligarPorAba = new Map<number, () => void>();

async function armar(tabId: number): Promise<void> {
  desligarPorAba.get(tabId)?.();
  pedidoPorAba.delete(tabId);
  const off = dm.on(tabId, 'Page.fileChooserOpened', (p) => {
    const id = Number(p.backendNodeId);
    if (Number.isFinite(id)) pedidoPorAba.set(tabId, { backendNodeId: id, modo: String(p.mode ?? '') });
  });
  let ligado = true;
  const desligar = () => {
    if (!ligado) return;
    ligado = false;
    off();
    clearTimeout(timer);
    desligarPorAba.delete(tabId);
    dm.send(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  };
  const timer = setTimeout(desligar, 30_000);
  desligarPorAba.set(tabId, desligar);
  await dm.send(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const modulo: ModuloCapacidades = {
  nome: 'seletor-arquivo',
  capacidades: [
    {
      nome: 'cap_seletor_armar',
      altera: true,
      async executar(ctx) {
        await armar(ctx.tabId);
        return { armado: true, expira_em_s: 30 };
      },
    },
    {
      nome: 'cap_seletor_entregar',
      altera: true,
      async executar(ctx) {
        const caminhos = (Array.isArray(ctx.params.caminhos) ? ctx.params.caminhos : []) as string[];
        if (!caminhos.length) throw new Error('informe caminhos');
        const ate = Date.now() + Number(ctx.params.timeout_ms ?? 10_000);
        let pedido = pedidoPorAba.get(ctx.tabId);
        while (!pedido && Date.now() < ate) {
          await esperar(150);
          pedido = pedidoPorAba.get(ctx.tabId);
        }
        desligarPorAba.get(ctx.tabId)?.();
        pedidoPorAba.delete(ctx.tabId);
        if (!pedido) {
          throw new Error(
            'o clique nao pediu arquivo nenhum (o Chrome nao avisou seletor aberto). Confira se o botao e o de '
            + 'enviar arquivo; se ele abre um menu antes, clique no item do menu. Nenhuma janela abriu na tela.',
          );
        }
        if (pedido.modo === 'selectSingle' && caminhos.length > 1) {
          throw new Error(`o campo aceita UM arquivo so e vieram ${caminhos.length}; mande um por vez.`);
        }
        await dm.send(ctx.tabId, 'DOM.setFileInputFiles', { backendNodeId: pedido.backendNodeId, files: caminhos });
        return {
          entregues: caminhos.length,
          modo: pedido.modo,
          proximo_passo: 'os arquivos foram entregues ao campo que o site abriu, sem janela. Quem prova que o site '
            + 'aceitou e a tela (miniatura, barra de progresso, nome do arquivo).',
        };
      },
    },
  ],
};
