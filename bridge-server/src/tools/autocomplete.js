/**
 * Tool de autocomplete (suggest do RichFaces e afins): digita de verdade,
 * espera a lista de sugestoes aparecer, acha a sugestao pelo texto e clica
 * nela com mouse real. Ver docs/obra-20260904/06-autocomplete-richfaces.md.
 */

export const TOOLS = [
  {
    name: 'browser_autocomplete',
    description:
      'Preenche um campo de autocomplete/suggest (ex.: CEP e autoridade do PJe, que sao RichFaces '
      + 'suggest com onchange que ignora valor colado): digita tecla a tecla de verdade, espera a lista '
      + 'de sugestoes aparecer, acha a que bate com "escolher" (por texto, normalizando acento e caixa) '
      + 'e clica nela com mouse real via CDP. Nao precisa saber nada do widget por dentro. Devolve o '
      + 'que ficou no campo ("lido") — se a selecao nao pegou, e erro, nunca "ok" silencioso.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'number',
          description: 'Ref do campo de autocomplete (backendNodeId), vinda de browser_read_page ou browser_find.',
        },
        texto: { type: 'string', description: 'Texto a digitar no campo, tecla a tecla.' },
        escolher: {
          type: 'string',
          description:
            'Texto da sugestao a escolher (case/acento nao importam). Se omitido, usa o proprio "texto".',
        },
        delay_ms: { type: 'number', description: 'Intervalo entre teclas ao digitar. Padrao: 60.' },
        timeout_ms: {
          type: 'number',
          description: 'Quanto esperar a sugestao aparecer, em ms, antes de desistir. Padrao: 8000.',
        },
        seletor_sugestoes: {
          type: 'string',
          description:
            'Seletor CSS explicito das linhas de sugestao, quando a lista padrao (RichFaces, jQuery UI, '
            + 'Select2, typeahead...) nao servir para este widget.',
        },
        limpar: {
          type: 'boolean',
          description: 'Apagar o campo (Ctrl+A + Backspace) antes de digitar. Padrao: false.',
        },
      },
      required: ['ref'],
    },
    action: 'cap_autocomplete',
    build: (i) => ({
      target: { strategy: 'agent-id', agentId: i.ref },
      params: {
        texto: i.texto,
        escolher: i.escolher,
        delay_ms: i.delay_ms,
        timeout_ms: i.timeout_ms,
        seletor_sugestoes: i.seletor_sugestoes,
        limpar: i.limpar,
      },
    }),
    // O clique na sugestao passa pelo mesmo freio de cap_click_xy — se o texto
    // dela casar com algo destrutivo, a tool devolve erro e o agente repete
    // com confirm: true depois de perguntar ao usuario.
    confirmavel: true,
  },
];
