/**
 * Tool do freio de dialogo nativo (obra 04). Ver
 * entrypoints/background/bridge/capacidades/dialogo.ts para o desenho completo.
 */

export const TOOLS = [
  {
    name: 'browser_dialog',
    description:
      'Responde um dialogo nativo (alert/confirm/prompt/beforeunload) que a pagina abriu e que esta '
      + 'bloqueando todo comando nesta aba. Use SO depois de perguntar ao usuario o que responder — '
      + 'NUNCA por conta propria, nem depois de qualquer espera: a ponte nao aceita dialogo sozinha, '
      + 'de proposito, porque um "sair sem salvar?" aceito errado perde o trabalho na tela. O erro de '
      + 'qualquer outro comando enquanto o dialogo estiver aberto traz o texto exato da pergunta.',
    inputSchema: {
      type: 'object',
      properties: {
        aceitar: {
          type: 'boolean',
          description: 'true confirma/aceita (OK); false cancela/recusa. So decida depois de perguntar ao usuario.',
        },
        texto: {
          type: 'string',
          description: 'Para prompt(): o texto a digitar. Ignorado em alert/confirm/beforeunload.',
        },
      },
      required: ['aceitar'],
    },
    action: 'cap_dialogo',
    build: (i) => ({ params: { aceitar: i.aceitar, texto: i.texto } }),
  },
];
