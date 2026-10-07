/**
 * Upload em lote que nao mente (obra 05).
 *
 * `browser_upload_batch` substitui o ciclo manual de cinco passos por lote da
 * skill protocolo-pje-ponte (§4.1): reacha o input a cada lote (a ref antiga
 * expira e "funciona" sem anexar nada) e confere a lista real da pagina, na
 * ordem, antes de seguir para o proximo lote.
 *
 * `browser_upload_verify` le o check verde pela OPACITY, nao pelo `<select>`
 * de tipo — que MENTE (documento sem tipo aplicado nao existe no servidor
 * mesmo aparecendo na tela).
 */
import { existsSync } from 'node:fs';

export const TOOLS = [
  {
    name: 'browser_upload_batch',
    description:
      'Anexa uma lista de arquivos a um campo de upload MULTIPLO (Dropzone do PJe), em lotes, '
      + 'REACHANDO o input a cada lote — a ref antiga expira e reusa-la devolve "sucesso" sem anexar '
      + 'nada (foi assim que sumiram 9 de 47 documentos num protocolo real, um deles o RG do '
      + 'cliente). Confere a lista REAL da pagina apos cada lote, nome a nome e na ordem, e PARA no '
      + 'primeiro lote que perder algum — nunca devolve sucesso com relatorio parcial escondido. '
      + 'Isto so confere que o arquivo ENTROU na lista; o TIPO de cada anexo e o que grava no '
      + 'servidor do PJe — aplique com browser_form_fill/browser_form_input e so entao confira com '
      + 'browser_upload_verify antes de assinar. Os seletores padrao (.dz-preview etc.) sao do '
      + 'DROPZONE DO PJe -- em outro site (ex.: Portal OAB, Angular) "nao apareceu na lista" com os '
      + 'seletores padrao NAO PROVA falha, so que o seletor nao bate; nesse caso a resposta traz '
      + 'aviso_seletor_padrao e voce deve repetir passando seletor_item/seletor_nome do DOM real do site. '
      + 'INPUT DE ARQUIVO UNICO (sem "multiple": documento principal do PJe, PDF do Portal OAB): '
      + 'nao ha lista para conferir, entao a tool entrega o arquivo e devolve '
      + 'SUCESSO com lista:"inexistente" e entraram:null -- nao e falha; quem prova que o site aceitou '
      + 'e a propria tela (nome do arquivo, barra 100%, botao habilitado). Nao espera o timeout a toa.',
    inputSchema: {
      type: 'object',
      properties: {
        caminhos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Caminhos completos dos arquivos no Windows, na ordem em que devem ser anexados.',
        },
        seletor_input: {
          type: 'string',
          description:
            'Seletor CSS do input de arquivo. Padrao "input[type=file][multiple]" — o de MULTIPLOS '
            + 'anexos; o input singular (sem "multiple") e o documento principal, outro campo.',
        },
        tamanho_lote: { type: 'number', description: 'Quantos arquivos por lote. Padrao 10.' },
        seletor_item: {
          type: 'string',
          description: 'Seletor de cada item da lista apos anexar. Padrao ".dz-preview" (Dropzone).',
        },
        seletor_nome: {
          type: 'string',
          description: 'Seletor do nome dentro do item. Padrao "[data-dz-name]".',
        },
        timeout_lote_ms: {
          type: 'number',
          description: 'Teto de espera por lote ate os arquivos aparecerem na lista, em ms. Padrao 30000.',
        },
        conferir_lista: {
          type: 'boolean',
          description:
            'false em site que NAO e o PJe (Gemini, Portal OAB, formulario comum): entrega os arquivos ao '
            + 'input e volta na hora, com lista:"inexistente" e o que o input recebeu (no_input), sem esperar '
            + 'timeout_lote_ms por uma lista de Dropzone que nao existe. Quem prova que o site aceitou e a tela. '
            + 'Padrao true (confere nome a nome: e o que protege os anexos do PJe).',
        },
        forcar: {
          type: 'boolean',
          description:
            'Ignora o pre-voo que barra nome de arquivo >= 80 caracteres (recusado EM SILENCIO pelo '
            + 'PJe) e tenta anexar mesmo assim. Use so para confirmar o diagnostico — o relatorio '
            + 'volta como erro, com o que entrou e o que nao.',
        },
      },
      required: ['caminhos'],
    },
    action: 'cap_upload_lote',
    build: (i) => {
      const caminhos = Array.isArray(i.caminhos) ? i.caminhos.map(String) : [];

      // O servidor MCP roda no Windows e TEM disco; a extensao nao. Falhar
      // aqui, antes de mandar qualquer coisa para a extensao, poupa um lote
      // inteiro de espera so para descobrir que o caminho estava errado.
      const semArquivo = caminhos.filter((c) => !existsSync(c));
      if (semArquivo.length > 0) {
        throw new Error(
          `arquivo(s) nao encontrado(s) no disco — nada foi enviado para a extensao: ${semArquivo.join(', ')}`,
        );
      }

      return {
        params: {
          caminhos,
          seletor_input: i.seletor_input,
          tamanho_lote: i.tamanho_lote,
          seletor_item: i.seletor_item,
          seletor_nome: i.seletor_nome,
          timeout_lote_ms: i.timeout_lote_ms,
          forcar: i.forcar,
          conferir_lista: i.conferir_lista,
        },
      };
    },
    // Varios lotes, cada um podendo esperar o teto inteiro: o timeout do
    // TRANSPORTE (link.send) precisa cobrir a soma, com folga para o attach e
    // a ida-e-volta de cada evaluate — senao a ponte desiste antes da
    // extensao terminar (armadilha nomeada na obra 16, vale aqui tambem).
    timeout: (i) => {
      const total = Array.isArray(i.caminhos) ? i.caminhos.length : 0;
      const tamanhoLote = Number(i.tamanho_lote) || 10;
      const timeoutLote = Number(i.timeout_lote_ms) || 30_000;
      const lotes = Math.max(1, Math.ceil(total / tamanhoLote));
      return lotes * timeoutLote + 30_000;
    },
  },
  {
    name: 'browser_upload_verify',
    description:
      'Confere o check verde de cada anexo pela OPACITY do marcador de sucesso do Dropzone — nunca '
      + 'pelo <select> de tipo (que MENTE: arquivo sem tipo aplicado "nao existe" no servidor mesmo '
      + 'aparecendo na tela) nem por offsetParent/visibilidade (o marcador de erro convive no mesmo '
      + 'lugar e tambem passa nisso). Nao altera a pagina. Os seletores padrao sao do DROPZONE DO PJe '
      + '-- em outro site (ex.: Portal OAB) 0 itens encontrados com o seletor padrao NAO PROVA que o '
      + 'upload falhou, so que o seletor nao bate: a tool erra explicando isso em vez de devolver uma '
      + 'lista vazia muda; passe seletor_item/seletor_ok/seletor_nome do DOM real do site nesse caso.',
    inputSchema: {
      type: 'object',
      properties: {
        seletor_item: {
          type: 'string',
          description: 'Seletor de cada item da lista. Padrao ".dz-preview".',
        },
        seletor_ok: {
          type: 'string',
          description: 'Seletor do marcador de sucesso dentro do item. Padrao ".dz-success-mark".',
        },
        seletor_nome: {
          type: 'string',
          description: 'Seletor do campo com o nome gravado. Padrao \'input[id$=":descDoc"]\'.',
        },
        seletor_nome_fallback: {
          type: 'string',
          description: 'Seletor alternativo se o principal nao existir na pagina. Padrao "[data-dz-name]".',
        },
      },
    },
    action: 'cap_upload_conferir',
    build: (i) => ({
      params: {
        seletor_item: i.seletor_item,
        seletor_ok: i.seletor_ok,
        seletor_nome: i.seletor_nome,
        seletor_nome_fallback: i.seletor_nome_fallback,
      },
    }),
  },
];
