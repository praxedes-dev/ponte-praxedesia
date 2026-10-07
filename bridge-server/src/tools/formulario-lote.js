/**
 * `browser_form_fill` — preenche varios campos numa so chamada. Obra 07
 * (docs/obra-20260904/07-form-fill.md): a qualificacao de parte do PJe tem de
 * 8 a 15 campos, hoje 8 a 15 chamadas de `browser_form_input`.
 */

export const TOOLS = [
  {
    name: 'browser_form_fill',
    description:
      'Preenche varios campos numa unica chamada -- select (Select2 ou nativo), checkbox, radio, '
      + 'input e contenteditable -- aplicando o mesmo preencherCampo de browser_form_input a cada um: '
      + 'rele o valor e falha se nao bater. Prefira isto a varias browser_form_input em sequencia. '
      + 'Devolve o lido de cada campo; por padrao PARA no primeiro que nao bateu (mande so os que '
      + 'faltaram numa nova chamada). Use parar_no_erro:false so quando quiser o relatorio completo de '
      + 'uma tentativa, mesmo assim a resposta continua erro se algum campo falhou.',
    inputSchema: {
      type: 'object',
      properties: {
        campos: {
          type: 'array',
          description: 'Campos a preencher, na ordem.',
          items: {
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
        },
        parar_no_erro: {
          type: 'boolean',
          description: 'Parar no primeiro campo que nao bater. Padrao true.',
        },
        intervalo_ms: {
          type: 'number',
          description: 'Espera entre campos, para o framework (RichFaces etc.) se assentar. Padrao 150.',
        },
      },
      required: ['campos'],
    },
    action: 'cap_form_fill',
    build: (i) => ({
      params: {
        campos: i.campos,
        parar_no_erro: i.parar_no_erro,
        intervalo_ms: i.intervalo_ms,
      },
    }),
    // Um resolveNode+callFunctionOn por campo, mais o intervalo entre eles.
    // O transporte tem 60s (hub.js: DEFAULT_TIMEOUT_MS) -- sem isto, um lote
    // de 12+ campos no PJe (cada change disparando AJAX) passaria do teto.
    timeout: (i) => 15_000 + (Array.isArray(i.campos) ? i.campos.length : 0) * 5_000,
  },
];
