/**
 * Caderno por site (fase 4, G2). `bridge-server/caderno/<site>.json`:
 *   {
 *     "nome": "Fixture de teste",
 *     "dominios": ["caderno-teste.localhost"],      // host igual ou subdominio
 *     "verificado_em": "2026-10-20",
 *     "ler_antes": ["ate 5 linhas, regras curtas"],
 *     "armadilhas": ["o que ja deu errado nesse site"],
 *     "detalhe": "skill ou doc onde esta a receita completa"
 *   }
 * A leitura de pagina (browser_read_page) ganha, UMA VEZ por dominio por sessao (por processo do
 * servidor MCP), um bloco `[caderno X, verificado em D]` antes do cabecalho. Texto declarativo, sem
 * dado de cliente. PRAXEDES_BRIDGE_CADERNO=0 desliga; PRAXEDES_BRIDGE_CADERNO_DIR troca a pasta (testes).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_PADRAO = join(dirname(fileURLToPath(import.meta.url)), '..', 'caderno');
const MAX_LINHAS = 5;

let cadernos = null;
const jaMostrados = new Set();

export function carregarCadernos(pasta = process.env.PRAXEDES_BRIDGE_CADERNO_DIR || PASTA_PADRAO) {
  const lista = [];
  let arquivos = [];
  try { arquivos = readdirSync(pasta).filter((f) => f.endsWith('.json')); } catch { return lista; }
  for (const f of arquivos) {
    try {
      const c = JSON.parse(readFileSync(join(pasta, f), 'utf8'));
      if (!Array.isArray(c.dominios) || !c.dominios.length) continue;
      lista.push({
        arquivo: f,
        nome: c.nome || f.replace(/\.json$/, ''),
        dominios: c.dominios.map((d) => String(d).toLowerCase()),
        verificado_em: c.verificado_em || 'sem data',
        ler_antes: (c.ler_antes ?? []).map(String).slice(0, MAX_LINHAS),
        armadilhas: (c.armadilhas ?? []).map(String),
        detalhe: c.detalhe ? String(c.detalhe) : '',
      });
    } catch { /* arquivo quebrado nao derruba a leitura */ }
  }
  return lista;
}

/** Texto do caderno para esta URL, ou '' (sem caderno, ou ja mostrado nesta sessao). */
export function prefixoDoCaderno(url) {
  if (process.env.PRAXEDES_BRIDGE_CADERNO === '0') return '';
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ''; }
  cadernos ??= carregarCadernos();
  const c = cadernos.find((x) => x.dominios.some((d) => host === d || host.endsWith(`.${d}`)));
  if (!c) return '';
  const chave = `${c.arquivo}|${c.dominios.find((d) => host === d || host.endsWith(`.${d}`))}`;
  if (jaMostrados.has(chave)) return '';
  jaMostrados.add(chave);
  const linhas = [`[caderno ${c.nome}, verificado em ${c.verificado_em}]`, ...c.ler_antes.map((l) => `- ${l}`)];
  if (c.armadilhas.length) linhas.push(`Armadilhas: ${c.armadilhas.join('; ')}`);
  if (c.detalhe) linhas.push(`Detalhe: ${c.detalhe}`);
  return `${linhas.join('\n')}\n`;
}

/** Para testes: esquece o que ja foi mostrado e recarrega a pasta. */
export function reiniciarCadernos() {
  cadernos = null;
  jaMostrados.clear();
}
