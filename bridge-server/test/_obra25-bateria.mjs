/**
 * Roda a lista de regressao desta obra (alvo unico freio x motor) em serie e
 * imprime um placar compacto. Mesmo espirito de `test/todos.js` (que eu nao
 * posso editar): sempre vai ate o fim, nunca esconde falha atras da primeira.
 *
 *   node test/_obra25-bateria.mjs            # lista de regressao do briefing
 *   node test/_obra25-bateria.mjs a b c      # so os arquivos pedidos
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));

const PADRAO = [
  'isolamento', 'aba-sumiu', 'adotar-aba', 'freio-aba', 'close-tab-alvo',
  'cetico-switch-tab-alvo', 'cetico-click-alvo', 'cetico-quarto-furo',
  'click-semantico-legitimo', 'type-senha-alvo', 'press-key-senha-alvo',
  'furo5-cap-digitar-sem-ref', 'form-fantasma-e-senha', 'form-fill',
  'digitacao-real', 'autocomplete', 'clique-que-nao-mente', 'freio-clique-xy',
  'clique-assentar', 'smoke', 'e2e',
];

const ARQUIVOS = process.argv.slice(2).length ? process.argv.slice(2) : PADRAO;

const rodar = (nome) => new Promise((resolve) => {
  const inicio = Date.now();
  const p = spawn(process.execPath, [join(AQUI, `${nome}.js`)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  p.stdout.on('data', (d) => { saida += d; });
  p.stderr.on('data', (d) => { saida += d; });
  p.on('close', (code) => {
    const linhas = saida.split('\n');
    resolve({
      nome,
      ok: linhas.filter((l) => l.startsWith('OK')).length,
      falhas: linhas.filter((l) => l.startsWith('FALHA') || l.startsWith('ERRO')),
      code,
      ms: Date.now() - inicio,
    });
  });
});

let totalOk = 0;
const problemas = [];
for (const nome of ARQUIVOS) {
  const r = await rodar(nome);
  totalOk += r.ok;
  const marca = r.falhas.length === 0 && r.code === 0 ? 'ok   ' : 'FALHA';
  console.log(`${marca} ${nome.padEnd(34)} ${String(r.ok).padStart(3)} verificacoes  ${(r.ms / 1000).toFixed(1)}s`);
  for (const f of r.falhas) {
    console.log(`        ${f.trim()}`);
    problemas.push(`${nome}: ${f.trim()}`);
  }
}
console.log(`\n=== ${totalOk} verificacoes OK, ${problemas.length} problema(s) ===`);
if (problemas.length) process.exitCode = 1;
