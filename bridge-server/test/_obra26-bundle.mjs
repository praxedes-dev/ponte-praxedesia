/**
 * Empacota o freio, o motor, o resolvedor e as capacidades num ESM que roda em
 * Node — insumo da bancada `receptor-da-escrita-bancada.mjs` (obra 26).
 *
 * Irmao de `_obra25-bundle.mjs`; existe separado porque exporta tambem o que a
 * obra 26 precisa confrontar (`pressKeyEscreveTexto`, do freio, e `normaliseKey`
 * /`teclaImprimivel`, do motor) — e porque a obra 25 esta com pedreiro em cima
 * do arquivo dela. Nao toca em `.output/` nem na extensao: nao precisa da
 * `.obra-lock`.
 *
 *   node bridge-server/test/_obra26-bundle.mjs <saida.mjs>
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const saida = process.argv[2];
if (!saida) { console.error('uso: node _obra26-bundle.mjs <saida.mjs>'); process.exit(2); }

await esbuild.build({
  stdin: {
    contents: `
export { avaliar, pressKeyEscreveTexto } from './entrypoints/background/bridge/policy';
export {
  executionEngine, resolverAlvoDaAcao, ACOES_COM_ALVO_UNICO, efetivoEhCampoDigitavel,
  resolverAlvoDeClique, resolverAlvoDeSwitchTab, resolverAlvoDeCloseTab, resolveTarget,
} from './entrypoints/background/execution-engine';
export { normaliseKey, teclaImprimivel } from './entrypoints/background/execution-engine/cdp-tools';
export { debuggerManager } from './entrypoints/background/debugger-manager';
export { workspaceManager } from './entrypoints/background/workspace-manager';
export { modulo as moduloFormulario } from './entrypoints/background/bridge/capacidades/formulario';
export { modulo as moduloAutocomplete } from './entrypoints/background/bridge/capacidades/autocomplete';
export { modulo as moduloClique } from './entrypoints/background/bridge/capacidades/clique';
export { modulo as moduloFormularioLote } from './entrypoints/background/bridge/capacidades/formulario-lote';
`,
    resolveDir: RAIZ,
    sourcefile: 'entry-obra26.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: saida,
  logLevel: 'error',
});
console.log('bundle ok:', saida);
