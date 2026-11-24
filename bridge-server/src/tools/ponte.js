/** Tools proprias da ponte: faxina de abas, troca de aba, diagnostico e reload. */

export const TOOLS = [
  {
    name: 'bridge_limpar',
    description:
      'Fecha as abas ORFAS da ponte: abertas por algum agente que ja saiu. Nunca fecha aba de agente '
      + 'vivo (o seu ou o de outra sessao) nem aba do usuario. A faxina automatica ja faz isto a cada '
      + 'minuto; use so para conferir na hora.',
    inputSchema: { type: 'object', properties: {} },
    action: 'cap_limpar',
    timeout: 60_000,
  },
  {
    name: 'bridge_faxina_ociosos',
    description:
      'Forca agora a faxina que fecha as abas de agentes parados. Ela roda sozinha a cada minuto; '
      + 'isto serve para conferir na hora.',
    inputSchema: {
      type: 'object',
      properties: {
        janela_ms: {
          type: 'number',
          description: 'Considerar ocioso quem nao age ha estes ms. Sem isto, usa os 5 minutos padrao.',
        },
      },
    },
    action: 'cap_faxina_ociosos',
    build: (i) => ({ params: { janela_ms: i.janela_ms } }),
    timeout: 30_000,
  },
  {
    name: 'browser_use_current_tab',
    description:
      'Aponta para a aba que o usuario esta vendo AGORA. Use so quando ele pedir algo sobre a pagina '
      + 'que esta na frente dele ("olha isso", "le essa pagina"). Entra em modo SOMENTE LEITURA: '
      + 'navegar, clicar e digitar ficam barrados, para um erro seu nao custar a aba dele. Se ele '
      + 'pedir explicitamente para voce agir nessa aba, repita com permitir_acao: true.',
    inputSchema: {
      type: 'object',
      properties: {
        permitir_acao: {
          type: 'boolean',
          description: 'Liberar navegar, clicar e digitar na aba do usuario. So depois que ELE pedir. Nunca por conta propria.',
        },
      },
    },
    action: 'cap_use_current_tab',
    build: (i) => ({ params: { permitir_acao: i.permitir_acao } }),
  },
  {
    name: 'browser_use_own_tab',
    description:
      'Volta para a sua aba propria, na janela da ponte, onde pode navegar e clicar sem encostar no que '
      + 'o usuario esta vendo. E o padrao; use depois de browser_use_current_tab ou browser_use_tab.',
    inputSchema: { type: 'object', properties: {} },
    action: 'cap_use_own_tab',
  },
  {
    name: 'browser_tabs_all',
    description:
      'Lista TODAS as abas abertas no Chrome, inclusive as do usuario. Use com browser_use_tab '
      + 'quando ele disser "usa a aba que eu ja abri" ou quando o site exigir uma sessao que ele ja tem.',
    inputSchema: { type: 'object', properties: {} },
    action: 'cap_tabs_all',
  },
  {
    name: 'browser_use_tab',
    description:
      'Aponta para uma aba especifica que o usuario ja tem aberta (ex.: PJe logado), sem refazer login. '
      + 'E aba dele: entra em modo SOMENTE LEITURA ate ele liberar com permitir_acao: true. '
      + 'Ela nunca e fechada quando voce sai.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'ID da aba, vindo de browser_tabs_all.' },
        permitir_acao: {
          type: 'boolean',
          description: 'Liberar navegar, clicar e digitar nessa aba. So depois que o usuario pedir.',
        },
      },
      required: ['tabId'],
    },
    action: 'cap_use_tab',
    build: (i) => ({ params: { tabId: i.tabId, permitir_acao: i.permitir_acao } }),
  },
  {
    name: 'browser_tabs_list',
    description:
      'Lista as abas deste agente, na janela compartilhada da ponte. Serve para saber em que aba '
      + 'voce esta trabalhando.',
    inputSchema: { type: 'object', properties: {} },
    action: 'bridge_tabs',
  },
  {
    name: 'bridge_reload_extension',
    description:
      'Recarrega a extensao PraxedesIA no Chrome, aplicando o ultimo build sem ninguem precisar '
      + 'clicar em recarregar no chrome://extensions. A ponte cai e volta sozinha em alguns segundos.',
    inputSchema: { type: 'object', properties: {} },
    action: 'bridge_reload',
    timeout: 10_000,
  },
  {
    name: 'browser_entregar_aba',
    description:
      'Chame ISTO ao terminar uma tarefa que para esperando o usuário — ele que assina, confere ou '
      + 'decide o proximo passo (ex.: cadastro de peticao pronto no PJe, faltando so o botao de '
      + 'assinar). SEM ISTO, a faxina por ociosidade FECHA a aba depois de 5 minutos parado, e o '
      + 'trabalho pronto some. A aba entregue sai do seu controle (nenhuma faxina, bridge_limpar ou '
      + 'desconexao fecha ela depois), e vai para uma janela normal do Chrome do usuario, ativa, para '
      + 'ele achar assim que olhar. Voce ganha uma aba propria nova em branco para continuar. So '
      + 'funciona com aba SUA (aberta pela ponte para voce); aba do usuario ou de outro agente e '
      + 'recusada.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: {
          type: 'number',
          description: 'ID da aba a entregar. Sem isto, entrega a aba ativa deste agente.',
        },
      },
    },
    action: 'cap_entregar_aba',
    build: (i) => ({ params: { tabId: i.tabId } }),
    timeout: 15_000,
  },
  {
    name: 'bridge_fechar_aba_admin',
    description:
      'USO DE TESTE — fecha qualquer aba pelo tabId, sem checar dono. Nunca use isto em atendimento '
      + 'normal; e so para o teste de browser_entregar_aba limpar a aba de teste que entregou, sem '
      + 'deixar lixo na janela do usuário.',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'number' } },
      required: ['tabId'],
    },
    action: 'cap_fechar_aba_admin',
    build: (i) => ({ params: { tabId: i.tabId } }),
  },
  {
    name: 'bridge_capacidades',
    description:
      'Lista as capacidades registradas na extensao (cap_*) e os conjuntos calculados de quem altera '
      + 'a pagina e quem exige a aba pintada. Serve para conferir se um cap_* novo entrou certo, e para '
      + 'o agente perceber quando o servidor MCP e mais novo que a extensao instalada.',
    inputSchema: { type: 'object', properties: {} },
    action: 'cap_listar',
  },
];
