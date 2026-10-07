/**
 * Obra 08 — aba filha vira da ponte, download nativo cai numa pasta, e os
 * dois furos da aba do usuario (`browser_tab_open` na janela errada,
 * `browser_tab_close` fechando qualquer aba). Ver
 * docs/obra-20260904/08-abas-filhas-download-nativo-e-aba-do-usuario.md,
 * secao "Criterio de pronto".
 *
 * Roda contra o Chrome de verdade do Dr. Cezar: item 4 tenta fechar a aba
 * DELE de proposito, para provar que a ponte RECUSA — nunca chega a fechar.
 * Se algum dia isto realmente fechar a aba dele, e a barreira que quebrou.
 *
 *   node test/abas-filhas.js
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

/**
 * Espera com polling em vez de `sleep` fixo (mesma tecnica de
 * `test/dialogo.js:esperarGate`): tenta `buscar()` ate `condicao(valor)`
 * bater ou a tentativas acabarem. Sob carga (build/reload de outro pedreiro
 * disputando o Chrome), um `sleep` fixo vira falha intermitente; aqui a
 * ultima leitura sempre volta, mesmo sem a condicao bater, para o `check`
 * seguinte relatar a FALHA de verdade em vez de estourar em `.foo` de
 * `undefined`.
 */
async function esperarCondicao(buscar, condicao, tentativas = 10, intervaloMs = 300) {
  let valor;
  for (let i = 0; i < tentativas; i += 1) {
    valor = await buscar();
    if (condicao(valor)) return valor;
    await sleep(intervaloMs);
  }
  return valor;
}

const a = startClient('obra08-A');

try {
  await a.handshake();
  if (!(await esperarExtensao(a))) throw new Error('extensao nao conectou');

  const infoInicial = await a.json('browser_tabs_list');
  const janelaDaPonte = infoInicial.janelaDaPonte;
  check(typeof janelaDaPonte === 'number', `janela da ponte existe (${janelaDaPonte})`);

  // Foto das abas do usuario ANTES de mexer em qualquer coisa — item 6 confere
  // que nenhuma delas sumiu no final (mesma tecnica de test/isolamento.js).
  const antesTudo = JSON.parse((await a.tool('browser_tabs_all')).content[0].text);
  const doUsuarioAntes = antesTudo.filter((t) => t.janela !== janelaDaPonte);
  check(doUsuarioAntes.length > 0, `achei ${doUsuarioAntes.length} aba(s) do usuario para vigiar`);

  // ── item 1 (achado c): browser_tab_open abre na janela da PONTE ────────
  const abriu = await a.json('browser_tab_open', { url: 'https://example.com/?obra08-item1' });
  // Polling em vez de `sleep(600)` fixo: sob carga a aba pode demorar mais
  // para aparecer em `browser_tabs_all` (armadilha de sleep fixo da bancada).
  const depoisAbrir = await esperarCondicao(
    async () => JSON.parse((await a.tool('browser_tabs_all')).content[0].text),
    (lista) => lista.some((t) => t.tabId === abriu.newTabId),
  );
  const tabItem1 = depoisAbrir.find((t) => t.tabId === abriu.newTabId);
  check(tabItem1?.janela === janelaDaPonte, 'item1: browser_tab_open abre na janela da ponte',
    `aba ${abriu.newTabId} caiu na janela ${tabItem1?.janela}, ponte e ${janelaDaPonte}`);

  await a.tool('browser_use_own_tab').catch(() => {});

  // ── item 2 (achado a): window.open vira filha DA PONTE ─────────────────
  await a.tool('browser_navigate', { url: 'https://example.com' });
  // `void 0` no final: `window.open(...)` devolve a Window da aba nova, e
  // `Runtime.evaluate` falha ("Object reference chain is too long") tentando
  // serializar isso de volta — nao e o valor que o teste quer, so o efeito.
  await a.tool('browser_javascript', { codigo: "window.open('https://example.com/?obra08-filha'); void 0;" });

  const espera1 = await a.json('browser_wait_new_tab', { timeout_ms: 8000 });
  check(espera1.abaNova !== null, 'item2: browser_wait_new_tab achou a filha', JSON.stringify(espera1));
  check(Boolean(espera1.abaNova?.url?.includes('obra08-filha')), 'item2: url da filha bate',
    espera1.abaNova?.url);
  check(espera1.abaNova?.daPonte === true, 'item2: filha marcada daPonte: true');

  const filhaId = espera1.abaNova?.tabId;
  if (filhaId) {
    await a.tool('browser_tab_switch', { tabId: filhaId });
    const leuFilha = (await a.tool('browser_read_page')).content[0].text;
    check(!leuFilha.includes('[somente leitura]'), 'item2: read_page na filha sem [somente leitura]',
      leuFilha.slice(0, 60));

    const navFilha = await a.call('tools/call', {
      name: 'browser_navigate', arguments: { url: 'https://example.com/?obra08-filha-nav' },
    });
    check(navFilha.result?.isError !== true, 'item2: browser_navigate funciona na filha',
      navFilha.result?.content?.[0]?.text?.slice(0, 80));
  } else {
    check(false, 'item2: sem tabId de filha, pulei read_page/navigate nela');
  }

  // ── item 3 (achado a): sem filha nova, wait_new_tab NAO e erro ─────────
  const espera2 = await a.json('browser_wait_new_tab', { timeout_ms: 1500 });
  check(espera2.abaNova === null, 'item3: sem filha nova, abaNova vem null', JSON.stringify(espera2));
  check(/leia-a/.test(espera2.mensagem ?? ''), 'item3: mensagem manda ler a aba antes de repetir',
    espera2.mensagem);

  await a.tool('browser_use_own_tab').catch(() => {});

  // ── item 4 (achado d): browser_tab_close RECUSA aba do usuario ─────────
  const tudoAgora = JSON.parse((await a.tool('browser_tabs_all')).content[0].text);
  const doUsuarioAgora = tudoAgora.filter((t) => t.janela !== janelaDaPonte);
  const alvoDoUsuario = doUsuarioAgora.find((t) => t.ativa) ?? doUsuarioAgora[0];

  if (alvoDoUsuario) {
    const tentativa = await a.call('tools/call', {
      name: 'browser_tab_close', arguments: { tabId: alvoDoUsuario.tabId },
    });
    const texto = tentativa.result?.content?.[0]?.text ?? '';
    check(tentativa.result?.isError === true, 'item4: fechar aba do usuario e recusado', texto.slice(0, 90));
    check(/\[aba do usuario\]/.test(texto), 'item4: erro tem o marcador certo', texto.slice(0, 90));

    const aindaLa = JSON.parse((await a.tool('browser_tabs_all')).content[0].text)
      .some((t) => t.tabId === alvoDoUsuario.tabId);
    check(aindaLa, 'item4: a aba do usuario continua aberta depois da tentativa');
  } else {
    check(false, 'item4: nenhuma aba do usuario encontrada fora da janela da ponte para testar');
  }

  // ── item 5 (achado b): download nativo — PLANO C (06/09/2026) ───────────
  // CDP (Browser/Page.setDownloadBehavior) continua recusado nesta versao do
  // Chrome (medido de novo nesta obra, mesmo erro do relatorio da obra 08).
  // Com autorizacao do Dr. Cezar, `download-nativo.ts` passou a usar
  // `chrome.downloads` + `onDeterminingFilename` (permissao nova em
  // wxt.config.ts). Servidor HTTP local PROPRIO (nunca site real, regra do
  // briefing) com `Content-Disposition: attachment` — e o caso de VERDADE
  // (PJe "Imprimir boletos"): um LINK COMUM, sem atributo `download`, que o
  // Chrome baixa sozinho por causa do header, nao por acao do HTML.
  const CONTEUDO_PROVA = 'conteudo-de-prova-download-nativo';
  let servidor5;
  let pastaDownload5;
  try {
    servidor5 = createServer((req, res) => {
      if (req.url === '/arquivo.txt') {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="prova.txt"',
        });
        res.end(CONTEUDO_PROVA);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><a id="alvo" href="/arquivo.txt">baixar</a></body></html>');
    });
    await new Promise((resolve) => servidor5.listen(0, '127.0.0.1', resolve));
    const porta5 = servidor5.address().port;

    pastaDownload5 = mkdtempSync(join(tmpdir(), 'praxedes-obra08-'));

    await a.tool('browser_navigate', { url: `http://127.0.0.1:${porta5}/` });
    await a.tool('browser_wait_network', {}).catch(() => {});

    const armou = await a.json('browser_download_arm', { pasta: pastaDownload5 });
    check(typeof armou.metodo === 'string' && armou.metodo.length > 0,
      'item5: browser_download_arm devolveu o metodo usado', armou.metodo);

    await a.tool('browser_click', { text: 'baixar' });
    const baixou = await a.json('browser_download_wait', { timeout_ms: 15000 });
    check(typeof baixou.nome === 'string' && baixou.nome.length > 0,
      'item5: browser_download_wait devolveu um nome', baixou.nome);

    // A pasta devolvida tem de ser a PEDIDA (pastaDownload5, um tmpdir fora
    // da pasta de Downloads do Chrome) — nao a subpasta de staging interna.
    // Prova que o servidor MOVEU o arquivo, nao so leu onde o Chrome gravou.
    check(baixou.pasta === pastaDownload5, 'item5: a pasta devolvida e a PEDIDA, nao a de staging do Chrome',
      `pedida=${pastaDownload5} devolvida=${baixou.pasta}`);

    const caminho = join(baixou.pasta || pastaDownload5, baixou.nome || 'prova.txt');
    const existe = existsSync(caminho);
    check(existe, 'item5: arquivo existe na pasta pedida', caminho);
    if (existe) {
      const conteudo = readFileSync(caminho, 'utf8');
      check(conteudo === CONTEUDO_PROVA, 'item5: conteudo do arquivo bate', JSON.stringify(conteudo));
    }
  } catch (err) {
    check(false, 'item5: download nativo (Plano C, chrome.downloads)', err.message);
  } finally {
    servidor5?.closeAllConnections?.();
    servidor5?.close();
  }

  // ── item 5b: sem download nenhum, browser_download_wait FALHA ALTO ──────
  // Arma e nao clica em nada: prova que "nao baixou" nunca vira "ok" vazio
  // (regra explicita do briefing — a ponte ja teve oito defeitos desta familia).
  try {
    await a.tool('browser_download_arm', { pasta: pastaDownload5 || tmpdir() });
    const semDownload = await a.call('tools/call', {
      name: 'browser_download_wait', arguments: { timeout_ms: 1500 },
    });
    const textoSemDownload = semDownload.result?.content?.[0]?.text ?? '';
    check(semDownload.result?.isError === true,
      'item5b: browser_download_wait sem download nenhum e ERRO (nunca "ok" vazio)',
      textoSemDownload.slice(0, 160));
  } catch (err) {
    check(false, 'item5b: falha alto sem download nenhum', err.message);
  } finally {
    if (pastaDownload5) rmSync(pastaDownload5, { recursive: true, force: true });
  }

  // ── item 6: ao sair, as abas que a ponte abriu somem; o usuario fica intacto ──
  a.close();

  const c = startClient('obra08-conferindo');
  await c.handshake();
  await esperarExtensao(c);
  // Polling em vez de `sleep(3000)` fixo: a faxina ao encerrar o cliente A e
  // assincrona; sob carga pode nao ter terminado ainda quando C pergunta.
  const fim = await esperarCondicao(
    async () => JSON.parse((await c.tool('browser_tabs_all')).content[0].text),
    (lista) => !lista.some((t) => t.tabId === filhaId) && !lista.some((t) => t.tabId === tabItem1?.tabId),
    10, 500,
  );

  check(!fim.some((t) => t.tabId === filhaId), 'item6: a filha da ponte foi fechada ao sair o cliente');
  check(!fim.some((t) => t.tabId === tabItem1?.tabId), 'item6: a aba do item1 tambem foi fechada ao sair');

  const perdidas = doUsuarioAntes.filter((t) => !fim.some((f) => f.tabId === t.tabId));
  check(perdidas.length === 0, `item6: nenhuma das ${doUsuarioAntes.length} abas do usuario sumiu`,
    perdidas.map((t) => t.url).join(', ') || 'todas intactas');

  c.close();
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  a.close();
}
