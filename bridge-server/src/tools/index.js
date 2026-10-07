/**
 * Registro das tools MCP, um arquivo por dominio.
 *
 * Cada arquivo exporta TOOLS (array). A ordem de concatenacao aqui e por
 * DOMINIO (navegacao, interacao, leitura...), NAO a ordem historica do
 * `tools.js` monolitico de antes da obra 01
 * (docs/obra-20260904/01-refatoracao-registro-e-ganchos.md) — la a lista era
 * organica (ex.: `read_page, find, screenshot, navigate, click...`), sem
 * agrupar por dominio; aqui e o oposto (`navigate, tab_open, tab_switch,
 * tab_close, click...`). Reproduzir a ordem antiga exigiria fatiar um arquivo
 * de dominio ao meio so para intercalar (por exemplo, separar `read_page`/
 * `find` de `extract`/`clipboard_copy` dentro de leitura.js) — pioraria a
 * legibilidade sem ganho nenhum: nenhum teste ou cliente MCP depende de
 * posicao no array (`tools/list` nao promete ordem estavel; os testes
 * conferem por nome/Set — ver `bridge-server/test/registro.js`, `sameSet`).
 * Achado F5 do cetico (05/09/2026): o comentario antigo AFIRMAVA preservar a
 * ordem, o que era falso; preferimos consertar o comentario a fatiar arquivo.
 */
import { TOOLS as NAVEGACAO } from './navegacao.js';
import { TOOLS as INTERACAO } from './interacao.js';
import { TOOLS as LEITURA } from './leitura.js';
import { TOOLS as DIAGNOSTICO } from './diagnostico.js';
import { TOOLS as ESPERA } from './espera.js';
import { TOOLS as JS } from './js.js';
import { TOOLS as FORMULARIO } from './formulario.js';
import { TOOLS as ARQUIVOS } from './arquivos.js';
import { TOOLS as EMULACAO } from './emulacao.js';
import { TOOLS as PONTE } from './ponte.js';

// Stubs vazios, um por obra planejada. Cada pedreiro preenche o seu TOOLS,
// sem tocar neste arquivo alem de existir aqui.
import { TOOLS as DIALOGO } from './dialogo.js';
import { TOOLS as UPLOAD_LOTE } from './upload-lote.js';
import { TOOLS as AUTOCOMPLETE } from './autocomplete.js';
import { TOOLS as FORMULARIO_LOTE } from './formulario-lote.js';
import { TOOLS as ABAS_FILHAS } from './abas-filhas.js';
import { TOOLS as DOWNLOAD_NATIVO } from './download-nativo.js';
import { TOOLS as REDE_INSPECAO } from './rede-inspecao.js';
import { TOOLS as HISTORICO } from './historico.js';
import { TOOLS as AUDITORIA } from './auditoria.js';
// Obra 22 (acrescentada em 05/09/2026, fora dos 17 itens originais — por isso
// nao ganhou stub da obra 01): canal de feedback do agente. Ver feedback.js.
import { TOOLS as FEEDBACK } from './feedback.js';

export const TOOLS = [
  ...NAVEGACAO, ...INTERACAO, ...LEITURA, ...DIAGNOSTICO, ...ESPERA,
  ...JS, ...FORMULARIO, ...ARQUIVOS, ...EMULACAO, ...PONTE,
  ...DIALOGO, ...UPLOAD_LOTE, ...AUTOCOMPLETE, ...FORMULARIO_LOTE, ...ABAS_FILHAS,
  ...DOWNLOAD_NATIVO, ...REDE_INSPECAO, ...HISTORICO, ...AUDITORIA, ...FEEDBACK,
];

/**
 * Acoes que o freio da ponte pode barrar ganham `confirm` no proprio
 * inputSchema — e como o agente repete a acao depois de perguntar ao usuario.
 * Cada tool confirmavel se declara com `confirmavel: true` no seu proprio
 * arquivo de dominio; aqui so se aplica o efeito, sem precisar saber os nomes.
 */
for (const tool of TOOLS) {
  if (!tool.confirmavel) continue;
  tool.inputSchema.properties.confirm = {
    type: 'boolean',
    description:
      'Use apenas depois que o usuario confirmar uma acao que a ponte barrou '
      + '(site de banco, botao de excluir ou pagar). Nunca marque por conta propria.',
  };
}

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
