import { debuggerManager as dm } from '../../debugger-manager';
import type { ModuloCapacidades } from './registro';
import { executarJs } from './js';

/**
 * Upload em lote que nao mente (obra 05, docs/obra-20260904/05-upload-em-lote-que-nao-mente.md).
 *
 * O incidente que isto existe para matar: no PJe a ref do input de arquivo
 * EXPIRA a cada lote — cada anexo re-renderiza a lista do Dropzone, e reusar a
 * ref antiga faz `DOM.setFileInputFiles` devolver sucesso SEM anexar nada (o
 * CDP nao erra em no que a pagina ja descartou). Assim sumiram 9 de 47
 * (CLIENTE A) e 4 de 20 (CLIENTE B) documentos em 19/08/2026 — um deles o
 * documento de identidade do cliente — com "sucesso" reportado em todos.
 *
 * A defesa, na mesma linha de `preencherCampo` (formulario.ts): nao confiar no
 * que o CDP diz que fez, e reler o estado real da pagina. Aqui isso significa
 * DUAS coisas, nao uma: (1) reachar o input POR SELETOR a cada lote, nunca por
 * ref/backendNodeId guardado de uma chamada anterior; (2) depois de cada lote,
 * contar e NOMEAR os itens que realmente apareceram na lista, na ordem, e
 * parar no primeiro lote que perdeu algum — nunca seguir para o proximo lote
 * com um relatorio parcial escondido dentro de um "ok".
 */

/** O <select> de tipo do anexo do PJe MENTE (documento sem tipo aplicado nao
 * existe no servidor mesmo aparecendo na tela) — por isso a obra que aplica o
 * tipo (form-fill) fica de fora daqui, e esta capacidade so confere a
 * ENTRADA na lista, nunca o tipo. */

const SELETOR_INPUT_PADRAO = 'input[type=file][multiple]';
const SELETOR_ITEM_PADRAO = '.dz-preview';
const SELETOR_NOME_PADRAO = '[data-dz-name]';
const SELETOR_OK_PADRAO = '.dz-success-mark';
const SELETOR_DESC_DOC_PADRAO = 'input[id$=":descDoc"]';
const TAMANHO_LOTE_PADRAO = 10;
const TIMEOUT_LOTE_MS_PADRAO = 30_000;

/**
 * Nome de arquivo comprido e recusado EM SILENCIO pelo PJe: sem erro, sem
 * mensagem, sem entrada no console — o arquivo simplesmente nunca aparece na
 * lista. Medido na skill protocolo-pje-ponte: 89 caracteres falhou, 57 passou.
 * O pre-voo usa 80 como limiar de corte.
 */
const LIMIAR_NOME_LONGO = 80;

interface ItemRelatorio {
  nome: string;
  /** null = nao ha lista nesta pagina para provar (modo sem lista). */
  entrou: boolean | null;
  motivo?: string;
}

interface RelatorioUploadLote {
  total: number;
  entraram: number | null;
  /** 'inexistente' = a pagina nao tem lista de anexos; quem prova e a tela do site. */
  lista?: 'inexistente';
  /** Nomes que o input de arquivo guardava logo depois de anexar (modo sem lista). */
  no_input?: string[];
  lotes: number;
  arquivos: ItemRelatorio[];
  parou_no_lote?: number;
  proximo_passo: string;
  aviso_seletor_padrao?: string;
}

/**
 * Mensagem do item 2 desta obra: os seletores padrao (`.dz-preview` etc.) sao
 * do Dropzone do PJe. Em outro site (ex.: Portal OAB, Angular) o mesmo
 * "0 itens encontrados" NAO PROVA que o upload falhou — so que o seletor nao
 * bate com o DOM daquele site. Sem esta mensagem, "nao apareceu na lista"
 * lia como falha de verdade em qualquer site, nao so no PJe (o que a
 * capacidade foi de fato medida contra). Nao inventamos o seletor do Portal
 * OAB aqui: so orientamos a passar seletor_item/seletor_ok/seletor_nome.
 */
function avisoSeletorPadrao(seletorItem: string, seletorOk?: string): string {
  return `nenhum item encontrado com o seletor padrao "${seletorItem}"`
    + (seletorOk ? ` (marcador de sucesso "${seletorOk}")` : '')
    + ' — este seletor e do DROPZONE DO PJe. Em outro site (ex.: Portal OAB, que e Angular) isto NAO '
    + 'PROVA que o upload falhou, so que o seletor nao bate com o DOM daquele site. Confira a tela '
    + 'manualmente e, se for outro site, repita passando seletor_item (e seletor_ok/seletor_nome, se '
    + 'aplicavel) do DOM real dele — nao ha seletor padrao conhecido para o Portal OAB ainda.';
}

interface ItemConferido {
  nome: string;
  ok: boolean;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Basename por `\` OU `/`. Sem depender do modulo `path` do Node — ele nao
 * existe no mundo da extensao (service worker de MV3), e este calculo nao
 * precisa dele: e so achar o ultimo separador.
 */
function basename(caminho: string): string {
  const partes = caminho.split(/[\\/]/).filter(Boolean);
  return partes.length > 0 ? partes[partes.length - 1] : caminho;
}

/**
 * Reacha o input de arquivo POR SELETOR — nunca por ref guardada — e anexa o
 * lote. Isto e o que substitui "ref nova": nao ha ref nenhuma para expirar.
 *
 * O CDP aceita `nodeId` (do dominio DOM) ou `backendNodeId` em
 * `DOM.setFileInputFiles`; usamos `nodeId` porque e o que `DOM.querySelector`
 * devolve direto, sem precisar resolver mais nada.
 */
async function anexarNoInput(tabId: number, seletorInput: string, caminhos: string[]): Promise<void> {
  const doc = await dm.send<{ root?: { nodeId: number } }>(tabId, 'DOM.getDocument', { depth: 0 });
  const rootId = doc?.root?.nodeId;
  if (!rootId) throw new Error('nao consegui ler o DOM da pagina (DOM.getDocument sem root)');

  const encontrado = await dm.send<{ nodeId?: number }>(tabId, 'DOM.querySelector', {
    nodeId: rootId,
    selector: seletorInput,
  });
  if (!encontrado?.nodeId) {
    throw new Error(
      `input de arquivo nao encontrado com o seletor "${seletorInput}" — reachado a cada lote de `
      + 'proposito (e a ref antiga que expira). Confira se e o input de MULTIPLOS anexos: o '
      + 'singular (sem "multiple") e o documento principal, outro campo.',
    );
  }

  await dm.send(tabId, 'DOM.setFileInputFiles', { nodeId: encontrado.nodeId, files: caminhos });
}

/**
 * Nomes de todos os itens da lista, na ordem em que aparecem no DOM.
 *
 * O nome em `[data-dz-name]` vem SUJO no primeiro preview (o template do
 * Dropzone deixa um `<script>` inline antes do texto do nome): o `textContent`
 * junta o codigo do script com o nome numa segunda linha. Por isso a ULTIMA
 * linha, sempre — nos itens seguintes (sem o script) a ultima linha e a unica.
 */
async function listarNomes(tabId: number, seletorItem: string, seletorNome: string): Promise<string[]> {
  const resultado = await executarJs(tabId, `
    (function(){
      var itens = document.querySelectorAll(${JSON.stringify(seletorItem)});
      var nomes = [];
      itens.forEach(function(it){
        var el = it.querySelector(${JSON.stringify(seletorNome)});
        var texto = el ? (el.textContent || '') : '';
        var linhas = texto.split('\\n');
        nomes.push(linhas[linhas.length - 1].trim());
      });
      return nomes;
    })()
  `);
  return Array.isArray(resultado) ? resultado.map((n) => String(n)) : [];
}

/**
 * Compara o que era esperado neste lote com o que realmente apareceu, NA
 * ORDEM — nunca por contagem. Contar so pega "entrou menos que o esperado";
 * comparar por posicao pega "um sumiu e outro entrou no lugar", porque cada
 * nome esperado so avanca o ponteiro dos nomes reais quando bate exatamente.
 * Um nome que falta nao desalinha os que vem depois dele.
 */
function compararEmOrdem(esperados: string[], atuais: string[], segundos: string): ItemRelatorio[] {
  const resultado: ItemRelatorio[] = [];
  let j = 0;
  for (const nome of esperados) {
    if (j < atuais.length && atuais[j] === nome) {
      resultado.push({ nome, entrou: true });
      j += 1;
    } else {
      const motivo = nome.length >= LIMIAR_NOME_LONGO
        ? `nao apareceu na lista em ${segundos}s (nome com ${nome.length} caracteres — provavel `
          + 'recusa silenciosa do PJe por nome comprido)'
        : `nao apareceu na lista em ${segundos}s`;
      resultado.push({ nome, entrou: false, motivo });
    }
  }
  return resultado;
}

export async function executarUploadLote(
  tabId: number,
  caminhosBrutos: string[],
  opcoes: {
    seletorInput?: string;
    tamanhoLote?: number;
    seletorItem?: string;
    seletorNome?: string;
    timeoutLoteMs?: number;
    forcar?: boolean;
    /** false = site que nao e PJe (Gemini etc.): entrega e volta, sem esperar lista (26/09/2026). */
    conferirLista?: boolean;
  } = {},
): Promise<RelatorioUploadLote> {
  const caminhos = caminhosBrutos.map((c) => String(c));
  if (caminhos.length === 0) throw new Error('informe ao menos um caminho em "caminhos"');

  const seletorInput = opcoes.seletorInput || SELETOR_INPUT_PADRAO;
  const seletorItem = opcoes.seletorItem || SELETOR_ITEM_PADRAO;
  const seletorNome = opcoes.seletorNome || SELETOR_NOME_PADRAO;
  const tamanhoLote = Number(opcoes.tamanhoLote || TAMANHO_LOTE_PADRAO);
  const timeoutLoteMs = Number(opcoes.timeoutLoteMs || TIMEOUT_LOTE_MS_PADRAO);
  const forcar = opcoes.forcar === true;

  const nomes = caminhos.map(basename);

  // Pre-voo: nome >= 80 caracteres e recusa calada. Barrar ANTES de tocar no
  // input evita o sintoma classico (sucesso reportado, documento sumido) —
  // sem isto o defeito so aparece la na frente, na conferencia manual.
  const compridos = nomes
    .map((nome, i) => ({ nome, i }))
    .filter((x) => x.nome.length >= LIMIAR_NOME_LONGO);
  if (compridos.length > 0 && !forcar) {
    throw new Error(
      `[pre-voo] ${compridos.length} arquivo(s) com nome >= ${LIMIAR_NOME_LONGO} caracteres seriam `
      + 'recusados EM SILENCIO pelo PJe (sem erro, sem mensagem, o arquivo so nunca aparece na '
      + `lista): ${compridos.map((x) => `"${x.nome}" (${x.nome.length} chars)`).join(', ')}. `
      + 'Renomeie o(s) arquivo(s), ou repita com forcar: true para tentar mesmo assim (relatorio '
      + 'vira erro, com o que entrou e o que nao).',
    );
  }

  // Modo sem lista (23/09/2026, 29 relatos de "nao apareceu na lista" em upload
  // que tinha dado certo). Input de arquivo UNICO (documento principal do PJe,
  // PDF do Portal OAB — os dois casos medidos) nunca gera item de lista:
  // esperar ".dz-preview" ali e esperar o que nunca vai nascer, e o "erro"
  // resultante mentia. So vale quando o agente NAO passou seletor_item — se
  // passou, ele disse qual e a lista e ela e conferida normalmente.
  //
  // NAO se estende a "input multiplo em pagina sem classe de Dropzone": a
  // bateria test/upload-lote.js (Dropzone de mentira, sem .dropzone) mostrou
  // que isso desligaria a conferencia num Dropzone de verdade que nao tenha a
  // classe — e a conferencia desligada e o incidente CLIENTE A de volta.
  if (!opcoes.seletorItem) {
    const sonda = await executarJs(tabId, `
      (function(){
        var inp = document.querySelector(${JSON.stringify(seletorInput)});
        return {
          input: !!inp,
          multiplo: !!(inp && inp.multiple),
        };
      })()
    `) as { input?: boolean; multiplo?: boolean } | null;

    if (sonda?.input && (!sonda.multiplo || opcoes.conferirLista === false)) {
      if (!sonda.multiplo && caminhos.length > 1) {
        throw new Error(
          `o input "${seletorInput}" aceita UM arquivo so (sem "multiple") e vieram ${caminhos.length}. `
          + 'Nada foi anexado. Mande um por vez, ou aponte seletor_input para o campo de multiplos anexos.',
        );
      }
      await anexarNoInput(tabId, seletorInput, caminhos);
      await esperar(300);
      const noInput = await executarJs(tabId, `
        (function(){
          var inp = document.querySelector(${JSON.stringify(seletorInput)});
          return inp && inp.files ? Array.prototype.map.call(inp.files, function(f){ return f.name; }) : [];
        })()
      `);
      const nomesNoInput = Array.isArray(noInput) ? noInput.map((n) => String(n)) : [];
      const porque = opcoes.conferirLista === false
        ? 'conferir_lista: false (site que nao e o PJe)'
        : `o input "${seletorInput}" e de arquivo UNICO`;
      return {
        total: caminhos.length,
        entraram: null,
        lista: 'inexistente',
        no_input: nomesNoInput,
        lotes: 1,
        arquivos: nomes.map((nome) => ({
          nome,
          entrou: null,
          motivo: nomesNoInput.includes(nome)
            ? 'entregue ao input; sem lista nesta pagina para provar que o site aceitou'
            : 'entregue ao input (o site ja consumiu e limpou o campo, o que e normal); sem lista para provar',
        })),
        proximo_passo: `arquivo entregue. Nao ha lista de anexos para conferir (${porque}), entao quem `
          + 'prova que o site aceitou e a PROPRIA TELA: confira o sinal dele (nome do arquivo, barra em '
          + '100%, botao que habilita, pagina que avanca). Isto nao e falha.',
      };
    }
  }

  const relatorio: ItemRelatorio[] = nomes.map((nome) => ({ nome, entrou: false }));
  const totalLotes = Math.max(1, Math.ceil(caminhos.length / tamanhoLote));
  let entraram = 0;
  let parouNoLote: number | undefined;

  for (let lote = 0; lote < totalLotes; lote += 1) {
    const inicio = lote * tamanhoLote;
    const fim = Math.min(inicio + tamanhoLote, caminhos.length);
    const caminhosDoLote = caminhos.slice(inicio, fim);
    const nomesDoLote = nomes.slice(inicio, fim);
    const numeroLote = lote + 1;

    // N0: conta ANTES de anexar. Nao e so deste lote — inclui qualquer item ja
    // presente de uma chamada anterior desta mesma tool na mesma pagina.
    const antes = await listarNomes(tabId, seletorItem, seletorNome);
    const n0 = antes.length;
    const alvo = n0 + caminhosDoLote.length;

    await anexarNoInput(tabId, seletorInput, caminhosDoLote);

    const inicioEspera = Date.now();
    let atuais = antes;
    while (Date.now() - inicioEspera < timeoutLoteMs) {
      // Laco de espera no service worker (setTimeout entre evaluates curtos),
      // NUNCA dentro da pagina: Runtime.evaluate e browser_javascript tem teto.
      atuais = await listarNomes(tabId, seletorItem, seletorNome);
      if (atuais.length >= alvo) break;
      await esperar(500);
    }
    const segundos = ((Date.now() - inicioEspera) / 1000).toFixed(1);

    const novosNomes = atuais.slice(n0);
    const comparacao = compararEmOrdem(nomesDoLote, novosNomes, segundos);

    for (let i = 0; i < comparacao.length; i += 1) {
      relatorio[inicio + i] = comparacao[i];
      if (comparacao[i].entrou) entraram += 1;
    }

    const faltouAlgum = comparacao.some((c) => !c.entrou);
    if (faltouAlgum) {
      parouNoLote = numeroLote;
      // Os lotes seguintes nunca foram enviados — o relatorio tem de mostrar
      // os dois lados (o que entrou E o que nao), nao so parar mudo.
      for (let i = fim; i < caminhos.length; i += 1) {
        relatorio[i] = { nome: nomes[i], entrou: false, motivo: 'nao enviado (lote anterior falhou)' };
      }
      break;
    }
  }

  // "Nada entrou nem 1 arquivo, com o seletor PADRAO": o sintoma classico de
  // seletor errado para o site (nao de upload que falhou de verdade) — so
  // quando o seletor NAO foi passado pelo agente (senao a explicacao do PJe
  // nao faz sentido: ele escolheu o proprio seletor).
  const usouSeletorPadrao = !opcoes.seletorItem;
  const nadaEntrouAlgumaVez = entraram === 0 && relatorio.every((r) => !r.entrou);

  const resposta: RelatorioUploadLote = {
    total: caminhos.length,
    entraram,
    lotes: totalLotes,
    arquivos: relatorio,
    ...(parouNoLote !== undefined ? { parou_no_lote: parouNoLote } : {}),
    proximo_passo: parouNoLote !== undefined
      ? 'upload incompleto: corrija o(s) arquivo(s) que faltaram (nome/tamanho) e repita so esses — '
        + 'os que ja entraram nao precisam ser reenviados.'
      : 'aplique o tipo de cada arquivo com browser_form_fill (ou browser_form_input) — o <select> de '
        + 'tipo e o que grava no servidor — e confira com browser_upload_verify antes de assinar.',
    ...(parouNoLote !== undefined && nadaEntrouAlgumaVez && usouSeletorPadrao
      ? { aviso_seletor_padrao: avisoSeletorPadrao(seletorItem) }
      : {}),
  };

  // Defeito irmao a nao cometer: devolver "ok" com relatorio parcial em texto
  // de sucesso. O agente le "ok" e segue. Faltou um -> isto tem de ser ERRO,
  // com o relatorio inteiro dentro da mensagem (quem le precisa ver os dois lados).
  if (parouNoLote !== undefined) {
    throw new Error(JSON.stringify(resposta, null, 2));
  }
  return resposta;
}

/**
 * Le o check verde pela OPACITY — nunca por `offsetParent`/visibilidade.
 * `dz-success-mark` e `dz-error-mark` convivem no mesmo lugar do DOM e os dois
 * passam em `offsetParent !== null`; so a opacity distingue qual esta "ligado".
 * Nao altera a pagina.
 */
export async function executarUploadConferir(
  tabId: number,
  opcoes: {
    seletorItem?: string;
    seletorOk?: string;
    seletorNome?: string;
    seletorNomeFallback?: string;
  } = {},
): Promise<ItemConferido[]> {
  const seletorItem = opcoes.seletorItem || SELETOR_ITEM_PADRAO;
  const seletorOk = opcoes.seletorOk || SELETOR_OK_PADRAO;
  const seletorNomePrincipal = opcoes.seletorNome || SELETOR_DESC_DOC_PADRAO;
  const seletorNomeFallback = opcoes.seletorNomeFallback || SELETOR_NOME_PADRAO;

  const resultado = await executarJs(tabId, `
    (function(){
      var itens = document.querySelectorAll(${JSON.stringify(seletorItem)});
      var out = [];
      itens.forEach(function(it){
        var okEl = it.querySelector(${JSON.stringify(seletorOk)});
        var op = okEl ? parseFloat(getComputedStyle(okEl).opacity) : 0;
        var ok = !isNaN(op) && op > 0.9;

        var principal = it.querySelector(${JSON.stringify(seletorNomePrincipal)});
        var nome;
        if (principal && 'value' in principal && principal.value) {
          nome = principal.value;
        } else {
          var fallback = it.querySelector(${JSON.stringify(seletorNomeFallback)});
          var texto = fallback ? (fallback.textContent || '') : '';
          var linhas = texto.split('\\n');
          nome = linhas[linhas.length - 1].trim();
        }
        out.push({ nome: nome, ok: ok });
      });
      return out;
    })()
  `);

  const itens = Array.isArray(resultado) ? (resultado as ItemConferido[]) : [];

  // Mesmo aviso do item acima, aqui pro CONFERIR (browser_upload_verify): 0
  // itens com o seletor padrao pode ser upload que falhou de verdade no PJe,
  // OU pode ser outro site (Portal OAB) onde ".dz-preview" nunca vai bater.
  // So dispara quando o agente NAO passou seletor proprio — se ele passou, 0
  // itens e resposta legitima (lista vazia de verdade) e nao merece aviso.
  if (itens.length === 0 && !opcoes.seletorItem) {
    throw new Error(avisoSeletorPadrao(seletorItem, seletorOk));
  }

  return itens;
}

export const modulo: ModuloCapacidades = {
  nome: 'upload-lote',
  capacidades: [
    {
      nome: 'cap_upload_lote',
      altera: true,
      executar: (ctx) => {
        const p = ctx.params;
        const caminhos = (Array.isArray(p.caminhos) ? p.caminhos : []) as string[];
        return executarUploadLote(ctx.tabId, caminhos, {
          seletorInput: p.seletor_input as string | undefined,
          tamanhoLote: p.tamanho_lote as number | undefined,
          seletorItem: p.seletor_item as string | undefined,
          seletorNome: p.seletor_nome as string | undefined,
          timeoutLoteMs: p.timeout_lote_ms as number | undefined,
          forcar: p.forcar as boolean | undefined,
          conferirLista: p.conferir_lista as boolean | undefined,
        });
      },
    },
    {
      nome: 'cap_upload_conferir',
      executar: (ctx) => {
        const p = ctx.params;
        return executarUploadConferir(ctx.tabId, {
          seletorItem: p.seletor_item as string | undefined,
          seletorOk: p.seletor_ok as string | undefined,
          seletorNome: p.seletor_nome as string | undefined,
          seletorNomeFallback: p.seletor_nome_fallback as string | undefined,
        });
      },
    },
  ],
};
