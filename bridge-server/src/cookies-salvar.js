/**
 * browser_cookies_salvar (07/10/2026, pedido do Estrelinha — HANDOFF-COOKIES-PARA-ARQUIVO-20261007.md).
 *
 * browser_cookies devolve os valores ao agente, e a sessão logada do usuário ficaria no histórico
 * da conversa. Aqui os cookies vão da extensão direto para um ARQUIVO; o agente recebe só caminho,
 * quantidade e nomes.
 *
 * Fica fora de TOOLS de propósito: o browser_roteiro chama rodarTool com `bruto`, que devolve o dado
 * cru — por ali os valores voltariam ao agente. Tratado no handler, como a browser_baixar_midia.
 */
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const COOKIES_SALVAR_TOOL = {
  name: 'browser_cookies_salvar',
  description:
    'Grava os cookies de um site (inclusive httpOnly) direto num arquivo JSON, sem devolver nenhum valor: '
    + 'a resposta traz so o caminho, a quantidade e os NOMES. Use para renovar sessao de script sem a '
    + 'credencial passar pela conversa. Formato: array cru do chrome.cookies.getAll (name, value, domain, '
    + 'path, expirationDate, httpOnly, secure, sameSite). So o site da url e os dominios-pai que valem '
    + 'para ele. arquivo: caminho absoluto dentro da pasta do usuario. Apague o arquivo depois de usar.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL do site, ex.: https://app.exemplo.com.br/dashboard' },
      arquivo: { type: 'string', description: 'Caminho absoluto do .json a gravar (dentro da pasta do usuario).' },
    },
    required: ['url', 'arquivo'],
  },
};

/** Recusa caminho relativo e qualquer coisa fora da pasta do usuario (inclusive por `..`). */
export function validarArquivo(arquivo, casa = homedir()) {
  if (typeof arquivo !== 'string' || !arquivo.trim()) throw new Error('informe arquivo (caminho absoluto)');
  if (!isAbsolute(arquivo)) throw new Error(`arquivo precisa ser caminho absoluto: ${arquivo}`);
  const alvo = resolve(arquivo);
  const rel = relative(resolve(casa), alvo);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`recusado: so grava dentro de ${casa}`);
  return alvo;
}

/**
 * `enviar(acao, args, timeout)` = link.send. Nunca põe valor de cookie em mensagem de erro nem no
 * retorno.
 */
export async function salvarCookies(input, enviar) {
  const url = String(input.url || '');
  if (!/^https?:\/\//i.test(url)) throw new Error('informe a url (http/https) do site');
  const alvo = validarArquivo(input.arquivo);

  const data = await enviar('cap_cookies_completos', { params: { url, arquivo: alvo } }, 30_000);
  const cookies = Array.isArray(data?.cookies) ? data.cookies : null;
  if (!cookies) throw new Error('a extensao nao devolveu a lista de cookies (extensao desatualizada? recarregue-a)');

  mkdirSync(dirname(alvo), { recursive: true });
  const tmp = `${alvo}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cookies, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, alvo);
  try { chmodSync(alvo, 0o600); } catch { /* no Windows o mode vale pouco; a pasta do usuario ja e privada */ }

  return {
    arquivo: alvo,
    quantidade: cookies.length,
    nomes: cookies.map((c) => c.name),
    dominios: [...new Set(cookies.map((c) => c.domain))],
  };
}
