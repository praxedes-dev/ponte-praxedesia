/**
 * v6.1 (e) — texto inteiro de um Google Docs de uma vez.
 *
 * O Docs desenha o documento em canvas: a arvore de acessibilidade e o innerText trazem so uma
 * fatia (o que esta na tela), e rolar a pagina inteira para ler custa dezenas de rodadas. Aqui o
 * texto vem de tres rotas, da mais simples a mais rebuscada (a primeira que render texto vence):
 *
 *   1. /mobilebasic   HTML estatico do documento inteiro (mesmos cookies do usuario)
 *   2. /edit          JSON embutido do modelo (`DOCS_modelChunk = [...]`): comandos de insercao de texto
 *   3. /export?format=txt
 *
 * Modulo puro (sem `chrome.*`): a busca da rede entra por `buscar`, para testar com fixture local.
 * Estrutura real nao foi conferida contra o Google por aqui; o teste usa fixtures que imitam a forma.
 */

/** `docs-fixture.localhost` existe so para a bancada ao vivo servir uma fixture local. */
export const HOSTS_DOCS = ['docs.google.com', 'docs-fixture.localhost'];

export interface RotaDocs { id: string; base: string }

export function rotaGoogleDocs(url: string | undefined | null): RotaDocs | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!HOSTS_DOCS.includes(u.hostname.toLowerCase())) return null;
  const m = /^\/document\/(?:u\/\d+\/)?d\/([\w-]{8,})/.exec(u.pathname);
  if (!m) return null;
  return { id: m[1], base: `${u.origin}/document/d/${m[1]}` };
}

const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bull: '•', laquo: '«', raquo: '»',
  ordm: 'º', ordf: 'ª', sect: '§', deg: '°', copy: '©', reg: '®',
  Aacute: 'Á', aacute: 'á', Agrave: 'À', agrave: 'à', Acirc: 'Â', acirc: 'â', Atilde: 'Ã', atilde: 'ã',
  Eacute: 'É', eacute: 'é', Ecirc: 'Ê', ecirc: 'ê', Iacute: 'Í', iacute: 'í',
  Oacute: 'Ó', oacute: 'ó', Ocirc: 'Ô', ocirc: 'ô', Otilde: 'Õ', otilde: 'õ',
  Uacute: 'Ú', uacute: 'ú', Uuml: 'Ü', uuml: 'ü', Ccedil: 'Ç', ccedil: 'ç',
};

export function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tudo, e: string) => {
    if (e[0] === '#') {
      const cod = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cod); } catch { return tudo; }
    }
    return ENTIDADES[e] ?? ENTIDADES[e.toLowerCase()] ?? tudo;
  });
}

/** Texto de uma pagina /mobilebasic. */
export function textoDeMobileBasic(html: string): string {
  let h = html;
  const corpo = /<div[^>]*class="[^"]*doc-content[^"]*"[^>]*>/i.exec(h);
  if (corpo) h = h.slice(corpo.index + corpo[0].length);
  else {
    const b = /<body[^>]*>/i.exec(h);
    if (b) h = h.slice(b.index + b[0].length);
  }
  h = h.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|blockquote)>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return normalizarTexto(decodificarEntidades(h));
}

function normalizarTexto(t: string): string {
  return t
    .replace(/\r\n?/g, '\n')
    .replace(/\n+\t/g, '\t')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── JSON embutido do modelo ─────────────────────────────────────────────────

/** Fatia o array JSON que comeca em `ini` (um '['), respeitando strings e escapes. Null se nao fechar. */
function fatiarArray(s: string, ini: number): string | null {
  let prof = 0;
  let dentro = false;
  for (let i = ini; i < s.length; i++) {
    const c = s[i];
    if (dentro) {
      if (c === '\\') i++;
      else if (c === '"') dentro = false;
      continue;
    }
    if (c === '"') dentro = true;
    else if (c === '[') prof++;
    else if (c === ']' && --prof === 0) return s.slice(ini, i + 1);
  }
  return null;
}

interface Comando { ty?: string; ibi?: number; s?: string; si?: number; ei?: number; mts?: Comando[] }

/** Aplica insercoes/remocoes (indices 1-based, em unidades UTF-16) sobre o buffer. */
function aplicar(buf: string, c: Comando): string {
  if (c.ty === 'is' && typeof c.s === 'string' && typeof c.ibi === 'number') {
    const pos = Math.max(0, Math.min(buf.length, c.ibi - 1));
    return buf.slice(0, pos) + c.s + buf.slice(pos);
  }
  if (c.ty === 'ds' && typeof c.si === 'number' && typeof c.ei === 'number') {
    return buf.slice(0, Math.max(0, c.si - 1)) + buf.slice(c.ei);
  }
  if ((c.ty === 'mlti' || c.mts) && Array.isArray(c.mts)) {
    return c.mts.reduce((acc, filho) => aplicar(acc, filho), buf);
  }
  return buf;
}

/** Marcas internas do modelo do Docs viram texto legivel; o resto dos controles some. */
function limparMarcas(t: string): string {
  return t
    .replace(/\u000b/g, '\n') // quebra de linha suave
    .replace(/[\u0012\u001c]/g, '\t') // fim de celula
    .replace(/\u0010|\u0011|\u001d|\u0003|\u0001|\u0002|\u0000/g, '')
    .replace(/[\u0004-\u0008\u000e\u000f\u0013-\u001b\u001e\u001f]/g, '');
}

/** Texto do documento a partir do HTML de /edit (`DOCS_modelChunk = [...]`). Null se nao achar. */
export function textoDeModelChunks(html: string): string | null {
  const re = /DOCS_modelChunk\s*=\s*\[/g;
  let buf = '';
  let achou = false;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const ini = m.index + m[0].length - 1;
    const bruto = fatiarArray(html, ini);
    if (!bruto) continue;
    let lista: Comando[];
    try { lista = JSON.parse(bruto.replace(/\\x([0-9a-fA-F]{2})/g, (_t, h) => `\\u00${h}`)); } catch { continue; }
    achou = true;
    for (const c of lista) buf = aplicar(buf, c);
  }
  if (!achou) return null;
  const texto = normalizarTexto(limparMarcas(buf));
  return texto || null;
}

// ── orquestracao ────────────────────────────────────────────────────────────

export interface ResultadoDocs { texto: string; via: 'mobilebasic' | 'modelo' | 'exportacao' }

/** `buscar` devolve o corpo da URL ou null (falha, 403, login). */
export async function extrairTextoDoDocs(
  rota: RotaDocs,
  buscar: (url: string) => Promise<string | null>,
): Promise<ResultadoDocs | null> {
  const mobile = await buscar(`${rota.base}/mobilebasic`).catch(() => null);
  if (mobile) {
    const t = textoDeMobileBasic(mobile);
    if (t) return { texto: t, via: 'mobilebasic' };
  }
  const edit = await buscar(`${rota.base}/edit`).catch(() => null);
  if (edit) {
    const t = textoDeModelChunks(edit);
    if (t) return { texto: t, via: 'modelo' };
  }
  const txt = await buscar(`${rota.base}/export?format=txt`).catch(() => null);
  if (txt) {
    const t = normalizarTexto(txt.replace(/^﻿/, ''));
    if (t) return { texto: t, via: 'exportacao' };
  }
  return null;
}

/** Mesma regra do `extract` do motor: from >= 0 le dali; negativo = cauda. */
export function fatiar(texto: string, from: number, max: number): string {
  if (from >= 0 && from < texto.length) return texto.slice(from, from + max);
  if (from >= 0) return '';
  return texto.slice(-max);
}

export function notaDeCorte(total: number, from: number, max: number): string {
  if (from < 0) return `\n[Google Docs: so a cauda; documento tem ${total} caracteres]`;
  const fim = Math.min(total, from + max);
  return fim < total
    ? `\n[Google Docs: mostrando ${from}-${fim} de ${total} caracteres; continue com from_length=${fim}]`
    : '';
}
