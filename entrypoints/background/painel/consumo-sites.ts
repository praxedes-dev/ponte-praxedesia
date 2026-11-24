/**
 * Consumo por SITE, guardado pela propria extensao (chrome.storage.local.consumoSites).
 *
 * Por que aqui e nao no servidor: `medicao.jsonl` nao sabe de que site veio cada
 * chamada (so tool, ms e tamanho), e quem sabe a aba e a extensao. Entao os totais,
 * o ranking de tools e o numero de prints vem do servidor (o que foi de fato devolvido
 * ao agente) e o ranking de SITES vem daqui, a partir do `chars_brutos` de cada
 * resposta da extensao (antes do servidor enxugar a leitura: e um teto, nao o entregue).
 *
 * Baldes por dia local, 70 dias. Host local/de teste nunca entra. A gravacao e
 * adiada em 3 s para uma rajada de comandos virar uma escrita so.
 */

export interface BaldeSite { c: number; p: number }
export type DiasDeConsumo = Record<string, Record<string, BaldeSite>>;

const CHAVE = 'consumoSites';
const DIAS_GUARDADOS = 70;
const TOKENS_POR_PRINT = 1366; // cap_print reduz a 1280x800: ceil(1280*800/750)
const CHARS_POR_TOKEN = 4;

/** 'YYYY-MM-DD' pela data local. */
export function dataLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Pura: acrescenta um uso ao mapa. */
export function acrescentar(dias: DiasDeConsumo, site: string, chars: number, print: boolean, agora: number): void {
  const dia = (dias[dataLocal(agora)] ??= {});
  const b = (dia[site] ??= { c: 0, p: 0 });
  if (print) b.p += 1; else b.c += Math.max(0, chars);
}

/** Pura: descarta dias com mais de DIAS_GUARDADOS. */
export function podar(dias: DiasDeConsumo, agora: number): void {
  const corte = dataLocal(agora - DIAS_GUARDADOS * 86_400_000);
  for (const d of Object.keys(dias)) if (d < corte) delete dias[d];
}

export interface LinhaSite { site: string; chars: number; prints: number; tokens: number }

/** Pura: ranking dos ultimos `nDias` (hoje e os anteriores), maior primeiro. */
export function topSites(dias: DiasDeConsumo, agora: number, nDias = 7, n = 5): LinhaSite[] {
  const desde = dataLocal(agora - (nDias - 1) * 86_400_000);
  const soma = new Map<string, BaldeSite>();
  for (const [dia, sites] of Object.entries(dias)) {
    if (dia < desde) continue;
    for (const [site, b] of Object.entries(sites)) {
      const s = soma.get(site) ?? { c: 0, p: 0 };
      s.c += b.c; s.p += b.p;
      soma.set(site, s);
    }
  }
  return [...soma.entries()]
    .map(([site, b]) => ({
      site, chars: b.c, prints: b.p,
      tokens: Math.ceil(b.c / CHARS_POR_TOKEN) + b.p * TOKENS_POR_PRINT,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, n);
}

let memoria: DiasDeConsumo | null = null;
let carregando: Promise<DiasDeConsumo> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function carregar(): Promise<DiasDeConsumo> {
  if (memoria) return memoria;
  carregando ??= (async () => {
    try {
      const v = (await chrome.storage.local.get(CHAVE))[CHAVE];
      memoria = (v && typeof v === 'object') ? v as DiasDeConsumo : {};
    } catch {
      memoria = {};
    }
    return memoria;
  })();
  return carregando;
}

async function gravar(): Promise<void> {
  timer = null;
  if (!memoria) return;
  podar(memoria, Date.now());
  try { await chrome.storage.local.set({ [CHAVE]: memoria }); } catch { /* sem storage: fica so na memoria */ }
}

/** Registra o uso de uma resposta. Nunca lanca. */
export async function registrarUso(site: string, chars: number, print: boolean): Promise<void> {
  try {
    const dias = await carregar();
    acrescentar(dias, site, chars, print, Date.now());
    timer ??= setTimeout(() => { void gravar(); }, 3_000);
  } catch { /* contabilidade nunca derruba comando */ }
}

/** Apaga o ranking de sites (memoria e storage). */
export async function zerarConsumoSites(): Promise<void> {
  memoria = {};
  carregando = null;
  if (timer) { clearTimeout(timer); timer = null; }
  try { await chrome.storage.local.remove(CHAVE); } catch { /* sem storage */ }
}

export async function rankingDeSites(nDias = 7, n = 5): Promise<LinhaSite[]> {
  return topSites(await carregar(), Date.now(), nDias, n);
}
