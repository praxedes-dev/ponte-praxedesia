/**
 * V3 (20/10/2026) — hosts que SEMPRE digitam tecla a tecla.
 *
 * O padrao global de `browser_type` continua rapido (setter + insertText). Para
 * os hosts abaixo o modo rapido deixa o campo com o texto mas o site nao reage
 * (mascara, validacao no keyup): o Portal de Assinaturas da OAB (Certisign)
 * exige digitacao real, e antes dependia de o agente lembrar de passar
 * `modo:"teclado"`. Mapa na mesma ideia de `ritmoHosts` (capacidades/ritmo.ts):
 * `chrome.storage.local.tecladoHosts` (array de sufixos) sobrescreve o padrao.
 *
 * Campo `type=password`: NAO entra aqui. O freio (policy.ts, regra 1) recusa
 * digitar em senha em qualquer modo, com ou sem confirm, entao nao ha modo
 * "sempre teclado" a registrar para senha: ela nao e digitada de jeito nenhum.
 *
 * Modulo puro (sem `chrome.*`) para o teste unitario importar direto.
 */

// `forca-teclado.localhost` e um host RESERVADO de teste: o Chrome resolve qualquer `*.localhost`
// para 127.0.0.1, entao a bancada ao vivo prova o caminho forcado numa fixture local, sem tocar em
// site de ninguem e sem mexer em chrome.storage. Nao existe fora da maquina.
export const HOSTS_TECLADO_PADRAO = ['oab.portaldeassinaturas.com.br', 'forca-teclado.localhost'];

/** Casa por igualdade ou por sufixo de dominio (`.host`), nunca por substring solta. */
export function hostForcaTeclado(url: string | undefined | null, hosts: string[] = HOSTS_TECLADO_PADRAO): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => {
    const alvo = h.toLowerCase().replace(/^\./, '');
    return host === alvo || host.endsWith(`.${alvo}`);
  });
}

/**
 * Decide se um comando `type` deve virar `cap_digitar`. So reescreve quando e
 * seguro manter a semantica do pedido: `clear:true` ficaria sem efeito no modo
 * teclado, e alvo semantico (papel/texto, sem ref) perderia o alvo em
 * `cap_digitar`, que so entende `ref` ou o foco. Nesses casos fica no rapido.
 */
export function reescreverTypeParaTeclado<T extends { action: string; args?: object }>(
  cmd: T, url: string | undefined | null, hosts?: string[],
): T | null {
  if (cmd.action !== 'type') return null;
  if (!hostForcaTeclado(url, hosts)) return null;
  const args = (cmd.args ?? {}) as { target?: { agentId?: number }; params?: Record<string, unknown> };
  const params = args.params ?? {};
  if (params.clear === true) return null;
  const alvo = args.target;
  const temRef = typeof alvo?.agentId === 'number';
  const semAlvo = !alvo || Object.keys(alvo).length === 0;
  if (!temRef && !semAlvo) return null;
  return { ...cmd, action: 'cap_digitar', args: { ...args, params: { text: params.text } } };
}
