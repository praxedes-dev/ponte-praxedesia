/**
 * O mapa de tools mudou para `./tools/*.js` (obra 01,
 * docs/obra-20260904/01-refatoracao-registro-e-ganchos.md), um arquivo por
 * dominio. Este arquivo continua existindo para quem importava de `./tools.js`
 * nao precisar mudar.
 */
export { TOOLS, TOOL_BY_NAME } from './tools/index.js';
