/** Tools de historico: voltar/avancar na aba sem refazer a navegacao. */

export const TOOLS = [
  {
    name: 'browser_back',
    description:
      'Volta para a pagina anterior no historico desta aba, mantendo o estado do formulario '
      + '(diferente de navegar de novo para a mesma URL, que reconstroi a pagina do zero e perde '
      + 'o que estava preenchido). Erra se a aba nao tem pagina anterior no historico — nesse caso '
      + 'use browser_navigate.',
    inputSchema: { type: 'object', properties: {} },
    action: 'cap_back',
  },
  {
    name: 'browser_forward',
    description:
      'Avanca para a proxima pagina no historico desta aba (depois de um browser_back). '
      + 'Prefira navegar de novo para a URL. Erra se nao ha pagina seguinte no historico.',
    inputSchema: { type: 'object', properties: {} },
    action: 'cap_forward',
  },
];
