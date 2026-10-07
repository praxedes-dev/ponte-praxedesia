/**
 * Regressao do desenho de PERFIS MULTIPLOS (dois Chrome/duas extensoes ao
 * mesmo tempo — perfil pessoal e perfil escritorio), docs/obra-20260904
 * (pedido do Dr. Cezar, 11/09/2026): o hub de antes guardava UMA extensao so
 * (`this.extension`); a segunda derrubava a primeira, que reconectava e
 * derrubava a segunda — "funciona as vezes, no perfil errado".
 *
 * Este arquivo fala o protocolo BRUTO do hub como uma EXTENSAO (nao so como
 * peer, que e o que `close-tab-alvo.js` ja fazia) — precedente citado no
 * proprio briefing. Nao tenho um segundo Chrome de verdade para testar; a
 * extensao real (perfil "padrao", pessoal, com WhatsApp Web do Dr. Cezar
 * aberto) fica INTOCADA o tempo todo — os testes usam extensoes FALSAS,
 * conectadas com o mesmo `hello` que a extensao de verdade manda, para
 * provar o roteamento por perfil sem depender de segundo hardware.
 *
 *   node test/perfis-multiplos.js
 */
/**
 * Roda num hub PRIVADO, numa porta separada da 8788 (via
 * PRAXEDES_BRIDGE_PORT), de proposito: nao tenho um segundo Chrome/perfil de
 * verdade, e o hub da 8788 e COMPARTILHADO por qualquer outra sessao deste PC
 * — process que ja esta rodando com o codigo ANTIGO em memoria (JS de servidor
 * so e lido uma vez no boot, ver armadilhas do briefing) e derrubar/ciclar
 * esse processo tiraria a ponte de todo mundo so para este teste. Isolado
 * assim, o teste prova o protocolo sem tocar em nada de ninguem — e o
 * `HOST/PORT` continuam vindo de `hub.js`, so que lidos DEPOIS de setar a
 * env var, para o hub que este teste sobe (via `startClient`, subprocesso
 * novo) nascer nela.
 */
// IMPORTANTE: import estatico e hoisted (roda ANTES de qualquer linha do
// corpo do modulo) — setar a env var depois de um `import ... from` nao
// adianta nada, `hub.js` já teria lido `process.env.PRAXEDES_BRIDGE_PORT`
// com o valor de fora. Por isso os modulos sensiveis a porta entram por
// IMPORT DINAMICO, depois da env var setada. (Foi assim que a primeira
// tentativa deste teste vazou pra porta 8788 de verdade — corrigido.)
process.env.PRAXEDES_BRIDGE_PORT = '18799';

const { WebSocket } = await import('ws');
const { getToken } = await import('../src/token.js');
const { HOST, PORT } = await import('../src/hub.js');
const { startClient, esperarExtensao, sleep } = await import('./client.js');

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const token = getToken();

/**
 * Extensao FALSA: fala o `hello` de extensao (role: 'extension', perfil,
 * instanceId) e devolve `result` a qualquer `cmd` que receber, marcado com o
 * PROPRIO nome do perfil — e o que deixa o teste provar QUAL extensao
 * recebeu (ou nao recebeu) cada comando.
 */
function extensaoFalsa(perfil, instanceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}`);
    const recebidos = [];
    let welcome = null;
    let fechada = false;
    let motivoFechamento = null;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'extension', token, perfil, instanceId }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'welcome') { welcome = msg; return; }
      if (msg.type === 'cmd') {
        recebidos.push(msg);
        ws.send(JSON.stringify({
          type: 'result', id: msg.id, clientId: msg.clientId, ok: true,
          result: { respondidoPor: perfil, action: msg.action },
        }));
      }
    });
    ws.on('close', (code, reasonBuf) => {
      fechada = true;
      motivoFechamento = `${code} ${reasonBuf?.toString() || ''}`.trim();
    });
    ws.on('error', reject);

    // Da tempo do hello/welcome chegarem antes de devolver o controle.
    setTimeout(() => resolve({
      ws,
      recebidos,
      get welcome() { return welcome; },
      get fechada() { return fechada; },
      get motivoFechamento() { return motivoFechamento; },
      fechar: () => ws.close(1000, 'fim do teste'),
    }), 400);
  });
}

async function main() {
  // Sobe o hub PRIVADO: nenhum outro processo escuta a porta 18799, entao
  // este subprocesso ganha a eleicao e vira hub sozinho.
  console.log(`hub privado de teste em ws://${HOST}:${PORT}`);
  const sonda = startClient('sonda-perfis');
  await sonda.handshake();

  // Extensao falsa do perfil "padrao" — no hub privado nao existe Chrome de
  // verdade, entao o padrao tambem precisa ser simulado. Cobre o mesmo papel
  // que a extensao real cobriria: e o que uma sessao que nunca escolhe
  // perfil deve alcancar.
  const padrao = await extensaoFalsa('padrao', 'inst-padrao-1');
  check(!padrao.fechada, 'extensao falsa "padrao" conectou e ficou de pe');
  const online = await esperarExtensao(sonda);
  check(online, 'hub privado enxerga a extensao "padrao" conectada');

  // ---------------------------------------------------------------- (a)
  // duas extensoes convivem, sem se derrubar.
  const escritorio = await extensaoFalsa('escritorio-teste', 'inst-escritorio-1');
  check(!escritorio.fechada, 'extensao falsa "escritorio-teste" conectou e ficou de pe');

  const statusA = await sonda.json('browser_status');
  check(
    Array.isArray(statusA.perfis) && statusA.perfis.includes('padrao') && statusA.perfis.includes('escritorio-teste'),
    'browser_status lista os dois perfis conectados',
    JSON.stringify(statusA.perfis),
  );

  // A extensao "padrao" nao pode ter sido derrubada pela chegada da falsa.
  const aindaOnlineDepois = await esperarExtensao(sonda, 5000);
  check(aindaOnlineDepois, 'a extensao "padrao" continua conectada depois da segunda entrar');
  check(!padrao.fechada, 'e o socket dela nem chegou a fechar', padrao.motivoFechamento || '(nunca fechou)');

  // ---------------------------------------------------------------- (b)
  // comando da sessao com perfil X chega SO na conexao X.
  const outraFalsa = await extensaoFalsa('outra-teste', 'inst-outra-1');
  check(!outraFalsa.fechada, 'extensao falsa "outra-teste" tambem conectou');

  const clienteB = startClient('cliente-b-perfil');
  await clienteB.handshake();
  await esperarExtensao(clienteB);
  await clienteB.tool('browser_usar_perfil', { perfil: 'escritorio-teste' });
  const statusAtivoB = await clienteB.json('browser_status');
  check(statusAtivoB.perfilAtivo === 'escritorio-teste', 'browser_status confirma o perfil ativo escolhido', statusAtivoB.perfilAtivo);

  // Uma tool qualquer que vire `cmd` — bridge_tabs e leve e nao depende de
  // aba nenhuma existir de verdade no lado da extensao falsa.
  await clienteB.tool('browser_tabs_list');
  await sleep(300);
  check(
    escritorio.recebidos.length === 1,
    'a extensao "escritorio-teste" recebeu exatamente 1 comando',
    String(escritorio.recebidos.length),
  );
  check(
    outraFalsa.recebidos.length === 0,
    'a extensao "outra-teste" NAO recebeu nada (comando foi so pro perfil ativo)',
    String(outraFalsa.recebidos.length),
  );

  // ---------------------------------------------------------------- (c)
  // perfil escolhido desconectado -> erro alto, NAO cai pra outro perfil.
  await clienteB.tool('browser_usar_perfil', { perfil: 'perfil-que-nao-existe' });
  let erroRecebido = null;
  try {
    await clienteB.tool('browser_tabs_list');
  } catch (err) {
    erroRecebido = err.message;
  }
  check(
    Boolean(erroRecebido) && erroRecebido.includes('perfil-que-nao-existe'),
    'perfil inexistente falha ALTO citando o nome do perfil',
    erroRecebido || '(nao lancou erro)',
  );
  await sleep(300);
  check(
    escritorio.recebidos.length === 1 && outraFalsa.recebidos.length === 0,
    'nenhuma extensao conectada recebeu o comando do perfil que caiu — nao migrou pra outra em silencio',
    `escritorio=${escritorio.recebidos.length} outra=${outraFalsa.recebidos.length}`,
  );

  // ---------------------------------------------------------------- (d)
  // nome repetido, com a original AINDA viva -> recusa a segunda.
  const escritorioDuplicada = await extensaoFalsa('escritorio-teste', 'inst-escritorio-2-DIFERENTE');
  check(
    escritorioDuplicada.fechada,
    'segunda extensao com o MESMO nome de perfil (instancia diferente) foi recusada — conexao fechada',
    escritorioDuplicada.motivoFechamento || '',
  );
  check(
    Boolean(escritorioDuplicada.welcome?.erro),
    'a recusa veio com mensagem de erro clara no welcome',
    escritorioDuplicada.welcome?.erro || '(sem erro)',
  );
  // A original continua valendo o nome dela.
  const clienteD = startClient('cliente-d-perfil');
  await clienteD.handshake();
  await esperarExtensao(clienteD);
  await clienteD.tool('browser_usar_perfil', { perfil: 'escritorio-teste' });
  await clienteD.tool('browser_tabs_list');
  await sleep(300);
  check(
    escritorio.recebidos.length === 2,
    'a extensao ORIGINAL "escritorio-teste" continua recebendo comandos depois da tentativa de duplicata',
    String(escritorio.recebidos.length),
  );

  // ---------------------------------------------------------------- (e)
  // sessao que nunca chama browser_usar_perfil fica no padrao — nada muda
  // para quem nao escolher.
  const clienteE = startClient('cliente-e-sem-escolha');
  await clienteE.handshake();
  await esperarExtensao(clienteE);
  const statusE = await clienteE.json('browser_status');
  check(statusE.perfilAtivo === 'padrao', 'sessao que nunca escolheu perfil fica em "padrao"', statusE.perfilAtivo);
  // E o comando dela tem de ir pra extensao "padrao", nao pras outras.
  await clienteE.tool('browser_tabs_list');
  await sleep(300);
  check(
    padrao.recebidos.length === 1,
    'sessao sem escolha de perfil manda o comando pra extensao "padrao" — bateria de hoje continua verde sem mudar nada',
    String(padrao.recebidos.length),
  );
  check(
    escritorio.recebidos.length === 2 && outraFalsa.recebidos.length === 0,
    'e nao mexe no que ja tinha chegado pras outras extensoes',
    `escritorio=${escritorio.recebidos.length} outra=${outraFalsa.recebidos.length}`,
  );

  // ------------------------------------------------------------ limpeza
  padrao.fechar();
  escritorio.fechar();
  outraFalsa.fechar();
  sonda.close();
  clienteB.close();
  clienteD.close();
  clienteE.close();

  console.log(falhou ? '\nALGUM CASO FALHOU.' : '\nTODOS OS CASOS OK.');
  process.exit(falhou ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRO no teste:', err);
  process.exit(1);
});
