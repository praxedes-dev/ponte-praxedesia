/**
 * browser_transcricao_youtube (17/10/2026, pedido do usuário).
 *
 * Pega a transcrição que o próprio YouTube mostra em "Mostrar transcrição", na aba DO AGENTE (ou na
 * `aba` passada — cada subagente na sua). Não usa API nem baixa áudio: abre o painel e lê o texto.
 * Nem todo vídeo tem transcrição; aí devolve erro dizendo isso.
 *
 * Medido em 17/10/2026: o painel novo usa `transcript-segment-view-model` (timestamp em
 * `.ytwTranscriptSegmentViewModelTimestamp`, texto em `.ytAttributedStringHost`); o antigo,
 * `ytd-transcript-segment-renderer` (`.segment-timestamp` / `.segment-text`). Lê os dois.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

export const YOUTUBE_TOOL = {
  name: 'browser_transcricao_youtube',
  description:
    'Le a transcricao de um video do YouTube pelo painel "Mostrar transcricao" da propria pagina, na aba '
    + 'deste agente (ou na `aba` passada). Sem `url`, usa o video ja aberto; com `url`, navega antes. '
    + 'Devolve titulo, canal e o texto com os tempos (0:00 ...). Com `arquivo`, grava o texto la e devolve so '
    + 'o resumo (bom para video longo). Video sem transcricao volta como erro dizendo isso.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Opcional. URL do video (youtube.com/watch?v=... ou youtu.be/...).' },
      com_tempo: { type: 'boolean', description: 'Prefixar cada trecho com o tempo. Padrao: true.' },
      arquivo: { type: 'string', description: 'Opcional. Caminho absoluto de um .txt/.md para gravar o texto.' },
    },
  },
};

const LER = `
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
if (!/youtube\\.com$/.test(location.hostname) || !/^\\/(watch|shorts|live)/.test(location.pathname)) {
  return { ok: false, motivo: 'a aba nao esta num video do YouTube (' + location.href + ')' };
}
const pegar = () => [...document.querySelectorAll('transcript-segment-view-model, ytd-transcript-segment-renderer')];
for (let i = 0; i < 30 && !document.querySelector('ytd-watch-metadata'); i++) await dorme(500);
let segs = pegar();
if (!segs.length) {
  let btn = null;
  for (let i = 0; i < 12 && !btn; i++) {
    const exp = document.querySelector('#description-inline-expander #expand');
    if (exp && exp.offsetParent) exp.click();
    await dorme(500);
    btn = document.querySelector('ytd-video-description-transcript-section-renderer button');
  }
  if (!btn) return { ok: false, motivo: 'este video nao tem transcricao (nao ha o botao "Mostrar transcricao")' };
  btn.click();
  for (let i = 0; i < 40; i++) { await dorme(500); segs = pegar(); if (segs.length) break; }
  if (!segs.length) return { ok: false, motivo: 'abri o painel de transcricao mas nenhum trecho apareceu em 20 s' };
  // painel virtualizado carrega aos poucos: espera parar de crescer
  for (let i = 0, n = -1; i < 10 && n !== segs.length; i++) { n = segs.length; await dorme(600); segs = pegar(); }
}
const limpa = (s) => (s || '').replace(/\\s+/g, ' ').trim();
const itens = segs.map((s) => ({
  t: limpa((s.querySelector('.ytwTranscriptSegmentViewModelTimestamp, .segment-timestamp') || {}).textContent),
  x: limpa((s.querySelector('.ytAttributedStringHost, .segment-text') || {}).textContent),
})).filter((i) => i.x);
// 17/10/2026: a pagina pode ter o painel de transcricao duas vezes no DOM (o mesmo texto vinha
// repetido na segunda metade do arquivo). Fica so a primeira ocorrencia de cada tempo+texto.
const vistos = new Set();
const unicos = itens.filter((i) => { const k = i.t + '|' + i.x; if (vistos.has(k)) return false; vistos.add(k); return true; });
const canal = limpa((document.querySelector('ytd-watch-metadata ytd-channel-name a') || {}).textContent);
const titulo = limpa((document.querySelector('ytd-watch-metadata h1') || {}).textContent) || document.title.replace(/ - YouTube$/, '');
return { ok: true, url: location.href, titulo, canal, itens: unicos, brutos: itens.length };
`;

export async function transcricaoYoutube(input, enviar) {
  if (input.url) {
    if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(input.url)) throw new Error('url nao e do YouTube');
    await enviar('navigate', { params: { url: input.url } }, 60_000);
  }
  const r = await enviar('cap_js', { params: { codigo: LER, args: [], timeout_ms: 60_000 } }, 70_000);
  if (!r?.ok) throw new Error(`transcricao: ${r?.motivo || 'falhou sem motivo'}`);

  const comTempo = input.com_tempo !== false;
  const texto = r.itens.map((i) => (comTempo && i.t ? `[${i.t}] ${i.x}` : i.x)).join('\n');
  const resumo = { duplicados_removidos: (r.brutos ?? r.itens.length) - r.itens.length, titulo: r.titulo, canal: r.canal, url: r.url, trechos: r.itens.length, caracteres: texto.length, ultimo_tempo: r.itens.at(-1)?.t || null };

  if (input.arquivo) {
    if (!isAbsolute(input.arquivo)) throw new Error('arquivo precisa ser caminho absoluto');
    mkdirSync(dirname(input.arquivo), { recursive: true });
    writeFileSync(input.arquivo, `# ${r.titulo}\n${r.canal} · ${r.url}\n\n${texto}\n`, 'utf8');
    return { ...resumo, arquivo: input.arquivo };
  }
  return { ...resumo, texto };
}
