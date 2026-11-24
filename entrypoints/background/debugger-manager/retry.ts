/**
 * v6.1 (b) — politica de retry do chrome.debugger, pura (sem `chrome.*`) para testar sem Chrome.
 *
 * Tres familias de falha, tratadas diferente porque diferem no que sabemos sobre o comando:
 *
 *  - "Debugger is not attached": o Chrome recusou ANTES de entregar. Certeza de que nao executou,
 *    entao reanexar e repetir 1 vez serve para qualquer comando, de leitura ou de acao.
 *  - Desanexou no meio / alvo fechou ("Detached while handling command", "Target closed",
 *    "Inspected target navigated or closed"): o comando pode ter chegado a rodar. Leitura: reanexa e
 *    repete 1 vez. ACAO: reanexa (para a aba continuar usavel) mas NAO repete, e o erro diz que pode
 *    ter executado. Repetir um clique que ja saiu e dar dois cliques.
 *  - Timeout: leitura (arvore, DOM, layout) recarrega a aba 1 vez e repete; ACAO nunca repete
 *    (pode ter executado), o erro diz "nao repita".
 *
 * Leitura = lista fechada de metodos CDP que so consultam. Tudo o que nao esta nela e tratado como
 * acao, inclusive Runtime.evaluate/callFunctionOn (executam JS arbitrario).
 */

/** Metodo de leitura -> teto (ms) antes de dar por travado. As arvores grandes (PJe) podem demorar. */
export const TETO_DE_LEITURA_MS: Record<string, number> = {
  'DOM.getDocument': 15_000,
  'DOM.describeNode': 15_000,
  'DOM.resolveNode': 15_000,
  'DOM.getBoxModel': 15_000,
  'DOM.querySelector': 15_000,
  'DOM.querySelectorAll': 15_000,
  'DOM.getNodeForLocation': 15_000,
  'DOM.getFrameOwner': 15_000,
  'Page.getLayoutMetrics': 15_000,
  'Page.getFrameTree': 15_000,
  'Page.getNavigationHistory': 15_000,
  'Accessibility.getFullAXTree': 40_000,
  'DOMSnapshot.captureSnapshot': 40_000,
};

export const ehLeitura = (metodo: string): boolean => metodo in TETO_DE_LEITURA_MS;

export type ClasseDeErro = 'nao-anexado' | 'desanexou' | 'timeout' | 'outro';

export function classificarErro(mensagem: string): ClasseDeErro {
  const m = mensagem.toLowerCase();
  if (m.includes('not attached')) return 'nao-anexado';
  if (m.includes('timed out') || m.includes('timeout')) return 'timeout';
  if (m.includes('detached') || m.includes('target closed') || m.includes('session closed')
    || m.includes('navigated or closed') || m.includes('no target with given id')) return 'desanexou';
  return 'outro';
}

export interface DepsDeRetry<T> {
  /** Uma tentativa do comando. */
  enviar(): Promise<T>;
  /** Reanexa o debugger (e refaz os enables/ganchos). */
  reanexar(): Promise<void>;
  /** Recarrega a aba e espera ela assentar. So para leitura que travou. */
  recarregar(): Promise<void>;
  log?(msg: string): void;
}

const comTeto = <T>(p: Promise<T>, ms: number | undefined): Promise<T> => {
  if (!ms) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Debugger command timed out (${ms} ms)`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
};

export async function enviarComRetry<T>(metodo: string, deps: DepsDeRetry<T>): Promise<T> {
  const leitura = ehLeitura(metodo);
  const teto = leitura ? TETO_DE_LEITURA_MS[metodo] : undefined;
  const tentar = () => comTeto(deps.enviar(), teto);

  try {
    return await tentar();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const classe = classificarErro(msg);

    if (classe === 'nao-anexado') {
      deps.log?.(`${metodo}: debugger nao anexado, reanexando e repetindo 1 vez`);
      await deps.reanexar();
      return tentar();
    }

    if (classe === 'desanexou') {
      if (leitura) {
        deps.log?.(`${metodo}: desanexou durante leitura, reanexando e repetindo 1 vez`);
        await deps.reanexar();
        return tentar();
      }
      // Acao: deixa a aba usavel, mas nao repete.
      await deps.reanexar().catch(() => undefined);
      throw new Error(`${msg} [${metodo} e comando de acao: o Chrome soltou o debugger no meio e ele PODE TER EXECUTADO — `
        + 'nao repita; releia a tela para ver o que ficou]');
    }

    if (classe === 'timeout') {
      if (leitura) {
        deps.log?.(`${metodo}: leitura travou (${msg}), recarregando a aba 1 vez`);
        await deps.recarregar();
        return tentar();
      }
      throw new Error(`${msg} [${metodo} e comando de acao: pode ter executado — nao repita; releia a tela antes de decidir]`);
    }

    throw err;
  }
}
