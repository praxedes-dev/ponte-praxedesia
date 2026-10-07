/**
 * Smoke test da ponte, sem depender da extensao estar conectada.
 *
 * Sobe o servidor MCP como um cliente de verdade faria (JSON-RPC por stdio),
 * lista as tools e chama browser_status. Verifica tambem a auto-eleicao:
 * o segundo processo tem de virar peer, nao morrer com a porta ocupada.
 *
 *   node test/smoke.js
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

function startClient(name) {
  const proc = spawn(process.execPath, [SERVER, '--name', name], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  let seq = 0;

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        entry(msg);
      }
    }
  });

  // O servidor so aceita JSON-RPC depois de escolher seu papel na ponte.
  // Esperar o sinal de pronto evita mandar o initialize no vazio.
  const stderr = [];
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  proc.stderr.on('data', (c) => {
    const text = c.toString();
    stderr.push(text);
    if (text.includes('pronto como')) markReady();
  });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error(`timeout em ${method}`)), 15_000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const notify = (method, params) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  };

  return { proc, call, notify, stderr, ready };
}

async function handshake(client) {
  await client.ready;
  await client.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '0.0.0' },
  });
  client.notify('notifications/initialized', {});
}

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const a = startClient('agente-A');
const b = startClient('agente-B');

try {
  await handshake(a);
  await handshake(b);

  const list = await a.call('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  // Contar tools e frágil: cada capacidade nova quebrava o teste sem motivo.
  // O que importa e o essencial estar exposto.
  const essenciais = [
    'browser_status', 'browser_read_page', 'browser_find', 'browser_click', 'browser_type',
    'browser_navigate', 'browser_javascript', 'browser_form_input', 'browser_upload_file',
    'browser_download', 'browser_save_pdf', 'browser_cookies', 'browser_use_tab',
  ];
  const faltando = essenciais.filter((n) => !names.includes(n));
  check(faltando.length === 0, `${names.length} tools expostas, nenhuma essencial faltando`,
    faltando.join(', '));

  // Nao da para exigir que um destes dois vire hub: se o Cezar tem uma sessao do
  // Claude Code aberta, ELA e o hub e os dois entram como peers. Isso e o sistema
  // funcionando, nao falha. O que precisa valer e que todos tenham papel definido
  // e enxerguem o mesmo estado da ponte.
  const status = async (cli) => JSON.parse(
    (await cli.call('tools/call', { name: 'browser_status', arguments: {} })).result.content[0].text,
  );
  const papeis = [await status(a), await status(b)];

  check(
    papeis.every((p) => p.papel === 'hub' || p.papel === 'peer'),
    `os dois assumiram um papel (${papeis.map((p) => p.papel).join(' / ')})`,
  );
  check(
    papeis.every((p) => typeof p.extensaoConectada === 'boolean'),
    'peer sabe dizer se a extensao esta conectada (perguntando ao hub)',
    papeis.map((p) => `${p.papel}=${p.extensaoConectada}`).join(' '),
  );

  const comAgentes = papeis.find((p) => Array.isArray(p.agentes));
  check(Boolean(comAgentes), `a ponte lista os agentes conectados: ${
    JSON.stringify(comAgentes?.agentes?.map((x) => x.name))}`);

  // O que precisa valer aqui e que a acao SEMPRE volta, nunca pendura. Se a
  // extensao estiver conectada ela executa; se nao, tem de vir erro com motivo.
  // (Antes o teste exigia erro, e passava so por acidente de a extensao estar fora.)
  const inicio = Date.now();
  const resposta = await a.call('tools/call', { name: 'browser_read_page', arguments: {} });
  const levou = Date.now() - inicio;
  const texto = resposta.result.content[0].text;

  check(levou < 90_000, `a acao respondeu em ${(levou / 1000).toFixed(1)}s, sem pendurar`);
  if (resposta.result.isError) {
    check(/extensao|hub/i.test(texto), 'sem extensao, o erro diz o motivo', texto.slice(0, 80));
  } else {
    check(texto.length > 0, 'com extensao conectada, a acao executou', texto.split('\n')[0]);
  }
} catch (err) {
  console.error('ERRO:', err.message);
  console.error('stderr A:', a.stderr.join(''));
  console.error('stderr B:', b.stderr.join(''));
  process.exitCode = 1;
} finally {
  a.proc.kill();
  b.proc.kill();
}
