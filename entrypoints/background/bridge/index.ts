import { focoEmMoldura } from '../execution-engine/molduras';
import { workspaceManager } from '../workspace-manager';

import { auditLogger } from '../audit';
import { debuggerManager } from '../debugger-manager';
import {
  executionEngine, resolverAlvoDeCloseTab, resolverAlvoDeSwitchTab,
  resolverAlvoDaAcao, ACOES_COM_ALVO_UNICO, type AlvoResolvido, type Resolucao,
} from '../execution-engine';
import { avaliar } from './policy';
import { lerValorDoElemento } from './capabilities';
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
import { registrarFilha } from './capacidades/abas-filhas';
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

const BRIDGE_URL = 'ws://127.0.0.1:8788';

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
  //      do Dr. Cezar, nao da pagina: "olha isso aqui" nao pode apagar o que
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
 * o Dr. Cezar assinar". A rede de seguranca (ver `encerrar`, `opts.viaFaxina`)
 * so ENTREGA a aba ao usuario quando ela e "de verdade" — o resto (branco,
 * pagina interna) continua sendo fechado como sempre, senao toda aba de
 * teste (example.com, about:blank) iria parar na janela do Dr. Cezar.
 */
function ehPaginaReal(url: string | undefined): boolean {
  if (!url || url === 'about:blank') return false;
  return !ehPaginaInterna(url);
}

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
 * Quanto o indicador visual fica na tela depois do ultimo comando.
 *
 * Existe para nao piscar entre dois comandos seguidos (o agente costuma mandar
 * varios em fila). Passou disso sem comando novo, o agente parou de fato.
 */
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

class BridgeClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** Workspace de cada agente conectado: qual aba ele esta usando. */
  private workspaceByClient = new Map<string, string>();

  /** Abas que ja eram do usuario: nunca fechar. E o caso normal. */
  private abasAdotadas = new Set<number>();

  /**
   * Abas que a PONTE abriu (`browser_tab_open`). Sao as unicas que ela pode
   * fechar — o resto pertence ao usuario.
   */
  private abasCriadasPelaPonte = new Set<number>();

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
   * So mexe na JANELA DA PONTE (nunca numa janela do Dr. Cezar).
   *
   * O Dr. Cezar quer a ponte SEMPRE minimizada, sem aparecer na tela
   * (30/09/2026). Minimizada, a janela vira 0x0 e o hit-test nao acha nada.
   * 1o caminho: manter minimizada e EMULAR o tamanho da tela pelo CDP
   * (Emulation.setDeviceMetricsOverride): a pagina ganha layout e o clique
   * por coordenada volta a ter onde cair, sem a janela aparecer.
   * 2o caminho (se a emulacao nao der layout): restaura sem foco e devolve ao
   * minimizado 20 s depois — menos que os 30 s em que o service worker dorme
   * e levaria o temporizador junto.
   */
  private async garantirJanelaDesenhada(tabId: number): Promise<void> {
    try {
      const { janelaDaPonte } = await chrome.storage.local.get('janelaDaPonte');
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== janelaDaPonte) return;
      const win = await chrome.windows.get(tab.windowId);

      if (win.state !== 'minimized') {
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

      if (!tab.active) await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      await debuggerManager.attach(tabId).catch(() => {});
      await debuggerManager.send(tabId, 'Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
      }).catch(() => {});
      await debuggerManager.send(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      this.emuladas.add(tabId);
      await new Promise((r) => setTimeout(r, 150));
      if (await temLayout()) return;

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

  get online(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    this.stopped = false;

    // Alarme, e nao setInterval: o service worker MV3 dorme e levaria o timer
    // junto, deixando grupo de agente parado na tela indefinidamente.
    chrome.alarms.create(ALARME_FAXINA, { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener(async (alarme) => {
      if (alarme.name !== ALARME_FAXINA) return;
      await this.encerrarOciosos();
      // Segunda rede: grupo sem dono, inclusive de antes do service worker dormir.
      await this.limparAbasOrfas();
    });

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
      if ((msg as { type?: string } | undefined)?.type !== 'PONTE_AGENTES') return;
      this.estadoDosAgentes().then(respond);
      return true;
    });

    await this.connect();
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'parado pelo usuario');
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.online) return;

    const token = await this.getToken();
    if (!token) {
      console.warn('[Bridge] sem token de pareamento — cole o token no painel da extensao');
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

    ws.onopen = async () => {
      const [perfil, instanceId] = await Promise.all([this.getPerfil(), this.getInstanceId()]);
      ws.send(JSON.stringify({ type: 'hello', role: 'extension', token, perfil, instanceId }));
      this.reconnectDelay = RECONNECT_MIN_MS;
      console.log(`[Bridge] conectada ao hub — perfil "${perfil}"`);
      void this.broadcastStatus(true);
      // Sobra de execucao anterior: aba que a propria ponte abriu e ficou sem dono.


      void this.limparAbasOrfas();
    };

    ws.onmessage = (event) => {
      void this.onMessage(event.data as string);
    };

    ws.onclose = () => {
      this.ws = null;
      void this.broadcastStatus(false);
      // Sem hub, ninguem esta no comando: solta os workspaces (a aba do usuario
      // fica intacta; so aba aberta pela ponte e fechada).
      void this.encerrarTodos();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // O close cuida da reconexao; aqui so evitamos erro nao tratado.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
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
   * valor gravado pelo Dr. Cezar no painel da extensao. Sem nada salvo, cai
   * em "padrao" — a instalacao existente (a pessoal) nunca precisa configurar
   * nada para continuar funcionando exatamente como hoje.
   *
   * Por que nao `chrome.identity.getProfileUserInfo`: pede uma permissao nova
   * no manifest so para isto, e devolveria o e-mail da conta Google logada no
   * Chrome — nem sempre e o dado que o Dr. Cezar quer usar como nome de
   * perfil (ele pode nao estar logado, ou querer um nome mais claro que o
   * e-mail, ex.: "escritorio"). Um campo de texto no painel resolve sem
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
      return;
    }
    if (msg.type !== 'cmd') return;

    const cmd = msg as BridgeCommand;
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
    try {
      const wsDaSessao = await this.resolveWorkspace(cmd.clientId, cmd.name, cmd.action);

      // ABA EXPLICITA POR COMANDO (26/09/2026, sessao "Storytelling e Animacao
      // JS"): subagentes da tool Agent herdam a conexao da sessao-mae, entao
      // tinham o MESMO clientId e caiam na MESMA aba — 7 em paralelo, um
      // navegando enquanto o outro anexava arquivo. Com `aba`, o comando age
      // naquela aba e so nele: a aba "da sessao" nao muda. So vale aba que a
      // ponte abriu para esta sessao — aba do Dr. Cezar nunca entra por aqui.
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
      if (cmd.action === 'open_tab') {
        try {
          const url = cmd.args?.params?.url as string | undefined;
          const tab = await this.abrirAbaPropria();
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
        // Alvo e da ponte: cai no caminho normal (motor), que resolve o MESMO
        // alvo pela mesma funcao — nunca mais diverge do que o freio checou.
      }

      // Janela da ponte MINIMIZADA (30/09/2026): o Chrome nao desenha a pagina,
      // a janela vira 0x0, o hit-test responde "nao ha no" para qualquer ponto
      // e o clique cai no vazio — o freio nem tem o que examinar. Minimizar a
      // janela e natural (ela atrapalha), entao quem se ajeita e a ponte.
      await this.garantirJanelaDesenhada(ws.activeTabId);

      let resultado: Resultado;
      try {
        // Ganchos "antes": rodam antes do freio (avaliar faz chamada CDP; um
        // modulo que precise barrar tem de conseguir fazer isso antes dela).
        for (const g of ganchos()) {
          if (g.antes) await g.antes(ctx);
        }

        // Capacidades proprias da ponte, que nao passam pelo ExecutionEngine.
        if (cmd.action.startsWith('cap_')) {
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
                error: `[bloqueado] ${cmd.action}: nao consegui identificar com seguranca o elemento `
                  + `que esta acao vai tocar (${r.motivo}). Releia a pagina com browser_read_page, `
                  + 'role ate o elemento ficar visivel e repita com uma ref atual.',
              };
              await this.responder(cmd, ctx, resultado);
              return;
            }
          }

          const veredito = await avaliar(action, ws, cmd.args?.confirm === true, alvo);
          if (!veredito.permitido) {
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
      soltarIndicador?.();
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

    this.reply(cmd, r.ok, r.ok ? r.data : undefined, r.error);
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
    return { agentes, janelaDaPonte, extensaoOnline: this.online };
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

  private reply(cmd: BridgeCommand, ok: boolean, result?: unknown, error?: string): void {
    if (!this.online) return;
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
      const novo = await this.criarWorkspace(clientId);

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
    // O Dr. Cezar quer a ponte SEMPRE minimizada (30/09/2026): nasce assim, sem
    // abrir na tela nem piscar. Funciona porque `garantirJanelaDesenhada` da
    // layout a pagina por emulacao. So se o Chrome recusar nascer minimizada e
    // que cai no jeito antigo (abre com foco e devolve).
    try {
      janela = await chrome.windows.create({ url: 'about:blank', type: 'normal', state: 'minimized' });
      if (janela?.id !== undefined) {
        await chrome.storage.local.set({ janelaDaPonte: janela.id });
        this.abaAncora = janela.tabs?.[0]?.id;
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
      // esperando o Dr. Cezar (assinar, conferir, decidir) e chama isto ANTES
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

        return `aba ${alvo} entregue ao Dr. Cezar — saiu do meu controle, nenhuma faxina fecha ela `
          + `mais. Esta ativa na janela ${windowId}.${mensagemNova}`;
      }

      // USO DE TESTE — nao aparece em nenhum tool description nem e algo que
      // um agente normal saberia chamar (so existe em `bridge-server/test/`).
      // Fecha QUALQUER tabId, sem checar dono, para o teste de
      // `browser_entregar_aba` conseguir limpar a aba que entregou "ao Dr.
      // Cezar" (uma aba de teste de verdade) sem deixar lixo na janela dele.
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
   * Dr. Cezar.
   *
   * `opts.viaFaxina: true` (SO a faxina por ociosidade, `encerrarOciosos`): e
   * a rede de seguranca do incidente do PJe — agente parou porque TERMINOU e
   * esta esperando o Dr. Cezar (assinar, conferir, decidir), nao porque
   * abandonou. Cada aba propria que tiver pagina DE VERDADE (`ehPaginaReal`)
   * e ENTREGUE em vez de fechada; aba em branco ou pagina interna continua
   * sendo fechada, porque nao ha nada para o Dr. Cezar achar nela.
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
