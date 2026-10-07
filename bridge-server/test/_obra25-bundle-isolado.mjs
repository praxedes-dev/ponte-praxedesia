/**
 * Empacota a bancada a partir de uma ARVORE DADA (ex.: HEAD + so os arquivos
 * desta obra), para o resultado nao depender do que outro pedreiro tenha em
 * andamento na arvore de trabalho compartilhada.
 *   node test/_obra25-bundle-isolado.mjs <raiz> <saida.mjs>
 */
import * as esbuild from 'esbuild';
const [RAIZ, saida] = process.argv.slice(2);
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
    resolveDir: RAIZ, sourcefile: 'entry-isolado.ts', loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', outfile: saida, logLevel: 'error',
  nodePaths: ['C:/Users/Cezar/claudecode/PraxedesIA-v5/node_modules'],
});
console.log('bundle isolado ok:', saida);
