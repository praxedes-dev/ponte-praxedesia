import * as esbuild from 'esbuild';
const RAIZ = process.argv[2];
const saida = process.argv[3];
await esbuild.build({
  stdin: {
    contents: `
export { avaliar } from './entrypoints/background/bridge/policy';
export { executionEngine, resolverAlvoDeClique, resolveTarget } from './entrypoints/background/execution-engine';
export { debuggerManager } from './entrypoints/background/debugger-manager';
export { modulo as moduloFormulario } from './entrypoints/background/bridge/capacidades/formulario';
`,
    resolveDir: RAIZ, sourcefile: 'entry-antes.ts', loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'neutral', outfile: saida, logLevel: 'error',
  nodePaths: ['C:/Users/Cezar/claudecode/PraxedesIA-v5/node_modules'],
});
console.log('bundle antes ok');
