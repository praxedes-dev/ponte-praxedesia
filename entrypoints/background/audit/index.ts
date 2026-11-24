import type { AuditEvent } from '../../../shared/types';

const DB_NAME = 'browser-agent-audit';
const STORE_NAME = 'events';

/** A cada tantos log(), confere o total e apara os mais antigos se precisar. */
const RITMO_DE_ROTACAO = 100;
/** Teto de eventos guardados — acima disso, `rotacionar()` apaga os mais antigos ate voltar aqui. */
const TETO_DE_EVENTOS = 5000;

class AuditLogger {
  private db: IDBDatabase | null = null;

  /**
   * Fila do intervalo entre o boot do service worker e o IndexedDB abrir.
   *
   * Antes (obra 10): `log()` chamado com `db` ainda nulo so dava
   * `console.warn` e descartava o evento — e o service worker MV3 dorme e
   * acorda com `init()` chamado de novo, sem `await`
   * (`background/index.ts:315`), entao essa janela existe toda vez que ele
   * acorda, nao so no primeiro boot da extensao. Guarda o evento JA MONTADO
   * (com `id`/`timestamp` do instante real do `log()`, nao de quando a fila
   * descarrega) e `init()` grava tudo, na ordem, assim que o banco abre.
   */
  private fila: AuditEvent[] = [];

  private contadorDeLogs = 0;

  async init(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('workspaceId', 'workspaceId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      };
      req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = reject;
    });

    if (this.fila.length === 0) return;
    const pendentes = this.fila;
    this.fila = [];
    // `this.db` acabou de ser atribuido pela promise acima — TS nao propaga
    // essa narrowing de `this.<campo>` por outras linhas (nem sempre, mesmo
    // sem `await` no meio), entao capturamos numa const local, igual toda
    // outra leitura de `this.db` nesta classe faz com o proprio guard `if
    // (!this.db)` logo antes de usar.
    const db = this.db;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const full of pendentes) store.add(full);
  }

  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): void {
    const full: AuditEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    if (!this.db) {
      this.fila.push(full);
      return;
    }
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(full);

    this.contadorDeLogs += 1;
    if (this.contadorDeLogs >= RITMO_DE_ROTACAO) {
      this.contadorDeLogs = 0;
      this.rotacionar().catch((err) => console.warn('[Auditoria] rotacao falhou:', err));
    }
  }

  /**
   * Apara os eventos mais antigos quando o total passa de `TETO_DE_EVENTOS`
   * — sem isto o IndexedDB cresce sem fim com cinco agentes gerando um
   * evento por comando. Chamado a cada `RITMO_DE_ROTACAO` gravacoes, nunca
   * dentro do proprio `log()` de forma sincrona (nao pode atrasar o comando
   * que esta sendo auditado).
   */
  private async rotacionar(): Promise<void> {
    const db = this.db;
    if (!db) return;

    const total = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = (e) => resolve((e.target as IDBRequest<number>).result);
      req.onerror = reject;
    });
    const aApagar = total - TETO_DE_EVENTOS;
    if (aApagar <= 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const idx = tx.objectStore(STORE_NAME).index('timestamp');
      let apagados = 0;
      // Sem direcao explicita = 'next' = crescente = mais antigo primeiro.
      const req = idx.openCursor();
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor || apagados >= aApagar) { resolve(); return; }
        cursor.delete();
        apagados += 1;
        cursor.continue();
      };
      req.onerror = reject;
    });
  }

  async getByWorkspace(workspaceId: string): Promise<AuditEvent[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const idx = tx.objectStore(STORE_NAME).index('workspaceId');
      const req = idx.getAll(workspaceId);
      req.onsuccess = () => resolve(req.result as AuditEvent[]);
      req.onerror = reject;
    });
  }

  /**
   * Ultimos eventos de TODOS os workspaces (todo agente conectado nesta
   * ponte, nao so o de `workspaceId`) — o dado por tras de `bridge_auditoria`
   * (obra 10): "quem fez o que", cruzando agentes. `filtro.clientId`
   * restringe a um unico agente (`so_meus: true`), filtrando por
   * `payload.clientId` porque nao existe indice por clientId (cada agente
   * tem seu proprio `workspaceId`, que muda entre sessoes).
   */
  /** Apaga todos os eventos (botao "Zerar contadores"). */
  async limpar(): Promise<void> {
    this.fila = [];
    if (!this.db) return;
    const db = this.db;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async listarRecentes(limite = 50, filtro?: { clientId?: string }): Promise<AuditEvent[]> {
    if (!this.db) return [];
    const db = this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const idx = tx.objectStore(STORE_NAME).index('timestamp');
      const resultados: AuditEvent[] = [];
      const req = idx.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor || resultados.length >= limite) { resolve(resultados); return; }
        const evento = cursor.value as AuditEvent;
        if (!filtro?.clientId || evento.payload?.clientId === filtro.clientId) {
          resultados.push(evento);
        }
        cursor.continue();
      };
      req.onerror = reject;
    });
  }
}

export const auditLogger = new AuditLogger();
