/** Tool de JavaScript arbitrario na pagina. */

export const TOOLS = [
  {
    name: 'browser_javascript',
    description:
      'Roda JavaScript na pagina e devolve o retorno. Use para extrair dado preciso, inspecionar '
      + 'estado ou depurar. Uma expressao ("document.title") ou um corpo de funcao com return. Na '
      + 'aba do usuario sem permissao, so passa se for leitura pura — JS com efeito colateral '
      + '(escrever, clicar, navegar, POST) e barrado com [somente leitura]. Com args, codigo e o '
      + 'CORPO de uma funcao (use return) e recebe o array args — passe aqui texto de peticao, '
      + 'nome com aspas, JSON: nunca interpolado no codigo. Ciclo AJAX longo (PJe): suba timeout_ms.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo: { type: 'string', description: 'Expressao ou corpo de funcao.' },
        args: {
          type: 'array',
          items: {},
          description:
            'Valores JSON-serializaveis que o codigo recebe como array `args` (ex.: args[0]). Use '
            + 'para texto com aspas ou quebra de linha em vez de colar o valor dentro de `codigo`; '
            + 'com args presente, codigo vira o CORPO de uma funcao async, entao use return.',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Teto do script NA PAGINA, em ms. Quando estoura, A EXTENSAO desiste de esperar e devolve '
            + 'erro na hora -- medido em 06/09/2026, o parametro nativo do CDP para isto NAO aborta a '
            + 'avaliacao nesta versao do Chrome (uma promise de 3s com timeout_ms:1000 rodou os 3s '
            + 'inteiros e voltou sucesso). Ou seja: o script pode continuar rodando sozinho na pagina '
            + 'ate terminar, mesmo depois de voce ja ter recebido o erro de estouro -- se ele tiver '
            + 'efeito colateral (gravar, navegar, POST), o efeito ainda acontece, so que depois. '
            + 'Padrao: 55000. O transporte espera timeout_ms + 5000, entao suba isto (nao so espere '
            + 'mais) quando o script faz um ciclo AJAX longo. No estouro, a mensagem de erro traz um '
            + 'id_exec -- confira com browser_javascript_conferir se o script chegou a terminar (bem '
            + 'ou com erro) ou ainda esta rodando.',
        },
      },
      required: ['codigo'],
    },
    action: 'cap_js',
    build: (i) => ({ params: { codigo: i.codigo, args: i.args, timeout_ms: i.timeout_ms } }),
    timeout: (i) => (i.timeout_ms ?? 55_000) + 5_000,
  },
  {
    name: 'browser_javascript_conferir',
    description:
      'Confere o que aconteceu com uma execucao de browser_javascript que ESTOUROU o timeout_ms — a '
      + 'extensao desiste de esperar, mas o script pode continuar rodando na pagina ate terminar '
      + 'sozinho (ver a mensagem de erro de browser_javascript). Devolve status: "nunca_comecou" '
      + '(id_exec invalido, de outra aba, ou a pagina navegou/recarregou depois do inicio), '
      + '"ainda_rodando", "terminou_ok" ou "terminou_com_erro" (com detalhe do erro). A marca vive na '
      + 'PROPRIA pagina (window.__ponteJs) -- id_exec so serve enquanto a aba nao navegar de novo.',
    inputSchema: {
      type: 'object',
      properties: {
        id_exec: { type: 'string', description: 'O id_exec devolvido na mensagem de erro de estouro do browser_javascript.' },
      },
      required: ['id_exec'],
    },
    action: 'cap_js_conferir',
    build: (i) => ({ params: { id_exec: i.id_exec } }),
  },
];
