/**
 * CETICO da obra "download nativo" (06/09/2026).
 *
 * A pergunta que decide: ELA SABE DIZER QUE NAO BAIXOU? A ponte ja teve oito
 * defeitos da familia "responde ok sem ter feito". Cada caso abaixo e um jeito
 * de o download NAO acontecer; qualquer um que volte sucesso reprova a obra.
 *
 * Servidor HTTP local proprio em todos os casos (regra do briefing: nunca site
 * real). `data:` URL nao serve de fixture neste Chrome.
 *
 *   node test/_cetico-download-honesto.js
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startClient, esperarExtensao, sleep } from './client.js';

let falhas = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhas++; process.exitCode = 1; }
};

const CONTEUDO = 'conteudo-de-prova-do-cetico-download';

// Servidor com uma rota por patologia.
const servidor = createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/ok.txt') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="prova.txt"',
    });
    res.end(CONTEUDO);
    return;
  }

  // Corta a conexao no meio: promete 100000 bytes, manda 50 e derruba o socket.
  if (url === '/corta.txt') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': '100000',
      'content-disposition': 'attachment; filename="cortado.txt"',
    });
    res.write('x'.repeat(50));
    setTimeout(() => { res.socket?.destroy(); }, 120);
    return;
  }

  // Arquivo de TAMANHO ZERO (200, attachment, corpo vazio).
  if (url === '/vazio.txt') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': '0',
      'content-disposition': 'attachment; filename="vazio.txt"',
    });
    res.end();
    return;
  }

  // Link quebrado: 404 (sem attachment nenhum).
  if (url === '/quebrado.txt') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('nao existe');
    return;
  }

  // Demora muito (para o caso de timeout).
  if (url === '/lento.txt') {
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': '100000',
      'content-disposition': 'attachment; filename="lento.txt"',
    });
    res.write('x'.repeat(10));
    // nunca termina (o teste derruba o servidor no fim)
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <a id="ok" href="/ok.txt">baixar ok</a><br>
    <a id="corta" href="/corta.txt">baixar cortado</a><br>
    <a id="vazio" href="/vazio.txt">baixar vazio</a><br>
    <a id="quebrado" href="/quebrado.txt">baixar quebrado</a><br>
    <a id="lento" href="/lento.txt">baixar lento</a>
  </body></html>`);
});

await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const porta = servidor.address().port;
const base = `http://127.0.0.1:${porta}`;

const c = startClient('cetico-download-honesto');
const pastas = [];
const novaPasta = () => {
  const p = mkdtempSync(join(tmpdir(), 'cetico-dl-'));
  pastas.push(p);
  return p;
};

/**
 * Chamada crua: nunca lanca, devolve { isError, texto }.
 *
 * `index.js:70` chama `tool.build(input)` FORA do try/catch que embrulha
 * `link.send` — se `build()` lancar sincrono (ex.: `mkdirSync` numa pasta
 * invalida em `browser_download_arm`), o SDK do MCP nao devolve
 * `{result:{isError:true}}`, devolve erro de PROTOCOLO JSON-RPC
 * (`{error:{message}}`, sem `result` nenhum). `r.result?.isError === true`
 * sozinho vira `false` nesse caso — um teste que devia dizer "isto falhou"
 * diria "nao falhou". Medido nesta obra (item 7, pasta invalida); tratado
 * aqui, nao em `index.js` (fora do escopo desta obra).
 */
async function bruto(nome, args = {}) {
  const r = await c.call('tools/call', { name: nome, arguments: args });
  if (r.error) {
    return { isError: true, texto: r.error.message ?? JSON.stringify(r.error) };
  }
  return {
    isError: r.result?.isError === true,
    texto: r.result?.content?.[0]?.text ?? '',
  };
}

/**
 * Roda um caso: navega, arma, clica no link, espera. Devolve o resultado bruto
 * do wait e o que sobrou na pasta.
 */
async function caso(idLink, { timeoutWait = 12000 } = {}) {
  const pasta = novaPasta();
  await c.tool('browser_navigate', { url: `${base}/` });
  await sleep(300);
  const armou = await bruto('browser_download_arm', { pasta });
  if (armou.isError) return { pasta, armou, wait: null, arquivos: [] };
  await c.tool('browser_click', { text: idLink === 'ok' ? 'baixar ok' : `baixar ${idLink}` })
    .catch(async () => { await c.tool('browser_javascript', { codigo: `document.getElementById('${idLink}').click()` }); });
  const wait = await bruto('browser_download_wait', { timeout_ms: timeoutWait });
  let arquivos = [];
  try { arquivos = readdirSync(pasta); } catch { /* pasta some */ }
  return { pasta, armou, wait, arquivos };
}

try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // ── 0: a tool sequer existe / a capacidade responde? ────────────────────
  {
    const caps = await c.json('bridge_capacidades').catch(() => null);
    console.log('     capacidades cap_download_*:',
      JSON.stringify(JSON.stringify(caps).match(/cap_download[a-z_]*/g)));
  }

  // ── 1: caminho feliz — download de verdade, arquivo na pasta PEDIDA ─────
  {
    const r = await caso('ok');
    console.log('     [1] armou:', r.armou.texto.slice(0, 200));
    console.log('     [1] wait :', r.wait?.texto.slice(0, 300));
    const ok = r.wait && !r.wait.isError;
    check(ok, '1: caminho feliz — browser_download_wait devolveu sucesso',
      r.wait?.texto.slice(0, 200));
    if (ok) {
      let dados = null;
      try { dados = JSON.parse(r.wait.texto); } catch { /* nao e json */ }
      check(dados !== null, '1: o retorno do wait e JSON (o teste chama a.json)', r.wait.texto.slice(0, 120));
      const caminho = dados ? join(dados.pasta, dados.nome) : null;
      check(caminho && existsSync(caminho), '1: o arquivo existe na pasta PEDIDA', String(caminho));
      if (caminho && existsSync(caminho)) {
        check(readFileSync(caminho, 'utf8') === CONTEUDO, '1: o conteudo do arquivo bate');
      }
      check(dados && dados.pasta === r.pasta, '1: a pasta devolvida e a pedida (o servidor MOVEU)',
        `pedida=${r.pasta} devolvida=${dados?.pasta}`);
    }
  }

  // ── 2: armou e NAO clicou em nada ───────────────────────────────────────
  {
    const pasta = novaPasta();
    await c.tool('browser_navigate', { url: `${base}/` });
    await sleep(200);
    const armou = await bruto('browser_download_arm', { pasta });
    const wait = await bruto('browser_download_wait', { timeout_ms: 2500 });
    check(!armou.isError && wait.isError,
      '2: armou e nao baixou nada -> ERRO, nunca "ok" vazio', wait.texto.slice(0, 160));
  }

  // ── 3: servidor corta a conexao no meio ─────────────────────────────────
  {
    const r = await caso('corta');
    const temArquivo = r.arquivos.filter((n) => !n.endsWith('.crdownload'));
    check(r.wait?.isError === true,
      '3: servidor corta a conexao no meio -> ERRO, nunca "ok"',
      `isError=${r.wait?.isError} resp=${r.wait?.texto.slice(0, 200)}`);
    check(!(r.wait && !r.wait.isError && temArquivo.length === 0),
      '3: nao devolveu sucesso com a pasta vazia', `arquivos=${JSON.stringify(r.arquivos)}`);
  }

  // ── 4: arquivo de TAMANHO ZERO ──────────────────────────────────────────
  {
    const r = await caso('vazio');
    let dados = null;
    try { dados = JSON.parse(r.wait?.texto ?? ''); } catch { /* nao json */ }
    console.log('     [4] wait:', r.wait?.texto.slice(0, 240));
    check(r.wait?.isError === true,
      '4: arquivo de tamanho ZERO -> ERRO (briefing do cetico: qualquer "ok" aqui reprova)',
      `isError=${r.wait?.isError} bytes=${dados?.bytes} arquivos=${JSON.stringify(r.arquivos)}`);
  }

  // ── 5: link quebrado (404) ──────────────────────────────────────────────
  {
    const r = await caso('quebrado', { timeoutWait: 8000 });
    console.log('     [5] wait:', r.wait?.texto.slice(0, 240));
    check(r.wait?.isError === true,
      '5: link quebrado (404) -> ERRO, nunca "ok"',
      `isError=${r.wait?.isError} arquivos=${JSON.stringify(r.arquivos)}`);
  }

  // ── 6: timeout — download que nunca termina ─────────────────────────────
  {
    const r = await caso('lento', { timeoutWait: 4000 });
    console.log('     [6] wait:', r.wait?.texto.slice(0, 240));
    check(r.wait?.isError === true,
      '6: download que nunca termina + timeout -> ERRO, nunca "ok"',
      `isError=${r.wait?.isError} arquivos=${JSON.stringify(r.arquivos)}`);
  }

  // ── 7: pasta de destino invalida ────────────────────────────────────────
  {
    const invalida = process.platform === 'win32'
      ? 'Z:\\pasta\\que\\nao\\existe\\<>|?'
      : '/proc/nao-pode/aqui';
    const armou = await bruto('browser_download_arm', { pasta: invalida });
    check(armou.isError, '7: pasta de destino invalida -> browser_download_arm falha ALTO',
      armou.texto.slice(0, 160));
  }

  // ── 8: NAO-REGRESSAO — browser_download antigo (por URL) ────────────────
  {
    const pasta = novaPasta();
    const destino = join(pasta, 'antigo.txt');
    await c.tool('browser_navigate', { url: `${base}/` });
    await sleep(200);
    const r = await bruto('browser_download', { url: `${base}/ok.txt`, caminho: destino });
    console.log('     [8] browser_download:', r.texto.slice(0, 200));
    check(!r.isError && existsSync(destino),
      '8 (NAO-REGRESSAO): browser_download antigo (por URL/conteudo) continua funcionando',
      `isError=${r.isError} existe=${existsSync(destino)} ${r.texto.slice(0, 120)}`);
    if (existsSync(destino)) {
      check(readFileSync(destino, 'utf8') === CONTEUDO, '8: conteudo do download antigo bate');
    }
  }
} catch (err) {
  check(false, 'erro fatal na bateria', err.message);
} finally {
  console.log(`\n${falhas === 0 ? 'sem falhas' : falhas + ' FALHA(S)'}`);
  servidor.closeAllConnections?.();
  servidor.close();
  c.close();
  for (const p of pastas) { try { rmSync(p, { recursive: true, force: true }); } catch { /* ignora */ } }
}
