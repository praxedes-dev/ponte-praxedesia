/**
 * Obra 04 — dialogo nativo (alert/confirm/prompt/beforeunload) chama o Cezar.
 *
 * Decisao do Cezar, fechada: nenhum dialogo e respondido sozinho pela ponte,
 * nem por timeout. Enquanto um dialogo esta aberto, todo comando naquela aba
 * tem de FALHAR ALTO com o texto da pergunta, e so `browser_dialog` resolve.
 *
 * Ver docs/obra-20260904/04-dialogo-nativo-chama-o-cezar.md (criterio de
 * pronto) e entrypoints/background/bridge/capacidades/dialogo.ts (desenho).
 *
 *   node test/dialogo.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-dialogo');

/**
 * Poll em vez de um `sleep` fixo antes de olhar o gate. Achado ao fechar esta
 * obra: sob carga (varios build+reload seguidos), o `setTimeout` de 300ms
 * agendado dentro da pagina por `browser_javascript` as vezes so abre o
 * dialogo de verdade bem depois de 800ms — sem isto o teste falhava por
 * FLAKE de agendamento, nao por defeito do gate (reproduzido: 1 em 4 rodadas
 * manuais, sempre com a MESMA mensagem de erro do item 6 do criterio de
 * pronto: "browser_dialog: nenhum dialogo aberto nesta aba", disparada pelo
 * comando seguinte por nao achar pendencia nenhuma). Nao mascara gate
 * quebrado: se o dialogo nunca aparecer, a ultima leitura (sem `isError`) e
 * exatamente o que os `check()` abaixo reprovam do mesmo jeito.
 */
async function esperarGate(tentativas = 8, intervaloMs = 300) {
  let ultima;
  for (let i = 0; i < tentativas; i += 1) {
    ultima = await c.call('tools/call', { name: 'browser_read_page', arguments: {} });
    if (ultima.result.isError) return ultima;
    await sleep(intervaloMs);
  }
  return ultima;
}

try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste abriria dialogo na aba que o usuario esta usando.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  // ── 1. confirm() agendado: o browser_javascript RETORNA antes do dialogo
  //      abrir (setTimeout de 300ms), e so DEPOIS o dialogo aparece. O
  //      proximo comando (browser_read_page) tem de FALHAR ALTO, citando a
  //      pergunta e a tool que resolve. ─────────────────────────────────────
  const agendado = await c.tool('browser_javascript', {
    codigo: "setTimeout(() => { window.__r = confirm('Sair sem salvar?'); }, 300); 'agendado'",
  });
  check(agendado.content[0].text.includes('agendado'), 'browser_javascript agendou o confirm() e retornou na hora');

  const leitura1 = await esperarGate();
  const texto1 = leitura1.result.content[0].text;
  check(leitura1.result.isError === true, 'browser_read_page falha enquanto o confirm() esta aberto', texto1.slice(0, 90));
  check(/dialogo aberto/.test(texto1), 'a mensagem casa com /dialogo aberto/');
  check(texto1.includes('Sair sem salvar?'), 'a mensagem contem o texto exato da pergunta');
  check(texto1.includes('browser_dialog'), 'a mensagem diz para chamar browser_dialog');

  // ── 2. browser_dialog { aceitar: false } resolve, e o valor lido na pagina
  //      bate com a recusa. ─────────────────────────────────────────────────
  const negado = await c.json('browser_dialog', { aceitar: false });
  check(negado.respondido === 'confirm' && negado.aceito === false, 'browser_dialog respondeu recusando', JSON.stringify(negado));
  await sleep(200);
  const r1 = (await c.tool('browser_javascript', { codigo: 'String(window.__r)' })).content[0].text.trim();
  check(r1 === 'false', 'window.__r ficou false depois de aceitar: false', r1);

  // Comando seguinte volta ao normal (a pendencia sumiu de verdade).
  const leituraDepoisDeNegar = await c.tool('browser_read_page');
  check(!leituraDepoisDeNegar.isError, 'depois de resolver, o comando seguinte funciona normalmente');

  // ── 3. Mesmo dialogo, agora aceitando: window.__r fica true. ─────────────
  await c.tool('browser_javascript', {
    codigo: "setTimeout(() => { window.__r = confirm('Sair sem salvar?'); }, 300); 'agendado'",
  });
  await esperarGate();
  await c.json('browser_dialog', { aceitar: true });
  await sleep(200);
  const r2 = (await c.tool('browser_javascript', { codigo: 'String(window.__r)' })).content[0].text.trim();
  check(r2 === 'true', 'window.__r ficou true depois de aceitar: true', r2);

  // ── 4. prompt() com texto digitado. ───────────────────────────────────────
  await c.tool('browser_javascript', {
    codigo: "setTimeout(() => { window.__nome = prompt('Nome?'); }, 300); 'agendado'",
  });
  await esperarGate();
  const respostaPrompt = await c.json('browser_dialog', { aceitar: true, texto: 'Cezar' });
  check(respostaPrompt.respondido === 'prompt', 'browser_dialog reconheceu o tipo prompt', JSON.stringify(respostaPrompt));
  await sleep(200);
  const nomeLido = (await c.tool('browser_javascript', { codigo: 'window.__nome' })).content[0].text.trim();
  check(nomeLido === 'Cezar', 'o prompt recebeu o texto digitado', nomeLido);

  // ── 5. alert(): comando seguinte erra; browser_dialog limpa; comando
  //      seguinte volta a funcionar. ────────────────────────────────────────
  await c.tool('browser_javascript', {
    codigo: "setTimeout(() => { window.__alertou = true; alert('Atencao'); window.__depoisDoAlert = true; }, 300); 'agendado'",
  });
  const leituraAlert = await esperarGate();
  check(leituraAlert.result.isError === true, 'comando seguinte ao alert() falha', leituraAlert.result.content[0].text.slice(0, 90));
  check(leituraAlert.result.content[0].text.includes('Atencao'), 'a mensagem cita o texto do alert');

  const respostaAlert = await c.json('browser_dialog', { aceitar: true });
  check(respostaAlert.respondido === 'alert', 'browser_dialog limpou o alert', JSON.stringify(respostaAlert));
  await sleep(200);
  const leituraPosAlert = await c.tool('browser_read_page');
  check(!leituraPosAlert.isError, 'comando seguinte ao browser_dialog funciona de novo');

  // ── 6. browser_dialog sem pendencia nenhuma. ──────────────────────────────
  const semPendencia = await c.call('tools/call', { name: 'browser_dialog', arguments: { aceitar: true } });
  check(semPendencia.result.isError === true, 'browser_dialog sem dialogo aberto falha', semPendencia.result.content[0].text);
  check(/nenhum dialogo/.test(semPendencia.result.content[0].text), 'a mensagem diz "nenhum dialogo"');

  // ── 7. Medicao 1 do relatorio da obra: clique num botao cujo handler chama
  //      confirm() de verdade.
  //
  //      Medido (rodada real desta obra): o PROPRIO browser_click NAO volta
  //      sozinho — Input.dispatchMouseEvent so e reconhecido pelo Chrome
  //      depois que o handler de clique TERMINA de rodar, e o handler fica
  //      parado dentro do confirm() ate alguem responder. Sem responder, o
  //      comando ficou preso ate o timeout do TRANSPORTE (hub.js, 60s) e
  //      voltou com a mensagem generica ("estourou 60s sem resposta"), nao
  //      com a mensagem do dialogo — o desenho previa essa alternativa
  //      ("se prende, o erro chega pelo timeout do transporte").
  //
  //      Mas o evento `Page.javascriptDialogOpening` chega por um canal
  //      separado da resposta do comando (e o `chrome.debugger.onEvent`, nao
  //      o retorno de `Input.dispatchMouseEvent`) — entao mesmo com o clique
  //      ainda preso, um SEGUNDO comando disparado logo em seguida ja
  //      enxerga a pendencia e falha com a mensagem certa NA HORA (nao
  //      precisa esperar o clique "terminar"). E so depois de `browser_dialog`
  //      responder que o handler de clique de fato conclui e o comando
  //      `browser_click` original finalmente resolve. ─────────────────────
  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML = '<button id="btn" onclick="window.__cliqueTerminou = false; window.__r2 = confirm(\\'Clique real\\'); window.__cliqueTerminou = true;">Clicar</button>';
      window.__cliqueTerminou = null;
      return 'montado';
    })()`,
  });
  await sleep(300);
  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const linhaBotao = pagina.split('\n').find((l) => l.toLowerCase().includes('clicar'));
  const refBotao = linhaBotao ? Number(linhaBotao.match(/\[(\d+)\]/)?.[1]) : undefined;
  check(Boolean(refBotao), 'achou o botao de teste na arvore', `ref ${refBotao}`);

  if (refBotao) {
    const antesDoClique = Date.now();
    // Dispara e NAO espera: o proprio clique fica preso (medido). Testar isso
    // de verdade, esperando os 60s do transporte, so desperdicaria o tempo da
    // trava de build compartilhada — a medicao real ja foi feita numa rodada
    // manual desta obra (60014 ms, mensagem generica de timeout).
    const promessaDoClique = c.call('tools/call', { name: 'browser_click', arguments: { ref: refBotao } });

    await sleep(1000);
    const duracaoAteDetectar = Date.now() - antesDoClique;
    const leituraDuranteClique = await c.call('tools/call', { name: 'browser_read_page', arguments: {} });
    check(leituraDuranteClique.result.isError === true,
      'MEDICAO 1: com o clique ainda preso, o PROXIMO comando ja detecta o dialogo',
      leituraDuranteClique.result.content[0].text.slice(0, 100));
    check(leituraDuranteClique.result.content[0].text.includes('Clique real'),
      'a mensagem do proximo comando cita o texto exato do confirm() aberto pelo clique');
    console.log(`      medicao 1: o dialogo do clique ja estava visivel para outro comando em ${duracaoAteDetectar} ms`
      + ' (Page.javascriptDialogOpening chega por canal separado da resposta do comando)');

    await c.tool('browser_dialog', { aceitar: true });

    const respostaClique = await promessaDoClique;
    const duracaoTotalDoClique = Date.now() - antesDoClique;
    console.log(`      medicao 1: o PROPRIO browser_click so retornou apos resolver o dialogo, em ${duracaoTotalDoClique} ms`);
    check(respostaClique.result.isError !== true,
      'depois do browser_dialog, o clique original finalmente conclui (deixou de ser isError)',
      JSON.stringify(respostaClique.result.content?.[0]?.text ?? respostaClique.result).slice(0, 120));
  }
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
