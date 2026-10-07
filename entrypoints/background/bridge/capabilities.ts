/**
 * Barril de compatibilidade: o codigo das capacidades mudou para
 * `./capacidades/*` (obra 01, docs/obra-20260904/01-refatoracao-registro-e-ganchos.md),
 * um arquivo por dominio. Este arquivo continua existindo para quem importava
 * de `./capabilities` nao precisar mudar.
 */
// Reexport nomeado (nao `export *`): cada arquivo de dominio tambem exporta
// `modulo` (o ModuloCapacidades que ele registra), e um `export *` duplicado
// vira ambiguidade de import (TS2308).
export { executarJs } from './capacidades/js';
export { preencherCampo, lerValorDoElemento, digitarTeclaATecla } from './capacidades/formulario';
export {
  paginaEmPdf, anexarArquivos, baixarComoBase64, lerCookies,
} from './capacidades/arquivos';
export { esperarRede } from './capacidades/rede';
export { emularAparelho, pararEmulacao } from './capacidades/emulacao';
