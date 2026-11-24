import { reescreverTypeParaTeclado } from './teclado-hosts';
import { focoEmMoldura, ehRefMoldura } from '../execution-engine/molduras';
import {
  resolverAlvoDeMoldura, cliqueNaMoldura, digitarNaMoldura,
} from '../execution-engine/moldura-acoes';
import { workspaceManager } from '../workspace-manager';
import { atualizarStatus, aplicado as iconeAplicado } from '../painel/status-icone';
import { rankingDeSites } from '../painel/consumo-sites';
import { cancelarTodasAsDecisoes, notificacaoDaDecisao, tratarBotao } from '../painel/decisao-runtime';
import { avisarEspera, registroAvisos, reiniciarAvisos, avisosLigados, notificacoesAtivas, ligarModoTesteDecisao, modoTesteDecisaoLigado } from '../painel/avisos';

import { auditLogger } from '../audit';
import { debuggerManager } from '../debugger-manager';
import {
  executionEngine, resolverAlvoDeCloseTab, resolverAlvoDeSwitchTab,
  resolverAlvoDaAcao, ACOES_COM_ALVO_UNICO, type AlvoResolvido, type Resolucao,
} from '../execution-engine';
import { avaliar } from './policy';
import { lerValorDoElemento } from './capabilities';
import { esperarCondicao } from '../execution-engine/espera-condicao';
import { documentoTrocou } from '../execution-engine/refs-documento';
// Registra todos os modulos de capacidade (e liga os ganchos aoAnexar ao
// debugger-manager) so de ser importado. Precisa acontecer no carregamento do
// modulo, nao dentro de `start()`: o service worker MV3 pode acordar sem
// passar por `start()`, e mesmo assim precisa estar tudo registrado.
import {
  capacidadePorNome, errosDeRegistro, ganchos, listarCapacidades, nomesDeInput, nomesQueAlteram,
  type ContextoCapacidade, type Resultado,
} from './capacidades';
// Import direto do modulo (nao do agregado `./capacidades`): `registrarFilha`
// nao e uma capacidade nem um gancho do contrato de `registro.ts`, e sim uma
// funcao proprio de estado do modulo `abas-filhas`, que so o `onCreated` daqui
// (dono do `openerTabId`) pode chamar. Ver docs/obra-20260904/08-...md.
import { emulacaoDoAgente } from './capacidades/emulacao';
import { registrarFilha } from './capacidades/abas-filhas';
import { ConjuntoSessao } from './conjunto-sessao';
import { zerarConsumoSites } from '../painel/consumo-sites';
import type { AgentWorkspace, PlannedAction, ProviderConfig } from '../../../shared/types';

/**
 * Ponte com os agentes locais (Claude Code, OpenCode, Codex).
 *
 * Recebe comandos por WebSocket e os entrega direto ao ExecutionEngine,
 * DESVIANDO do AgentLoop e do Planner de proposito: quem decide o que fazer e o
 * agente do outro lado. Meter um LLM no meio faria telefone sem fio.
 *
 * MV3 nao deixa extensao escutar porta, entao quem escuta e o servidor node e
 * nos conectamos nele como cliente.
 */

const BRIDGE_URL = 'ws://127.0.0.1:8789';

/** Acoes do MOTOR (ExecutionEngine) que despacham input e por isso exigem a aba renderizada. */
const INPUT_ACTIONS_MOTOR = new Set(['click', 'type', 'press_key', 'scroll', 'drag']);

/**
 * Acoes do MOTOR que ALTERAM a pagina. Em aba do usuario elas ficam barradas por
 * padrao: "olha isso aqui" e leitura, e um erro do agente nao pode custar a aba
 * em que o usuario esta trabalhando. Para agir na aba dele e preciso permissao
 * explicita.
 */
const ACOES_QUE_ALTERAM_MOTOR = new Set([
  'navigate', 'click', 'type', 'press_key', 'scroll', 'drag',
  // `copy_to_clipboard` entrou em 06/09/2026. MEDIDO na aba adotada em modo
  // leitura, ANTES do conserto: a copia respondeu `copiedLength: 34` e o
  // MutationObserver da pagina registrou 4 mutacoes novas — ou seja, rodou E
  // mexeu no DOM da aba que o agente so devia estar lendo.
  //
  // Nao e leitura por dois motivos independentes:
  //   1. sobrescreve a AREA DE TRANSFERENCIA do Windows. E estado da maquina
  //      do usuário, nao da pagina: "olha isso aqui" nao pode apagar o que
  //      ele tinha copiado para colar em outro lugar.
  //   2. o fallback do `case 'copy_to_clipboard'` (execution-engine) CRIA um
  //      `<textarea>`, ANEXA em `document.body`, chama `select()` — que rouba
  //      o foco e destroi a selecao de texto do usuario — e remove. E esse
  //      fallback nao e caso raro: `navigator.clipboard.writeText` recusa em
  //      documento sem foco, que e a situacao NORMAL de uma aba lida em
  //      segundo plano. Foi o que a medicao acima pegou.
  //
  // Era a incoerencia que o mapa apontou: `scroll`, que nao muda dado nenhum
  // da pagina, ja estava barrado, e isto nao.
  //
  // POR QUE NAO "barrar so o fallback que mexe no DOM": deixaria a tool
  // NAO-DETERMINISTICA (funciona com a aba em foco, falha sem foco), nao
  // protegeria a area de transferencia — metade do dano — e poria a decisao
  // DENTRO da funcao injetada na pagina, um segundo ponto de politica fora do
  // freio. E exatamente o desenho que criou a familia de furos desta obra.
  //
  // Na aba propria do agente continua livre; na aba do usuario passa pela
  // MESMA porta das demais (`permitir_acao: true`).
  'copy_to_clipboard',
]);

/**
 * Nomes internos do BridgeClient: capacidades de estado (abas, faxina) e os
 * dois aliases de antes de 19/08. Ficam aqui, e nao no registro, porque
 * precisam de `this` (workspaceByClient, abasCriadasPelaPonte...).
 */
const CAPACIDADES_INTERNAS = [
  'cap_parar_tudo_admin', 'cap_liberar_admin',
  'cap_faxina_ociosos', 'cap_limpar', 'cap_use_current_tab', 'cap_use_own_tab',
  'cap_tabs_all', 'cap_use_tab', 'cap_janela_propria', 'cap_voltar_aba_corrente', 'cap_listar',
  'cap_entregar_aba', 'cap_fechar_aba_admin',
];

/** Uma acao exige a aba pintada: acao do motor, ou capacidade registrada com `input: true`. */
function exigeAbaPintada(acao: string): boolean {
  return INPUT_ACTIONS_MOTOR.has(acao) || nomesDeInput().has(acao);
}

/** Uma acao altera a pagina: acao do motor, ou capacidade registrada com `altera: true`. */
function alteraAPagina(acao: string): boolean {
  return ACOES_QUE_ALTERAM_MOTOR.has(acao) || nomesQueAlteram().has(acao);
}

/**
 * Obra 19: pagina interna do navegador (chrome://, edge://, chrome-extension://
 * e about: fora de about:blank) trava o CDP na hora de anexar — o Chrome
 * responde `Cannot access a chrome:// URL` sem dar chance de ler ou operar.
 * `about:blank` fica de fora da lista de proposito: e a aba em branco que a
 * propria ponte usa (`abrirAbaPropria`) e o usuario tambem pode ter uma sem
 * que isso signifique "pagina interna" no sentido que quebra o CDP.
 */
function ehPaginaInterna(url: string | undefined): boolean {
  if (!url) return false;
  if (url === 'about:blank') return false;
  return /^(chrome|edge|chrome-extension):\/\//i.test(url) || /^about:/i.test(url);
}

/**
 * O incidente do PJe (11/09/2026): a faxina por ociosidade fechava a aba do
 * agente sem distinguir "abandonou o trabalho" de "terminou e esta esperando
 * o usuário assinar". A rede de seguranca (ver `encerrar`, `opts.viaFaxina`)
 * so ENTREGA a aba ao usuario quando ela e "de verdade" — o resto (branco,
 * pagina interna) continua sendo fechado como sempre, senao toda aba de
 * teste (example.com, about:blank) iria parar na janela do usuário.
 */
function ehPaginaReal(url: string | undefined): boolean {
  if (!url || url === 'about:blank') return false;
  return !ehPaginaInterna(url);
}

/**
 * Resposta que o agente recebe quando o usuário aperta "Parar tudo" no painel.
 * Vale para o comando que estava rodando e, ate ele liberar, para todo comando
 * novo dos agentes que estavam conectados: erro claro, sem convite a tentar de novo.
 */
export const MSG_PARADO = 'parado pelo usuário — não repita; pergunte a ele. '
  + 'A ponte foi interrompida de propósito: nada seguirá até ele liberar os agentes no painel.';

/** Depois do "Parar tudo", por quanto tempo nenhuma aba nova nasce (comando que ja estava a meio caminho). */
const PARADA_SEM_ABA_MS = 4_000;

/** Nome do workspace interno. Nao cria grupo de aba nenhum. */
const NOME_WORKSPACE = 'ponte';

/** Tamanho padrao da janela da ponte, usado so na primeira vez. Depois ela lembra. */
const JANELA_PADRAO = { width: 1100, height: 850 };

/**
 * Agente parado solta a aba.
 *
 * O processo MCP vive enquanto a sessao do agente estiver aberta — pode ser o dia
 * inteiro. Sem isto, ele seguiria "dono" da aba para sempre; e se tiver aberto
 * alguma aba propria, ela ficaria na tela indefinidamente.
 */
const OCIOSIDADE_MS = 5 * 60_000;
const ALARME_FAXINA = 'ponte-faxina-ociosos';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/**
 * Falhas seguidas (sem nunca abrir) ate desistir do laco de tentativas. Contra a
 * porta fechada cada tentativa deixa um ERR_CONNECTION_REFUSED em
 * chrome://extensions; depois disto a extensao so tenta de novo pelo alarme
 * abaixo (1 vez por minuto), ao abrir o painel lateral ou ao trocar o token.
 * 5 falhas = ~31 s de tentativas (1+2+4+8+16 s de espera).
 */
const FALHAS_ATE_REPOUSO = 5;
const ALARME_RECONECTAR = 'ponte-reconectar';
/** Mensagem pequena a cada 20 s no WS aberto: no Chrome 116+ enviar mensagem renova os 30 s do service worker. */
const KEEPALIVE_WS_MS = 20_000;

/**
 * Quanto o indicador visual fica na tela depois do ultimo comando.
 *
 * Existe para nao piscar entre dois comandos seguidos (o agente costuma mandar
 * varios em fila). Passou disso sem comando novo, o agente parou de fato.
 */
/** Hosts em que a janela da ponte fica aberta (sem foco), sem tamanho emulado. */
const HOSTS_JANELA_REAL = ['https://flow.google.com/', 'https://labs.google/'];
/** Acoes que so funcionam na aba da FRENTE: uma por vez na janela da ponte (ver `pegarVez`). */
const ACOES_DA_FRENTE = new Set([
  'click', 'type', 'press_key', 'drag', 'scroll',
  'cap_click_xy', 'cap_form_input', 'cap_form_fill', 'cap_digitar', 'cap_autocomplete',
  'cap_print', 'cap_screenshot_ref', 'screenshot',
]);
const INDICADOR_GRACA_MS = 2_000;

/** De quanto em quanto tempo o indicador e reafirmado durante um comando longo. */
const INDICADOR_REAFIRMA_MS = 10_000;

/**
 * O workspace ainda exige um provider de LLM. A ponte nao usa nenhum — este
 * stub existe so para satisfazer o tipo e sai junto com o agent-loop na poda.
 */
const NO_PROVIDER = {
  provider: 'none',
  model: 'bridge',
  supportsVision: false,
  supportsStructuredOutputs: false,
  contextWindow: 0,
} as unknown as ProviderConfig;

interface BridgeCommand {
  type: 'cmd';
  id: string;
  clientId: string;
  action: string;
  args?: {
    target?: PlannedAction['target'];
    params?: PlannedAction['params'];
    /** Usuario ja confirmou uma acao que o freio barrou. */
    confirm?: boolean;
  };
  name?: string;
}

/** Uma linha do "ultimas acoes" do painel lateral. */
export interface AcaoRecente {
  quando: number;
  clientId: string;
  agente?: string;
  acao: string;
  ok: boolean;
  ms: number;
  site?: string;
  erro?: string;
}

const RECENTES_MAX = 10;

class BridgeClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Falhas seguidas de conexao sem nunca abrir. Zera ao abrir. */
  private falhasSeguidas = 0;
  /** Laco de tentativas desligado: so alarme/painel/token tentam. Espelhado em chrome.storage.session. */
  private repouso = false;
  /** O hub respondeu welcome sem erro nesta conexao. */
  private acolhido = false;
  private keepaliveWs: ReturnType<typeof setInterval> | null = null;

  /** Workspace de cada agente conectado: qual aba ele esta usando. */
  private workspaceByClient = new Map<string, string>();

  /** Abas que ja eram do usuario: nunca fechar. E o caso normal. */
  private abasAdotadas = new ConjuntoSessao('ponteAbasAdotadas');

  /**
   * Abas que a PONTE abriu (`browser_tab_open`). Sao as unicas que ela pode
   * fechar — o resto pertence ao usuario.
   */
  private abasCriadasPelaPonte = new ConjuntoSessao('ponteAbasCriadas', 'local');

  /** Ultimo comando de cada agente, para soltar quem parou. */
  private ultimoComando = new Map<string, number>();

  /** Timer que apaga o indicador visual de cada aba depois da graca. */
  private apagarIndicador = new Map<number, ReturnType<typeof setTimeout>>();

  /**
   * Agentes que estao numa aba DO USUARIO (via browser_use_current_tab ou
   * browser_use_tab) sem permissao para alterar. Ficam so na leitura.
   */
  private somenteLeitura = new Set<string>();

  /** Aba propria de cada agente na janela da ponte, para voltar depois de olhar a do usuario. */
  private abaPropriaDoCliente = new Map<string, number>();

  /**
   * Fila de input. Todos os agentes dividem a janela da ponte, e clicar exige a
   * aba ativa NAQUELA janela: dois agentes clicando ao mesmo tempo ativariam a
   * aba um do outro e o clique cairia na pagina errada.
   */
  private filaInput: Promise<unknown> = Promise.resolve();

  /** Aba ancora da janela da ponte: mantem a janela viva; nenhum agente a usa. */
  private abaAncora: number | undefined;
  /** Janelas que a ponte tirou do minimizado, com o temporizador para devolver. */
  private reMinimizar = new Map<number, ReturnType<typeof setTimeout>>();

  /** Abas com tamanho de tela emulado porque a janela esta minimizada. */
  private emuladas = new Set<number>();
  /**
   * Vez na janela da ponte (29/10/2026, sessao Imersos): so a aba da FRENTE recebe
   * teclado e clique. Com dois agentes, o comando de um trazia a aba dele para a
   * frente no meio da digitacao do outro; a aba escondida travava o
   * Input.dispatchKeyEvent (cap_digitar estourava) e congelava. Acao que precisa
   * da frente espera a vez; leitura nao troca a aba da frente.
   */
  private vezDaJanela = new Map<number, Promise<void>>();
  /**
   * Aba que o PROPRIO agente fechou (`clientId:tabId`). Nao e "fechada por fora":
   * o proximo comando dele segue sem o erro de [aba trocou] (01/11/2026).
   */
  private fechadasPeloDono = new Set<string>();
  /** Aba em branco aberta em silencio depois disso; o proximo open_tab a aproveita. */
  private brancaDoCliente = new Map<string, number>();

  /**
   * So mexe na JANELA DA PONTE (nunca numa janela do usuário).
   *
   * O usuário quer a ponte SEMPRE minimizada, sem aparecer na tela
   * (30/09/2026). Minimizada, a janela vira 0x0 e o hit-test nao acha nada.
   * 1o caminho: manter minimizada e EMULAR o tamanho da tela pelo CDP
   * (Emulation.setDeviceMetricsOverride): a pagina ganha layout e o clique
   * por coordenada volta a ter onde cair, sem a janela aparecer.
   * 2o caminho (se a emulacao nao der layout): restaura sem foco e devolve ao
   * minimizado 20 s depois — menos que os 30 s em que o service worker dorme
   * e levaria o temporizador junto.
   */
  private async pegarVez(tabId: number, aguardando?: () => void): Promise<() => void> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return () => {};
    const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
    if (tab.windowId !== janelaDaPonte) return () => {};
    const anterior = this.vezDaJanela.get(tab.windowId) ?? Promise.resolve();
    let soltar!: () => void;
    const minha = new Promise<void>((r) => { soltar = r; });
    const fila = anterior.then(() => minha);
    this.vezDaJanela.set(tab.windowId, fila);
    // Teto: um comando preso nao segura os outros para sempre.
    // Enquanto espera, avisa quem mandou: a fila nao conta no prazo do comando.
    let esperando = true;
    const aviso = aguardando ? setInterval(() => { if (esperando) aguardando(); }, 5_000) : undefined;
    await Promise.race([anterior, new Promise((r) => setTimeout(r, 90_000))]);
    esperando = false;
    if (aviso) { clearInterval(aviso); aguardando?.(); }
    return () => {
      soltar();
      if (this.vezDaJanela.get(tab.windowId) === fila) this.vezDaJanela.delete(tab.windowId);
    };
  }

  private async garantirJanelaDesenhada(tabId: number, ativar = true): Promise<void> {
    try {
      // O agente pediu um aparelho (browser_emulate_device): a medida dele manda, nao a de 1280x800.
      if (emulacaoDoAgente.has(tabId)) { this.emuladas.delete(tabId); return; }
      const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== janelaDaPonte) return;
      let win = await chrome.windows.get(tab.windowId);

      // Site com antirrobo (Flow, 08/11/2026): janela minimizada com tamanho
      // emulado da innerWidth 1280 e outerWidth 157 em screenX -16000, sinal
      // impossivel para gente de verdade, e a geracao volta "atividade incomum".
      // Nesses hosts a janela fica NORMAL, sem foco e sem emulacao: tamanho real.
      if (HOSTS_JANELA_REAL.some((h) => (tab.url ?? '').startsWith(h))) {
        if (this.emuladas.delete(tabId)) {
          await debuggerManager.send(tabId, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
          await debuggerManager.send(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
        }
        if (win.state === 'minimized') {
          await chrome.windows.update(tab.windowId, { state: 'normal', focused: false }).catch(() => {});
          // A pagina reflui depois de sair do minimizado: medida tirada antes disso
          // mandava o clique para outro elemento (09/11/2026). Espera a largura parar.
          let antes = -1;
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const r = await debuggerManager.send<{ result?: { value?: number } }>(tabId, 'Runtime.evaluate', {
              expression: 'innerWidth * 10000 + innerHeight', returnByValue: true,
            }).catch(() => undefined);
            const v = Number(r?.result?.value ?? 0);
            if (v > 0 && v === antes) break;
            antes = v;
          }
        }
        if (ativar && !tab.active) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
        return;
      }

      // Janela aberta mas SEM foco (28/10/2026, sessao Imersos): restaurada e
      // coberta por outras, o Chrome para de desenhar, o print trava 60 s e o clique
      // cai no vazio. Sem o usuário olhando para ela, volta ao minimizado e segue
      // pelo caminho da emulacao, que funciona.
      if (win.state !== 'minimized' && !win.focused && !this.reMinimizar.has(tab.windowId)) {
        await chrome.windows.update(tab.windowId, { state: 'minimized' }).catch(() => {});
        win = await chrome.windows.get(tab.windowId);
      }

      if (win.state !== 'minimized') {
        // Ele esta olhando a janela: so a aba da frente e desenhada, entao traz a
        // aba do agente para a frente, como no minimizado.
        if (ativar && !tab.active) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
        // Janela aberta: a emulacao nao tem mais por que existir.
        if (this.emuladas.delete(tabId)) {
          await debuggerManager.send(tabId, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
        }
        const pendente = this.reMinimizar.get(tab.windowId);
        if (pendente) { clearTimeout(pendente); this.agendarMinimizar(tab.windowId); }
        return;
      }

      const temLayout = async () => {
        const r = await debuggerManager.send<{ result?: { value?: boolean } }>(tabId, 'Runtime.evaluate', {
          expression: 'innerWidth > 50 && innerHeight > 50 && !!document.elementFromPoint(5, 5)', returnByValue: true,
        }).catch(() => undefined);
        return r?.result?.value === true;
      };

      if (ativar && !tab.active) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      await debuggerManager.attach(tabId).catch(() => {});
      await debuggerManager.send(tabId, 'Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
      }).catch(() => {});
      await debuggerManager.send(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      this.emuladas.add(tabId);
      // V1: era 150 ms parados antes de conferir uma vez. A conferencia (layout de
      // verdade + hit-test) passa a ser a propria espera: poll de 30 ms, mesmo teto.
      if ((await esperarCondicao(temLayout, { intervaloMs: 30, tetoMs: 150 })).ok) return;

      // Emulacao nao bastou: restaura sem foco e devolve depois.
      this.emuladas.delete(tabId);
      await debuggerManager.send(tabId, 'Emulation.clearDeviceMetricsOverride', {}).catch(() => {});
      await chrome.windows.update(tab.windowId, { state: 'normal', focused: false });
      await new Promise((r) => setTimeout(r, 500));
      this.agendarMinimizar(tab.windowId);
    } catch {
      // Janela sumiu ou o Chrome recusou: o comando segue e reporta o proprio erro.
    }
  }

  private agendarMinimizar(windowId: number): void {
    const antes = this.reMinimizar.get(windowId);
    if (antes) clearTimeout(antes);
    this.reMinimizar.set(windowId, setTimeout(() => {
      this.reMinimizar.delete(windowId);
      chrome.windows.update(windowId, { state: 'minimized' }).catch(() => {});
    }, 20_000));
  }

  /**
   * Obra 17 (painel "Agentes agora"): ultima acao de cada agente, com o
   * resultado que ele recebeu. Atualizado em `responder()` — o ponto unico de
   * resposta que a obra 01 centralizou — para refletir o resultado FINAL
   * (depois dos ganchos "depois"), o mesmo que o agente ve.
   *
   * Duas rotas de resposta ficam FORA disto, de proposito e ja documentado
   * onde chamam `this.reply()` direto: `bridge_reload` (nao ha ws/ctx ainda) e
   * a falha de `resolveWorkspace()` no catch mais externo do `onMessage`
   * (idem). O painel nao mostra "ultima acao" para esses dois casos —
   * consequencia aceita, nao lacuna desta obra.
   */
  private ultimaAcao = new Map<string, { acao: string; ok: boolean; quando: number; erro?: string }>();

  /** Obra 17: nome do agente (`cmd.name`, obra 10) por clientId — so para exibir no painel. */
  private nomeDoCliente = new Map<string, string>();

  /** Comandos em andamento, por id. Base do "Parar tudo", do icone laranja e da duracao no painel. */
  private emVoo = new Map<string, { cmd: BridgeCommand; inicio: number; cancelar: () => void }>();
  /** Ids de comando cuja resposta ja foi dada pelo "Parar tudo": a resposta tardia do trabalho e descartada. */
  private cancelados = new Set<string>();
  /** Agentes parados pelo usuário: todo comando deles falha com MSG_PARADO ate `liberarAgentes()`. */
  private bloqueados = new Set<string>();
  private paradoEm = 0;
  /** Agentes conectados ao hub (o proprio hub incluso), como o hub os informa. */
  private peersLista: Array<{ clientId: string; name?: string }> = [];
  /** Pedidos de consumo ao hub aguardando resposta. */
  private consumoPendente = new Map<string, (dados: unknown) => void>();
  /** Ultimas acoes de todos os agentes, mais nova primeiro, para o painel. */
  private recentes: AcaoRecente[] = [];

  get online(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.stopped = false;

    // Alarme, e nao setInterval: o service worker MV3 dorme e levaria o timer
    // junto, deixando grupo de agente parado na tela indefinidamente.
    // So cria se ainda nao existe: criar de novo a cada acordar do SW adia o
    // disparo e, com o SW acordando seguido, o alarme nunca chegaria a tocar.
    void this.garantirAlarme(ALARME_FAXINA);
    chrome.alarms.onAlarm.addListener(async (alarme) => {
      if (alarme.name === ALARME_RECONECTAR) {
        // Repouso: 1 tentativa por minuto, sem laco de backoff.
        this.tentarDeNovo();
        return;
      }
      if (alarme.name !== ALARME_FAXINA) return;
      await this.encerrarOciosos();
      // Segunda rede: grupo sem dono, inclusive de antes do service worker dormir.
      await this.limparAbasOrfas();
    });

    // Token colado/trocado no painel: tenta na hora, nao no proximo minuto.
    chrome.storage.onChanged.addListener((mudancas, area) => {
      if (area === 'local' && mudancas.bridgeToken) this.tentarDeNovo();
    });
    chrome.runtime.onStartup.addListener(() => this.tentarDeNovo());

    // O usuario arrasta a janela da ponte uma vez para o canto (ou monitor) que
    // menos incomoda, e ela volta la sempre.
    chrome.windows.onBoundsChanged?.addListener((w) => {
      void this.lembrarPosicao(w);
    });

    // Aba filha: quando uma pagina abre outra aba (window.open, target="_blank",
    // popup), o Chrome dispara isto com `openerTabId` apontando para quem abriu.
    // Ver `aoCriarAba` — obra 08.
    chrome.tabs.onCreated.addListener((tab) => {
      void this.aoCriarAba(tab);
    });

    // FURO 7a, achado do cetico (06/09/2026): `abasCriadasPelaPonte` nunca
    // perdia id nenhum quando a aba MORRIA por fora (usuario fechou na mao,
    // outro agente fechou, o Chrome derrubou) -- so perdia em `encerrar()` e
    // `limparAbasOrfas()`, os dois caminhos que a propria ponte controla. O
    // Chrome REUSA id de aba fechada; enquanto o id fantasma ficasse no
    // conjunto, o freio de `close_tab` (~logo abaixo) achava que uma aba
    // NOVA e ALHEIA, que por acaso nasceu com o mesmo numero, "era dele".
    // Medido ao vivo em `test/cetico-aba-fantasma.js` e na segunda prova do
    // mesmo arquivo (fechar a mesma aba duas vezes): sem este listener, o
    // segundo `close_tab` cai no motor (`chrome.tabs.remove` de um id que ja
    // nao existe) em vez do erro `[aba do usuario] ... nao foi aberta pela
    // ponte`.
    //
    // `abasAdotadas` e `apagarIndicador` sao os OUTROS dois campos desta
    // classe indexados por tabId (achado do cetico) -- vazam pelo MESMO
    // motivo e sao limpos aqui junto. `apagarIndicadorJa` ja faz
    // clearTimeout + delete (e um sendMessage inofensivo para uma aba
    // morta, ja com `.catch`); reusar em vez de duplicar a limpeza do timer.
    // Os demais campos da classe (workspaceByClient, ultimoComando,
    // somenteLeitura, abaPropriaDoCliente, ultimaAcao, nomeDoCliente) sao
    // indexados por CLIENT ID, nao por tabId -- ficam de fora deste listener
    // de proposito; `resolveWorkspace()` ja trata aba morta do lado do
    // clientId (o "[aba trocou]" logo ali embaixo).
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.abasCriadasPelaPonte.delete(tabId);
      this.abasAdotadas.delete(tabId);
      this.apagarIndicadorJa(tabId);
    });

    // Painel "Agentes agora" (obra 17): estado ao vivo sob pedido do
    // sidepanel. So responde ao tipo PONTE_AGENTES — o roteador legado em
    // background/index.ts cai fora do `switch` para tipo desconhecido e nao
    // chama `respond` nem retorna `true` para ele, entao os dois listeners
    // de `chrome.runtime.onMessage` (registrados no MESMO service worker) nao
    // competem pela mesma mensagem. Ver "defeito irmao" no briefing da obra.
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      const tipo = (msg as { type?: string } | undefined)?.type;
      if (tipo === 'PONTE_AGENTES') {
        this.estadoDosAgentes().then(respond);
        return true;
      }
      if (tipo === 'PONTE_PAINEL') {
        this.montarPainel().then(respond).catch((err) => respond({ erro: String(err) }));
        return true;
      }
      // Botao "Parar tudo" e o "Liberar agentes" que o segue (painel lateral).
      if (tipo === 'PONTE_PARAR_TUDO') {
        this.pararTudo().then((r) => respond({ ok: true, ...r })).catch((err) => respond({ ok: false, error: String(err) }));
        return true;
      }
      // Painel lateral aberto: se a ponte esta em repouso, tenta ja.
      if (tipo === 'PONTE_RECONECTAR') {
        this.tentarDeNovo();
        respond({ ok: true, online: this.online, repouso: this.repouso });
        return;
      }
      // Botao "Zerar contadores": servidor arquiva o jsonl, a extensao limpa os dela.
      if (tipo === 'PONTE_ZERAR_CONTADORES') {
        this.zerarContadores().then((r) => respond(r)).catch((err) => respond({ ok: false, erro: String(err) }));
        return true;
      }
      if (tipo === 'PONTE_LIBERAR') {
        this.liberarAgentes().then((n) => respond({ ok: true, liberados: n }));
        return true;
      }
    });

    this.aoMudarEstado();
    await Promise.all([this.abasCriadasPelaPonte.restaurar(), this.abasAdotadas.restaurar(), this.restaurarAncora()]);
    void this.zeragemInicial();
    // Em repouso (service worker acordado por outro evento) nao reabre o laco:
    // quem tenta e o alarme, o painel ou o token.
    if (await this.lerRepouso()) {
      this.falhasSeguidas = FALHAS_ATE_REPOUSO - 1;
      this.repouso = true;
      await this.garantirAlarme(ALARME_RECONECTAR);
      return;
    }
    await this.connect();
  }

  private async garantirAlarme(nome: string): Promise<void> {
    try {
      if (!(await chrome.alarms.get(nome))) {
        await chrome.alarms.create(nome, { periodInMinutes: 1, delayInMinutes: 1 });
      }
    } catch { /* sem alarmes: segue */ }
  }

  private async lerRepouso(): Promise<boolean> {
    try {
      return (await chrome.storage.session.get('ponteRepouso')).ponteRepouso === true;
    } catch { return false; }
  }

  private async gravarRepouso(ligado: boolean): Promise<void> {
    this.repouso = ligado;
    try {
      if (ligado) await chrome.storage.session.set({ ponteRepouso: true });
      else await chrome.storage.session.remove('ponteRepouso');
    } catch { /* sem storage de sessao: so a memoria */ }
  }

  private guardarAncora(): void {
    const v = this.abaAncora;
    (v === undefined ? chrome.storage.session.remove('ponteAncora') : chrome.storage.session.set({ ponteAncora: v })).catch(() => {});
  }

  private async restaurarAncora(): Promise<void> {
    try {
      const id = (await chrome.storage.session.get('ponteAncora')).ponteAncora;
      if (typeof id === 'number' && (await this.tabAlive(id))) this.abaAncora = id;
    } catch { /* idem */ }
  }

  /** Tentativa explicita (alarme, painel aberto, token novo). Zera o backoff; no repouso faz UMA tentativa. */
  private tentarDeNovo(): void {
    if (this.stopped || this.online) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.reconnectDelay = RECONNECT_MIN_MS;
    if (!this.repouso) this.falhasSeguidas = 0;
    void this.connect();
  }

  /**
   * Uma aba nova nasceu. So nos interessa quando o `openerTabId` e uma aba que
   * a ponte conhece — senao e aba organica do usuario (Ctrl+T, por exemplo) ou
   * a propria aba que `abrirAbaPropria`/`workspaceManager.addTab` acabaram de
   * criar (essas nao passam `openerTabId`: `chrome.tabs.create` so preenche
   * esse campo quando a aba nasce de script/clique numa pagina, nunca quando a
   * extensao chama `tabs.create` ela mesma — conferido na medicao da obra 08).
   *
   * Duas rotas, nunca a mesma aba nas duas:
   *   - opener e aba DA PONTE (`abasCriadasPelaPonte`): a filha e adotada de
   *     verdade — entra no mesmo conjunto (a ponte pode fecha-la) e no
   *     workspace do agente dono do opener (para `browser_tabs_list` mostrar
   *     e `encerrar()` fechar quando ele sair).
   *   - opener e aba ADOTADA DO USUARIO (`abasAdotadas`): so registra no modulo
   *     para `cap_wait_new_tab` avisar. NUNCA entra em `abasCriadasPelaPonte` —
   *     a ponte nao pode ganhar dono de aba que nasceu do lado do usuario, e
   *     trocar para ela cai na adocao em leitura de sempre (`switch_tab`).
   */
  private async aoCriarAba(tab: chrome.tabs.Tab): Promise<void> {
    const openerTabId = tab.openerTabId;
    const novaId = tab.id;
    if (openerTabId === undefined || novaId === undefined) return;

    // `url` so vem definitivo no onUpdated; aqui e so o melhor palpite —
    // `cap_wait_new_tab` releo com chrome.tabs.get na hora de responder.
    const url = tab.pendingUrl ?? tab.url ?? '';
    const quando = Date.now();

    if (this.abasCriadasPelaPonte.has(openerTabId)) {
      this.abasCriadasPelaPonte.add(novaId);
      registrarFilha(openerTabId, { tabId: novaId, url, quando, daPonte: true });

      for (const workspaceId of this.workspaceByClient.values()) {
        const ws = workspaceManager.get(workspaceId);
        if (!ws || !ws.tabs[openerTabId]) continue;
        workspaceManager.update(workspaceId, {
          tabs: {
            ...ws.tabs,
            [novaId]: {
              tabId: novaId,
              windowId: tab.windowId,
              groupId: tab.groupId,
              url,
              isActive: false,
              lastObservedAt: quando,
            },
          },
        });
        break; // so um agente e dono do opener
      }
    } else if (this.abasAdotadas.has(openerTabId)) {
      registrarFilha(openerTabId, { tabId: novaId, url, quando, daPonte: false });
    }
  }

  private async lembrarPosicao(w: chrome.windows.Window): Promise<void> {
    const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
    if (w.id !== janelaDaPonte || w.state === 'minimized') return;
    if (w.left === undefined || w.top === undefined || !w.width || !w.height) return;
    await chrome.storage.local.set({
      janelaDaPonteBounds: { left: w.left, top: w.top, width: w.width, height: w.height },
    });
  }

  /** Fecha as abas de quem nao manda comando ha um tempo. */
  private async encerrarOciosos(janelaMs?: number): Promise<void> {
    const { ociosidadeMs } = await chrome.storage.local.get('ociosidadeMs');
    const janela = janelaMs ?? (typeof ociosidadeMs === 'number' ? ociosidadeMs : OCIOSIDADE_MS);
    const limite = Date.now() - janela;
    for (const [clientId, quando] of [...this.ultimoComando]) {
      if (quando > limite) continue;
      if (!this.workspaceByClient.has(clientId)) {
        this.ultimoComando.delete(clientId);
        continue;
      }
      console.log(`[Bridge] agente ${clientId} parado — soltando a aba`);
      this.ultimoComando.delete(clientId);
      // `viaFaxina: true` — SO esta chamada. Desconexao (bridge_close_workspace,
      // encerrarTodos) continua fechando como sempre; ver comentario em `encerrar`.
      await this.encerrar(clientId, { viaFaxina: true });
    }
  }

  stop(): void {
    this.stopped = true;
    this.pararKeepaliveWs();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'parado pelo usuario');
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.online) return;
    if (this.ws?.readyState === WebSocket.CONNECTING) return;

    const token = await this.getToken();
    if (!token) {
      console.warn('[Bridge] sem token de pareamento — cole o token no painel da extensao');
      // Sem token nao ha o que tentar: repouso direto (o token novo acorda sozinho).
      this.falhasSeguidas = FALHAS_ATE_REPOUSO;
      return this.scheduleReconnect();
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(BRIDGE_URL);
    } catch (err) {
      console.warn('[Bridge] nao consegui abrir o socket:', err);
      return this.scheduleReconnect();
    }
    this.ws = ws;
    let abriu = false;
    this.acolhido = false;

    ws.onopen = async () => {
      abriu = true;
      this.iniciarKeepaliveWs(ws);
      const [perfil, instanceId] = await Promise.all([this.getPerfil(), this.getInstanceId()]);
      ws.send(JSON.stringify({ type: 'hello', role: 'extension', token, perfil, instanceId }));
      console.log(`[Bridge] conectada ao hub — perfil "${perfil}"`);
      void this.broadcastStatus(true);
      // Sobra de execucao anterior: aba que a propria ponte abriu e ficou sem dono.


      void this.limparAbasOrfas();
    };

    ws.onmessage = (event) => {
      void this.onMessage(event.data as string);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.pararKeepaliveWs();
      const foiAcolhido = this.acolhido;
      this.acolhido = false;
      if (abriu) {
        // Havia conexao de verdade: avisa o painel e solta os workspaces (a aba do
        // usuario fica intacta; so aba aberta pela ponte e fechada). Tentativa que
        // nunca abriu nao tem nada a soltar nem a avisar.
        this.peersLista = [];
        this.aoMudarEstado();
        void this.broadcastStatus(false);
        void this.encerrarTodos();
      }
      // So conta como conexao boa quem o hub acolheu (welcome sem erro). Token errado
      // ou perfil em uso abre e fecha na hora: isso e falha, com backoff e repouso.
      if (!foiAcolhido) this.falhasSeguidas++;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // O close cuida da reconexao; aqui so evitamos erro nao tratado.
    };
  }

  /** O hub aceitou o hello: a conexao e de verdade. Zera backoff e falhas e sai do repouso. */
  private aoAcolher(): void {
    this.acolhido = true;
    this.falhasSeguidas = 0;
    this.reconnectDelay = RECONNECT_MIN_MS;
    if (this.repouso) {
      void this.gravarRepouso(false);
      chrome.alarms.clear(ALARME_RECONECTAR).catch(() => {});
    }
  }

  /** Mensagem barata no WS aberto: no Chrome 116+ renova o prazo de 30 s do service worker (substitui o ping do offscreen). */
  private iniciarKeepaliveWs(ws: WebSocket): void {
    this.pararKeepaliveWs();
    this.keepaliveWs = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ka"}');
    }, KEEPALIVE_WS_MS);
  }

  private pararKeepaliveWs(): void {
    if (this.keepaliveWs) clearInterval(this.keepaliveWs);
    this.keepaliveWs = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.falhasSeguidas >= FALHAS_ATE_REPOUSO) {
      if (!this.repouso) console.log('[Bridge] hub fora do ar: paro de insistir, tento 1 vez por minuto');
      void this.gravarRepouso(true);
      void this.garantirAlarme(ALARME_RECONECTAR);
      return;
    }
    const delay = this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }

  private async getToken(): Promise<string | null> {
    const stored = await chrome.storage.local.get('bridgeToken');
    return (stored.bridgeToken as string | undefined)?.trim() || null;
  }

  /**
   * Nome do perfil que esta extensao apresenta ao hub. `chrome.storage.local`
   * e por PERFIL do Chrome (cada instalacao tem o seu), entao basta ler um
   * valor gravado pelo usuário no painel da extensao. Sem nada salvo, cai
   * em "padrao" — a instalacao existente (a pessoal) nunca precisa configurar
   * nada para continuar funcionando exatamente como hoje.
   *
   * Por que nao `chrome.identity.getProfileUserInfo`: pede uma permissao nova
   * no manifest so para isto, e devolveria o e-mail da conta Google logada no
   * Chrome — nem sempre e o dado que o usuário quer usar como nome de
   * perfil (ele pode nao estar logado, ou querer um nome mais claro que o
   * e-mail, ex.: "trabalho"). Um campo de texto no painel resolve sem
   * permissao nova e da controle total do nome a quem vai chamar por ele.
   */
  private async getPerfil(): Promise<string> {
    const stored = await chrome.storage.local.get('bridgePerfil');
    return (stored.bridgePerfil as string | undefined)?.trim() || 'padrao';
  }

  /**
   * Identidade estavel DESTA instalacao, gerada uma vez e guardada em
   * `chrome.storage.local` (que ja e por perfil do Chrome). Nao e o nome do
   * perfil — e o que deixa o hub diferenciar "a mesma extensao reconectando"
   * (substitui, comportamento de sempre) de "duas extensoes de verdade
   * apresentando o mesmo nome de perfil" (recusa a segunda, ver hub.js).
   */
  private async getInstanceId(): Promise<string> {
    const stored = await chrome.storage.local.get('bridgeInstanceId');
    const existente = stored.bridgeInstanceId as string | undefined;
    if (existente) return existente;
    const novo = crypto.randomUUID();
    await chrome.storage.local.set({ bridgeInstanceId: novo });
    return novo;
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: BridgeCommand | { type: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'welcome') {
      // Hub recusou o hello (nome de perfil ja em uso por outra extensao
      // viva). Fica claro no console em vez de reconectar em silencio.
      const erro = (msg as { erro?: string }).erro;
      if (erro) console.warn(`[Bridge] ${erro}`);
      else this.aoAcolher();
      return;
    }
    if (msg.type === 'peers') {
      // O hub avisa quem esta conectado a ele (agentes = sessoes de Claude Code, Codex...).
      const lista = (msg as { agentes?: unknown }).agentes;
      this.peersLista = Array.isArray(lista) ? lista as Array<{ clientId: string; name?: string }> : [];
      this.aoMudarEstado();
      return;
    }
    if (msg.type === 'consumo' || msg.type === 'zerar_consumo') {
      const m = msg as { id?: string; dados?: unknown };
      const espera = m.id ? this.consumoPendente.get(m.id) : undefined;
      if (espera) { this.consumoPendente.delete(m.id!); espera(m.dados ?? null); }
      return;
    }
    if (msg.type !== 'cmd') return;
    await this.comandoRastreado(msg as BridgeCommand);
  }

  /**
   * Porta de entrada de todo comando: barra quem o usuário parou, registra o
   * comando como "em voo" (icone, painel, "Parar tudo") e o corre contra a
   * promessa de cancelamento — `pararTudo()` resolve esta e o agente ja recebeu
   * o erro, mesmo que o trabalho la dentro demore a perceber que as abas sumiram.
   */
  private async comandoRastreado(cmd: BridgeCommand): Promise<void> {
    await this.carregarBloqueio();
    // USO DE TESTE, como `cap_fechar_aba_admin`: nenhuma tool do servidor MCP as expoe; so o teste
    // (peer bruto) as chama. Fazem o mesmo que os botoes "Parar tudo" e "Liberar agentes" do painel
    // lateral, que nao da para clicar de fora. Ficam aqui, antes do portao e sem workspace, para
    // nao abrir aba nenhuma e para o proprio comando nao ser interrompido pela parada.
    if (cmd.action === 'cap_parar_tudo_admin') {
      this.reply(cmd, true, await this.pararTudo(cmd.id));
      return;
    }
    if (cmd.action === 'cap_desanexar_admin') {
      // So teste (v6.1 b): solta o debugger de UMA aba por fora da ponte, depois de `atraso_ms`, para provar o
      // retry ao vivo (comando seguinte: "not attached"; comando em voo: "Detached while handling command").
      // Nao atualiza o estado do DebuggerManager de proposito: e assim que o Chrome faz quando o DevTools toma a sessao.
      const pa = (cmd.args?.params ?? {}) as { tabId?: number; atraso_ms?: number };
      if (!Number.isFinite(Number(pa.tabId))) { this.reply(cmd, false, undefined, 'cap_desanexar_admin: tabId invalido.'); return; }
      if (pa.atraso_ms) await new Promise((r) => setTimeout(r, pa.atraso_ms));
      await chrome.debugger.detach({ tabId: Number(pa.tabId) }).catch(() => {});
      this.reply(cmd, true, { desanexou: Number(pa.tabId) });
      return;
    }
    if (cmd.action === 'cap_icone_admin') {
      // So leitura: o que o status-icone aplicou de verdade e o badge que o Chrome guardou.
      this.reply(cmd, true, {
        aplicado: { ...iconeAplicado },
        badgeLido: await chrome.action.getBadgeText({}),
        agentesNoHub: this.peersLista.length,
        comandosEmVoo: this.emVoo.size,
      });
      return;
    }
    if (cmd.action === 'cap_painel_admin') {
      this.reply(cmd, true, await this.montarPainel()); // mesma carga que o painel lateral recebe
      return;
    }
    if (cmd.action === 'cap_avisos_admin') {
      // So leitura (e `reiniciar` para isolar passos do teste): avisos tentados e o que o Chrome tem de ativo.
      if ((cmd.args?.params as { reiniciar?: boolean } | undefined)?.reiniciar) await reiniciarAvisos();
      this.reply(cmd, true, {
        ligados: await avisosLigados(),
        registro: registroAvisos,
        ativas: await notificacoesAtivas(),
      });
      return;
    }
    if (cmd.action === 'cap_decisao_teste_admin') {
      // So teste (v6.1 f). 'ligar'/'desligar': decisao simulada em host local (nada vai ao Windows). 'negar': aperta o
      // botao NEGAR / CANCELAR (indice 1) de uma decisao. NAO existe 'aprovar' de proposito: aprovar e clique humano.
      const pd = (cmd.args?.params ?? {}) as { modo?: string; id?: string };
      if (pd.modo === 'ligar' || pd.modo === 'desligar') await ligarModoTesteDecisao(pd.modo === 'ligar');
      else if (pd.modo === 'negar') {
        const nid = pd.id ? await notificacaoDaDecisao(pd.id) : undefined;
        if (!nid) { this.reply(cmd, false, undefined, 'cap_decisao_teste_admin: decisao sem notificacao.'); return; }
        await tratarBotao(nid, 1);
      } else { this.reply(cmd, false, undefined, 'cap_decisao_teste_admin: modo invalido (ligar, desligar, negar).'); return; }
      this.reply(cmd, true, { modoTeste: await modoTesteDecisaoLigado() });
      return;
    }
    if (cmd.action === 'cap_liberar_admin') {
      this.reply(cmd, true, { liberados: await this.liberarAgentes() });
      return;
    }
    if (this.bloqueados.has(cmd.clientId) && cmd.action !== 'bridge_close_workspace') {
      this.reply(cmd, false, undefined, MSG_PARADO);
      return;
    }
    let cancelar: () => void = () => {};
    const cancelada = new Promise<void>((resolve) => { cancelar = resolve; });
    this.emVoo.set(cmd.id, { cmd, inicio: Date.now(), cancelar });
    this.aoMudarEstado();
    try {
      await Promise.race([this.executarComando(cmd), cancelada]);
    } finally {
      this.emVoo.delete(cmd.id);
      this.aoMudarEstado();
    }
  }

  /** Gancho de mudanca de estado (agentes conectados, comando em voo). Icone e badge ligam aqui. */
  private aoMudarEstado(): void {
    const agentes = this.online ? this.peersLista.length : 0; // `peersLista` ja conta o proprio hub
    // Subida e imediata; a descida espera 1,2 s sem comando, para uma fila de comandos seguidos
    // nao fazer o icone piscar entre laranja e cinza. So transicoes reescrevem (status-icone.ts decide).
    if (this.emVoo.size > 0) {
      if (this.timerIconeOcioso) { clearTimeout(this.timerIconeOcioso); this.timerIconeOcioso = null; }
      this.iconeRodando = true;
      void atualizarStatus(agentes, true);
      return;
    }
    if (this.timerIconeOcioso) clearTimeout(this.timerIconeOcioso);
    this.timerIconeOcioso = setTimeout(() => {
      this.timerIconeOcioso = null;
      this.iconeRodando = this.emVoo.size > 0;
      void atualizarStatus(this.online ? this.peersLista.length : 0, this.iconeRodando);
    }, 1_200);
    void atualizarStatus(agentes, this.iconeRodando);
  }
  private timerIconeOcioso: ReturnType<typeof setTimeout> | null = null;
  private iconeRodando = false;

  private async executarComando(cmdEntrada: BridgeCommand): Promise<void> {
    let cmd = cmdEntrada;
    this.ultimoComando.set(cmd.clientId, Date.now());

    // O agente saiu: fecha as abas dele.
    if (cmd.action === 'bridge_close_workspace') {
      await this.encerrar(cmd.clientId);
      return;
    }

    // Recarrega a extensao sob comando. Sem isto, toda correcao no codigo da
    // extensao exige o usuario clicar em recarregar no chrome://extensions.
    //
    // Fica FORA de responder() de proposito (achado F4 do cetico, 05/09/2026):
    // aqui nao existe aba nem workspace ainda — ContextoCapacidade exige `ws` e
    // `tabId` reais, e forjar um ws vazio so para passar pelos ganchos "depois"
    // contaminaria a auditoria da obra 10 com dado inventado. bridge_reload
    // derruba a sessao de TODOS os agentes (ws.onclose -> encerrarTodos()) e por
    // isso e exatamente a acao que a obra 10 mais precisa registrar; ela deve
    // tratar isto com um gancho proprio no onMessage (que ve cmd.action antes de
    // qualquer ws), nao fingindo um ContextoCapacidade que nao existe.
    if (cmd.action === 'bridge_reload') {
      this.reply(cmd, true, 'recarregando a extensao');
      setTimeout(() => chrome.runtime.reload(), 200);
      return;
    }

    // Diagnostico do proprio agente: quais abas sao dele e se o grupo pegou.
    if (cmd.action === 'bridge_tabs') {
      let ws: AgentWorkspace;
      try {
        ws = await this.resolveWorkspace(cmd.clientId, cmd.name, cmd.action);
      } catch (err) {
        // Sem workspace resolvido ainda nao ha ws/tabId para montar o
        // ContextoCapacidade — mesmo caso do catch mais externo, la embaixo.
        this.reply(cmd, false, undefined, err instanceof Error ? err.message : String(err));
        return;
      }

      const ctx: ContextoCapacidade = {
        clientId: cmd.clientId,
        nome: cmd.name,
        ws,
        tabId: ws.activeTabId,
        params: {} as Record<string, never>,
        confirm: false,
        acao: cmd.action,
        emSomenteLeitura: this.somenteLeitura.has(cmd.clientId),
      };
      try {
        const abas = await Promise.all(
          Object.keys(ws.tabs).map(async (id) => {
            const tab = await chrome.tabs.get(Number(id)).catch(() => null);
            return tab && {
              tabId: tab.id,
              url: tab.url,
              title: tab.title,
              groupId: tab.groupId,
              windowId: tab.windowId,
            };
          }),
        );
        await this.responder(cmd, ctx, {
          ok: true,
          data: {
            workspaceId: ws.workspaceId,
            nome: ws.name,
            tabGroupId: ws.tabGroupId,
            agrupado: ws.tabGroupId !== chrome.tabGroups.TAB_GROUP_ID_NONE,

            activeTabId: ws.activeTabId,
            modo: this.somenteLeitura.has(cmd.clientId) ? 'somente leitura (aba do usuario)' : 'acao (aba propria)',
            abaPropria: this.abaPropriaDoCliente.get(cmd.clientId),
            janelaDaPonte: (await chrome.storage.local.get('janelaDaPonte')).janelaDaPonte,
            abas: abas.filter(Boolean),
            totalDeAbasNoChrome: (await chrome.tabs.query({})).length,
          },
        });
      } catch (err) {
        await this.responder(cmd, ctx, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    let soltarIndicador: (() => void) | null = null;
    let soltarVez: (() => void) | undefined;
    try {
      const wsDaSessao = await this.resolveWorkspace(cmd.clientId, cmd.name, cmd.action);

      // ABA EXPLICITA POR COMANDO (26/09/2026, sessao "Storytelling e Animacao
      // JS"): subagentes da tool Agent herdam a conexao da sessao-mae, entao
      // tinham o MESMO clientId e caiam na MESMA aba — 7 em paralelo, um
      // navegando enquanto o outro anexava arquivo. Com `aba`, o comando age
      // naquela aba e so nele: a aba "da sessao" nao muda. So vale aba que a
      // ponte abriu para esta sessao — aba do usuário nunca entra por aqui.
      let ws = wsDaSessao;
      let leitura = this.somenteLeitura.has(cmd.clientId);
      const abaPedida = (cmd.args as { aba?: unknown } | undefined)?.aba;
      if (abaPedida !== undefined && abaPedida !== null) {
        const id = Number(abaPedida);
        const minha = Number.isInteger(id) && String(id) in wsDaSessao.tabs && this.abasCriadasPelaPonte.has(id);
        if (!minha || !(await this.tabAlive(id))) {
          this.reply(cmd, false, undefined,
            `[aba] a aba ${String(abaPedida)} nao e uma aba aberta pela ponte para esta sessao (ou ja foi fechada). `
            + 'Abra a sua com browser_tab_open e passe o newTabId que ele devolver em "aba".');
          return;
        }
        ws = { ...wsDaSessao, activeTabId: id };
        leitura = false;
      }
      soltarIndicador = this.acenderIndicador(ws.activeTabId);

      // V3: host que exige digitacao real (Portal de Assinaturas da OAB) -- o `type`
      // rapido vira `cap_digitar` aqui, antes do ctx e do freio, para o resto do
      // caminho (somente leitura, freio de senha, auditoria) ver a acao verdadeira.
      if (cmd.action === 'type') {
        const { tecladoHosts } = await chrome.storage.local.get('tecladoHosts');
        const url = (await chrome.tabs.get(ws.activeTabId).catch(() => null))?.url;
        const reescrito = reescreverTypeParaTeclado(
          cmd, url, Array.isArray(tecladoHosts) ? (tecladoHosts as string[]) : undefined,
        );
        if (reescrito) cmd = reescrito;
      }

      const ctx: ContextoCapacidade = {
        clientId: cmd.clientId,
        nome: cmd.name,
        ws,
        tabId: ws.activeTabId,
        ref: cmd.args?.target?.agentId,
        params: (cmd.args?.params ?? {}) as Record<string, never>,
        confirm: cmd.args?.confirm === true,
        acao: cmd.action,
        // Obra 20: mesmo sinal que o `if` logo abaixo consulta para barrar por
        // NOME de acao. Capacidade que precisa decidir por CONTEUDO (cap_js,
        // que roda liso na aba do usuario porque bloquear tudo quebraria
        // leitura legitima) le este campo em vez de reimplementar a checagem.
        emSomenteLeitura: leitura,
      };

      // Aba do usuario e so leitura, a menos que ele tenha liberado.
      if (leitura && alteraAPagina(cmd.action)) {
        await this.responder(cmd, ctx, {
          ok: false,
          error: '[somente leitura] esta e a aba do usuario, e voce so tem permissao para ler. '
            + 'Para agir nela, pergunte a ele e repita browser_use_current_tab com permitir_acao: true. '
            + 'Para navegar ou clicar sem incomodar, volte para a sua aba com browser_use_own_tab.',
        });
        return;
      }

      // switch_tab era um caminho ate a aba do usuario SEM modo leitura: o motor
      // aceita qualquer tabId e troca o workspace em modo acao. Aba que nao e da
      // ponte e do usuario, e entra pela mesma porta que browser_use_tab — leitura
      // ate ele liberar. Voltar para aba da ponte solta a leitura.
      //
      // O alvo usa `resolverAlvoDeSwitchTab`, a MESMA funcao que o motor usa
      // (execution-engine/index.ts) — FURO 1, medido ao vivo em 06/09/2026:
      // antes deste conserto o freio calculava `Number(params.tabId ??
      // target.agentId)` e testava `if (alvo && ...)`; com `tabId: 0`, `alvo`
      // virava `0` (FALSY), o `if` inteiro era pulado e a linha seguinte
      // apagava o modo somente leitura SEM checar nada — o motor, por sua
      // vez, lia `params.tabId || target.agentId`, outro `||`, e podia trocar
      // para um `target.agentId` que o freio nunca examinou. `null` aqui
      // cobre tabId ausente, 0, negativo, NaN e string: falha fechada, nunca
      // segue em frente como se a troca não tivesse sido pedida.
      if (cmd.action === 'switch_tab') {
        const alvo = resolverAlvoDeSwitchTab({ params: cmd.args?.params, target: cmd.args?.target });
        if (alvo === null) {
          await this.responder(cmd, ctx, {
            ok: false,
            error: '[switch_tab] tabId invalido ou ausente (esperado inteiro positivo, em params.tabId '
              + 'ou target.agentId). O modo da aba atual nao mudou.',
          });
          return;
        }
        if (!this.abasCriadasPelaPonte.has(alvo)) {
          try {
            const tab = await chrome.tabs.get(alvo);
            await this.responder(cmd, ctx, { ok: true, data: await this.adotarAbaDoUsuario(cmd.clientId, ws, tab, false) });
          } catch (err) {
            // Aba alvo sumiu (fechada por fora): o erro tem de passar pelos
            // ganchos "depois" como qualquer outra resposta — achado F4 do
            // cetico (05/09/2026): sem este try/catch local, chrome.tabs.get
            // joga o erro para o catch mais externo, que nao tem ctx e nunca
            // chama responder(), e browser_tab_switch com aba fechada some da
            // auditoria da obra 10.
            await this.responder(cmd, ctx, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        // Alvo e da ponte (aba propria do agente): cai no caminho normal
        // (motor), que resolve o MESMO alvo pela mesma funcao. FURO 7b,
        // achado do cetico (06/09/2026): o `somenteLeitura.delete` que
        // rodava AQUI, antes de o motor sequer tentar a troca, soltava o
        // modo leitura mesmo quando `chrome.tabs.update` (a troca de
        // verdade, la embaixo) FALHASSE -- o agente ficava sem protecao na
        // aba do usuario tendo continuado, de fato, nela. O delete agora
        // mora depois de `result.success` confirmar que o motor trocou de
        // aba (procure "FURO 7b" mais abaixo).
      }

      // open_tab tratado AQUI, antes do motor: `workspaceManager.addTab` faz
      // `chrome.tabs.create({ url, active: false })` SEM windowId, e para um
      // service worker "janela atual" e a focada — a do usuario (achado 1 da
      // obra 08, medido em 05/09/2026: aba nova nasceu numa janela diferente
      // de `janelaDaPonte`). `abrirAbaPropria()` ja cria no lugar certo e ja
      // marca `abasCriadasPelaPonte` — reusa-la em vez de consertar `addTab`.
      if (cmd.action === 'navigate') {
        const recusa = await this.recusaSessaoUnica(cmd.args?.params?.url as string | undefined, ws.activeTabId);
        if (recusa) { await this.responder(cmd, ctx, { ok: false, error: recusa }); return; }
      }

      if (cmd.action === 'open_tab') {
        try {
          const url = cmd.args?.params?.url as string | undefined;
          const recusa = await this.recusaSessaoUnica(url, ws.activeTabId);
          if (recusa) { await this.responder(cmd, ctx, { ok: false, error: recusa }); return; }
          const branca = this.brancaDoCliente.get(cmd.clientId);
          this.brancaDoCliente.delete(cmd.clientId);
          const tab = branca !== undefined && branca === ws.activeTabId && await this.tabAlive(branca)
            ? await chrome.tabs.get(branca)
            : await this.abrirAbaPropria();
          const novaId = tab.id!;
          if (url) await chrome.tabs.update(novaId, { url });

          workspaceManager.update(ws.workspaceId, {
            tabs: {
              ...ws.tabs,
              [novaId]: {
                tabId: novaId,
                windowId: tab.windowId,
                groupId: tab.groupId,
                url: url ?? tab.url ?? 'about:blank',
                isActive: true,
                lastObservedAt: Date.now(),
              },
            },
          });
          workspaceManager.switchActiveTab(ws.workspaceId, novaId);
          ws.activeTabId = novaId;

          await this.responder(cmd, ctx, { ok: true, data: { newTabId: novaId } });
        } catch (err) {
          await this.responder(cmd, ctx, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // close_tab tratado AQUI, antes do motor: o motor faz `chrome.tabs.remove`
      // sem checar dono nenhum — fecha QUALQUER aba do Chrome, inclusive a do
      // usuario (achado 2 da obra 08). So a aba que a propria ponte abriu pode
      // ser fechada por ela; fechar a aba do proprio agente continua permitido
      // (e o caso do test/aba-sumiu.js: B fecha a aba de A, que e da ponte).
      //
      // O alvo usa `resolverAlvoDeCloseTab`, a MESMA funcao que o motor usa
      // (execution-engine/index.ts) — achado dos dois auditores, 06/09/2026:
      // antes deste conserto o freio calculava o alvo so com
      // `params.tabId ?? ws.activeTabId`, nunca olhando `target.agentId`,
      // enquanto o motor aceitava `target.agentId` como tabId cru. Bastava
      // mandar close_tab com target.agentId preenchido e SEM params.tabId: o
      // freio verificava a aba ATIVA do proprio agente (dele, entao libera) e
      // o motor fechava OUTRA aba (a de target.agentId), nunca checada.
      if (cmd.action === 'close_tab') {
        const alvo = resolverAlvoDeCloseTab(
          { params: cmd.args?.params, target: cmd.args?.target },
          ws.activeTabId,
        );
        if (!this.abasCriadasPelaPonte.has(alvo)) {
          await this.responder(cmd, ctx, {
            ok: false,
            error: `[aba do usuario] a aba ${alvo} nao foi aberta pela ponte; eu so fecho aba que eu `
              + 'mesma abri. Feche-a voce ou peca ao usuario.',
          });
          return;
        }
        this.fechadasPeloDono.add(`${cmd.clientId}:${alvo}`);
        // Alvo e da ponte: cai no caminho normal (motor), que resolve o MESMO
        // alvo pela mesma funcao — nunca mais diverge do que o freio checou.
      }

      // Janela da ponte MINIMIZADA (30/09/2026): o Chrome nao desenha a pagina,
      // a janela vira 0x0, o hit-test responde "nao ha no" para qualquer ponto
      // e o clique cai no vazio — o freio nem tem o que examinar. Minimizar a
      // janela e natural (ela atrapalha), entao quem se ajeita e a ponte.
      const daFrente = ACOES_DA_FRENTE.has(cmd.action);
      if (daFrente) soltarVez = await this.pegarVez(ws.activeTabId, () => this.prorrogar(cmd));
      await this.garantirJanelaDesenhada(ws.activeTabId, daFrente);

      let resultado: Resultado;
      try {
        // Ganchos "antes": rodam antes do freio (avaliar faz chamada CDP; um
        // modulo que precise barrar tem de conseguir fazer isso antes dela).
        for (const g of ganchos()) {
          if (g.antes) await g.antes(ctx);
        }

        // L5: ref de elemento DENTRO de moldura de outro site (f<n>:<id>). Caminho
        // proprio, mas com o mesmo freio (avaliar) sobre o botao real de la de dentro.
        const molduraRef = (cmd.args?.target as { strategy?: string; ref?: string } | undefined);
        if (molduraRef?.strategy === 'moldura-ref') {
          resultado = await this.agirNaMoldura(cmd, ws, String(molduraRef.ref ?? ''));
        } else if (cmd.action.startsWith('cap_')) {
          const dado = await this.comAbaPronta(cmd.action, ws, () => this.executarCapacidade(cmd, ws, ctx));
          resultado = { ok: true, data: dado };
        } else {
          const action = {
            type: cmd.action,
            target: cmd.args?.target,
            params: cmd.args?.params,
          } as PlannedAction;

          // ALVO UNICO (obra 25): resolve UMA vez, aqui, e o mesmo objeto vai
          // para o freio e para o motor. Antes cada lado resolvia o seu — em
          // instantes diferentes, por caminhos diferentes — e foi dessa fresta
          // que sairam os oito furos da familia "o freio confere uma coisa e o
          // motor faz outra". A lista de quem paga isso e
          // `ACOES_COM_ALVO_UNICO`, a MESMA que o motor consulta para exigir o
          // alvo: se divergissem, uma acao entraria no motor sem alvo e ele
          // voltaria a resolver sozinho.
          let resolucao: Resolucao | undefined;
          let alvo: AlvoResolvido | undefined;
          // L4 (fase 4): ref lido em outro documento (a pagina navegou/recarregou) nao e confiavel.
          if ((cmd.action === 'click' || cmd.action === 'type')
            && (action.target as { strategy?: string } | undefined)?.strategy === 'agent-id') {
            const trocou = await documentoTrocou(ws.activeTabId);
            if (trocou) {
              resultado = { ok: false, error: `${cmd.action}: ${trocou}` };
              await this.responder(cmd, ctx, resultado);
              return;
            }
          }
          if (ACOES_COM_ALVO_UNICO.has(cmd.action)) {
            // Fora de `comAbaPronta` DE PROPOSITO: resolver o alvo e leitura
            // (CDP + injecao de script), que funciona com a aba em segundo
            // plano — quem precisa da aba pintada e o INPUT, e esse continua
            // dentro da fila. Enfileirar duas vezes o mesmo comando abriria uma
            // janela entre o freio e o motor para OUTRO agente ativar a aba
            // dele, e o clique deste cairia numa aba nao pintada, em silencio.
            const r = await resolverAlvoDaAcao(action, ws.activeTabId);
            resolucao = r;
            if (r.ok) alvo = r.alvo;
            else if (r.causa !== 'no-inexistente' && r.causa !== 'sem-alvo') {
              // Falha FECHADA: nao sei em que elemento isto cai. As duas causas
              // acima sao a excecao documentada em `policy.ts`
              // (`vereditoDeResolucaoFalha`) — o motor falha pelo mesmo motivo,
              // com a mensagem que diz o que fazer, entao passam.
              resultado = {
                ok: false,
                // S2: `exato:true` com mais de um candidato -- a mensagem do motor ja
                // lista os candidatos e diz como desempatar.
                error: r.causa === 'ambiguo'
                  ? `[bloqueado] ${cmd.action}: ${r.motivo}`
                  : `[bloqueado] ${cmd.action}: nao consegui identificar com seguranca o elemento `
                    + `que esta acao vai tocar (${r.motivo}). Releia a pagina com browser_read_page, `
                    + 'role ate o elemento ficar visivel e repita com uma ref atual.',
              };
              await this.responder(cmd, ctx, resultado);
              return;
            }
          }

          const veredito = await avaliar(action, ws, cmd.args?.confirm === true, alvo);
          if (!veredito.permitido) {
            this.avisarSeEspera(ws.activeTabId, veredito, action);
            resultado = { ok: false, error: `[bloqueado] ${veredito.motivo}` };
          } else {
            const result = await this.comAbaPronta(cmd.action, ws, () => executionEngine.run(action, ws, resolucao));

            // FURO 7b (ver comentario "Alvo e da ponte" la em cima, ~linha
            // 585): so agora, com `result.success` confirmando que o motor
            // TROCOU de aba de verdade (`chrome.tabs.update` nao lancou), e
            // que faz sentido soltar o modo somente leitura do agente. Antes
            // deste conserto o delete rodava no bloco de cima, ANTES desta
            // linha — se o motor falhasse (aba sumiu entre o freio e o motor,
            // por exemplo), o agente perdia a protecao sem ter de fato saido
            // da aba do usuario.
            if (cmd.action === 'switch_tab' && result.success) {
              this.somenteLeitura.delete(cmd.clientId);
            }

            // Toda escrita devolve o que ficou no campo, nao so "ok". No PJe quase
            // nada da erro: ele aceita o valor errado e segue. A leitura de volta e a
            // defesa, e fica muito mais barata vindo da propria tool.
            //
            // ACHADO MEDIDO (06/09/2026): o `lido` vinha do no NOMEADO, nao do
            // que recebeu o texto — `browser_type({ref:<wrapper>, text:'X'})`
            // respondia `lido: ""` enquanto o `<input>` interno ficava com 'X'.
            // A resposta ate confessava o alvo real no campo `element` e mesmo
            // assim reportava o campo vazio. Agora le o EFETIVO, o mesmo no que
            // o freio julgou e o motor escreveu.
            if (cmd.action === 'type' && result.success && alvo) {
              let lido = await lerValorDoElemento(ws.activeTabId, alvo.efetivo.backendNodeId);
              // Campo dentro de moldura de outro site: o efetivo aqui e o
              // <iframe>, que nao tem valor. Le la dentro (23/09/2026).
              const m = !lido ? await focoEmMoldura(ws.activeTabId) : null;
              if (m) lido = m.valor;
              result.data = {
                ...(result.data as object ?? {}), lido,
                ...(m ? { moldura: m.host } : {}),
                ...(m && m.valor === null ? { aviso: `o foco esta numa moldura de outro site (${m.host}) e nao deu para reler o campo: confira com browser_screenshot` } : {}),
              };
            }

            // open_tab nao chega mais aqui (obra 08 intercepta antes do motor,
            // linha ~503, e sempre retorna) — o que abria a aba certa e marcava
            // `abasCriadasPelaPonte` DEPOIS do resultado do motor morava aqui;
            // saiu junto, senao seria comentario mentindo sobre codigo morto.

            // TODO: registrar no auditLogger com o formato AuditEvent correto.
            resultado = result.success ? { ok: true, data: result.data } : { ok: false, error: result.error };
          }
        }
      } catch (err) {
        resultado = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      await this.responder(cmd, ctx, resultado);
    } catch (err) {
      // So cai aqui quando resolveWorkspace() falha (linha ~348, antes do ctx
      // existir) — sem ws nao ha ContextoCapacidade para os ganchos "depois"
      // avaliarem, entao este e o unico this.reply legitimamente fora de
      // responder() no caminho principal (achado F4 do cetico, 05/09/2026).
      this.reply(cmd, false, undefined, err instanceof Error ? err.message : String(err));
    } finally {
      soltarVez?.();
      soltarIndicador?.();
    }
  }

  /**
   * O freio barrou e a saida e o usuário: ou a acao pede a confirmacao dele
   * (`confirmavel`), ou e campo de senha, que so ele digita. Aviso do Windows nos dois.
   */
  private avisarSeEspera(
    tabId: number, veredito: { confirmavel?: boolean; motivo?: string; decisaoId?: string }, action?: PlannedAction,
  ): void {
    // Navegacao barrada (banco): o site que importa e o DESTINO, nao a aba em que o agente esta.
    let destino: string | undefined;
    if (action?.type === 'navigate') {
      try { destino = new URL(String(action.params?.url ?? '')).host || undefined; } catch { /* url invalida */ }
    }
    if (veredito.confirmavel) {
      // v6.1 (f): com decisao aberta o aviso ja saiu, com botoes (policy.avaliar); nao repete.
      if (!veredito.decisaoId) void avisarEspera(tabId, 'ação barrada pede sua confirmação', destino);
    } else if (/senha/i.test(veredito.motivo ?? '')) {
      void avisarEspera(tabId, 'campo de senha: só você pode digitar');
    }
  }

  /**
   * L5: clique/digitacao por ref de moldura de outro site. O alvo vira um
   * `AlvoResolvido` com o descritor do elemento real, passa por `avaliar` (texto
   * destrutivo, senha/cartao, host financeiro da moldura e da aba) e so entao age.
   */
  private async agirNaMoldura(cmd: BridgeCommand, ws: AgentWorkspace, ref: string): Promise<Resultado> {
    const acao = cmd.action;
    if (acao !== 'click' && acao !== 'type' && acao !== 'cap_digitar') {
      return { ok: false, error: `${acao}: ref de moldura (${ref}) so vale em browser_click e browser_type.` };
    }
    if (!ehRefMoldura(ref)) {
      return { ok: false, error: `${acao}: ref de moldura invalido (${JSON.stringify(ref)}); o formato e f<n>:<id>, como a leitura mostra.` };
    }
    const tabId = ws.activeTabId;
    const r = await resolverAlvoDeMoldura(tabId, ref);
    if (!r.ok) return { ok: false, error: `${acao}: ${r.erro}` };
    const action = { type: acao, target: undefined, params: cmd.args?.params } as unknown as PlannedAction;
    const veredito = await avaliar(action, ws, cmd.args?.confirm === true, r.alvo);
    if (!veredito.permitido) {
      this.avisarSeEspera(tabId, veredito);
      return { ok: false, error: `[bloqueado] ${veredito.motivo}` };
    }
    try {
      const dado = await this.comAbaPronta(acao, ws, async () => {
        if (acao === 'click') {
          const p = await cliqueNaMoldura(tabId, r.entrada);
          return { element: ref, moldura: r.entrada.host, ponto: p };
        }
        const params = (cmd.args?.params ?? {}) as { text?: string; clear?: boolean; delay_ms?: number };
        if (typeof params.text !== 'string') throw new Error('type: sem texto para digitar');
        const out = await digitarNaMoldura(tabId, r.entrada, params.text, {
          limpar: params.clear === true, modo: acao === 'cap_digitar' ? 'teclado' : 'rapido', delayMs: params.delay_ms,
        });
        return { typeOutcome: 'moldura', element: ref, moldura: r.entrada.host, lido: out.lido };
      });
      return { ok: true, data: dado };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Ponto unico de resposta ao agente. Roda os ganchos "depois" (na ordem de
   * registro) antes de responder — TODO caminho passa por aqui, inclusive
   * [somente leitura] e [bloqueado], porque um modulo de auditoria precisa ver
   * o que foi barrado, nao so o que executou.
   */
  private async responder(cmd: BridgeCommand, ctx: ContextoCapacidade, resultado: Resultado): Promise<void> {
    let r = resultado;
    for (const g of ganchos()) {
      if (!g.depois) continue;
      try {
        r = await g.depois(ctx, r);
      } catch (err) {
        console.warn('[Bridge] gancho "depois" falhou:', err);
      }
    }

    // Obra 17: registra a ultima acao do agente para o painel "Agentes agora",
    // depois dos ganchos "depois" — e o resultado final que o agente recebe.
    this.ultimaAcao.set(cmd.clientId, {
      acao: cmd.action,
      ok: r.ok,
      quando: Date.now(),
      ...(r.ok ? {} : { erro: r.error }),
    });
    if (cmd.name) this.nomeDoCliente.set(cmd.clientId, cmd.name);

    if (!this.cancelados.has(cmd.id)) {
      const voo = this.emVoo.get(cmd.id);
      this.registrarRecente(cmd, r.ok, voo ? Date.now() - voo.inicio : 0, r.error, await this.siteDaAba(ctx.tabId));
    }
    this.reply(cmd, r.ok, r.ok ? r.data : undefined, r.error);
  }

  /** Acrescenta ao "ultimas acoes" do painel (so as 10 mais novas). Nunca lanca. */
  private registrarRecente(cmd: BridgeCommand, ok: boolean, ms: number, erro?: string, site?: string): void {
    // Cliente de teste nao entra no "Ultimas acoes".
    if (/^(teste-|sonda)/i.test(cmd.name ?? this.nomeDoCliente.get(cmd.clientId) ?? '')) return;
    this.recentes.unshift({
      quando: Date.now(),
      clientId: cmd.clientId,
      agente: cmd.name ?? this.nomeDoCliente.get(cmd.clientId),
      acao: cmd.action,
      ok,
      ms,
      ...(site ? { site } : {}),
      ...(erro ? { erro: erro.slice(0, 160) } : {}),
    });
    if (this.recentes.length > RECENTES_MAX) this.recentes.length = RECENTES_MAX;
  }

  /** Host da aba (nunca a URL inteira), ou undefined se a aba ja nao existe. */
  private async siteDaAba(tabId: number): Promise<string | undefined> {
    try {
      const url = (await chrome.tabs.get(tabId)).url;
      return url ? new URL(url).host || undefined : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Zeragem unica (21/10/2026, pedido do usuário): os numeros dos testes da v6 saem do
   * painel para ele ver so uso real daqui em diante. Roda uma vez por instalacao (flag em
   * storage.local) e usa o mesmo caminho do botao, menos o arquivo do servidor.
   */
  private async zeragemInicial(): Promise<void> {
    try {
      const FLAG = 'zeragemContadores';
      if ((await chrome.storage.local.get(FLAG))[FLAG] === '20261021') return;
      await new Promise((r) => setTimeout(r, 1500)); // deixa o IndexedDB da auditoria abrir
      this.recentes.length = 0;
      await zerarConsumoSites();
      await auditLogger.limpar();
      await chrome.storage.local.set({ [FLAG]: '20261021' });
    } catch { /* tenta de novo na proxima partida */ }
  }

  /**
   * Zera o que o painel mostra: ultimas acoes, ranking de sites e auditoria (chars_brutos)
   * aqui na extensao, e pede ao hub para arquivar o medicao.jsonl. Nao toca em token,
   * tecladoHosts, avisos, estado de parada nem nas demais configuracoes.
   */
  private async zerarContadores(): Promise<Record<string, unknown>> {
    this.recentes.length = 0;
    this.ultimaAcao.clear();
    await zerarConsumoSites();
    await auditLogger.limpar().catch(() => {});
    const servidor = await this.pedirConsumo('zerar_consumo');
    return { ok: true, servidor };
  }

  /** Pede ao hub o consumo agregado de medicao.jsonl. null se o hub nao responder em 3 s. */
  private pedirConsumo(tipo: 'consumo' | 'zerar_consumo' = 'consumo'): Promise<unknown | null> {
    if (!this.online) return Promise.resolve(null);
    const id = `consumo:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.consumoPendente.delete(id); resolve(null); }, 3_000);
      this.consumoPendente.set(id, (dados) => { clearTimeout(timer); resolve(dados); });
      this.ws!.send(JSON.stringify({ type: tipo, id }));
    });
  }

  /**
   * Tudo que o painel lateral mostra, numa carga so: agentes conectados, ultimas 10
   * acoes, consumo e opcoes. `consumo.servidor` e o que a ponte devolveu aos agentes
   * (medicao.jsonl); `consumo.sites` e o ranking por site, da propria extensao.
   */
  private async montarPainel(): Promise<Record<string, unknown>> {
    const base = await this.estadoDosAgentes();
    const conhecidos = new Map<string, { clientId: string; nome?: string }>();
    for (const p of this.peersLista) conhecidos.set(p.clientId, { clientId: p.clientId, nome: p.name });
    for (const a of base.agentes) {
      if (!conhecidos.has(a.clientId)) conhecidos.set(a.clientId, { clientId: a.clientId, nome: a.nome });
    }
    const porId = new Map(base.agentes.map((a) => [a.clientId, a]));
    const agentes = [...conhecidos.values()].map((c) => {
      const a = porId.get(c.clientId);
      let site: string | undefined;
      try { site = a?.url ? new URL(a.url).host || undefined : undefined; } catch { /* url interna */ }
      return {
        clientId: c.clientId,
        nome: c.nome ?? a?.nome ?? c.clientId,
        tabId: a?.tabId,
        titulo: a?.titulo,
        site,
        modo: a?.modo,
        ultimoComandoEm: a?.ultimoComandoEm,
        ultimaAcao: a?.ultimaAcao,
        bloqueado: this.bloqueados.has(c.clientId),
      };
    });
    const [servidor, sites, avisos] = await Promise.all([
      this.pedirConsumo(), rankingDeSites(7, 5), avisosLigados(),
    ]);
    return {
      extensaoOnline: this.online,
      janelaDaPonte: base.janelaDaPonte,
      bloqueados: this.bloqueados.size,
      agentes,
      recentes: this.recentes,
      consumo: { servidor, sites },
      avisosLigados: avisos,
      geradoEm: Date.now(),
    };
  }

  /**
   * Estado ao vivo de todos os agentes conectados, para o painel "Agentes
   * agora" (obra 17, item 5b). Cada `chrome.tabs.get` tem `catch`: aba morta
   * lanca e nao pode derrubar a listagem inteira (armadilha do briefing).
   *
   * Nao inclui token nem URL completa no que o painel RENDERIZA — a URL viaja
   * ate aqui e ate o sidepanel (mensagem local, extensao-para-extensao, nunca
   * sai da maquina) mas `App.tsx` so mostra o titulo cortado, de proposito.
   */
  private async estadoDosAgentes(): Promise<{
    agentes: Array<{
      clientId: string;
      nome?: string;
      tabId?: number;
      titulo?: string;
      url?: string;
      modo: 'leitura' | 'acao';
      ultimoComandoEm?: number;
      ultimaAcao?: { acao: string; ok: boolean; quando: number; erro?: string };
    }>;
    janelaDaPonte?: number;
    extensaoOnline: boolean;
    /** Agentes parados pelo "Parar tudo" que ainda nao foram liberados. */
    bloqueados: number;
  }> {
    const agentes = await Promise.all(
      [...this.workspaceByClient.entries()].map(async ([clientId, workspaceId]) => {
        const ws = workspaceManager.get(workspaceId);
        const tabId = ws?.activeTabId;
        const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => null) : null;
        return {
          clientId,
          nome: this.nomeDoCliente.get(clientId),
          tabId,
          titulo: tab?.title,
          url: tab?.url,
          modo: (this.somenteLeitura.has(clientId) ? 'leitura' : 'acao') as 'leitura' | 'acao',
          ultimoComandoEm: this.ultimoComando.get(clientId),
          ultimaAcao: this.ultimaAcao.get(clientId),
        };
      }),
    );
    const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
    return { agentes, janelaDaPonte, extensaoOnline: this.online, bloqueados: this.bloqueados.size };
  }

  /**
   * Acende o indicador visual na aba e devolve a funcao que o solta.
   *
   * Quem manda mostrar e apagar e a PONTE, e nao a acao la dentro do
   * ExecutionEngine: o indicador e da ponte, existe enquanto ela trabalha, e
   * so ela sabe quando o comando acabou.
   *
   * Antes so o `wait_for_text` mandava mostrar, e ninguem mandava apagar. Dai
   * os dois sintomas: aparecia "as vezes" (so em espera longa) e, uma vez
   * aceso, ficava para sempre.
   *
   * A reafirmacao de 10 em 10s existe porque re-render de SPA arranca o host
   * injetado; `SHOW_AGENT_INDICATORS` e idempotente e recria o que faltar.
   */
  private acenderIndicador(tabId: number): () => void {
    const timerAntigo = this.apagarIndicador.get(tabId);
    if (timerAntigo) {
      clearTimeout(timerAntigo);
      this.apagarIndicador.delete(tabId);
    }

    const mostrar = () => {
      chrome.tabs.sendMessage(tabId, { type: 'SHOW_AGENT_INDICATORS' }).catch(() => {});
    };
    mostrar();
    const reafirma = setInterval(mostrar, INDICADOR_REAFIRMA_MS);

    return () => {
      clearInterval(reafirma);
      const timer = setTimeout(() => {
        this.apagarIndicador.delete(tabId);
        chrome.tabs.sendMessage(tabId, { type: 'HIDE_AGENT_INDICATORS' }).catch(() => {});
      }, INDICADOR_GRACA_MS);
      this.apagarIndicador.set(tabId, timer);
    };
  }

  /** Apaga o indicador agora, sem graca: o agente soltou a aba. */
  private apagarIndicadorJa(tabId: number): void {
    const timer = this.apagarIndicador.get(tabId);
    if (timer) clearTimeout(timer);
    this.apagarIndicador.delete(tabId);
    chrome.tabs.sendMessage(tabId, { type: 'HIDE_AGENT_INDICATORS' }).catch(() => {});
  }

  /**
   * Site de sessao unica (01/11/2026): a segunda aba do WhatsApp Web derruba a do
   * usuário. Abrir ou navegar ate ele com outra aba ja aberta e recusado,
   * apontando a aba existente.
   */
  private async recusaSessaoUnica(url: string | undefined, abaAtual: number): Promise<string | null> {
    if (!url || !/^https:\/\/web\.whatsapp\.com(\/|$)/.test(url)) return null;
    const aberta = (await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })).find((t) => t.id !== abaAtual);
    if (aberta?.id === undefined) return null;
    return `[sessao unica] o WhatsApp Web ja esta aberto na aba ${aberta.id}, e uma segunda aba `
      + `derrubaria essa. Use browser_use_tab com tabId ${aberta.id}.`;
  }

  private prorrogar(cmd: BridgeCommand): void {
    if (!this.online) return;
    this.ws!.send(JSON.stringify({ type: 'prorrogar', id: cmd.id, clientId: cmd.clientId }));
  }

  private reply(cmd: BridgeCommand, ok: boolean, result?: unknown, error?: string): void {
    if (!this.online) return;
    // O "Parar tudo" ja respondeu a este comando: o trabalho que sobrou nao tem mais a quem falar.
    if (this.cancelados.delete(cmd.id)) return;
    this.ws!.send(JSON.stringify({
      type: 'result',
      id: cmd.id,
      clientId: cmd.clientId,
      ok,
      ...(ok ? { result } : { error: error || 'acao falhou sem mensagem' }),
    }));
  }

  /**
   * Devolve o workspace do agente. Na primeira vez, abre uma aba PROPRIA para
   * ele na janela da ponte.
   *
   * Nunca a aba do usuario. Trabalhar na aba corrente parecia elegante e criou
   * dois problemas reais: duas sessoes abertas navegavam uma em cima da outra
   * (dividiam a mesma aba), e o agente trocava a pagina que o usuario estava
   * vendo — o YouTube dele virava o link que o agente precisava abrir.
   *
   * Aba do usuario so por pedido explicito (browser_use_current_tab /
   * browser_use_tab), e mesmo assim em modo leitura ate ele liberar.
   *
   * Obra 23: `acao` e opcional so por retrocompatibilidade de assinatura — todo
   * chamador real do caminho principal passa `cmd.action`. Serve para abrir uma
   * unica excecao ao "FALHA ALTO" abaixo: `cap_feedback`/`cap_feedback_drenar`
   * (relatar defeito) nao pode depender de aba viva, porque e exatamente a
   * ferramenta que o agente busca quando algo quebrou — inclusive a propria aba
   * dele. Nenhuma outra acao ganha esse desvio; a checagem age em todo o resto
   * pelo motivo documentado no comentario do throw.
   */
  private async resolveWorkspace(clientId: string, _name?: string, acao?: string): Promise<AgentWorkspace> {
    const known = this.workspaceByClient.get(clientId);
    if (known) {
      const ws = workspaceManager.get(known);
      if (ws && (await this.tabAlive(ws.activeTabId))) return ws;

      // A aba do agente morreu — fechada na mao, por outro agente ou por reload.
      // Abre-se outra, mas o comando de agora FALHA dizendo isso. Trocar de aba em
      // silencio foi o que mordeu em 03/09/2026: o agente seguiu lendo achando que
      // estava na pagina anterior. Uma aba nova em branco, calada, faria o mesmo
      // estrago de outro jeito: ele leria about:blank e concluiria coisa errada.
      const abaMorta = ws?.activeTabId;
      this.workspaceByClient.delete(clientId);
      this.abaPropriaDoCliente.delete(clientId);
      // O `somenteLeitura.delete` aqui e SEM condicao de proposito, e so e
      // correto porque `ws.activeTabId` e um REGISTRO do lugar onde o agente
      // esta — nunca uma promessa. `criarWorkspace` abaixo abre uma aba NOVA da
      // ponte; manter o modo leitura nela prenderia o agente para sempre em
      // leitura na propria aba dele, que e o defeito espelho.
      //
      // Quem quebrava esse pressuposto era o `case 'switch_tab'` do motor
      // (execution-engine), que escrevia o novo `activeTabId` ANTES de o Chrome
      // confirmar a troca: numa troca que FALHAVA, o registro passava a apontar
      // para uma aba morta, esta linha rodava, e o agente perdia a protecao
      // continuando na aba do usuario (furo 7b, metade 2 — medido 6/6 nas
      // tentativas que pegaram a corrida). Consertado la, na ordem das duas
      // chamadas; nao aqui, que so obedece ao registro.
      this.somenteLeitura.delete(clientId);
      // Abas irmas vivas (03/11/2026): subagentes da mesma sessao dividem o
      // workspace. Trocar de workspace abandonava as abas deles, que a faxina de
      // orfas fechava no meio do trabalho. Com irma viva, a aba nova entra no MESMO.
      const irmas = ws ? (await Promise.all(Object.keys(ws.tabs).map(Number)
        .filter((id) => id !== abaMorta).map(async (id) => ((await this.tabAlive(id)) ? id : null))))
        .filter((id): id is number => id !== null) : [];
      let novo: AgentWorkspace;
      if (ws && irmas.length) {
        const tab = await this.abrirAbaPropria();
        const tabs = { ...ws.tabs };
        if (abaMorta !== undefined) delete tabs[abaMorta];
        tabs[tab.id!] = {
          tabId: tab.id!, windowId: tab.windowId, groupId: tab.groupId,
          url: tab.url ?? 'about:blank', isActive: true, lastObservedAt: Date.now(),
        };
        workspaceManager.update(ws.workspaceId, { tabs });
        workspaceManager.switchActiveTab(ws.workspaceId, tab.id!);
        this.workspaceByClient.set(clientId, ws.workspaceId);
        this.abaPropriaDoCliente.set(clientId, tab.id!);
        novo = workspaceManager.get(ws.workspaceId)!;
        novo.activeTabId = tab.id!;
      } else {
        novo = await this.criarWorkspace(clientId);
      }

      if (this.fechadasPeloDono.delete(`${clientId}:${abaMorta}`)) {
        this.brancaDoCliente.set(clientId, novo.activeTabId);
        return novo;
      }

      // Obra 23 (docs/obra-20260904/... correcao 3 do pedreiro de 05/09/2026):
      // relatar defeito e o momento em que o agente MAIS precisa da ferramenta —
      // "algo quebrou" e a propria razao de chamar bridge_feedback. Fazer o
      // relato depender de aba viva tirava a tool bem na hora do uso real. A
      // aba nova ja foi criada em silencio (igual a um agente que nunca teve
      // workspace); so pulamos o erro alto, nao o resto do fluxo.
      if (acao === 'cap_feedback' || acao === 'cap_feedback_drenar') return novo;

      throw new Error(
        `[aba trocou] sua aba (${abaMorta}) nao existe mais — foi fechada por fora. Abri outra em `
        + `branco (${novo.activeTabId}) na janela da ponte. O que voce tinha na tela se perdeu: `
        + 'navegue de novo antes de ler ou clicar.',
      );
    }

    return this.criarWorkspace(clientId);
  }

  private async criarWorkspace(clientId: string): Promise<AgentWorkspace> {
    const tab = await this.abrirAbaPropria();
    const ws = await workspaceManager.create({
      goal: 'ponte MCP',
      name: NOME_WORKSPACE,
      tabId: tab.id!,
      provider: NO_PROVIDER,
      mode: 'task',
    });
    this.workspaceByClient.set(clientId, ws.workspaceId);
    this.abaPropriaDoCliente.set(clientId, tab.id!);
    return ws;
  }

  /** Aba nova para um agente, dentro da janela da ponte. */
  private async abrirAbaPropria(): Promise<chrome.tabs.Tab> {
    if (this.paradoEm && Date.now() - this.paradoEm < PARADA_SEM_ABA_MS) throw new Error(MSG_PARADO);
    const windowId = await this.janelaDaPonte();
    const tab = await chrome.tabs.create({ windowId, url: 'about:blank', active: true });
    if (tab.id === undefined) throw new Error('nao consegui abrir aba para o agente');
    this.abasCriadasPelaPonte.add(tab.id);
    return tab;
  }

  /**
   * A janela da ponte: UMA para todos os agentes, com uma aba por agente.
   *
   * Guardada no storage para sobreviver ao service worker dormir. Nasce COM foco
   * e o devolve em seguida: criada com `focused: false` ela nunca e pintada, e
   * aba nao pintada ignora clique (testado). E um piscar, uma vez, na primeira
   * abertura. A posicao e o tamanho sao os que o usuario deixou da ultima vez.
   *
   * A janela fica com uma aba ancora (about:blank) que nenhum agente usa, so
   * para ela nao fechar quando o ultimo agente sair — senao abriria e fecharia
   * (e piscaria) a cada sessao.
   */
  private async janelaDaPonte(): Promise<number> {
    const { janelaDaPonte, janelaDaPonteBounds: bounds } = await chrome.storage.local.get([
      'janelaDaPonte', 'janelaDaPonteBounds',
    ]);

    if (typeof janelaDaPonte === 'number') {
      const viva = await chrome.windows.get(janelaDaPonte).then(() => true).catch(() => false);
      if (viva) return janelaDaPonte;
    }

    const focoAnterior = (await chrome.windows.getLastFocused().catch(() => null))?.id;
    const b = bounds as { left: number; top: number; width: number; height: number } | undefined;

    // Posicao salva num SEGUNDO MONITOR que hoje esta desligado: o Chrome
    // recusa ("Bounds must be at least 50% within visible screen space") e a
    // ponte inteira ficava inutilizavel (26/09/2026, sessao IMERSAO). Tenta a
    // posicao salva; recusou, abre no tamanho padrao onde o Chrome quiser e
    // esquece a posicao velha.
    const criar = (comPosicao: boolean) => chrome.windows.create({
      url: 'about:blank',
      focused: true,
      type: 'normal',
      width: comPosicao ? (b?.width ?? JANELA_PADRAO.width) : JANELA_PADRAO.width,
      height: comPosicao ? (b?.height ?? JANELA_PADRAO.height) : JANELA_PADRAO.height,
      ...(comPosicao && b?.left !== undefined && { left: b.left }),
      ...(comPosicao && b?.top !== undefined && { top: b.top }),
    });
    let janela: chrome.windows.Window | undefined;
    // O usuário quer a ponte SEMPRE minimizada (30/09/2026): nasce assim, sem
    // abrir na tela nem piscar. Funciona porque `garantirJanelaDesenhada` da
    // layout a pagina por emulacao. So se o Chrome recusar nascer minimizada e
    // que cai no jeito antigo (abre com foco e devolve).
    try {
      janela = await chrome.windows.create({ url: 'about:blank', type: 'normal', state: 'minimized' });
      if (janela?.id !== undefined) {
        await chrome.storage.local.set({ janelaDaPonte: janela.id });
        this.abaAncora = janela.tabs?.[0]?.id;
        this.guardarAncora();
        return janela.id;
      }
    } catch (err) {
      console.warn('[ponte] nao nasceu minimizada, abrindo do jeito antigo:', err);
    }
    try {
      janela = await criar(true);
    } catch (err) {
      console.warn('[ponte] posicao salva da janela recusada, abrindo na posicao padrao:', err);
      await chrome.storage.local.remove('janelaDaPonteBounds').catch(() => {});
      janela = await criar(false);
    }
    if (janela?.id === undefined) throw new Error('nao consegui abrir a janela da ponte');

    await chrome.storage.local.set({ janelaDaPonte: janela.id });
    this.abaAncora = janela.tabs?.[0]?.id;
    this.guardarAncora();

    // Devolve o foco para onde o usuario estava. `focused: true` foi so para pintar.
    if (focoAnterior !== undefined && focoAnterior !== janela.id) {
      await chrome.windows.update(focoAnterior, { focused: true }).catch(() => {});
    }
    return janela.id;
  }

  /** A aba ativa da janela normal em que o usuario esta. */
  private async abaCorrenteDoUsuario(): Promise<chrome.tabs.Tab> {
    const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
    const janelas = (await chrome.windows.getAll({ windowTypes: ['normal'], populate: true }))
      .filter((w) => w.id !== janelaDaPonte); // a janela da ponte nao e "do usuario"
    const candidata = janelas.find((w) => w.focused) ?? janelas[0];
    const ativa = candidata?.tabs?.find((t) => t.active) ?? candidata?.tabs?.[0];
    if (ativa?.id === undefined) throw new Error('nao achei a aba em que o usuario esta');

    // Obra 19: recusa pagina interna do Chrome ANTES de devolver a aba — quem
    // chama isto (cap_use_current_tab) ia adotar a aba e travar no attach do
    // CDP com um erro cru. Sugere outra aba da MESMA janela se houver uma
    // utilizavel, para o agente nao precisar adivinhar o proximo passo.
    if (ehPaginaInterna(ativa.url)) {
      const alternativa = candidata?.tabs?.find((t) => t.id !== ativa.id && !ehPaginaInterna(t.url));
      const sugestao = alternativa
        ? ` Ha outra aba nessa janela que da para operar: "${alternativa.title}" (${alternativa.url}), `
          + `tabId ${alternativa.id} — chame browser_use_tab com esse tabId.`
        : ' Abra um site de verdade nessa janela e tente de novo.';
      throw new Error(
        `[pagina interna] a aba ativa e "${ativa.url}" — pagina interna do navegador, o Chrome nao `
        + `deixa a ponte le-la nem operar nela.${sugestao}`,
      );
    }

    return ativa;
  }

  /** Aponta o workspace do agente para uma aba do usuario, em modo leitura por padrao. */
  private async adotarAbaDoUsuario(
    clientId: string,
    ws: AgentWorkspace,
    tab: chrome.tabs.Tab,
    permitirAcao: boolean,
  ): Promise<string> {
    const id = tab.id!;
    await debuggerManager.attach(id).catch(() => {
      // Ja pode estar anexado de uma adocao anterior.
    });
    workspaceManager.update(ws.workspaceId, {
      activeTabId: id,
      tabs: {
        ...ws.tabs,
        [id]: {
          tabId: id,
          windowId: tab.windowId,
          groupId: tab.groupId,
          url: tab.url ?? '',
          title: tab.title,
          isActive: true,
          lastObservedAt: Date.now(),
        },
      },
    });
    ws.activeTabId = id;
    this.abasAdotadas.add(id); // aba do usuario nunca e fechada pela ponte

    if (permitirAcao) {
      this.somenteLeitura.delete(clientId);
      return `agindo na aba do usuario "${tab.title}" (${tab.url}) com permissao dele. `
        + 'Ela nao sera fechada ao sair.';
    }
    this.somenteLeitura.add(clientId);
    return `lendo a aba do usuario "${tab.title}" (${tab.url}) em modo SOMENTE LEITURA: `
      + 'navegar, clicar e digitar estao barrados aqui. Se ele pedir para agir nela, repita '
      + 'com permitir_acao: true. Para trabalhar sem incomodar, browser_use_own_tab.';
  }

  private async executarCapacidade(cmd: BridgeCommand, ws: AgentWorkspace, ctx: ContextoCapacidade): Promise<unknown> {
    const p = (cmd.args?.params ?? {}) as Record<string, never>;

    switch (cmd.action) {
      case 'cap_faxina_ociosos': {
        const antes = this.workspaceByClient.size;
        await this.encerrarOciosos(p.janela_ms);
        await this.limparAbasOrfas();
        return `faxina executada: ${antes} agentes ativos antes, ${this.workspaceByClient.size} depois`;
      }

      case 'cap_limpar': {
        // So aba ORFA: aberta pela ponte e sem agente vivo. Havia um `tudo` que
        // esvaziava `abasCriadasPelaPonte` inteiro — com cinco agentes no mesmo
        // Chrome, um limpando derrubava os outros no meio do trabalho. Saiu.
        // A aba do usuario nunca entra: nao esta nesse conjunto.
        const antes = this.abasCriadasPelaPonte.size;
        await this.limparAbasOrfas();
        const fechadas = antes - this.abasCriadasPelaPonte.size;
        return fechadas === 0
          ? 'nada a limpar: toda aba da ponte tem agente vivo'
          : `fechei ${fechadas} aba(s) orfa(s); as de agentes vivos ficaram`;
      }

      case 'cap_use_current_tab': {
        // "Olha isso aqui": aponta para a aba em que o usuario esta. Leitura por
        // padrao; alterar so com permitir_acao, que o agente so marca depois de
        // o usuario pedir explicitamente.
        const tab = await this.abaCorrenteDoUsuario();
        return this.adotarAbaDoUsuario(cmd.clientId, ws, tab, p.permitir_acao === true);
      }

      case 'cap_use_own_tab': {
        // Volta para a aba propria do agente na janela da ponte, onde ele pode
        // navegar e clicar a vontade sem encostar no que o usuario esta vendo.
        this.somenteLeitura.delete(cmd.clientId);
        let propria = this.abaPropriaDoCliente.get(cmd.clientId);
        if (propria === undefined || !(await this.tabAlive(propria))) {
          const nova = await this.abrirAbaPropria();
          propria = nova.id!;
          this.abaPropriaDoCliente.set(cmd.clientId, propria);
          workspaceManager.update(ws.workspaceId, {
            tabs: {
              ...ws.tabs,
              [propria]: {
                tabId: propria,
                windowId: nova.windowId,
                groupId: nova.groupId,
                url: nova.url ?? '',
                isActive: true,
                lastObservedAt: Date.now(),
              },
            },
          });
        }
        await debuggerManager.attach(propria).catch(() => {});
        // Medido na obra 08 (05/09/2026): reativar SO no bookkeeping interno
        // nao bastava — se outra aba da ponte ficou visualmente ativa no
        // Chrome nesse meio tempo (ex.: `open_tab` de outro comando), um
        // `window.open()` rodado por `cap_js` NESTA aba (via Runtime.evaluate,
        // que executa aqui de verdade) nascia com `openerTabId` apontando para
        // a aba que o CHROME via como ativa, nao para esta. `chrome.tabs.
        // onCreated`/`aoCriarAba` dependem de `chrome.tabs.active` bater com
        // `ws.activeTabId` para atribuir a filha ao agente certo.
        await chrome.tabs.update(propria, { active: true }).catch(() => {});
        workspaceManager.update(ws.workspaceId, { activeTabId: propria });
        ws.activeTabId = propria;
        return `de volta a sua aba propria (${propria}), na janela da ponte. Aqui pode navegar e clicar.`;
      }

      case 'cap_tabs_all': {
        const todas = await chrome.tabs.query({});
        return todas
          .filter((t) => t.id !== undefined && !t.url?.startsWith('chrome://'))
          .map((t) => ({
            tabId: t.id,
            titulo: t.title,
            url: t.url,
            janela: t.windowId,
            ativa: t.active,
            desteAgente: t.id === ws.activeTabId,
          }));
      }

      case 'cap_use_tab': {
        const alvo = Number(p.tabId);
        const tab = await chrome.tabs.get(alvo); // erra sozinho se a aba nao existir

        // Obra 19: aqui o tabId e escolhido a dedo (nao "a aba ativa"), entao
        // a mesma armadilha de abaCorrenteDoUsuario se aplica sem precisar de
        // aba ativa nenhuma — recusa antes de tentar adotar/anexar.
        if (ehPaginaInterna(tab.url)) {
          throw new Error(
            `[pagina interna] a aba ${alvo} e "${tab.url}" — pagina interna do navegador, o Chrome nao `
            + 'deixa a ponte le-la nem operar nela. Abra um site de verdade e tente de novo.',
          );
        }

        // Aba escolhida a dedo e do usuario tanto quanto a corrente: leitura por padrao.
        return this.adotarAbaDoUsuario(cmd.clientId, ws, tab, p.permitir_acao === true);
      }

      // Diagnostico: o que a extensao tem registrado, e os conjuntos calculados
      // que sustentam a barreira de somente leitura. Serve ao teste de contrato
      // e ao caso "servidor antigo x extensao nova" do README.
      // Acho F1 do cetico (05/09/2026): este case RECALCULAVA a mesma uniao de
      // Set que alteraAPagina()/exigeAbaPintada() calculam (linhas 52-59) em vez
      // de CHAMAR essas funcoes — um espelho da expressao, nao uma medicao da
      // barreira. Se alguem quebrasse alteraAPagina (por exemplo, esquecendo o
      // `|| nomesQueAlteram()`), o registro.js conferindo "alteram" contra ESTE
      // diagnostico continuava vendo o conjunto certo, porque era recalculado
      // aqui do zero, por fora da funcao que realmente barra na linha ~370. O
      // teste media um espelho, nao a barreira. Agora os candidatos passam pelo
      // FILTRO da propria funcao: uma barreira quebrada aparece aqui tambem.
      case 'cap_listar': {
        const candidatosAlteram = [...ACOES_QUE_ALTERAM_MOTOR, ...nomesQueAlteram()];
        const candidatosInput = [...INPUT_ACTIONS_MOTOR, ...nomesDeInput()];
        return {
          capacidades: listarCapacidades(),
          internas: CAPACIDADES_INTERNAS,
          alteram: candidatosAlteram.filter((nome) => alteraAPagina(nome)),
          input: candidatosInput.filter((nome) => exigeAbaPintada(nome)),
          // Conserto 1 (2a vistoria, 05/09/2026): erros de registro (nome duplicado
          // ou sem prefixo cap_) que capacidades/index.ts capturou em vez de deixar
          // derrubar o service worker. Tem de vir vazio — registro.js afirma isso.
          erros: errosDeRegistro,
        };
      }

      // Nomes de ate 19/08. Servidor MCP que subiu antes de a extensao ser
      // atualizada continua mandando estes; sem o alias ele recebe "desconhecida"
      // e o agente acha que o bug e dele.
      case 'cap_janela_propria':
        return this.executarCapacidade({ ...cmd, action: 'cap_use_own_tab' }, ws, ctx);
      case 'cap_voltar_aba_corrente':
        return this.executarCapacidade({ ...cmd, action: 'cap_use_current_tab' }, ws, ctx);

      // Incidente do PJe (11/09/2026): agente terminou tarefa que fica
      // esperando o usuário (assinar, conferir, decidir) e chama isto ANTES
      // de ficar 5 min sem mandar comando — senao a faxina por ociosidade
      // fecharia a aba com o cadastro pronto. Ver `entregarTabAoUsuario`.
      case 'cap_entregar_aba': {
        const alvo = p.tabId !== undefined ? Number(p.tabId) : ws.activeTabId;
        if (!Number.isFinite(alvo)) {
          throw new Error('cap_entregar_aba: tabId invalido.');
        }
        if (this.abasAdotadas.has(alvo)) {
          throw new Error(
            `a aba ${alvo} ja e do usuario (adotada por browser_use_current_tab/browser_use_tab) — `
            + 'nao ha o que entregar, ela ja nao e sua.',
          );
        }
        if (!this.abasCriadasPelaPonte.has(alvo) || !(alvo in ws.tabs)) {
          throw new Error(
            `a aba ${alvo} nao e sua aba propria (aberta pela ponte para voce) — so posso entregar `
            + 'aba que e sua. Aba de outro agente eu recuso.',
          );
        }

        const tab = await chrome.tabs.get(alvo).catch(() => null);
        if (!tab) throw new Error(`a aba ${alvo} ja nao existe.`);

        const { windowId } = await this.entregarTabAoUsuario(alvo, tab, 'tool', cmd.clientId, ws.workspaceId);

        const { [alvo]: _removida, ...tabsRestantes } = ws.tabs;
        ws.tabs = tabsRestantes;
        workspaceManager.update(ws.workspaceId, { tabs: tabsRestantes });

        let mensagemNova = ' Voce ficou sem aba propria — abra uma nova com browser_use_own_tab se precisar.';
        if (this.abaPropriaDoCliente.get(cmd.clientId) === alvo) {
          const nova = await this.abrirAbaPropria();
          this.abaPropriaDoCliente.set(cmd.clientId, nova.id!);
          const comNova = {
            ...ws.tabs,
            [nova.id!]: {
              tabId: nova.id!,
              windowId: nova.windowId,
              groupId: nova.groupId,
              url: nova.url ?? 'about:blank',
              isActive: true,
              lastObservedAt: Date.now(),
            },
          };
          ws.tabs = comNova;
          ws.activeTabId = nova.id!;
          workspaceManager.update(ws.workspaceId, { activeTabId: nova.id!, tabs: comNova });
          mensagemNova = ` Abri uma aba propria nova (${nova.id}) para voce continuar.`;
        }

        return `aba ${alvo} entregue ao usuário — saiu do meu controle, nenhuma faxina fecha ela `
          + `mais. Esta ativa na janela ${windowId}.${mensagemNova}`;
      }

      // USO DE TESTE — nao aparece em nenhum tool description nem e algo que
      // um agente normal saberia chamar (so existe em `bridge-server/test/`).
      // Fecha QUALQUER tabId, sem checar dono, para o teste de
      // `browser_entregar_aba` conseguir limpar a aba que entregou "ao Dr.
      // usuário" (uma aba de teste de verdade) sem deixar lixo na janela dele.
      // Ver docs/obra-20260904 (obra "entregar aba", 11/09/2026).
      case 'cap_fechar_aba_admin': {
        const alvo = Number(p.tabId);
        if (!Number.isFinite(alvo)) throw new Error('cap_fechar_aba_admin: tabId invalido.');
        await chrome.tabs.remove(alvo).catch(() => {});
        return `aba ${alvo} fechada (admin/teste).`;
      }

      default: {
        const capacidade = capacidadePorNome(cmd.action);
        if (capacidade) return capacidade.executar(ctx);

        throw new Error(
          `capacidade desconhecida: ${cmd.action}. O servidor MCP deste agente provavelmente subiu `
          + 'antes da extensao ser atualizada e manda nomes antigos. Reinicie a sessao do agente: '
          + 'o Claude Code sobe o servidor de novo com os nomes atuais.',
        );
      }
    }
  }

  /**
   * Executa uma acao com a aba pronta para receber input.
   *
   * Aba nao pintada ignora clique — o CDP despacha o evento de mouse e nada
   * acontece, sem erro. Navegar, ler e capturar tela funcionam em segundo plano;
   * input, nao. Entao antes de input a aba do agente e ativada NA JANELA DELA,
   * que e a janela da ponte, nao a do usuario.
   *
   * Passa pela fila porque todos os agentes dividem essa janela: sem
   * serializar, A ativa a aba dele, B ativa a dele, e o clique de A cai em B.
   *
   * `focarParaClicar` (storage) e o fallback para o caso de a janela da ponte
   * estar totalmente coberta e o Windows suspender a pintura: traz a janela
   * para frente so durante a acao e devolve o foco em seguida. Desligado por
   * padrao; liga-se so se o teste com janela coberta mostrar que precisa.
   */
  private comAbaPronta<T>(action: string, ws: AgentWorkspace, fn: () => Promise<T>): Promise<T> {
    if (!exigeAbaPintada(action)) return fn();

    const executar = async (): Promise<T> => {
      let focoAnterior: number | undefined;
      try {
        const tab = await chrome.tabs.get(ws.activeTabId);
        if (!tab.active) {
          await chrome.tabs.update(ws.activeTabId, { active: true });
          await new Promise((r) => setTimeout(r, 250)); // deixa a aba pintar
        }

        const { focarParaClicar } = await chrome.storage.local.get('focarParaClicar');
        if (focarParaClicar === true) {
          focoAnterior = (await chrome.windows.getLastFocused().catch(() => null))?.id;
          if (focoAnterior === tab.windowId) focoAnterior = undefined;
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
          await new Promise((r) => setTimeout(r, 120));
        }
      } catch {
        // Aba sumiu: a propria acao reporta o erro adiante.
      }

      try {
        return await fn();
      } finally {
        if (focoAnterior !== undefined) {
          await chrome.windows.update(focoAnterior, { focused: true }).catch(() => {});
        }
      }
    };

    const nesta = this.filaInput.then(executar, executar);
    this.filaInput = nesta.catch(() => {}); // erro de um nao trava a fila dos outros
    return nesta;
  }

  /**
   * Fecha apenas as abas que a PONTE abriu e que ficaram sem agente vivo.
   *
   * Nao existe mais grupo nem janela da ponte para limpar: no caminho normal ela
   * trabalha na aba que o usuario ja tinha aberta e nao cria nada. Sobra so o
   * caso de `browser_tab_open`, e essas abas ficam registradas em
   * `abasCriadasPelaPonte` — o que nao esta lá pertence ao usuario e nao se toca.
   */
  private async limparAbasOrfas(): Promise<void> {
    try {
      const comDono = new Set<number>();
      for (const workspaceId of this.workspaceByClient.values()) {
        const ws = workspaceManager.get(workspaceId);
        if (ws) for (const id of Object.keys(ws.tabs).map(Number)) comDono.add(id);
      }

      const orfas = [...this.abasCriadasPelaPonte]
        .filter((id) => !comDono.has(id) && id !== this.abaAncora);
      for (const id of orfas) {
        this.abasCriadasPelaPonte.delete(id);
        await chrome.tabs.remove(id).catch(() => {});
      }
      if (orfas.length) console.log(`[Bridge] fechei ${orfas.length} aba(s) que eu mesma abri e ficaram sobrando`);
    } catch (err) {
      console.warn('[Bridge] falhei ao limpar abas orfas:', err);
    }
  }

  /**
   * A janela normal do usuario para onde uma aba entregue vai. A ultima janela
   * NORMAL focada que nao seja a janela da ponte; `undefined` se nao houver
   * nenhuma (o chamador entao cria uma janela nova a partir da propria aba).
   */
  private async janelaDoUsuario(): Promise<number | undefined> {
    const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
    const candidatas = (await chrome.windows.getAll({ windowTypes: ['normal'] }))
      .filter((w) => w.id !== janelaDaPonte);
    if (candidatas.length === 0) return undefined;

    const focoAtual = await chrome.windows.getLastFocused().catch(() => null);
    const focadaEhCandidata = candidatas.find((w) => w.id === focoAtual?.id);
    return (focadaEhCandidata ?? candidatas[0]).id;
  }

  /**
   * Move a aba PARA FORA do controle da ponte: destacada do debugger, tirada
   * de `abasCriadasPelaPonte` (nenhuma faxina/`bridge_limpar`/desconexao volta
   * a fecha-la depois), movida para uma janela normal do usuario e deixada
   * ativa la, para ele achar. Usada pela tool `cap_entregar_aba` e pela rede
   * de seguranca da faxina por ociosidade (`encerrar`, `viaFaxina`) — nunca
   * pela faxina por desconexao, que continua fechando como sempre.
   */
  private async entregarTabAoUsuario(
    tabId: number,
    tab: chrome.tabs.Tab,
    origem: 'tool' | 'faxina',
    clientId: string,
    workspaceId: string | undefined,
  ): Promise<{ windowId: number }> {
    this.abasCriadasPelaPonte.delete(tabId);
    this.abasAdotadas.delete(tabId); // por seguranca — aba entregue nao e "adotada", e do usuario mesmo
    this.apagarIndicadorJa(tabId);
    await debuggerManager.detach(tabId).catch(() => {});

    let destino = await this.janelaDoUsuario();
    if (destino !== undefined) {
      await chrome.tabs.move(tabId, { windowId: destino, index: -1 }).catch(() => {});
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      await chrome.windows.update(destino, { focused: true }).catch(() => {});
    } else {
      // Nenhuma janela normal do usuario existe — cria uma nova A PARTIR desta
      // aba (`tabId` em `windows.create` MOVE a aba, nao cria uma em branco
      // do lado; sem isto sobraria uma aba `about:blank` extra na janela nova).
      const nova = await chrome.windows.create({ tabId, focused: true });
      if (nova?.id === undefined) throw new Error('nao consegui abrir janela para entregar a aba');
      destino = nova.id;
    }

    console.log(`[Bridge] aba ${tabId} entregue ao usuario (origem=${origem}, janela=${destino})`);
    auditLogger.log({
      workspaceId: workspaceId ?? 'faxina',
      tabId,
      type: 'bridge_command',
      payload: {
        clientId,
        agente: this.nomeDoCliente.get(clientId) ?? null,
        acao: origem === 'tool' ? 'cap_entregar_aba' : 'faxina_entregou_aba_ociosa',
        ok: true,
        url: tab.url ?? null,
        resumo: `aba ${tabId} entregue ao usuario (janela ${destino}), origem=${origem}`,
        ms: 0,
      },
    });

    return { windowId: destino };
  }

  /**
   * Solta o workspace do agente.
   *
   * Caminho normal (`opts.viaFaxina` ausente/false — desconexao: `bridge_close_
   * workspace`, `encerrarTodos`): fecha somente as abas que a ponte abriu, como
   * sempre. E o caminho que os testes usam para limpar — se ele passasse a
   * entregar, toda aba de teste (example.com etc.) iria parar na janela do
   * usuário.
   *
   * `opts.viaFaxina: true` (SO a faxina por ociosidade, `encerrarOciosos`): e
   * a rede de seguranca do incidente do PJe — agente parou porque TERMINOU e
   * esta esperando o usuário (assinar, conferir, decidir), nao porque
   * abandonou. Cada aba propria que tiver pagina DE VERDADE (`ehPaginaReal`)
   * e ENTREGUE em vez de fechada; aba em branco ou pagina interna continua
   * sendo fechada, porque nao ha nada para o usuário achar nela.
   */
  private async encerrar(clientId: string, opts?: { viaFaxina?: boolean }): Promise<void> {
    this.somenteLeitura.delete(clientId);
    this.abaPropriaDoCliente.delete(clientId);
    const workspaceId = this.workspaceByClient.get(clientId);
    if (!workspaceId) return;
    this.workspaceByClient.delete(clientId);

    const ws = workspaceManager.get(workspaceId);
    if (!ws) return;

    const proprias = Object.keys(ws.tabs).map(Number)
      .filter((id) => this.abasCriadasPelaPonte.has(id) && !this.abasAdotadas.has(id));

    // Aba do usuario que fica: nao pode ficar com o brilho aceso para sempre.
    for (const id of Object.keys(ws.tabs).map(Number)) this.apagarIndicadorJa(id);

    await workspaceManager.destroy(workspaceId);

    for (const id of proprias) {
      if (opts?.viaFaxina) {
        const tab = await chrome.tabs.get(id).catch(() => null);
        if (tab && ehPaginaReal(tab.url)) {
          await this.entregarTabAoUsuario(id, tab, 'faxina', clientId, workspaceId);
          continue;
        }
      }
      this.abasCriadasPelaPonte.delete(id);
      await chrome.tabs.remove(id).catch(() => {});
    }
  }

  /**
   * "Parar tudo" (botao do painel). Em ordem: (1) bloqueia os agentes conhecidos,
   * para ninguem recomecar; (2) responde MSG_PARADO a todo comando em andamento
   * e solta quem esperava; (3) fecha as abas que a PONTE abriu (a aba do usuario
   * nunca e fechada) e desliga o debugger, inclusive das abas adotadas; (4) uma
   * segunda varredura logo depois, para o que estava a meio caminho de abrir aba.
   * A aba ancora da janela da ponte fica: e uma aba vazia, e fechar a ultima
   * aba derrubaria a janela inteira.
   */
  async pararTudo(exceto?: string): Promise<{
    interrompidos: number; abasFechadas: number; debuggersSoltos: number; agentesBloqueados: string[];
  }> {
    this.paradoEm = Date.now();
    if (this.cancelados.size > 200) this.cancelados.clear();
    // v6.1 (f): nenhuma decisao pendente sobrevive, nem aprovacao solta valendo.
    void cancelarTodasAsDecisoes().catch(() => {});

    const emAndamento = [...this.emVoo.values()].filter((e) => e.cmd.id !== exceto);
    const ids = new Set<string>([
      ...this.workspaceByClient.keys(),
      ...this.peersLista.map((p) => p.clientId),
      ...emAndamento.map((e) => e.cmd.clientId),
    ]);
    for (const id of ids) this.bloqueados.add(id);
    await chrome.storage.local.set({ paradoPeloDr: { desde: this.paradoEm, ids: [...this.bloqueados] } }).catch(() => {});

    for (const e of emAndamento) {
      this.cancelados.add(e.cmd.id);
      if (this.online) {
        this.ws!.send(JSON.stringify({
          type: 'result', id: e.cmd.id, clientId: e.cmd.clientId, ok: false, error: MSG_PARADO,
        }));
      }
      this.registrarRecente(e.cmd, false, Date.now() - e.inicio, 'parado pelo usuário');
      e.cancelar();
    }

    const candidatas = [...this.abasCriadasPelaPonte].filter((id) => id !== this.abaAncora);
    this.filaInput = Promise.resolve();
    // Debugger primeiro: com ele solto, o que sobrou do trabalho nao tem mais CDP para usar.
    // (Fechar a aba antes derrubaria a sessao sozinha e o numero sairia zerado.)
    const debuggersSoltos = await debuggerManager.detachAll();
    this.emuladas.clear();
    await this.encerrarTodos();
    await this.limparAbasOrfas();

    let abasFechadas = 0;
    for (const id of candidatas) if (!(await this.tabAlive(id))) abasFechadas++;

    setTimeout(() => {
      void (async () => {
        await this.encerrarTodos();
        await this.limparAbasOrfas();
        await debuggerManager.detachAll();
        this.aoMudarEstado();
      })();
    }, 1500);

    this.aoMudarEstado();
    return {
      interrompidos: emAndamento.length,
      abasFechadas,
      debuggersSoltos,
      agentesBloqueados: [...this.bloqueados].map((id) => this.nomeDoCliente.get(id)
        ?? this.peersLista.find((p) => p.clientId === id)?.name ?? id),
    };
  }

  /** O usuário liberou os agentes depois de um "Parar tudo". */
  async liberarAgentes(): Promise<number> {
    await this.carregarBloqueio();
    const n = this.bloqueados.size;
    this.bloqueados.clear();
    this.paradoEm = 0;
    await chrome.storage.local.remove('paradoPeloDr').catch(() => {});
    return n;
  }

  /**
   * A lista de agentes parados sobrevive ao service worker dormir e a `bridge_reload`
   * (que o proprio agente parado poderia tentar): fica em chrome.storage.local, e some
   * em 24 h ou quando o usuário libera.
   */
  private bloqueioCarregado: Promise<void> | null = null;
  private carregarBloqueio(): Promise<void> {
    this.bloqueioCarregado ??= (async () => {
      try {
        const { paradoPeloDr } = await chrome.storage.local.get('paradoPeloDr');
        const p = paradoPeloDr as { desde?: number; ids?: string[] } | undefined;
        if (p?.desde && Date.now() - p.desde < 24 * 3_600_000 && Array.isArray(p.ids)) {
          for (const id of p.ids) this.bloqueados.add(id);
        }
      } catch { /* sem storage: segue so com a memoria */ }
    })();
    return this.bloqueioCarregado;
  }

  private async encerrarTodos(): Promise<void> {
    for (const clientId of [...this.workspaceByClient.keys()]) {
      await this.encerrar(clientId);
    }
  }

  private async tabAlive(tabId: number): Promise<boolean> {
    try {
      await chrome.tabs.get(tabId);
      return true;
    } catch {
      return false;
    }
  }

  private async broadcastStatus(online: boolean): Promise<void> {
    try {
      await chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS', online });
    } catch {
      // Side panel fechado. Sem problema.
    }
  }
}

export const bridgeClient = new BridgeClient();
