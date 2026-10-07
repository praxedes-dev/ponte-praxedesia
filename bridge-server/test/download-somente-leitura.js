/**
 * Prova o item 1 do briefing "furos-somente-leitura" (05/09/2026): o modo
 * somente leitura tem de barrar `browser_download` do MESMO jeito que barra
 * `browser_javascript` — antes disto, um cetico mediu que a MESMA URL, na
 * MESMA aba, em modo "somente leitura" confirmado, era barrada por
 * `browser_javascript` (fetch com credentials:'include') mas DISPARAVA de
 * verdade por `browser_download` (cookie de sessao do Dr. Cezar incluso).
 *
 * Causa dupla, corrigida em `capacidades/arquivos.ts`:
 *   1. `cap_download` nao declarava `altera` — nao entrava em
 *      `nomesQueAlteram()`, passava pelo gate de NOME de `bridge/index.ts`.
 *   2. `baixarComoBase64` chamava `executarJs` com 2 argumentos —
 *      `emSomenteLeitura` caia no default `false`, `throwOnSideEffect`
 *      nunca era ligado.
 *
 * Achado de 05/09/2026 (auditoria desta obra): a assercao do caso 2 so
 * conferia o prefixo GENERICO `[somente leitura]`, que as DUAS camadas da
 * causa dupla acima emitem — nao dava para saber, pelo teste, se as duas
 * continuavam de pe ou so uma. Duas mutacoes provaram o problema:
 *   - M3 (tirar so `altera: true` de `cap_download`, mantendo a passagem de
 *     `emSomenteLeitura` para `executarJs`) — o teste ficava 10/10 verde,
 *     porque a camada de CONTEUDO sozinha ja barra e ja comeca com
 *     `[somente leitura]`.
 *   - M4 (manter `altera: true`, tirar o terceiro argumento que
 *     `baixarComoBase64` repassa) — TAMBEM ficava 10/10 verde, porque o gate
 *     de NOME sozinho ja barra antes de `baixarComoBase64` rodar.
 * O caso 2 agora exige a mensagem ESPECIFICA do gate de NOME ("esta e a aba
 * do usuario", `bridge/index.ts:399`), nao so o prefixo generico. Isso pega
 * M3: sem o gate de NOME, quem sobra e a mensagem de CONTEUDO
 * (`capacidades/js.ts`: "este JS tenta alterar a aba do usuario..."), com
 * texto DIFERENTE — a assercao nova nao bate, o teste fica vermelho.
 *
 * M4 continua fora do alcance deste teste, e nao por falta de uma assercao
 * melhor: `ctx.emSomenteLeitura` (o que alimenta a camada de CONTEUDO) e
 * `this.somenteLeitura.has(cmd.clientId)` (o que alimenta o gate de NOME)
 * sao a MESMA leitura do MESMO Set, para o MESMO comando
 * (`bridge/index.ts:392` e `:396`). Como `cap_download` sempre declara
 * `altera: true`, o gate de NOME SEMPRE intercepta primeiro quando o cliente
 * esta em modo leitura — nao ha, pela API publica da ponte, um jeito de
 * `emSomenteLeitura: true` chegar em `baixarComoBase64` sem o gate de NOME
 * ja ter barrado antes. Tirar a camada de CONTEUDO de `cap_download` (M4) e
 * por isso INVISIVEL para qualquer teste de caixa-preta contra
 * `browser_download`, enquanto o gate de NOME continuar de pe: essa camada
 * so importa como reforco para o dia em que o gate de NOME quebrar (o
 * cenario que M3 simula, e que o caso 2 agora prova). A prova de que a
 * camada de CONTEUDO funciona sozinha, por si, mora em
 * `test/js-somente-leitura.js` (via `cap_js`, que NUNCA tem gate de nome).
 *
 * Nao rodei M3/M4 de verdade aqui: este teste nao pode editar
 * `capacidades/arquivos.ts` para mutar (outro agente tem esse arquivo nesta
 * obra). O paragrafo acima e raciocinio sobre o codigo-fonte lido
 * (`bridge/index.ts` e `arquivos.ts`), nao mutation testing empirico deste
 * caso especifico — quem tiver acesso para mutar `arquivos.ts` deveria
 * confirmar M3 de verdade; M4 nao tem como ficar vermelho, pelo motivo acima,
 * entao nao adianta tentar de novo sem mudar a arquitetura (dar ao gate de
 * NOME e a camada de CONTEUDO sinais independentes).
 *
 * Servidor local PROPRIO (nunca site real, por regra do briefing): conta de
 * verdade quantas vezes o endpoint "autenticado" foi alcancado, para provar
 * que a REQUISICAO nao saiu — nao so que apareceu uma mensagem de erro.
 *
 *   node test/download-somente-leitura.js
 */
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClient, esperarExtensao } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

let hits = 0;
const servidor = createServer((req, res) => {
  if (req.url === '/alvo-autenticado') {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('SEGREDO-DE-SESSAO');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<html><body><h1>sonda-download-somente-leitura</h1></body></html>');
});

await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const porta = servidor.address().port;
const urlPagina = `http://127.0.0.1:${porta}/pagina`;
const urlAlvo = `http://127.0.0.1:${porta}/alvo-autenticado`;
const pastaTmp = mkdtempSync(join(tmpdir(), 'praxedes-download-somente-leitura-'));

const c = startClient('teste-download-somente-leitura');
try {
  await c.handshake();

  if (!(await esperarExtensao(c))) {
    check(false, 'extensao conectou');
  } else {
    await c.tool('browser_tab_open', { url: urlPagina });
    await c.tool('browser_wait_network', {}).catch(() => {});
    const cobaia = (await c.json('browser_tabs_list')).activeTabId;

    try {
      // ── 1. adotar a cobaia entra em modo somente leitura ──────────────────
      const adocao = (await c.tool('browser_use_tab', { tabId: cobaia })).content[0].text;
      const entrouEmLeitura = /somente leitura/i.test(adocao);
      check(entrouEmLeitura, '1. browser_use_tab (cobaia) entra em modo somente leitura', adocao.slice(0, 90));
      if (!entrouEmLeitura) throw new Error('sem modo leitura, o resto do teste nao prova nada — abortando');

      // ── 2. browser_download em modo leitura e barrado, e a requisicao NAO sai ──
      // A assercao exige a mensagem ESPECIFICA do gate de NOME ("esta e a aba
      // do usuario", bridge/index.ts:399), nao so o prefixo generico
      // "[somente leitura]" — as DUAS camadas de defesa emitem o prefixo, e
      // uma checagem so pelo prefixo nao pega perder o gate de NOME sozinho
      // (a mensagem que sobra, da camada de CONTEUDO em capacidades/js.ts, e
      // "este JS tenta alterar a aba do usuario...", com texto diferente).
      // Ver o cabecalho do arquivo para o porque isto NAO cobre a perda da
      // camada de CONTEUDO (M4 no cabecalho) — e por desenho da ponte, nao
      // por uma assercao fraca aqui.
      const caminhoBarrado = join(pastaTmp, 'nao-devia-existir.txt');
      const respBarrado = await c.call('tools/call', {
        name: 'browser_download', arguments: { url: urlAlvo, caminho: caminhoBarrado },
      });
      const textoBarrado = respBarrado.result?.content?.[0]?.text ?? '';
      const foiBarradoPeloGateDeNome = respBarrado.result?.isError === true
        && /esta e a aba do usuario/.test(textoBarrado);
      check(foiBarradoPeloGateDeNome,
        '2. browser_download e barrado PELO GATE DE NOME (nao so pelo prefixo generico "[somente leitura]")',
        textoBarrado.slice(0, 200));

      // Prova a medicao do cetico ao contrario: nao e so a mensagem — o
      // GET "autenticado" nunca chegou a sair da pagina.
      check(hits === 0, '2b. o servidor NUNCA recebeu o GET (a requisicao nao saiu, nao so a mensagem)',
        `hits=${hits}`);
      check(!existsSync(caminhoBarrado), '2c. nenhum arquivo foi gravado no disco', caminhoBarrado);

      // ── 3. com permitir_acao, o MESMO download passa ──────────────────────
      const liberou = (await c.tool('browser_use_tab', { tabId: cobaia, permitir_acao: true })).content[0].text;
      check(!/somente leitura/i.test(liberou), '3a. browser_use_tab com permitir_acao:true sai do modo leitura',
        liberou.slice(0, 90));

      const caminhoLiberado = join(pastaTmp, 'liberado.txt');
      const respLiberado = await c.call('tools/call', {
        name: 'browser_download', arguments: { url: urlAlvo, caminho: caminhoLiberado },
      });
      const passou = respLiberado.result?.isError !== true;
      check(passou, '3b. browser_download passa depois de permitir_acao: true',
        respLiberado.result?.content?.[0]?.text?.slice(0, 160) ?? '');
      check(hits === 1, '3c. agora sim o servidor recebeu o GET (uma vez)', `hits=${hits}`);
      const conteudoGravado = existsSync(caminhoLiberado) ? readFileSync(caminhoLiberado, 'utf8') : null;
      check(conteudoGravado === 'SEGREDO-DE-SESSAO', '3d. o arquivo gravado tem o conteudo certo',
        String(conteudoGravado).slice(0, 40));
    } finally {
      // Devolve o agente para a aba propria ANTES de fechar a cobaia (mesmo
      // padrao de js-somente-leitura.js) — sem isto a sessao fica presa em
      // modo leitura ate c.close() la embaixo soltar o workspace.
      const volta = (await c.tool('browser_use_own_tab')).content[0].text;
      check(/aba propria/.test(volta), '4. browser_use_own_tab devolve o agente para a aba dele');
      await c.tool('browser_tab_close', { tabId: cobaia }).catch(() => {});
    }

    // ── 5. download continua funcionando normalmente na aba PROPRIA do agente ──
    // Confere que endurecer o modo leitura nao criou falso positivo: na aba
    // que o agente mesmo abriu (nunca "adotada"), o download nao pede nada.
    await c.tool('browser_navigate', { url: urlPagina }).catch(() => {});
    await c.tool('browser_wait_network', {}).catch(() => {});
    const caminhoProprio = join(pastaTmp, 'aba-propria.txt');
    const respProprio = await c.call('tools/call', {
      name: 'browser_download', arguments: { url: urlAlvo, caminho: caminhoProprio },
    });
    const passouNaPropria = respProprio.result?.isError !== true;
    check(passouNaPropria, '5. browser_download funciona normalmente na aba propria (sem falso positivo)',
      respProprio.result?.content?.[0]?.text?.slice(0, 160) ?? '');
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
  // `close()` sozinho NAO derruba conexao keep-alive aberta: ele so completa
  // quando a ultima fechar, e o socket vivo segura o processo node de pe.
  // Rodando isolado, o teste imprimia os 10 OK e nunca voltava ao prompt.
  // `closeAllConnections()` (Node 18.2+) corta as que sobraram. Isto importa
  // alem da conveniencia: este arquivo esta na bateria (`test/todos.js`), e um
  // processo que nao encerra penduraria `npm test` inteiro, de forma
  // intermitente — so quando o Chrome tivesse mesmo reusado a conexao.
  servidor.closeAllConnections?.();
  servidor.close();
  rmSync(pastaTmp, { recursive: true, force: true });
}
