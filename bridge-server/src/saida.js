/**
 * Limite da resposta ao agente (fase 4: X3 e X4).
 *
 * X3: resposta de texto acima de N caracteres (padrao 12000) vai para um arquivo em
 *     ~/.praxedes-bridge-v6/saidas/ e o agente recebe o caminho + as primeiras linhas.
 *     Quem quer o texto na conversa pede `max_chars` (decisao dele: a resposta vem inteira
 *     ate esse tamanho). PRAXEDES_BRIDGE_ARQUIVO_ACIMA=0 desliga.
 * X4: teto por chamada. `max_chars` do agente (em tool que nao corta por conta propria) ou, na
 *     falta, PRAXEDES_BRIDGE_MAX_CHARS (padrao 30000; 0 = sem teto). Corte sempre avisa.
 *
 * Imagem e erro nao vao para arquivo (erro e curto e precisa ser lido; imagem nao e texto).
 */
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Tools que ja cortam por max_chars sozinhas (e avisam como continuar). */
const CORTAM_SOZINHAS = new Set(['browser_read_page', 'browser_extract']);

const numeroDeEnv = (nome, padrao) => {
  const v = process.env[nome];
  return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : padrao;
};

export const arquivoAcima = () => numeroDeEnv('PRAXEDES_BRIDGE_ARQUIVO_ACIMA', 12_000);
export const tetoPadrao = () => numeroDeEnv('PRAXEDES_BRIDGE_MAX_CHARS', 30_000);

let faxinaFeita = false;
function faxina(dir) {
  if (faxinaFeita) return;
  faxinaFeita = true;
  try {
    const limite = Date.now() - 3 * 24 * 3600 * 1000;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      try { if (statSync(p).mtimeMs < limite) unlinkSync(p); } catch { /* outro processo pode ter apagado */ }
    }
  } catch { /* pasta ainda nao existe */ }
}

function primeirasLinhas(texto, maxLinhas = 12, maxChars = 1200) {
  const linhas = texto.split('\n').slice(0, maxLinhas).join('\n');
  return linhas.length > maxChars ? `${linhas.slice(0, maxChars)}...` : linhas;
}

function gravar(texto, tool, dir) {
  mkdirSync(dir, { recursive: true });
  faxina(dir);
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const arq = join(dir, `${carimbo}-${String(tool).replace(/[^\w-]/g, '_')}-${Math.random().toString(36).slice(2, 6)}.txt`);
  writeFileSync(arq, texto, 'utf8');
  return arq;
}

/**
 * Aplica X3/X4 a uma resposta MCP `{content, isError?}`. Devolve a mesma resposta (ou uma nova).
 * `dir` e a pasta das saidas grandes.
 */
export function limitarResposta(resposta, { tool, input = {}, dir }) {
  if (!resposta?.content?.length) return resposta;
  const pedido = typeof input.max_chars === 'number' && input.max_chars > 0 ? input.max_chars : null;
  const acima = arquivoAcima();
  const teto = pedido ?? tetoPadrao();

  const content = resposta.content.map((item) => {
    if (typeof item?.text !== 'string') return item;
    const t = item.text;
    const n = t.length;

    // Agente pediu um tamanho: vale (tool que corta sozinha ja respeitou).
    if (pedido) {
      if (CORTAM_SOZINHAS.has(tool) || n <= pedido) return item;
      return { ...item, text: `${t.slice(0, pedido)}\n\n[... cortado em ${pedido} de ${n} caracteres (max_chars). Peca max_chars maior ou refine a consulta ...]` };
    }

    // X3: grande demais para a conversa -> arquivo.
    if (!resposta.isError && acima > 0 && n > acima) {
      try {
        const arq = gravar(t, tool, dir);
        return {
          ...item,
          text: `[saida grande: ${n} caracteres gravados em ${arq}]\nPrimeiras linhas:\n${primeirasLinhas(t)}\n\n`
            + 'Leia so o trecho que precisar (Read com offset/limit) ou repita a chamada com max_chars. '
            + 'Para ter tudo na conversa, passe max_chars maior que o tamanho acima.',
        };
      } catch { /* sem disco: cai no teto abaixo */ }
    }

    // X4: teto global.
    if (teto > 0 && n > teto) {
      return { ...item, text: `${t.slice(0, teto)}\n\n[... cortado em ${teto} de ${n} caracteres (teto da ponte). Use max_chars, seletor ou outra consulta ...]` };
    }
    return item;
  });
  return { ...resposta, content };
}
