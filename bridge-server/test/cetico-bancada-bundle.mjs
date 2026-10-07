/**
 * Empacota o freio (`bridge/policy.ts`), o motor (`execution-engine/index.ts`)
 * e duas capacidades num unico ESM que roda em Node — insumo da bancada
 * `cetico-bancada-freio-motor.mjs`. Nao toca em `.output/` nem na extensao:
 * nao precisa da `.obra-lock`.
 *
 *   node bridge-server/test/cetico-bancada-bundle.mjs <saida.mjs>
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const saida = process.argv[2];
if (!saida) { console.error('uso: node cetico-bancada-bundle.mjs <saida.mjs>'); process.exit(2); }

await esbuild.build({
  stdin: {
    contents: `
export { avaliar } from './entrypoints/background/bridge/policy';
export { executionEngine, resolverAlvoDeClique, resolverAlvoDeSwitchTab, resolverAlvoDeCloseTab, resolveTarget } from './entrypoints/background/execution-engine';
export { debuggerManager } from './entrypoints/background/debugger-manager';
export { workspaceManager } from './entrypoints/background/workspace-manager';
export { modulo as moduloFormulario } from './entrypoints/background/bridge/capacidades/formulario';
export { modulo as moduloAutocomplete } from './entrypoints/background/bridge/capacidades/autocomplete';
`,
    resolveDir: RAIZ,
    sourcefile: 'entry-cetico.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: saida,
  logLevel: 'error',
});
console.log('bundle ok:', saida);
