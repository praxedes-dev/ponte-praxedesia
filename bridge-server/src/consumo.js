/**
 * Consumo da ponte: agrega `medicao.jsonl` (uma linha por chamada MCP: tool, ms,
 * chars de texto e img_chars de imagem devolvidos ao agente) em periodos para o
 * painel lateral da extensao. E o que a PONTE devolveu aos agentes, nao o gasto
 * total do Claude (que tem o prompt, o raciocinio, as outras ferramentas...).
 *
 * Estimativas: texto = chars / 4 tokens; imagem = largura x altura / 750 (regra da
 * Anthropic; lado maior reduzido a 1568). Linhas antigas de print, sem dimensao
 * gravada, valem 1280x800 (o `cap_print` ja reduz a isso): ~1365 tokens.
 */
import { readFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './token.js';

export const MEDICAO_ARQ = process.env.PRAXEDES_BRIDGE_MEDICAO_ARQ || join(CONFIG_DIR, 'medicao.jsonl');

export const CHARS_POR_TOKEN = 4;
const LADO_MAX = 1568;
const DIM_PADRAO = { w: 1280, h: 800 };

/** Tokens de uma imagem w x h pela regra da Anthropic (w*h/750, lado maior limitado a 1568). */
export function tokensDeImagem(w, h) {
  let largura = Number(w) > 0 ? Number(w) : DIM_PADRAO.w;
  let altura = Number(h) > 0 ? Number(h) : DIM_PADRAO.h;
  const escala = Math.min(1, LADO_MAX / Math.max(largura, altura));
  largura *= escala;
  altura *= escala;
  return Math.ceil((largura * altura) / 750);
}

/** Largura e altura de um JPEG em base64, lendo so o comeco (marcador SOF). null se nao achar. */
export function dimensoesDeJpegBase64(b64) {
  if (typeof b64 !== 'string' || b64.length < 100) return null;
  let buf;
  try {
    buf = Buffer.from(b64.slice(0, 87_380), 'base64'); // ~64 KB
  } catch {
    return null;
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marca = buf[i + 1];
    if (marca === 0xff) { i++; continue; }
    if (marca === 0xd8 || (marca >= 0xd0 && marca <= 0xd7) || marca === 0x01) { i += 2; continue; }
    const tamanho = buf.readUInt16BE(i + 2);
    const ehSof = marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc;
    if (ehSof) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + tamanho;
  }
  return null;
}

const vazio = () => ({ chamadas: 0, chars: 0, tokens_texto: 0, prints: 0, tokens_imagem: 0, tokens: 0 });

function somar(acc, linha) {
  const chars = Number(linha.chars) || 0;
  const temImagem = Number(linha.img_chars) > 0;
  acc.chamadas += 1;
  acc.chars += chars;
  acc.tokens_texto += Math.ceil(chars / CHARS_POR_TOKEN);
  if (temImagem) {
    acc.prints += 1;
    acc.tokens_imagem += tokensDeImagem(linha.img_w, linha.img_h);
  }
  acc.tokens = acc.tokens_texto + acc.tokens_imagem;
}

const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Agrega as linhas ja lidas. `agora` (Date) so existe para o teste fixar o relogio.
 * Periodos pela data LOCAL: hoje (desde 00:00), 7 dias (hoje e os 6 anteriores), mes
 * corrente e mes anterior. O ranking de tools e dos 7 dias.
 */
export function agregar(linhas, agora = new Date()) {
  const hoje0 = inicioDoDia(agora);
  const sete0 = hoje0 - 6 * 86_400_000;
  const mesAtual = agora.getFullYear() * 12 + agora.getMonth();
  const out = {
    hoje: vazio(), sete_dias: vazio(), mes_atual: vazio(), mes_anterior: vazio(),
    top_tools_7d: [],
  };
  const porTool = new Map();

  for (const l of linhas) {
    const t = Date.parse(l.t);
    if (!Number.isFinite(t)) continue;
    const d = new Date(t);
    const mes = d.getFullYear() * 12 + d.getMonth();
    if (t >= hoje0) somar(out.hoje, l);
    if (t >= sete0) {
      somar(out.sete_dias, l);
      const nome = String(l.tool ?? '?');
      if (!porTool.has(nome)) porTool.set(nome, vazio());
      somar(porTool.get(nome), l);
    }
    if (mes === mesAtual) somar(out.mes_atual, l);
    else if (mes === mesAtual - 1) somar(out.mes_anterior, l);
  }

  out.top_tools_7d = [...porTool.entries()]
    .map(([tool, v]) => ({ tool, ...v }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);
  return out;
}

function lerLinhas(arquivo) {
  if (!existsSync(arquivo)) return [];
  const linhas = [];
  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    if (!linha) continue;
    try { linhas.push(JSON.parse(linha)); } catch { /* linha cortada no fim do arquivo */ }
  }
  return linhas;
}

/**
 * Zera os contadores sem perder o historico: move `medicao.jsonl` (e o `.1`) para
 * `medicao-ate-AAAAMMDD-HHMMSS.jsonl` na mesma pasta e deixa o original vazio.
 */
export function arquivarMedicao(arquivo = MEDICAO_ARQ, agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const carimbo = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  const base = arquivo.replace(/\.jsonl$/, '');
  const guardados = [];
  for (const [de, sufixo] of [[arquivo, ''], [`${arquivo}.1`, '-1']]) {
    if (!existsSync(de)) continue;
    const para = `${base}-ate-${carimbo}${sufixo}.jsonl`;
    renameSync(de, para);
    guardados.push(para);
  }
  writeFileSync(arquivo, '');
  return { arquivados: guardados };
}

/** Clientes de teste (nome comeca com "teste-" ou "sonda") nao entram na medicao de uso real. */
export const ehClienteDeTeste = (nome) => /^(teste-|sonda)/i.test(String(nome ?? ''));

/** Le `medicao.jsonl.1` (rotacao em 5 MB) e `medicao.jsonl` e agrega. */
export function consumoDaMedicao(arquivo = MEDICAO_ARQ, agora = new Date()) {
  const linhas = [...lerLinhas(`${arquivo}.1`), ...lerLinhas(arquivo)];
  return { ...agregar(linhas, agora), gerado_em: agora.toISOString(), linhas: linhas.length };
}

/** Caracteres de texto e de imagem de uma resposta MCP, mais as dimensoes do print (para `medicao.jsonl`). */
export function tamanhoDaResposta(resposta) {
  let chars = 0;
  let imgChars = 0;
  let dim = null;
  for (const c of resposta?.content ?? []) {
    if (typeof c?.text === 'string') chars += c.text.length;
    else if (typeof c?.data === 'string') {
      imgChars += c.data.length;
      dim ??= dimensoesDeJpegBase64(c.data);
    }
  }
  // img_w/img_h: o painel converte print em tokens por largura x altura / 750.
  return { chars, img_chars: imgChars, ...(dim ? { img_w: dim.w, img_h: dim.h } : {}) };
}
