/**
 * v6.1 (f) — esperar a decisao do usuário.
 *
 * Quando o freio barra uma acao irreversivel/financeira, ou a pagina pede login sem senha, o
 * Windows mostra uma notificacao com dois botoes ("Aprovar uma vez"/"Negar", "Já entrei"/"Cancelar")
 * e o comando volta dizendo "aguardando decisão do usuário" com um id. Esta tool so ESPERA e
 * REPORTA a resposta. Nao existe jeito de aprovar por aqui: aprovar e clicar no botao.
 */
export const TOOLS = [
  {
    name: 'browser_decisao',
    description:
      'Espera (ate esperar_s, padrao 30, teto 120) o usuário responder a notificacao do Windows que a ponte '
      + 'abriu quando barrou uma acao ou pediu login. Passe o id que o comando barrado devolveu; sem id, '
      + 'mostra as decisoes desta aba. Volta assim que uma sair de "aguardando". APROVADA: repita a MESMA '
      + 'acao (mesmo alvo, mesma aba), SEM confirm, em ate 60 s; vale uma vez so. NEGADA ou CANCELADA: nao '
      + 'repita nem contorne, avise o usuário no chat. Login "entrou": releia a pagina e siga. Esta tool '
      + 'nao aprova nada: quem aprova e ele, no botao.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Id da decisao, como veio no erro/aviso do comando barrado.' },
        esperar_s: { type: 'number', description: 'Quanto esperar pela resposta, em segundos. Padrao 30, teto 120.' },
      },
    },
    action: 'cap_decisao',
    build: (i) => ({ params: { id: i.id, esperar_s: i.esperar_s } }),
    timeout: (i) => (Math.min(Math.max(Number(i.esperar_s) || 30, 0), 120) + 20) * 1000,
    formatar: (data) => {
      const lista = data?.decisoes ?? [];
      if (!lista.length) return data?.vazio ?? 'nenhuma decisao';
      return lista.map((d) => {
        // a mensagem ja comeca pelo estado ("NEGADA pelo..."): nao repetir a palavra
        const jaDiz = d.mensagem.toUpperCase().startsWith(d.estado.toUpperCase());
        return `[${d.id}] ${d.tipo} em ${d.site}:${jaDiz ? '' : ` ${d.estado.toUpperCase()}`}\n  ${d.mensagem}\n  acao barrada: ${d.acao_barrada}`;
      }).join('\n')
        + `\n(esperou ${Math.round((data.esperou_ms ?? 0) / 1000)} s)`;
    },
  },
];
