/**
 * Empacota o freio, o motor, o resolvedor de alvo unico e as capacidades que
 * chamam `avaliar()` num ESM que roda em Node — insumo da bancada
 * `alvo-unico-bancada.mjs`. Nao toca em `.output/` nem na extensao: nao precisa
 * da `.obra-lock`.
 *
 *   node bridge-server/test/_obra25-bundle.mjs <saida.mjs>
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const saida = process.argv[2];
if (!saida) { console.error('uso: node _obra25-bundle.mjs <saida.mjs>'); process.exit(2); }

await esbuild.build({
  stdin: {
    contents: `
export { avaliar } from './entrypoints/background/bridge/policy';
export {
  executionEngine, resolverAlvoDaAcao, ACOES_COM_ALVO_UNICO,
  resolverAlvoDeClique, resolverAlvoDeSwitchTab, resolverAlvoDeCloseTab, resolveTarget,
} from './entrypoints/background/execution-engine';
export { debuggerManager } from './entrypoints/background/debugger-manager';
export { workspaceManager } from './entrypoints/background/workspace-manager';
export { modulo as moduloFormulario } from './entrypoints/background/bridge/capacidades/formulario';
export { modulo as moduloAutocomplete } from './entrypoints/background/bridge/capacidades/autocomplete';
export { modulo as moduloClique } from './entrypoints/background/bridge/capacidades/clique';
export { modulo as moduloFormularioLote } from './entrypoints/background/bridge/capacidades/formulario-lote';
`,
    resolveDir: RAIZ,
    sourcefile: 'entry-obra25.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: saida,
  logLevel: 'error',
});
console.log('bundle ok:', saida);
