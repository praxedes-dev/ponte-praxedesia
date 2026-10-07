/**
 * Tools de inspecao de rede (obra 11). Ver
 * entrypoints/background/bridge/capacidades/rede-inspecao.ts para o desenho completo
 * (buffer por aba, so leitura passiva de Network.*, sem interceptacao).
 */

export const TOOLS = [
  {
    name: 'browser_network_requests',
    description:
      'Lista as requisicoes que a aba pediu, do mais novo para o mais velho: URL, metodo, tipo '
      + '(Document/XHR/Fetch/Script/...), status, tamanho e falha, quando houver. Serve para ver o '
      + 'que uma pagina do PJe ou de um tribunal pediu por baixo dos panos, sem abrir o DevTools. '
      + 'O buffer e por aba e vale desde a ultima reconexao da extensao (reload da ponte ou o '
      + 'service worker dormir apaga tudo). Atencao: se voce abriu a aba com browser_tab_open ja '
      + 'passando url, o documento principal dela NAO aparece aqui (a pagina comeca a carregar antes '
      + 'da ponte anexar o depurador) — abra a aba em branco e navegue depois com browser_navigate '
      + 'para capturar o documento tambem.',
    inputSchema: {
      type: 'object',
      properties: {
        filtro_url: { type: 'string', description: 'Substring da URL a procurar, sem diferenciar maiusculas.' },
        tipo: { type: 'string', description: 'Filtra por tipo exato do CDP: Document, XHR, Fetch, Script, Image, Stylesheet...' },
        so_falhas: { type: 'boolean', description: 'So requisicoes que falharam (DNS, CORS, conexao recusada...).' },
        limite: { type: 'number', description: 'Quantas devolver, do mais novo. Padrao: 50.' },
      },
    },
    action: 'cap_network_requests',
    build: (i) => ({
      params: {
        filtro_url: i.filtro_url, tipo: i.tipo, so_falhas: i.so_falhas, limite: i.limite,
      },
    }),
  },
  {
    name: 'browser_network_body',
    description:
      'Le o corpo de uma resposta ja carregada (Network.getResponseBody). Use quando um upload do '
      + 'PJe falhar em silencio — sem mensagem de erro, sem .dz-error-message, sem nada no console — '
      + 'e o corpo do 400/500 que o servidor devolveu for a unica pista. Informe requestId (vindo de '
      + 'browser_network_requests) para o alvo exato, ou filtro_url para pegar a mais recente que '
      + 'casa. So funciona enquanto a resposta estiver no cache do Chrome — depois de navegar, some. '
      + 'Corpo binario (imagem, PDF) nao volta aqui: use browser_download.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'requestId exato, vindo de browser_network_requests.' },
        filtro_url: { type: 'string', description: 'Substring da URL; pega a requisicao mais recente que casar. Ignorado se requestId vier.' },
        max_chars: { type: 'number', description: 'Teto de caracteres do corpo. Padrao: 20000.' },
      },
    },
    action: 'cap_network_body',
    build: (i) => ({ params: { requestId: i.requestId, filtro_url: i.filtro_url, max_chars: i.max_chars } }),
  },
];
