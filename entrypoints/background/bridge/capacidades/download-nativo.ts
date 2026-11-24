import type { ContextoCapacidade, ModuloCapacidades } from './registro';
import { baixarComoBase64 } from './arquivos';
import { debuggerManager as dm } from '../../debugger-manager';
import { executarJs } from './js';

/**
 * Download nativo (obra 08, docs/obra-20260904/08-abas-filhas-download-nativo-e-aba-do-usuario.md)
 * — PLANO C (06/09/2026, com autorizacao explicita do usuário).
 *
 * Existe para o caso em que o Chrome baixa um arquivo SOZINHO — clique em
 * "Imprimir boletos" do PJe, um `<a download>`, um `blob:` gerado por JS —
 * sem URL que `cap_baixar` (arquivos.ts, que busca por fora com `fetch`)
 * consiga usar.
 *
 * MEDIDO na obra 08 (05/09/2026): os dois metodos CDP de download por sessao
 * de aba NAO EXISTEM nesta versao do Chrome —
 * `Browser.setDownloadBehavior` devolve -32601 "wasn't found";
 * `Page.setDownloadBehavior` devolve -32000 "Cannot not access browser-level
 * commands". Confirmado de novo nesta obra (06/09/2026, mesma bancada, ver
 * relatorio) antes de escrever este arquivo. Sobra o Plano C: a API
 * `chrome.downloads` (permissao nova em `wxt.config.ts`).
 *
 * DESENHO (por que fica assim, nao do jeito CDP de antes):
 *
 * 1. `chrome.downloads.DownloadItem` NAO TEM `tabId`. Nao ha, na API publica,
 *    como saber DE QUE ABA um download comecou — nem em `onCreated`, nem em
 *    `onDeterminingFilename`, nem em `onChanged`. O desenho antigo (CDP) era
 *    por SESSAO DE ABA; este e OBRIGATORIAMENTE por PROCESSO DE EXTENSAO
 *    INTEIRO. `cap_download_armar` continua recebendo um `tabId` (para a API
 *    externa nao mudar) mas so usa isso para registro/diagnostico — quem
 *    decide QUAL download e "o armado" e uma FILA GLOBAL por ordem de chegada
 *    (FIFO), consumida no primeiro download que comecar depois do armar.
 *
 * 2. RISCO MEDIDO E ACEITO, nao escondido: como o gancho e global, um
 *    download que o PROPRIO usuário disparar (ex.: na aba Jus IA) ENQUANTO
 *    um agente estiver armado tambem entraria na fila e SERIA desviado para
 *    a pasta de staging da ponte. Mitigacao (nao eliminacao — a API nao da
 *    para eliminar): `TTL_ARMAR_MS` curto (a arma expira sozinha se nenhum
 *    download comecar) e consumo DE UM SO TIRO (a entrada sai da fila no
 *    instante em que e usada). Ver relatorio da obra para o texto exato desta
 *    ressalva — o usuário/capataz decide se isso e aceitavel caso a caso.
 *
 * 3. `chrome.downloads.onDeterminingFilename` so aceita `filename` RELATIVO
 *    a pasta de Downloads REAL do Chrome (path absoluto, vazio ou com ".." e
 *    ignorado pela propria API — nao e limitacao nossa, e da plataforma). Ou
 *    seja: NAO HA COMO mandar o Chrome gravar direto numa pasta arbitraria
 *    (`~/.praxedes-bridge/downloads`, um `tmpdir()` de teste, etc.) que fique
 *    fora da pasta de Downloads do usuario. Resolvido em DUAS ETAPAS:
 *      a. O Chrome grava numa SUBPASTA DE STAGING, com nome unico por armar
 *         (`.praxedes-bridge-staging/<token>/`), dentro da SUA PROPRIA pasta
 *         de Downloads real — e essa etapa so serve para (i) suprimir o
 *         dialogo de "Salvar como" e (ii) isolar, uns dos outros, os arquivos
 *         de comandos `cap_download_armar` concorrentes.
 *      b. `cap_download_esperar` devolve o caminho ABSOLUTO real que o
 *         Chrome usou (`DownloadItem.filename` — o unico campo desta API que
 *         e path absoluto de verdade). O SERVIDOR (`download-nativo.js`, que
 *         tem disco de verdade nesta mesma maquina) e quem MOVE o arquivo da
 *         pasta de staging para a pasta que o agente pediu, e confere com
 *         `statSync` depois. A extensao nunca escreve fora da pasta de
 *         Downloads do Chrome — nao tem como, nem devia.
 */

/** Quanto tempo um `cap_download_armar` fica valido sem nenhum download comecar. */
const TTL_ARMAR_MS = 20_000;

/** Prefixo (relativo a pasta de Downloads REAL do Chrome) onde tudo desta ponte cai. */
const SUBPASTA_STAGING = '.praxedes-bridge-staging';

interface Armado {
  tabId: number;
  token: string;
  /** Pasta que o AGENTE pediu (arbitraria) — so passa por aqui, nunca e usada para escrever nada. */
  pastaPedida: string;
  subpastaRelativa: string;
  quando: number;
  expiraEm: number;
}

interface Consumido {
  downloadId: number;
  /** Nome que o Chrome sugeriu (Content-Disposition), guardado antes de qualquer janela. */
  nome: string;
  /** Arquivo ja buscado pela aba, sem janela (ver desviarDaJanela). */
  desvio?: Desvio;
  /** Por que o desvio nao deu (o download seguiu pelo Chrome). */
  porqueSemDesvio?: string;
  subpastaRelativa: string;
  pastaPedida: string;
  quando: number;
}

/** Fila FIFO dos `cap_download_armar` ainda sem download atribuido. Normalmente 0 ou 1 item. */
let fila: Armado[] = [];

/** tabId -> consumo (preenchido pelo listener global quando um download "casa" com um armado). */
const consumidoPorTab = new Map<number, Consumido>();

type Desvio = { pasta: string; nome: string; bytes: number; url: string; base64: string; sem_janela: true; via?: 'resposta' | 'aba' };

/** tabId -> arquivo capturado na RESPOSTA, antes de virar download (ver armarCaptura). */
const capturadoPorTab = new Map<number, Desvio>();
const desligarCaptura = new Map<number, () => void>();
/** tabId -> por que o arquivo capturado nao serve (vazio, cortado). O esperar devolve como erro. */
const falhaDeCaptura = new Map<number, string>();

function nomeDoCabecalho(cd: string, url: string): string {
  const estrela = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(cd);
  if (estrela) { try { return decodeURIComponent(estrela[1].trim().replace(/"/g, '')); } catch { /* segue */ } }
  const simples = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  if (simples) return simples[1].trim();
  return ultimaParteDoCaminho(url.split('?')[0].split('#')[0]) || 'arquivo-baixado';
}

/**
 * CAPTURA NA RESPOSTA (23/09/2026, pedido do usuário: a pergunta "onde
 * salvar" fica para ele, nunca para o agente). Enquanto o download esta
 * ARMADO, a aba passa pelo dominio Fetch do CDP na fase de RESPOSTA: quando
 * chega um documento que e arquivo (Content-Disposition attachment, ou PDF/
 * binario numa navegacao), a ponte pega os bytes ali mesmo e ABORTA a
 * requisicao. O download nunca nasce, entao a janela "Salvar como" nunca
 * abre, e nada e repetido: serve para formulario POST (a guia de custas do
 * TJ-RO e um .jsf por POST; repetir o POST emitiria outra guia). Requisicao
 * de script da pagina (XHR/fetch) nunca e tocada: so Document e Other.
 */
async function armarCaptura(tabId: number, pasta: string): Promise<void> {
  desligarCaptura.get(tabId)?.();
  capturadoPorTab.delete(tabId);
  falhaDeCaptura.delete(tabId);

  let ligado = true;
  const desligar = () => {
    if (!ligado) return;
    ligado = false;
    off();
    clearTimeout(timer);
    desligarCaptura.delete(tabId);
    dm.send(tabId, 'Fetch.disable', {}).catch(() => {});
  };

  const off = dm.on(tabId, 'Fetch.requestPaused', (p) => {
    const requestId = p.requestId as string;
    const seguir = () => dm.send(tabId, 'Fetch.continueRequest', { requestId }).catch(() => {});
    (async () => {
      const status = Number(p.responseStatusCode ?? 0);
      const headers = (p.responseHeaders as Array<{ name: string; value: string }> | undefined) ?? [];
      const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? '';
      const cd = h('content-disposition');
      const ct = h('content-type');
      const ehArquivo = status >= 200 && status < 300 && (
        /attachment/i.test(cd)
        || /^(application\/(pdf|octet-stream|zip|x-zip|vnd\.|msword|x-msdownload)|image\/|audio\/|video\/)/i.test(ct)
      );
      if (!ligado || !ehArquivo) return seguir();
      // Daqui em diante e ARQUIVO. Se vier com defeito (vazio, cortado, corpo
      // ilegivel), NAO se devolve ao Chrome: ele abriria a janela "Salvar como"
      // na tela do usuário (aconteceu nas baterias de 30/09/2026). Aborta e
      // o browser_download_wait responde o motivo.
      const url0 = String((p.request as { url?: string } | undefined)?.url ?? '');
      const recusar = async (motivo: string) => {
        falhaDeCaptura.set(tabId, `${motivo} (${url0.slice(0, 120)})`);
        fila = fila.filter((a) => a.tabId !== tabId);
        await dm.send(tabId, 'Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {});
        desligar();
      };
      let corpo: { body: string; base64Encoded: boolean };
      try {
        corpo = await dm.send<{ body: string; base64Encoded: boolean }>(tabId, 'Fetch.getResponseBody', { requestId });
      } catch (err) {
        return recusar(`o site cortou o arquivo no meio (${String((err as Error)?.message ?? err).slice(0, 80)})`);
      }
      const base64 = corpo.base64Encoded
        ? corpo.body
        : (() => {
          // Texto (sem base64Encoded): em pedacos, que spread de array grande estoura a pilha.
          const u = new TextEncoder().encode(corpo.body);
          let bin = '';
          for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
          return btoa(bin);
        })();
      const bytes = bytesDoBase64(base64);
      const declarado = Number(h('content-length'));
      if (bytes === 0) return recusar('o site respondeu o arquivo com 0 bytes');
      if (declarado > 0 && declarado !== bytes) return recusar(`arquivo cortado: vieram ${bytes} de ${declarado} bytes`);
      const url = url0;
      capturadoPorTab.set(tabId, { pasta, nome: nomeDoCabecalho(cd, url), bytes, url, base64, sem_janela: true, via: 'resposta' });
      // O armado desta aba ja foi atendido: tira da fila global para nao
      // desviar o proximo download do usuário.
      fila = fila.filter((a) => a.tabId !== tabId);
      await dm.send(tabId, 'Fetch.failRequest', { requestId, errorReason: 'Aborted' }).catch(() => {});
      desligar();
    })().catch(() => { seguir(); });
  });
  const timer = setTimeout(desligar, TTL_ARMAR_MS + 60_000);
  desligarCaptura.set(tabId, desligar);

  await dm.send(tabId, 'Fetch.enable', {
    patterns: [
      { urlPattern: '*', requestStage: 'Response', resourceType: 'Document' },
      { urlPattern: '*', requestStage: 'Response', resourceType: 'Other' },
    ],
  });
}

function limparExpirados(agora = Date.now()): void {
  fila = fila.filter((a) => a.expiraEm > agora);
}

/** Ultima parte de um path (Windows `\` ou POSIX `/`), sem depender de node:path — isto roda no browser. */
function ultimaParteDoCaminho(caminho: string | undefined | null): string {
  if (!caminho) return '';
  const partes = String(caminho).split(/[\\/]/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : '';
}

function nomeSugeridoDe(item: chrome.downloads.DownloadItem): string {
  const doArquivo = ultimaParteDoCaminho(item.filename);
  if (doArquivo) return doArquivo;
  const urlBase = (item.finalUrl || item.url || '').split('?')[0].split('#')[0];
  const daUrl = ultimaParteDoCaminho(urlBase);
  if (daUrl) {
    try {
      return decodeURIComponent(daUrl);
    } catch {
      return daUrl;
    }
  }
  return 'arquivo-baixado';
}

chrome.tabs.onRemoved.addListener((tabId) => {
  fila = fila.filter((a) => a.tabId !== tabId);
  consumidoPorTab.delete(tabId);
});

/**
 * Registrado UMA VEZ, no carregamento do modulo (nao dentro de `start()` nem
 * de nenhum `aoAnexar`) — o listener e do PROCESSO da extensao, nao de uma
 * aba, e o service worker MV3 precisa dele no escopo top-level para
 * sobreviver a um restart do worker (mesmo padrao do `chrome.tabs.onRemoved`
 * acima). "Cada extensao pode registrar no maximo UM listener deste evento"
 * (doc da API) — este e o unico, em todo o codebase.
 */
// GUARDA DE SOBREVIVENCIA (06/09/2026): sem a permissao `downloads` no
// manifest, `chrome.downloads` vem `undefined` e este acesso no escopo do
// modulo lanca. Como `capacidades/index.ts` importa este arquivo
// incondicionalmente, o throw derrubava o SERVICE WORKER INTEIRO — a ponte
// inteira saia do ar, nao so o download. Aconteceu em producao hoje: o build
// levou este codigo antes de a permissao entrar no manifest.
// Com a guarda, falta de permissao degrada so ESTA capacidade.
if (!chrome.downloads?.onDeterminingFilename) {
  console.warn(
    '[download-nativo] permissao "downloads" ausente no manifest — '
    + 'browser_download_arm/wait ficam indisponiveis. O resto da ponte segue normal.',
  );
} else {
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  limparExpirados();
  // FIFO: o armado mais ANTIGO ainda pendente e quem "ganha" este download.
  // Sem tabId em DownloadItem, nao ha como fazer melhor que ordem de chegada
  // (ver nota de risco no cabecalho do arquivo).
  const candidato = fila[0];
  if (!candidato) {
    // Download que NAO e desta ponte (nenhum armar pendente): nao mexe em nada.
    // NAO chamar suggest() e NAO devolver true — o listener retorna sem decidir e
    // o Chrome (ou outra extensao) escolhe o nome. Chamar suggest() aqui, mesmo
    // sem argumento, contava como decisao desta extensao: com duas pontes
    // instaladas (v6 e v6.1 dev) o Chrome acusava "Falha ao nomear o download
    // com esta extensao, porque outra extensao determinou um nome diferente" em
    // TODO download, ate nos do proprio usuário (21/10/2026).
    return;
  }

  fila = fila.filter((a) => a !== candidato); // consumo de UM SO TIRO, antes de qualquer outra coisa
  const nome = nomeSugeridoDe(item);
  const alvo = `${candidato.subpastaRelativa}/${nome}`;

  const consumo: Consumido = {
    downloadId: item.id,
    nome,
    subpastaRelativa: candidato.subpastaRelativa,
    pastaPedida: candidato.pastaPedida,
    quando: Date.now(),
  };
  consumidoPorTab.set(candidato.tabId, consumo);

  // SEM JANELA (23/09/2026, pedido do usuário: a pergunta "onde salvar" fica
  // para ele, nao para o agente). O Chrome so abre a janela DEPOIS que o nome
  // e decidido aqui, e a extensao nao le nem muda essa opcao. Entao segura a
  // decisao (return true + suggest depois), busca o mesmo arquivo pela aba e,
  // se o tamanho bater, cancela o download do Chrome: janela nenhuma. Se nao
  // der (download por formulario POST, blob ja descartado), solta o download
  // como sempre foi.
  desviarDaJanela(candidato.tabId, item, consumo)
    .then((d) => {
      if ('base64' in d) {
        consumo.desvio = d;
        // Cancela ANTES de devolver a decisao (a janela nunca abre) e depois
        // devolve: o Chrome so libera a fila de nomes quando o suggest e
        // chamado — sem isto o PROXIMO download nem comecava (medido 23/09).
        chrome.downloads.cancel(item.id)
          .catch(() => {})
          .then(() => { try { suggest(); } catch { /* ja resolvido */ } })
          .then(() => chrome.downloads.erase({ id: item.id }))
          .catch(() => {});
        return;
      }
      consumo.porqueSemDesvio = d.porque;
      // blob: que nao deu para rebuscar: soltar para o Chrome abriria a janela
      // "Salvar como" na tela do usuário (a pergunta e dele, nao do agente).
      // Cancela e o esperar devolve o motivo.
      if (/^blob:/i.test(item.finalUrl || item.url || '')) {
        chrome.downloads.cancel(item.id).catch(() => {}).then(() => { try { suggest(); } catch { /* */ } });
        return;
      }
      suggest({ filename: alvo, conflictAction: 'uniquify' });
    })
    .catch((err) => {
      consumo.porqueSemDesvio = String(err);
      suggest({ filename: alvo, conflictAction: 'uniquify' });
    });
  return true;
});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dump compacto do DownloadItem inteiro — usado nas mensagens de erro de
 * `cap_download_esperar` quando o download nao termina. Medido em 06/09/2026:
 * a mensagem antiga so dizia "estado atual: in_progress", que nao ensina nada
 * (nao diz SE esta recebendo bytes, SE esta pausado, SE o Chrome marcou como
 * suspeito). "Essa informacao no erro ja e metade do conserto" — briefing.
 */
function descreverItem(item: chrome.downloads.DownloadItem | undefined): string {
  if (!item) return '(nenhum DownloadItem encontrado)';
  const partes = [
    `state=${item.state}`,
    `paused=${item.paused}`,
    `canResume=${item.canResume}`,
    `danger=${item.danger}`,
    `bytesReceived=${item.bytesReceived}`,
    `totalBytes=${item.totalBytes}`,
    `fileSize=${item.fileSize}`,
    `exists=${item.exists}`,
    `mime=${item.mime || '(vazio)'}`,
    `filename=${item.filename || '(vazio)'}`,
  ];
  if (item.error) partes.push(`error=${item.error}`);
  return `[DownloadItem ${partes.join(' ')}]`;
}

/**
 * Hipoteses conhecidas (briefing "download nativo comeca e nao conclui",
 * 06/09/2026) que EXPLICAM um `state` preso em algo diferente de "complete" —
 * traduzidas dos campos medidos para nao obrigar quem le o erro a saber a API
 * de cor. Nao decide nada sozinha, so aponta.
 */
function dicaPorEstado(item: chrome.downloads.DownloadItem | undefined): string {
  if (!item) return '';
  if (item.danger !== 'safe' && item.danger !== 'accepted') {
    return (
      ` HIPOTESE: o Chrome sinalizou este arquivo como suspeito (danger="${item.danger}") e esta `
      + 'esperando confirmacao manual ("Manter arquivo" em chrome://downloads) — isto NAO e timeout '
      + 'de rede nem defeito da ponte, e aprovacao pendente que nunca chega sozinha. Nao ha como a '
      + 'extensao aceitar isso no lugar do usuario sem `downloads.acceptDanger`, que ainda nao esta '
      + 'implementado aqui de proposito (decide caso a caso com o usuário antes de automatizar isto).'
    );
  }
  if (item.state === 'in_progress' && !item.filename) {
    // MEDIDO em 23/09/2026 (custas do TJ-RO): bytesReceived === totalBytes,
    // filename vazio, danger safe. O arquivo chegou inteiro e o Chrome nao
    // sabe ONDE gravar: esta com a janela "Salvar como" aberta. No perfil
    // do usuario a opcao "Perguntar onde salvar cada arquivo" esta LIGADA
    // (Preferences: download.prompt_for_download = true) e ela vence o
    // suggest() do onDeterminingFilename.
    return (
      ' CAUSA: o Chrome esta com a janela "Salvar como" ABERTA esperando alguem escolher a pasta '
      + '(opcao "Perguntar onde salvar cada arquivo" ligada em chrome://settings/downloads). Enquanto '
      + 'ela estiver aberta nenhum outro download comeca. Peca ao usuário para clicar em Salvar ou '
      + 'Cancelar nessa janela; se o arquivo tiver URL direta, prefira browser_download (busca por '
      + 'fora, sem janela). Desligar a opcao e decisao dele, nao mude sozinho.'
    );
  }
  if (item.paused && item.bytesReceived === 0) {
    return (
      ' HIPOTESE: download pausado sem receber nenhum byte — compativel com o Chrome estar esperando '
      + 'o dialogo nativo "Salvar como" (configuracao "Perguntar onde salvar cada arquivo antes de '
      + 'fazer o download" LIGADA em chrome://settings/downloads). Isto e configuracao do usuário — '
      + 'NAO mude sozinho; confirme com ele antes.'
    );
  }
  if (item.state === 'in_progress' && item.bytesReceived === 0 && !item.paused) {
    return (
      ' HIPOTESE: o download foi criado mas nao comecou a receber bytes — confira se a subpasta de '
      + `staging (${SUBPASTA_STAGING}/<token>) foi mesmo criada dentro da pasta de Downloads real do `
      + 'Chrome (permissao, caminho com caractere invalido, ou OneDrive redirecionando a pasta).'
    );
  }
  return '';
}

/** Le o Blob guardado no armar (URL.createObjectURL interceptado) sem fetch. */
async function lerBlobGuardado(tabId: number, url: string): Promise<{ base64: string; tipo: string }> {
  const r = await executarJs(tabId, `new Promise(function (res, rej) {
    var b = window.__pxBlobs && window.__pxBlobs[${JSON.stringify(url)}];
    if (!b) return rej(new Error('blob nao guardado'));
    var fr = new FileReader();
    fr.onload = function () { res({ base64: String(fr.result).split(',')[1] || '', tipo: b.type || 'application/octet-stream' }); };
    fr.onerror = function () { rej(new Error('FileReader falhou')); };
    fr.readAsDataURL(b);
  })`) as { base64?: string; tipo?: string } | undefined;
  if (!r?.base64) throw new Error('blob vazio');
  return { base64: r.base64, tipo: r.tipo ?? 'application/octet-stream' };
}

/** Tamanho em bytes de um base64 (sem decodificar). */
function bytesDoBase64(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function desviarDaJanela(
  tabId: number,
  item: chrome.downloads.DownloadItem,
  consumo: Consumido,
): Promise<Desvio | { porque: string }> {
  const url = item.finalUrl || item.url;
  if (!url) return { porque: 'o download nao tem URL' };
  let got: { base64: string; tipo: string };
  try {
    got = /^blob:/i.test(url)
      ? await lerBlobGuardado(tabId, url).catch(() => baixarComoBase64(tabId, url))
      : await baixarComoBase64(tabId, url);
  } catch (err) {
    return { porque: `a busca pela aba falhou (${String((err as Error)?.message ?? err).slice(0, 120)}; download por formulario POST ou blob ja descartado nao da para repetir)` };
  }
  const bytes = bytesDoBase64(got.base64);
  // Prova de que e o MESMO arquivo: o tamanho que o Chrome ja recebeu. Sem
  // tamanho conhecido, so aceita se o tipo tambem nao for pagina HTML (uma
  // URL de formulario repetida por GET costuma devolver a pagina de erro).
  // Tamanho que o Chrome recebeu: no instante do nome ele pode ainda nao
  // saber (sem Content-Length); espera o recebimento parar, ate 5 s.
  let total = item.totalBytes;
  if (!(total > 0)) {
    let anterior = -1;
    for (let i = 0; i < 25; i += 1) {
      const [atual] = await chrome.downloads.search({ id: item.id });
      if (!atual) break;
      if (atual.totalBytes > 0) { total = atual.totalBytes; break; }
      if (atual.bytesReceived > 0 && atual.bytesReceived === anterior) { total = atual.bytesReceived; break; }
      anterior = atual.bytesReceived;
      await sleep(200);
    }
  }
  if (total > 0 && bytes !== total) {
    return { porque: `a busca trouxe ${bytes} bytes e o Chrome tinha ${total}: nao e o mesmo arquivo` };
  }
  if (!(total > 0) && /text\/html/i.test(got.tipo) && !/html/i.test(item.mime || '')) {
    return { porque: 'a busca devolveu uma pagina HTML, nao o arquivo' };
  }
  return { pasta: consumo.pastaPedida, nome: consumo.nome, bytes, url, base64: got.base64, sem_janela: true, via: 'aba' };
}

export const modulo: ModuloCapacidades = {
  nome: 'download-nativo',
  capacidades: [
    {
      nome: 'cap_download_armar',
      // Altera o comportamento de download do PROCESSO da extensao inteiro —
      // entra na barreira de somente leitura (aba adotada do usuario exige
      // permitir_acao: true). Ver test/registro.js:255 (sonda desta obra).
      altera: true,
      async executar(ctx: ContextoCapacidade): Promise<unknown> {
        const pasta = (ctx.params.pasta as string | undefined) ?? '';
        if (!pasta) {
          throw new Error(
            'cap_download_armar exige params.pasta — o servidor MCP resolve o padrao '
            + '(~/.praxedes-bridge/downloads); quem chamou direto tem de mandar a pasta.',
          );
        }

        limparExpirados();
        // Um armar novo nesta aba descarta qualquer armado/consumido anterior
        // dela que ainda estivesse pendente — "comeca do zero" (mesma regra
        // do desenho CDP anterior).
        fila = fila.filter((a) => a.tabId !== ctx.tabId);
        consumidoPorTab.delete(ctx.tabId);

        const token = crypto.randomUUID();
        const subpastaRelativa = `${SUBPASTA_STAGING}/${token}`;
        const agora = Date.now();
        fila.push({
          tabId: ctx.tabId,
          token,
          pastaPedida: pasta,
          subpastaRelativa,
          quando: agora,
          // ttl_s (10/11/2026): "1080p Aprimorada" do Flow leva ~5 min ate o arquivo sair.
          expiraEm: agora + Math.min(15 * 60_000, Math.max(TTL_ARMAR_MS, Number(ctx.params.ttl_s) * 1000 || 0)),
        });

        // Arquivo gerado por JS (blob:) — Gemini, 26/09/2026: a pagina cria o
        // blob, clica no <a download> e o descarta na hora; a ponte nao
        // conseguia rebuscar e a janela "Salvar como" abria. Enquanto armado,
        // o descarte espera 60 s (so nesta aba, so o adiamento, nada mais).
        await executarJs(ctx.tabId, `(function(){
          if (window.__pxRevogar) return 'ja';
          var orig = URL.revokeObjectURL.bind(URL);
          window.__pxRevogar = true;
          URL.revokeObjectURL = function (u) { setTimeout(function () { orig(u); }, 60000); };
          // Guarda o proprio Blob por URL: no Gemini a CSP (connect-src) barra
          // fetch de blob: (medido 26/09/2026, "Failed to fetch"); ler o Blob
          // guardado com FileReader nao passa pela rede nem pela CSP.
          var origCriar = URL.createObjectURL.bind(URL);
          window.__pxBlobs = window.__pxBlobs || {};
          URL.createObjectURL = function (b) { var u = origCriar(b); try { window.__pxBlobs[u] = b; } catch (e) {} return u; };
          setTimeout(function () { URL.revokeObjectURL = orig; URL.createObjectURL = origCriar; window.__pxRevogar = false; window.__pxBlobs = {}; }, 90000);
          return 'ok';
        })()`, ctx.emSomenteLeitura).catch(() => {});

        // Captura na resposta (sem janela). Se o CDP recusar, fica so o
        // caminho do chrome.downloads, como era.
        let captura = 'resposta (sem janela)';
        try {
          await armarCaptura(ctx.tabId, pasta);
        } catch (err) {
          captura = `indisponivel: ${String(err).slice(0, 80)}`;
        }

        return { pasta, metodo: 'chrome.downloads (Plano C)', captura, token };
      },
    },
    {
      nome: 'cap_download_esperar',
      async executar(ctx: ContextoCapacidade): Promise<unknown> {
        const timeoutMs = (ctx.params.timeout_ms as number | undefined) ?? 60_000;
        const inicio = Date.now();

        const falhou = () => {
          const f = falhaDeCaptura.get(ctx.tabId);
          if (f) { falhaDeCaptura.delete(ctx.tabId); consumidoPorTab.delete(ctx.tabId); throw new Error(`download recusado pela ponte: ${f}. Nada foi gravado.`); }
        };
        const pegarCapturado = () => {
          falhou();
          const c = capturadoPorTab.get(ctx.tabId);
          if (c) { capturadoPorTab.delete(ctx.tabId); consumidoPorTab.delete(ctx.tabId); }
          return c;
        };
        let consumo = consumidoPorTab.get(ctx.tabId);
        while (!consumo && Date.now() - inicio < timeoutMs) {
          const c = pegarCapturado();
          if (c) return c;
          await sleep(200);
          consumo = consumidoPorTab.get(ctx.tabId);
        }
        { const c = pegarCapturado(); if (c) return c; }

        if (!consumo) {
          // Download preso de antes (janela "Salvar como" aberta) segura a fila
          // do Chrome: o novo nem comeca. Diz isso, se for o caso.
          let preso = '';
          try {
            const pendentes = await chrome.downloads.search({ state: 'in_progress' });
            if (pendentes.some((d) => !d.filename)) {
              preso = ' ATENCAO: ha download parado sem nome de arquivo, sinal de janela "Salvar como" '
                + 'aberta no Chrome esperando o usuário (opcao "Perguntar onde salvar cada arquivo" '
                + 'ligada). Enquanto ela estiver aberta o download novo nao comeca; peca a ele para '
                + 'fechar essa janela.';
            }
          } catch { /* sem busca, fica so a mensagem de sempre */ }
          // Diferente de cap_wait_new_tab: aqui NAO ha um "nao apareceu, tudo
          // bem" legitimo. Ou o clique nao disparou download nenhum, ou
          // browser_download_arm nao rodou antes nesta MESMA aba — as duas
          // sao defeito do fluxo do agente. Falhar alto, nunca "ok" vazio.
          throw new Error(
            `nenhum download comecou nesta aba em ${Math.round(timeoutMs / 1000)}s. Confira se `
            + 'browser_download_arm rodou antes do clique NESTA MESMA aba (a fila e global e cada '
            + `armar vale so ${TTL_ARMAR_MS / 1000}s), e se o clique realmente dispara um download.${preso}`,
          );
        }

        let item: chrome.downloads.DownloadItem | undefined;
        while (Date.now() - inicio < timeoutMs) {
          if (consumo.desvio) {
            consumidoPorTab.delete(ctx.tabId);
            return consumo.desvio;
          }
          const encontrados = await chrome.downloads.search({ id: consumo.downloadId });
          item = encontrados[0];
          if (item && (item.state === 'complete' || item.state === 'interrupted')) break;
          if (consumo.desvio) {
            consumidoPorTab.delete(ctx.tabId);
            return consumo.desvio;
          }
          // Janela "Salvar como" aberta: sem nome de arquivo depois de 5 s nao
          // vai terminar sozinho. Falha ja, com a causa, em vez de gastar o
          // teto inteiro (e segurar o agente 60 s olhando para nada).
          // So depois que o desvio sem janela desistiu: enquanto ele busca o arquivo,
          // o nome ainda nao foi decidido e o filename vazio e esperado.
          if (item && item.state === 'in_progress' && !item.filename && consumo.porqueSemDesvio !== undefined
              && Date.now() - consumo.quando > 5_000) break;
          await sleep(200);
        }

        consumidoPorTab.delete(ctx.tabId);
        if (consumo.desvio) return consumo.desvio;

        if (!item) {
          throw new Error(
            `download id ${consumo.downloadId} nao apareceu em chrome.downloads.search — `
            + 'nunca deveria acontecer (o id veio do proprio onDeterminingFilename).',
          );
        }
        if (item.state === 'interrupted') {
          throw new Error(
            (consumo.porqueSemDesvio
              ? `download cancelado pela ponte para a janela "Salvar como" nao abrir na tela do usuário: ${consumo.porqueSemDesvio}. `
                + 'Arquivo gerado por JS e ja descartado pela pagina; repita o clique logo depois do browser_download_arm. '
              : `download interrompido pelo Chrome: ${item.error ?? '(motivo desconhecido)'}. `)
            + descreverItem(item),
          );
        }
        if (item.state !== 'complete') {
          throw new Error(
            `download nao terminou (estado atual: ${item.state}, ${Math.round((Date.now() - inicio) / 1000)}s de espera). `
            + descreverItem(item) + dicaPorEstado(item)
            + (consumo.porqueSemDesvio ? ` A ponte tentou baixar sozinha sem a janela e nao deu: ${consumo.porqueSemDesvio}.` : ''),
          );
        }

        return {
          // `pasta` e a que o AGENTE pediu no armar — pass-through, nunca usada
          // pela extensao para escrever nada. O servidor (com disco de
          // verdade) e quem move o arquivo pra la; ver formatar() em
          // bridge-server/src/tools/download-nativo.js.
          pasta: consumo.pastaPedida,
          nome: nomeSugeridoDe(item),
          bytes: item.fileSize >= 0 ? item.fileSize : item.bytesReceived,
          url: item.finalUrl || item.url,
          // Caminho ABSOLUTO real, na pasta de Downloads do PROPRIO Chrome
          // (subpasta de staging) — e o unico dado com que o servidor consegue
          // achar o arquivo fisico para mover.
          caminhoNavegador: item.filename,
        };
      },
    },
  ],
};
