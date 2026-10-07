import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.PRAXEDES_BRIDGE_PORT || 8788);

const HEARTBEAT_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Transporte da ponte, com auto-eleicao de hub.
 *
 * Quem consegue bindar a porta vira HUB: aceita a conexao da extensao e
 * roteia os comandos dos demais agentes. Quem nao consegue bindar vira PEER
 * e manda seus comandos pelo hub. Assim nao existe daemon separado para
 * ninguem lembrar de subir, e varios agentes usam o mesmo Chrome ao mesmo tempo.
 *
 * Eventos emitidos: 'role' (hub|peer), 'extension' (true|false), 'push' (evento
 * vindo da extensao), 'log'.
 */
export class BridgeLink extends EventEmitter {
  constructor({ clientId, name, token }) {
    super();
    this.clientId = clientId;
    this.name = name;
    this.token = token;

    this.role = null;
    /** Comandos meus aguardando resposta: id -> {resolve, reject, timer, perfil} */
    this.pending = new Map();

    // Perfil ativo DESTA sessao (hub ou peer). Sessao que nunca chamou
    // usarPerfil() fica em "padrao" — o que ja existia antes de perfis
    // multiplos, para nao mudar nada de quem nao escolher (item 3 do desenho).
    this.perfilAtivo = 'padrao';

    // Estado de hub
    this.wss = null;
    // perfil -> ws da extensao daquele perfil. Reconexao do MESMO perfil
    // substitui a conexao antiga dele; perfil diferente convive (item 2).
    this.extensoes = new Map();
    this.peers = new Map(); // clientId -> ws

    // Estado de peer
    this.upstream = null;
    this.reconnectTimer = null;
  }

  get connected() {
    if (this.role === 'hub') return this.extensoes.size > 0;
    return this.upstream?.readyState === WebSocket.OPEN;
  }

  /**
   * Escolhe o perfil (extensao/Chrome) que recebe os comandos desta sessao a
   * partir de agora. Sem chamar isto, fica em "padrao" — item 3 do desenho:
   * o agente escolhe, nunca o hub decide por ele.
   */
  usarPerfil(perfil) {
    const nome = String(perfil ?? '').trim();
    this.perfilAtivo = nome || 'padrao';
    return this.perfilAtivo;
  }

  async start() {
    try {
      await this.#becomeHub();
    } catch (err) {
      if (err?.code !== 'EADDRINUSE') throw err;
      await this.#becomePeer();
    }
  }

  // ---------------------------------------------------------------- hub

  #becomeHub() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: HOST, port: PORT });

      const onError = (err) => {
        wss.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        wss.removeListener('error', onError);
        this.wss = wss;
        this.role = 'hub';
        this.emit('role', 'hub');
        this.emit('log', `hub no ws://${HOST}:${PORT}`);

        wss.on('error', (e) => this.emit('log', `erro no hub: ${e.message}`));
        wss.on('connection', (ws) => this.#onHubConnection(ws));
        this.#startHeartbeat();
        resolve();
      };

      wss.once('error', onError);
      wss.once('listening', onListening);
    });
  }

  #onHubConnection(ws) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.once('message', (raw) => {
      let hello;
      try {
        hello = JSON.parse(raw.toString());
      } catch {
        return ws.close(1008, 'hello invalido');
      }

      if (hello.type !== 'hello' || hello.token !== this.token) {
        this.emit('log', 'conexao recusada: token invalido');
        return ws.close(1008, 'token invalido');
      }

      if (hello.role === 'extension') {
        // Nome do perfil: quem nao configurou nada nas opcoes da extensao cai
        // em "padrao" — o pessoal, comportamento de hoje. `instanceId` e
        // gerado uma vez por instalacao (chrome.storage daquele perfil, nunca
        // muda sozinho) e serve so para distinguir "e a MESMA extensao
        // reconectando" (substitui, igual sempre foi) de "sao DUAS extensoes
        // diferentes com o mesmo nome de perfil" (recusa a segunda — nunca
        // silencioso, que e o defeito que este desenho existe para fechar).
        const perfil = String(hello.perfil || '').trim() || 'padrao';
        const instanceId = hello.instanceId || null;
        const atual = this.extensoes.get(perfil);

        if (
          atual?.readyState === WebSocket.OPEN
          && instanceId && atual.instanceId && atual.instanceId !== instanceId
        ) {
          this.emit('log', `conexao recusada: perfil "${perfil}" ja esta em uso por outra extensao`);
          ws.send(JSON.stringify({
            type: 'welcome', role: 'hub',
            erro: `perfil "${perfil}" ja esta em uso por outra extensao — escolha outro nome nas opcoes da extensao`,
          }));
          return ws.close(1008, `perfil "${perfil}" ja em uso`);
        }

        atual?.close(1000, 'substituida');
        ws.role = 'extension';
        ws.perfil = perfil;
        ws.instanceId = instanceId;
        this.extensoes.set(perfil, ws);
        this.emit('extension', true);
        this.emit('log', `extensao conectada: perfil "${perfil}"`);
      } else {
        ws.role = 'peer';
        ws.clientId = hello.clientId;
        ws.name = hello.name;
        this.peers.set(hello.clientId, ws);
        this.emit('log', `agente conectado: ${hello.name || hello.clientId}`);
      }

      ws.send(JSON.stringify({
        type: 'welcome',
        role: 'hub',
        extensionOnline: this.extensoes.size > 0,
        perfis: [...this.extensoes.keys()],
      }));
      ws.on('message', (data) => this.#onHubMessage(ws, data));
      ws.on('close', () => this.#onHubClose(ws));
    });
  }

  #onHubMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Peer perguntando o estado da ponte. Sem isto ele nao tem como saber se a
    // extensao esta conectada, porque quem fala com ela e o hub.
    if (msg.type === 'status' && ws.role === 'peer') {
      return ws.send(JSON.stringify({
        type: 'result',
        id: msg.id,
        ok: true,
        result: {
          extensaoConectada: this.extensoes.size > 0,
          perfis: [...this.extensoes.keys()],
          hub: { clientId: this.clientId, name: this.name, pid: process.pid },
          agentes: [...this.peers.values()].map((p) => ({ clientId: p.clientId, name: p.name })),
        },
      }));
    }

    // Comando vindo de outro agente: repassa para a extensao do perfil ativo
    // DAQUELE agente, mantendo o dono. Nunca cai para "qualquer uma que
    // estiver ligada" — perfil sem extensao falha alto (item 4).
    if (msg.type === 'cmd' && ws.role === 'peer') {
      const perfil = msg.perfil || 'padrao';
      const ext = this.extensoes.get(perfil);
      if (!ext) {
        return ws.send(JSON.stringify({
          type: 'result', id: msg.id, ok: false,
          error: `extensao do perfil "${perfil}" nao esta conectada — confira browser_status ou troque de perfil`,
        }));
      }
      return ext.send(JSON.stringify({ ...msg, clientId: ws.clientId }));
    }

    if (ws.role !== 'extension') return;

    // Resposta da extensao: minha, ou de um agente que eu roteio.
    if (msg.type === 'result') {
      if (!msg.clientId || msg.clientId === this.clientId) return this.#settle(msg);
      const peer = this.peers.get(msg.clientId);
      if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify(msg));
      return;
    }

    // Evento espontaneo (console, rede, navegacao): entrega ao dono da aba.
    if (msg.type === 'push') {
      if (!msg.clientId || msg.clientId === this.clientId) this.emit('push', msg);
      const peer = msg.clientId ? this.peers.get(msg.clientId) : null;
      if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify(msg));
    }
  }

  #onHubClose(ws) {
    // So limpa o mapa se esta conexao AINDA e a dona do perfil dela — uma
    // substituicao (mesmo perfil reconectando) ja trocou a entrada do mapa
    // antes de fechar a antiga; sem este confere, o close tardio da conexao
    // VELHA apagaria a NOVA que acabou de assumir. Uma queda de perfil nunca
    // pode derrubar o outro perfil (item 5 do desenho).
    if (ws.role === 'extension' && this.extensoes.get(ws.perfil) === ws) {
      this.extensoes.delete(ws.perfil);
      this.emit('extension', this.extensoes.size > 0);
      this.emit('log', `extensao desconectada: perfil "${ws.perfil}"`);
      this.#failAllPending(`extensao do perfil "${ws.perfil}" desconectada`, ws.perfil);
    }
    if (ws.role === 'peer') {
      this.peers.delete(ws.clientId);
      this.emit('log', `agente saiu: ${ws.clientId}`);
      // Sem isto as abas do agente ficam orfas no Chrome. Manda para TODOS os
      // perfis conectados: o agente pode ter usado mais de um na sessao.
      for (const ext of this.extensoes.values()) {
        ext.send(JSON.stringify({
          type: 'cmd', id: `close:${ws.clientId}`, clientId: ws.clientId, action: 'bridge_close_workspace',
        }));
      }
    }
  }

  // --------------------------------------------------------------- peer

  /**
   * Prazo para o hub responder o handshake WebSocket.
   *
   * Antes NAO havia prazo: esta Promise so terminava em `open` ou `close`. Uma
   * conexao que ficasse no meio do caminho — TCP aceito, handshake WebSocket
   * nunca completado, que e o instante em que o hub ainda esta subindo —
   * pendurava a Promise para sempre. Como `index.js` esperava por ela antes de
   * abrir o canal MCP, o Claude Code inteiro ficava sem a ponte (medido em
   * 09/09/2026, com cinco servidores MCP nascendo juntos).
   *
   * `index.js` ja nao depende mais disto para subir, mas o prazo continua
   * necessario: sem ele, um hub zumbi (processo vivo que nao responde) deixaria
   * este peer esperando em silencio, em vez de assumir a eleicao.
   */
  static TEMPO_MAXIMO_PARA_LIGAR_MS = 5_000;

  #becomePeer() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://${HOST}:${PORT}`);
      this.upstream = ws;

      // Sem isto, hub que aceita a conexao e nao responde prende o peer para
      // sempre. Com isto, ele desiste e tenta assumir a eleicao — que e o
      // comportamento certo quando o hub anterior virou zumbi.
      const prazo = setTimeout(() => {
        this.emit('log', `hub nao respondeu em ${BridgeLink.TEMPO_MAXIMO_PARA_LIGAR_MS}ms — vou tentar assumir`);
        try { ws.terminate(); } catch { /* ja morto */ }
        this.#scheduleReelection();
        resolve();
      }, BridgeLink.TEMPO_MAXIMO_PARA_LIGAR_MS);
      const encerrarPrazo = () => clearTimeout(prazo);

      ws.on('open', () => {
        encerrarPrazo();
        ws.send(JSON.stringify({
          type: 'hello', role: 'peer', clientId: this.clientId, name: this.name, token: this.token,
        }));
        this.role = 'peer';
        this.emit('role', 'peer');
        this.emit('log', `conectado ao hub em ${HOST}:${PORT}`);
        resolve();
      });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'result') this.#settle(msg);
        else if (msg.type === 'push') this.emit('push', msg);
      });

      ws.on('close', () => {
        encerrarPrazo();
        this.#failAllPending('conexao com o hub caiu');
        this.emit('log', 'hub caiu, tentando reassumir');
        this.#scheduleReelection();
        resolve();
      });

      ws.on('error', () => { /* tratado no close */ });
    });
  }

  /**
   * O hub morreu. Espera um passo aleatorio curto para os agentes nao
   * disputarem a porta no mesmo instante e tenta assumir.
   */
  #scheduleReelection() {
    clearTimeout(this.reconnectTimer);
    const delay = 200 + Math.floor(Math.random() * 800);
    this.reconnectTimer = setTimeout(() => {
      this.start().catch(() => this.#scheduleReelection());
    }, delay);
  }

  // ------------------------------------------------------------- comum

  #startHeartbeat() {
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss?.clients ?? []) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  #settle(msg) {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'falha sem mensagem'));
  }

  /**
   * `perfilFiltro` presente: falha so os comandos pendentes daquele perfil
   * (queda de UM perfil nao pode arrastar comando pendente do outro). Sem
   * filtro: falha tudo — usado quando a conexao inteira caiu (peer perdeu o
   * hub), onde nao ha "outro perfil" para preservar.
   */
  #failAllPending(reason, perfilFiltro) {
    for (const [id, entry] of [...this.pending]) {
      if (perfilFiltro && entry.perfil !== perfilFiltro) continue;
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(new Error(reason));
    }
  }

  /**
   * Estado da ponte. O hub responde de cabeca; o peer tem de perguntar, porque
   * quem conversa com a extensao e o hub.
   */
  async estado() {
    const base = { papel: this.role, endereco: `ws://${HOST}:${PORT}`, pid: process.pid };

    if (this.role === 'hub') {
      return {
        ...base,
        extensaoConectada: this.extensoes.size > 0,
        perfis: [...this.extensoes.keys()],
        perfilAtivo: this.perfilAtivo,
        agentes: [...this.peers.values()].map((p) => ({ clientId: p.clientId, name: p.name })),
      };
    }

    if (this.upstream?.readyState !== WebSocket.OPEN) {
      return { ...base, extensaoConectada: false, perfilAtivo: this.perfilAtivo, erro: 'sem conexao com o hub' };
    }

    const id = `${this.clientId}:status:${++BridgeLink.seq}`;
    this.upstream.send(JSON.stringify({ type: 'status', id }));
    const doHub = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ erro: 'o hub nao respondeu' });
      }, 5000);
      this.pending.set(id, { resolve, reject: resolve, timer });
    });
    return { ...base, perfilAtivo: this.perfilAtivo, ...doHub };
  }

  /** Executa uma acao no browser (no perfil ativo desta sessao) e devolve o resultado. */
  send(action, args = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = `${this.clientId}:${++BridgeLink.seq}`;
    const perfil = this.perfilAtivo || 'padrao';
    // `name` (obra 10, auditoria): so para o gancho `depois` gravar QUEM
    // mandou o comando — o hub so repassa (#onHubMessage, `{ ...msg, clientId }`),
    // nunca le este campo para nada alem disso.
    // `perfil`: qual extensao deve receber o comando (item 3/4 do desenho de
    // perfis multiplos, docs/obra-20260904). Nunca cai para "qualquer uma".
    const payload = JSON.stringify({
      type: 'cmd', id, clientId: this.clientId, name: this.name, action, args, perfil,
    });

    if (this.role === 'hub') {
      const ext = this.extensoes.get(perfil);
      if (!ext) {
        return Promise.reject(new Error(
          `extensao do perfil "${perfil}" nao esta conectada — abra o Chrome daquele perfil e confira `
          + 'o painel da extensao, ou troque de perfil com browser_usar_perfil',
        ));
      }
      ext.send(payload);
    } else {
      if (this.upstream?.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('sem conexao com o hub da ponte'));
      }
      this.upstream.send(payload);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`acao "${action}" estourou ${Math.round(timeoutMs / 1000)}s sem resposta`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, perfil });
    });
  }
}

BridgeLink.seq = 0;
