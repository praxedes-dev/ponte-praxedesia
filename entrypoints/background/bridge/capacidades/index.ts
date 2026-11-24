import { debuggerManager } from '../../debugger-manager';
import { registrar, ganchos } from './registro';

import { modulo as js } from './js';
import { modulo as formulario } from './formulario';
import { modulo as clique } from './clique';
import { modulo as arquivos } from './arquivos';
import { modulo as rede } from './rede';
import { modulo as emulacao } from './emulacao';
import { modulo as dialogo } from './dialogo';
import { modulo as viewportGuarda } from './viewport-guarda';
import { modulo as selectNativo } from './select-nativo';
import { modulo as googleDocs } from './google-docs';
import { modulo as decisao } from './decisao';

// Stubs vazios, um por obra planejada (ver docs/obra-20260904/00-PLANO-DE-OBRA.md §3).
// Cada pedreiro preenche o seu `capacidades` e, se precisar, `ganchos` — sem
// tocar neste arquivo alem de existir aqui.
import { modulo as desafio } from './desafio';
import { modulo as esperaLogin } from './espera-login';
import { modulo as auditoria } from './auditoria';
import { modulo as uploadLote } from './upload-lote';
import { modulo as formularioLote } from './formulario-lote';
import { modulo as autocomplete } from './autocomplete';
import { modulo as abasFilhas } from './abas-filhas';
import { modulo as downloadNativo } from './download-nativo';
import { modulo as redeInspecao } from './rede-inspecao';
import { modulo as historico } from './historico';
import { modulo as ritmo } from './ritmo';
import { modulo as destaque } from './destaque';
import { modulo as assentar } from './assentar';
// Depois de `assentar` na lista abaixo DE PROPOSITO: a confirmacao do clique
// (esperar_texto/esperar_url) so comeca depois de a rede ter assentado.
import { modulo as confirmar } from './confirmar';
import { modulo as screenshotRecorte } from './screenshot-recorte';
import { modulo as consoleModulo } from './console';
import { modulo as feedback } from './feedback';
import { modulo as midia } from './midia';
import { modulo as seletorArquivo } from './seletor-arquivo';
// Por ultimo: o recibo (C1) olha o que assentar/confirmar ja deixaram para tras.
import { modulo as recibo } from './recibo';
// Ultimo: so contabiliza o que os outros modulos deixaram como resposta final.
import { modulo as consumoPonte } from './consumo-ponte';

/**
 * Registro central das capacidades da ponte.
 *
 * Importado (nao chamado) no carregamento do modulo, e nao dentro de
 * `start()`: o service worker MV3 dorme e acorda com um contexto novo, mas
 * quem acordou sem passar por `start()` ainda precisa ter tudo registrado.
 *
 * A ORDEM importa: e a ordem em que os ganchos `antes`/`depois` rodam.
 * Adicionar um modulo aqui e o unico jeito de ele entrar — nao existe
 * auto-registro por import.meta.glob de proposito, para a lista aparecer
 * inteira num `grep` so.
 */

/**
 * Erros de registro (nome duplicado ou sem prefixo `cap_`), um por modulo que
 * falhou. Conserto do achado da 2a rodada de vistoria (05/09/2026): antes,
 * `registrar()` throwing aqui, em escopo de modulo e sem try/catch, derrubava
 * o service worker inteiro no boot — um nome errado numa obra futura tirava a
 * ponte do ar para TODOS os agentes, e o caminho de conserto (reload pela
 * propria ponte) morria junto, sobrando so "o usuário clicar em Recarregar".
 *
 * Mantem o barulho (throw dentro de `registrar()`, log aqui) e tira o fatal:
 * um modulo que falha nao impede os outros de registrar nem a ponte de subir.
 * `cap_listar` (bridge/index.ts) expoe este array e `bridge-server/test/registro.js`
 * afirma que fica vazio — nome errado vira teste vermelho nomeando o modulo
 * culpado, em vez de erro mudo em "extensao nao esta conectada".
 */
export const errosDeRegistro: string[] = [];

for (const modulo of [
  js, formulario, clique, arquivos, rede, emulacao, dialogo, viewportGuarda,
  desafio, esperaLogin, auditoria, uploadLote, formularioLote, autocomplete, abasFilhas,
  downloadNativo, redeInspecao, historico, ritmo, destaque, assentar, confirmar,
  screenshotRecorte, consoleModulo, feedback, midia, seletorArquivo, selectNativo, googleDocs, decisao, recibo, consumoPonte,
]) {
  try {
    registrar(modulo);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Capacidades] falha ao registrar modulo — ponte continua de pe para os demais:', msg);
    errosDeRegistro.push(msg);
  }
}

// Liga os ganchos `aoAnexar` ao debugger-manager: rodam no attach() e tambem
// no reattach de send() (ver debugger-manager/index.ts), nao so na primeira vez.
for (const g of ganchos()) {
  if (g.aoAnexar) debuggerManager.aoAnexar(g.aoAnexar);
}

export * from './registro';
