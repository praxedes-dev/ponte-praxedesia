/** Tool de preenchimento direto de campo (select, checkbox, radio, input, contenteditable). */

export const TOOLS = [
  {
    name: 'browser_form_input',
    description:
      'Define o valor de um campo pela ref: select (pelo texto ou pelo value da opcao), checkbox, '
      + 'radio, input e contenteditable. Prefira isto a clicar num select nativo, que por coordenada '
      + 'quase nunca funciona. Dispara os eventos input e change que os frameworks escutam.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'number', description: 'Ref do campo, vinda de browser_read_page ou browser_find.' },
        valor: {
          anyOf: [{ type: 'string' }, { type: 'boolean' }],
          description: 'Valor a definir. Em checkbox use true/false; em select, o texto ou o value da opcao.',
        },
      },
      required: ['ref', 'valor'],
    },
    action: 'cap_form_input',
    build: (i) => ({ target: { strategy: 'agent-id', agentId: i.ref }, params: { valor: i.valor } }),
  },
];
