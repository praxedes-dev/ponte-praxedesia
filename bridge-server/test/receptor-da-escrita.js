/**
 * RECEPTOR DA ESCRITA (obra 26) — quem USA a resolucao de alvo unico.
 *
 * Wrapper sem argumento nenhum: monta o bundle numa pasta temporaria e roda a
 * bancada `receptor-da-escrita-bancada.mjs`, repassando a saida. Existe para
 * esta cobertura poder entrar na lista `ARQUIVOS` de `test/todos.js` como
 * qualquer outro teste (`node test/<nome>.js`, sem argumento) — a bancada em si
 * precisa do caminho do bundle e por isso nao serve direto.
 *
 * NAO precisa da `.obra-lock`, nao mexe em `.output/` e nao fala com o Chrome:
 * roda o codigo REAL do freio, do motor e das capacidades contra um DOM
 * (linkedom) e um CDP simulado. E onde o mutation testing da obra 26 mede
 * (`_obra26-mutacoes.mjs`).
 *
 *   node test/receptor-da-escrita.js
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const AQUI = dirname(fileURLToPath(import.meta.url));
const bundle = join(mkdtempSync(join(tmpdir(), 'obra26-')), 'bundle.mjs');

const rodar = (args, herdar) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { stdio: herdar ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  if (!herdar) {
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
  }
  p.on('close', (code) => resolve({ code, saida }));
});

const b = await rodar([join(AQUI, '_obra26-bundle.mjs'), bundle], false);
if (b.code !== 0) {
  console.log(`ERRO nao consegui montar o bundle da bancada: ${b.saida.trim().slice(0, 300)}`);
  process.exit(1);
}

const r = await rodar([join(AQUI, 'receptor-da-escrita-bancada.mjs'), bundle], true);
process.exitCode = r.code ?? 1;
