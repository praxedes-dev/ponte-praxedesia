import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.praxedes-bridge');
const TOKEN_FILE = join(CONFIG_DIR, 'token');

/**
 * Token de pareamento entre os agentes e a extensao. Fica em disco para que
 * todo agente deste PC leia o mesmo valor sem ninguem precisar configurar nada;
 * a extensao pede ele uma vez e guarda no chrome.storage.
 */
export function getToken() {
  if (process.env.PRAXEDES_BRIDGE_TOKEN) return process.env.PRAXEDES_BRIDGE_TOKEN;

  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved) return saved;
  }

  const token = randomBytes(16).toString('hex');
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, token + '\n', { encoding: 'utf8', mode: 0o600 });
  return token;
}
