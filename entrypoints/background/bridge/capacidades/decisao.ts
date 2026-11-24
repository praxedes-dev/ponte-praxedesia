import { esperarDecisao } from '../../painel/decisao-runtime';
import type { ModuloCapacidades } from './registro';

/**
 * v6.1 (f) — `browser_decisao`: o agente ESPERA (ou consulta) a resposta do usuário a uma
 * notificacao com botoes. So le o cofre: nao existe caminho por aqui que aprove, negue ou crie
 * decisao. Quem decide e o clique no botao (painel/decisao-runtime.ts, `tratarBotao`).
 */
export const modulo: ModuloCapacidades = {
  nome: 'decisao',
  capacidades: [
    {
      nome: 'cap_decisao',
      async executar(ctx) {
        const p = ctx.params as { id?: string; esperar_s?: number };
        return esperarDecisao({
          tabId: ctx.tabId,
          id: typeof p.id === 'string' && p.id ? p.id : undefined,
          segundos: typeof p.esperar_s === 'number' ? p.esperar_s : 30,
        });
      },
    },
  ],
};
