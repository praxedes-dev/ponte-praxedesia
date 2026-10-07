/**
 * Tool da auditoria (obra 10). So repassa para `cap_auditoria` — quem
 * gravou e quem le e a extensao (`entrypoints/background/bridge/capacidades/
 * auditoria.ts` e `entrypoints/background/audit/index.ts`).
 */

export const TOOLS = [
  {
    name: 'bridge_auditoria',
    description:
      'Quem fez o que nesta ponte: os ultimos comandos de TODOS os agentes conectados (navegar, '
      + 'clicar, digitar...), com hora, agente, aba, url, se deu certo (ou o erro/bloqueio) e quanto '
      + 'levou. Use quando uma aba mudou sem voce ter pedido, ou para conferir se outro agente ja '
      + 'mexeu numa pagina antes de voce.',
    inputSchema: {
      type: 'object',
      properties: {
        limite: {
          type: 'number',
          description: 'Quantos comandos trazer, do mais novo para o mais velho. Sem isto, traz 50.',
        },
        so_meus: {
          type: 'boolean',
          description: 'true traz so os comandos DESTE agente (este clientId), escondendo os de todo o resto.',
        },
      },
    },
    action: 'cap_auditoria',
    build: (i) => ({ params: { limite: i.limite, so_meus: i.so_meus } }),
  },
];
