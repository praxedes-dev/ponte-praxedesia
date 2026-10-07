/**
 * Teste ponta a ponta: cliente MCP -> hub -> extensao -> Chrome de verdade.
 *
 * Exige o Chrome aberto com a extensao PraxedesIA carregada e o token pareado.
 * Abre uma aba, navega, le a arvore de acessibilidade e confere o conteudo.
 *
 *   node test/e2e.js
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const ESPERA_EXTENSAO_MS = 90_000;

const proc = spawn(process.execPath, [SERVER, '--name', 'teste-e2e'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

const pending = new Map();
let buffer = '';
let seq = 0;
let ready;
const readyPromise = new Promise((r) => { ready = r; });

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const entry = pending.get(msg.id);
      if (entry) { pending.delete(msg.id); entry(msg); }
    } catch { /* linha parcial */ }
  }
});

proc.stderr.on('data', (c) => {
  const text = c.toString();
  process.stderr.write(text.replace(/^/gm, '    | '));
  if (text.includes('pronto como')) ready();
});

const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => reject(new Error(`timeout em ${method}`)), 120_000);
  pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

const tool = async (name, args = {}) => {
  const res = await call('tools/call', { name, arguments: args });
  if (res.result?.isError) throw new Error(`${name}: ${res.result.content[0].text}`);
  return res.result;
};

const check = (ok, label) => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}`);
  if (!ok) process.exitCode = 1;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await readyPromise;
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0.0.0' },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // A extensao reconecta com backoff, entao pode demorar ate meio minuto.
  console.log('esperando a extensao conectar no hub...');
  let conectada = false;
  const limite = Date.now() + ESPERA_EXTENSAO_MS;
  while (Date.now() < limite) {
    const status = JSON.parse((await tool('browser_status')).content[0].text);
    if (status.extensaoConectada === true) { conectada = true; break; }
    await sleep(2000);
  }
  check(conectada, 'extensao conectada ao hub');
  if (!conectada) throw new Error('a extensao nunca conectou — confira o token e se o Chrome esta aberto');

    // Aba propria: sem isto o teste navegaria na aba que o usuario esta usando,
  // porque a ponte trabalha na aba corrente por padrao.
await tool('browser_tab_open', { url: 'https://example.com' });
  check(true, 'navegou para example.com');

  await tool('browser_wait_for_text', { text: 'Example Domain', timeout_ms: 20_000 });
  check(true, 'texto da pagina apareceu');

  const page = await tool('browser_read_page');
  const arvore = page.content[0].text;
  check(arvore.includes('Example Domain'), 'read_page traz o titulo da pagina');
  check(arvore.includes('elementos interativos'), 'read_page vem no modo enxuto por padrao');
  check(!arvore.includes('accessibilityTree'), 'read_page nao devolve a arvore duplicada');

  const achados = (await tool('browser_find', { query: 'learn more' })).content[0].text;
  check(achados.includes('Learn more'), 'browser_find achou o elemento por descricao');

  const texto = await tool('browser_extract', { max_chars: 300 });
  console.log('     extraido:', texto.content[0].text.replace(/\s+/g, ' ').slice(0, 120));

  const shot = await tool('browser_screenshot');
  check(shot.content[0].type === 'image' && shot.content[0].data.length > 1000, 'screenshot veio como imagem');

  // Clique por ref: falhava calado quando a aba estava em segundo plano, porque
  // aba nunca renderizada nao recebe evento de mouse. Aqui isso nao volta sem aviso.
  const ref = achados.match(/\[(\d+)\] link/)?.[1];
  check(Boolean(ref), `extraiu a ref do link: ${ref}`);
  await tool('browser_click', { ref: Number(ref) });
  await sleep(4000);
  const depois = (await tool('browser_read_page')).content[0].text;
  check(depois.includes('iana.org'), `clique por ref navegou (${depois.split('\n')[0]})`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  proc.kill();
}
