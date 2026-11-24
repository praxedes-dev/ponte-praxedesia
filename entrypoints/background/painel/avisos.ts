/**
 * Aviso do Windows quando um agente fica ESPERANDO o usuário.
 *
 * Tres situacoes chamam `avisarEspera`: captcha/desafio detectado (capacidades/
 * desafio.ts), acao barrada pelo freio que pede `confirm` (bridge/index.ts) e
 * pagina de login com a senha por preencher (capacidades/espera-login.ts).
 *
 * Texto: "Ponte esperando você no <site>: <motivo>". Clicar traz a aba/janela
 * para a frente. No maximo 1 aviso por aba a cada 2 minutos (senao uma pagina que
 * le toda hora viraria uma chuva de notificacoes). Liga/desliga no painel
 * (`chrome.storage.local.avisosEspera`, ligado por padrao).
 */


// Nomes amigaveis: o "nome" de cada caderno por site (bridge-server/caderno/*.json), embutido no build.
const CADERNOS: Array<{ nome?: string; dominios?: string[] }> = [];
// Copia publica: sem cadernos de site. Crie bridge-server/caderno/<site>.json e importe aqui se quiser.

/** Pura: host de teste/local nunca vira notificacao (o usuário nao quer ver teste na tela). */
export function ehHostLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.test');
}

/** "PJe e PorAqui do TJ-RO" vira "PJe"; "InfinitePay (site financeiro)" vira "InfinitePay". */
export function abreviarNome(nome: string): string {
  return nome.split(/ \(| e /)[0].trim() || nome;
}

/** Pura: nome do caderno cujo dominio casa com o host; senao o hostname sem porta. */
export function nomeAmigavel(
  host: string,
  cadernos: Array<{ nome?: string; dominios?: string[] }> = CADERNOS,
): string {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  for (const c of cadernos) {
    if (c.nome && c.dominios?.some((d) => h === d.toLowerCase() || h.endsWith(`.${d.toLowerCase()}`))) {
      return abreviarNome(c.nome);
    }
  }
  return h;
}

export const JANELA_ANTIREPETICAO_MS = 2 * 60_000;
export const CHAVE_CONFIG = 'avisosEspera';
const PREFIXO_ID = 'praxedes_espera_';

/** Pura: ja passaram 2 min desde o ultimo aviso desta aba? */
export function podeAvisar(ultimoPorAba: Map<number, number>, tabId: number, agora: number): boolean {
  const ultimo = ultimoPorAba.get(tabId);
  return ultimo === undefined || agora - ultimo >= JANELA_ANTIREPETICAO_MS;
}

/** Pura: o texto da notificacao. O site e o host, nunca a URL inteira. */
export function textoDoAviso(site: string, motivo: string): string {
  return `Ponte esperando você no ${site}: ${motivo}`;
}

/** Pura: o id da notificacao leva o tabId, para o clique achar a aba sem estado em memoria. */
export function idDaNotificacao(tabId: number, agora: number): string {
  return `${PREFIXO_ID}${tabId}_${agora}`;
}
export function tabIdDaNotificacao(id: string): number | null {
  const m = new RegExp(`^${PREFIXO_ID}(\\d+)_`).exec(id);
  return m ? Number(m[1]) : null;
}

export interface RegistroAviso {
  quando: number;
  tabId: number;
  site: string;
  motivo: string;
  /** criada: foi para o Windows; local: host de teste, so registrado (nada na tela); simulada: host de teste COM o modo de teste de decisao ligado (v6.1 f), a decisao existe mas nada foi ao Windows; suprimida: antirepeticao; desligada: opcao do painel. */
  resultado: 'criada' | 'local' | 'simulada' | 'suprimida' | 'desligada' | 'erro';
  /** O texto exato enviado ao Windows (so quando criada). */
  mensagem?: string;
  erro?: string;
}

const ultimoPorAba = new Map<number, number>();
let sequenciaDeDecisao = 0;
/** Ultimos avisos tentados (diagnostico e teste). */
export const registroAvisos: RegistroAviso[] = [];

function anotar(r: RegistroAviso): void {
  registroAvisos.unshift(r);
  if (registroAvisos.length > 30) registroAvisos.length = 30;
}

const CHAVE_MODO_TESTE = 'decisaoModoTeste';
/**
 * v6.1 (f), SO TESTE: com este modo ligado (cap_decisao_teste_admin, chrome.storage.session, some ao fechar o Chrome),
 * um host local/teste passa a abrir a decisao COMO SE a notificacao tivesse saido, sem mandar nada ao Windows. Host
 * de verdade nao muda em nada. Serve para exercitar o fluxo (aguardando, negada, parar tudo) sem incomodar o usuário.
 */
export async function modoTesteDecisaoLigado(): Promise<boolean> {
  try { return (await chrome.storage.session.get(CHAVE_MODO_TESTE))[CHAVE_MODO_TESTE] === true; } catch { return false; }
}
export async function ligarModoTesteDecisao(ligado: boolean): Promise<void> {
  try { await chrome.storage.session.set({ [CHAVE_MODO_TESTE]: ligado }); } catch { /* sem sessao: modo desligado */ }
}

export async function avisosLigados(): Promise<boolean> {
  try {
    const v = (await chrome.storage.local.get(CHAVE_CONFIG))[CHAVE_CONFIG];
    return v !== false;
  } catch {
    return true;
  }
}

/** Barato: da para consultar ANTES de gastar uma sonda na pagina. */
export async function vale(tabId: number): Promise<boolean> {
  return (await avisosLigados()) && podeAvisar(ultimoPorAba, tabId, Date.now());
}

/**
 * Notifica que o agente espera o usuário. `siteAlvo` troca o site mostrado (navegacao barrada: o destino, nao a aba atual). Nunca lanca (aviso e enfeite: nao
 * pode derrubar nem atrasar comando). Devolve true se a notificacao foi criada.
 */
export async function avisarEspera(tabId: number, motivo: string, siteAlvo?: string): Promise<boolean> {
  const agora = Date.now();
  let site = siteAlvo || 'navegador';
  if (!siteAlvo) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) site = new URL(tab.url).host || site;
    } catch { /* aba sumiu: o aviso sai sem o site */ }
  }

  if (!(await avisosLigados())) {
    anotar({ quando: agora, tabId, site, motivo, resultado: 'desligada' });
    return false;
  }
  if (!podeAvisar(ultimoPorAba, tabId, agora)) {
    anotar({ quando: agora, tabId, site, motivo, resultado: 'suprimida' });
    return false;
  }
  ultimoPorAba.set(tabId, agora);

  const mensagem = textoDoAviso(nomeAmigavel(site), motivo);
  if (ehHostLocal(site)) {
    // Fixture/teste: registra o que SERIA dito, sem mostrar nada ao usuário.
    anotar({ quando: agora, tabId, site, motivo, resultado: 'local', mensagem });
    return false;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.notifications.create(idDaNotificacao(tabId, agora), {
        type: 'basic',
        title: 'PraxedesIA v6',
        message: mensagem,
        iconUrl: chrome.runtime.getURL('icon-t-128.png'),
        priority: 2,
        requireInteraction: true,
      }, () => {
        const e = chrome.runtime.lastError;
        if (e) reject(new Error(e.message)); else resolve();
      });
    });
    anotar({ quando: agora, tabId, site, motivo, resultado: 'criada', mensagem });
    return true;
  } catch (err) {
    ultimoPorAba.delete(tabId);
    anotar({ quando: agora, tabId, site, motivo, resultado: 'erro', erro: String(err) });
    return false;
  }
}

/**
 * v6.1 (f): notificacao COM DOIS BOTOES (decisao do usuário, ver decisoes.ts). Diferente de
 * `avisarEspera`: nao tem a antirepeticao de 2 min (cada decisao e uma pergunta diferente; quem evita
 * a repeticao e o cofre, por chave), mas segue as duas travas de sempre: host local/teste NUNCA
 * notifica e o liga/desliga do painel vale. Devolve o id da notificacao, ou null se nao saiu (e entao
 * nao ha decisao: o comando barrado volta com a mensagem de sempre).
 */
export async function avisarComDecisao(
  tabId: number, motivo: string, botoes: [string, string], siteAlvo?: string,
): Promise<string | null> {
  const agora = Date.now();
  let site = siteAlvo || 'navegador';
  if (!siteAlvo) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) site = new URL(tab.url).host || site;
    } catch { /* aba sumiu */ }
  }
  if (!(await avisosLigados())) {
    anotar({ quando: agora, tabId, site, motivo, resultado: 'desligada' });
    return null;
  }
  const mensagem = textoDoAviso(nomeAmigavel(site), motivo);
  if (ehHostLocal(site)) {
    if (await modoTesteDecisaoLigado()) {
      const idSimulado = `${idDaNotificacao(tabId, agora)}_${sequenciaDeDecisao++}`;
      anotar({ quando: agora, tabId, site, motivo, resultado: 'simulada', mensagem });
      return idSimulado;
    }
    anotar({ quando: agora, tabId, site, motivo, resultado: 'local', mensagem });
    return null;
  }
  // Sufixo sequencial: duas decisoes na mesma aba no mesmo milissegundo nao podem dividir o id do botao.
  const id = `${idDaNotificacao(tabId, agora)}_${sequenciaDeDecisao++}`;
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.notifications.create(id, {
        type: 'basic',
        title: 'PraxedesIA v6',
        message: mensagem,
        iconUrl: chrome.runtime.getURL('icon-t-128.png'),
        priority: 2,
        requireInteraction: true,
        buttons: [{ title: botoes[0] }, { title: botoes[1] }],
      }, () => {
        const e = chrome.runtime.lastError;
        if (e) reject(new Error(e.message)); else resolve();
      });
    });
    ultimoPorAba.set(tabId, agora); // o aviso simples da mesma aba nao repete por cima
    anotar({ quando: agora, tabId, site, motivo, resultado: 'criada', mensagem });
    return id;
  } catch (err) {
    anotar({ quando: agora, tabId, site, motivo, resultado: 'erro', erro: String(err) });
    return null;
  }
}

/** Clique na notificacao: traz a aba (e a janela, tirando-a do minimizado) para a frente. */
export async function trazerAbaAFrente(notificationId: string): Promise<boolean> {
  const tabId = tabIdDaNotificacao(notificationId);
  if (tabId === null) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    const janela = await chrome.windows.get(tab.windowId);
    // So tira do minimizado; janela normal ou maximizada do usuario mantem o tamanho.
    await chrome.windows.update(tab.windowId, janela.state === 'minimized'
      ? { state: 'normal', focused: true }
      : { focused: true });
    await chrome.tabs.update(tabId, { active: true });
    chrome.notifications.clear(notificationId, () => { void chrome.runtime.lastError; });
    return true;
  } catch {
    chrome.notifications.clear(notificationId, () => { void chrome.runtime.lastError; });
    return false; // a aba foi fechada enquanto a notificacao esperava
  }
}

/** Liga o ouvinte de clique. Chamar uma vez, no carregamento do service worker. */
export function iniciarAvisos(): void {
  chrome.notifications.onClicked.addListener((id) => {
    if (id.startsWith(PREFIXO_ID)) void trazerAbaAFrente(id);
  });
}

/** Ids das notificacoes da ponte que o Chrome ainda tem ativas. */
export function notificacoesAtivas(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.notifications.getAll((todas) => resolve(Object.keys(todas ?? {}).filter((id) => id.startsWith(PREFIXO_ID))));
  });
}

/** So para teste/diagnostico: limpa a antirepeticao e as notificacoes ativas. */
export async function reiniciarAvisos(): Promise<void> {
  ultimoPorAba.clear();
  registroAvisos.length = 0;
  for (const id of await notificacoesAtivas()) {
    await new Promise<void>((r) => chrome.notifications.clear(id, () => r()));
  }
}
