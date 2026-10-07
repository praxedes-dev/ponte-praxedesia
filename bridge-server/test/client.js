/**
 * Cliente MCP minimo para os testes e utilitarios da ponte.
 * Fala JSON-RPC por stdio, do mesmo jeito que o Claude Code fala.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

export function startClient(name, { verbose = false } = {}) {
  const proc = spawn(process.execPath, [SERVER, '--name', name], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  const stderr = [];
  let buffer = '';
  let seq = 0;
  let markReady;
  const ready = new Promise((r) => { markReady = r; });

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
    stderr.push(text);
    if (verbose) process.stderr.write(text.replace(/^/gm, '    | '));
    // O servidor so aceita JSON-RPC depois de escolher seu papel na ponte.
    if (text.includes('pronto como')) markReady();
  });

  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error(`timeout em ${method}`)), 120_000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const handshake = async () => {
    await ready;
    await call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name, version: '0.0.0' },
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  };

  const tool = async (toolName, args = {}) => {
    const res = await call('tools/call', { name: toolName, arguments: args });
    if (res.result?.isError) throw new Error(`${toolName}: ${res.result.content[0].text}`);
    return res.result;
  };

  /** Atalho para tools que devolvem JSON como texto. */
  const json = async (toolName, args = {}) => JSON.parse((await tool(toolName, args)).content[0].text);

  return { proc, call, tool, json, handshake, ready, stderr, close: () => proc.kill() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a extensao aparecer no hub, ja que ela reconecta com backoff. */
export async function esperarExtensao(client, limiteMs = 90_000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const status = await client.json('browser_status');
    if (status.extensaoConectada === true) return true;
    await sleep(2000);
  }
  return false;
}
