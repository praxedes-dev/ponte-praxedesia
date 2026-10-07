/**
 * browser_baixar_midia (26/09/2026, pedido do Dr. Cezar).
 *
 * O "motor" das extensoes de baixar do Behance, Instagram, YouTube etc. ja
 * existe pronto e mantido pela comunidade: o yt-dlp (video) e o gallery-dl
 * (imagem em resolucao maxima, ~300 sites). Esta tool e a cola: pede a
 * extensao o endereco da aba e os cookies COMPLETOS da sessao do Chrome,
 * escolhe o motor pelo site, roda aqui no Windows e confere no disco o que
 * caiu na pasta. Site que nenhum motor conhece cai no modo PAGINA: a
 * extensao lista as imagens/videos da aba (maior versao do srcset) e o
 * servidor baixa com os cookies e o Referer da pagina.
 *
 * Os cookies viram um arquivo temporario (formato Netscape, que os dois
 * motores pedem) e sao APAGADOS no fim, deu certo ou nao.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

// Sites em que o gallery-dl e o motor certo (imagem em alta; no Instagram e
// no X ele traz tambem os videos do post).
const GALERIA = [
  'behance.net', 'pinterest.', 'pin.it', 'instagram.com', 'artstation.com', 'deviantart.com',
  'flickr.com', 'tumblr.com', 'x.com', 'twitter.com', 'reddit.com', 'imgur.com', 'dribbble.com',
  'unsplash.com', 'pixiv.net', 'vk.com', 'bsky.app', 'threads.net',
];
// Sites de video: yt-dlp.
const VIDEO = [
  'youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'fb.watch', 'vimeo.com', 'twitch.tv',
  'dailymotion.com', 'kwai.com', 'globoplay.globo.com', 'soundcloud.com',
];

// Sites que recusam tudo que nao e navegador de verdade (Behance: 403 ate
// imitando o Chrome, medido 26/09/2026). So o modo pagina, pela aba.
const SO_PELA_ABA = ['behance.net'];

const casa = (host, lista) => lista.some((d) => host === d || host.endsWith(`.${d}`) || host.startsWith(d));

export const MIDIA_TOOL = {
  name: 'browser_baixar_midia',
  description:
    'Baixa as imagens e videos de uma pagina para uma pasta, em resolucao maxima, usando o login do '
    + 'Chrome. Sem url, usa a pagina aberta na aba. Escolhe o motor pelo site: gallery-dl (Behance, '
    + 'Pinterest, Instagram, ArtStation, X, Reddit, Imgur...), yt-dlp (YouTube, TikTok, Facebook, Vimeo, '
    + 'reels e videos em pedacos) e, para site que nenhum dos dois conhece, o modo "pagina" (le as '
    + 'imagens/videos da aba aberta, maior versao do srcset, e baixa com os cookies e o Referer). '
    + 'Devolve a lista de arquivos gravados com o tamanho, conferida no disco.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Pagina, post, projeto, perfil ou video. Sem isto: a aba aberta.' },
      pasta: { type: 'string', description: 'Onde gravar. Padrao: Downloads\\ponte-midia\\<site>-<data-hora>.' },
      motor: {
        type: 'string', enum: ['auto', 'gallery-dl', 'yt-dlp', 'pagina'],
        description: 'Padrao auto (escolhe pelo site e tenta o proximo se o primeiro nao trouxer nada).',
      },
      limite: { type: 'number', description: 'Maximo de arquivos (perfil, playlist, pagina grande). Padrao 100.' },
      min_px: { type: 'number', description: 'Modo pagina: ignora imagem menor que isto (lado maior). Padrao 300.' },
      so: { type: 'string', enum: ['tudo', 'imagens', 'videos'], description: 'Padrao tudo.' },
      nome: {
        type: 'string',
        description: 'Nome do arquivo, sem extensao (ex.: "01-336168689"). Um arquivo so: fica com este nome; '
          + 'varios: nome-01, nome-02... A extensao e a do arquivo baixado.',
      },
    },
  },
};

/**
 * ATUALIZACAO AUTOMATICA (pedido do Dr. Cezar, 26/09/2026). Site de video
 * muda toda semana e motor velho falha com "No video formats found". Uma vez
 * por dia, antes de baixar, atualiza os dois motores pelo pip (e assim que
 * estao instalados: o `yt-dlp -U` nao funciona em instalacao por pip). E se
 * um motor falhar com cara de "site mudou", atualiza na hora e tenta de novo.
 */
const MARCA_ATUALIZACAO = join(homedir(), '.praxedes-bridge', 'motores-atualizados.txt');
const UM_DIA = 24 * 3600_000;

async function atualizarMotores(forcar = false) {
  let ultima = 0;
  try { ultima = statSync(MARCA_ATUALIZACAO).mtimeMs; } catch { /* nunca atualizou */ }
  if (!forcar && Date.now() - ultima < UM_DIA) return null;
  const r = await rodar('python', ['-m', 'pip', 'install', '-q', '-U', 'yt-dlp[default]', 'gallery-dl'], 4 * 60_000);
  try {
    mkdirSync(join(homedir(), '.praxedes-bridge'), { recursive: true });
    writeFileSync(MARCA_ATUALIZACAO, new Date().toISOString());
  } catch { /* sem marca, tenta de novo amanha */ }
  return r.codigo === 0 ? 'motores atualizados' : `atualizacao falhou: ${r.erro.trim().split('\n').pop()?.slice(0, 160)}`;
}

/** Erro com cara de motor desatualizado (o site mudou). */
const PARECE_VELHO = /No video formats found|Unable to extract|please report this issue|KeyError|extractor error/i;

/**
 * Troca miniatura pelo ORIGINAL: o truque de toda extensao "baixar em alta".
 * Candidatos em ordem de preferencia; o primeiro que responder vale.
 */
function candidatosEmAlta(url) {
  const out = [];
  const be = /^(https:\/\/[^/]*behance\.net\/project_modules\/)[^/]+(\/.+)$/i.exec(url);
  if (be) out.push(`${be[1]}source${be[2]}`, `${be[1]}fs${be[2]}`, `${be[1]}max_3840${be[2]}`);
  const pin = /^(https:\/\/i\.pinimg\.com\/)[^/]+(\/.+)$/i.exec(url);
  if (pin) out.push(`${pin[1]}originals${pin[2]}`, `${pin[1]}736x${pin[2]}`);
  out.push(url);
  return [...new Set(out)];
}

/** Filtro por site: no Behance so as imagens DO projeto (fora capas de outros projetos e icones). */
function doConteudo(host, url) {
  if (host.endsWith('behance.net')) return /\/project_modules\//.test(url);
  return true;
}

function arquivoDeCookies(cookies) {
  const linhas = ['# Netscape HTTP Cookie File'];
  for (const c of cookies ?? []) {
    const dominio = c.hostOnly ? c.domain.replace(/^\./, '') : (c.domain.startsWith('.') ? c.domain : `.${c.domain}`);
    const exp = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    linhas.push([
      dominio, c.hostOnly ? 'FALSE' : 'TRUE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', exp, c.name, c.value,
    ].join('\t'));
  }
  const caminho = join(tmpdir(), `ponte-cookies-${randomUUID()}.txt`);
  writeFileSync(caminho, `${linhas.join('\n')}\n`, { mode: 0o600 });
  return caminho;
}

function cabecalhoCookie(cookies, url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return ''; }
  return (cookies ?? [])
    .filter((c) => {
      const d = c.domain.replace(/^\./, '');
      return c.hostOnly ? host === d : (host === d || host.endsWith(`.${d}`));
    })
    .map((c) => `${c.name}=${c.value}`).join('; ');
}

function rodar(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let saida = '';
    let erro = '';
    const timer = setTimeout(() => { p.kill(); erro += `\n[parado: passou de ${timeoutMs / 1000}s]`; }, timeoutMs);
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { erro += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ codigo: -1, saida, erro: `${erro}\n${e.message}` }); });
    p.on('close', (codigo) => { clearTimeout(timer); resolve({ codigo, saida, erro }); });
  });
}

/** Todos os arquivos da pasta (e subpastas), com tamanho. */
function listar(pasta) {
  const out = [];
  const andar = (d) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome);
      const st = statSync(p);
      if (st.isDirectory()) andar(p);
      else out.push({ caminho: p, bytes: st.size });
    }
  };
  if (existsSync(pasta)) andar(pasta);
  return out;
}

const EXT_VIDEO = /\.(mp4|webm|mov|mkv|m4v)$/i;
const EXT_PARCIAL = /\.(part|ytdl|temp)$|\.f\d+\.\w+$/i;

async function motorGalleryDl(url, pasta, cookies, limite) {
  return rodar('gallery-dl', ['--cookies', cookies, '-D', pasta, '--range', `1-${limite}`, '--no-mtime', url], 10 * 60_000);
}

async function motorYtDlp(url, pasta, cookies, limite, so) {
  const args = [
    '--cookies', cookies, '-P', pasta, '-o', '%(title).80B [%(id)s].%(ext)s',
    '--playlist-end', String(limite), '--no-mtime', '--windows-filenames',
    '--merge-output-format', 'mp4', '--ffmpeg-location', 'C:\\Program Files\\ffmpeg\\bin',
    // YouTube exige decifrar a assinatura em JavaScript; sem runtime o yt-dlp
    // responde "No video formats found" (medido 26/09/2026). O Node ja esta no PC.
    '--js-runtimes', 'node',
  ];
  if (so === 'imagens') args.push('--skip-download', '--write-thumbnail');
  else args.push('-f', 'bv*+ba/b');
  args.push(url);
  return rodar('yt-dlp', args, 20 * 60_000);
}

async function motorPagina(send, pasta, contexto, limite, minPx, so, url, cookies) {
  // A pagina pedida nao e a da aba: leva a aba ate ela (aba propria do agente;
  // na aba do Dr. Cezar sem permitir_acao a ponte recusa, como deve).
  if (url !== contexto.urlAba) {
    await send('navigate', { params: { url } }, 60_000);
    await new Promise((r) => setTimeout(r, 4000));
    contexto = { ...contexto, urlAba: url };
  }
  const host = new URL(url).hostname;
  const itens = (await send('cap_midia_listar', { params: { min_px: minPx, rolar: true } }, 90_000))
    .filter((i) => doConteudo(host, i.url));
  const avisos = [];

  // VIDEO EM PEDACOS e PLAYER EMBUTIDO (Vimeo no Behance, 26/09/2026): o
  // Vimeo recusa (401) qualquer pedido fora do navegador, ate com Referer.
  // Mas depois que a pagina rolou, o player ja carregou dentro da moldura e
  // a lista de pedacos (m3u8, assinada) esta no historico dela: esse
  // endereco o yt-dlp baixa direto.
  let streams = 0;
  if (so !== 'imagens') {
    const achados = await send('cap_midia_streams', {}, 60_000).catch(() => []);
    const urls = [...new Set(achados.flatMap((a) => a.valor ?? []).filter((u) => /^https?:/i.test(u)))];
    // Um video por lista: a do player (m3u8) e a melhor; json/mpd do mesmo video ficam de reserva.
    const preferidas = urls.filter((u) => /\.m3u8(\?|$)/i.test(u));
    const fila = (preferidas.length ? preferidas : urls).slice(0, limite);
    let k = 0;
    for (const s of fila) {
      k += 1;
      const r = await rodar('yt-dlp', [
        '--cookies', cookies, '--referer', contexto.urlAba, '-P', pasta,
        '-o', `video-${String(k).padStart(2, '0')}.%(ext)s`, '--no-mtime',
        '--merge-output-format', 'mp4', '--ffmpeg-location', 'C:\\Program Files\\ffmpeg\\bin',
        '-f', 'bv*+ba/b', s,
      ], 20 * 60_000);
      if (r.codigo === 0) streams += 1;
      else avisos.push(`video em pedacos ${k} falhou: ${r.erro.trim().split('\n').pop()?.slice(0, 160)}`);
    }
  }
  const pedacos = itens.filter((i) => i.tipo === 'video-em-pedacos');
  if (pedacos.length && !streams) {
    avisos.push(`${pedacos.length} video(s) da pagina vem em pedacos (blob:) e a lista deles nao apareceu: de play no video e rode de novo.`);
  }
  const alvo = itens
    .filter((i) => i.tipo !== 'video-em-pedacos')
    .filter((i) => so === 'tudo' || (so === 'imagens' ? i.tipo === 'imagem' : i.tipo === 'video'))
    .slice(0, limite);
  const usados = new Set();
  let n = 0;
  for (const it of alvo) {
    n += 1;
    try {
      let r;
      for (const cand of candidatosEmAlta(it.url)) {
        r = await fetch(cand, {
          headers: {
            Cookie: cabecalhoCookie(contexto.cookies, cand),
            Referer: contexto.urlAba,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
          },
        });
        if (r.ok && !/text\/html/i.test(r.headers.get('content-type') || '')) { it.url = cand; break; }
      }
      if (!r.ok) { avisos.push(`HTTP ${r.status}: ${it.url.slice(0, 120)}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const tipo = r.headers.get('content-type') || '';
      if (/text\/html/i.test(tipo)) { avisos.push(`veio pagina, nao arquivo: ${it.url.slice(0, 120)}`); continue; }
      let nome = basename(new URL(it.url).pathname) || `midia-${n}`;
      nome = decodeURIComponent(nome).replace(/[<>:"/\\|?*]+/g, '_').slice(0, 120);
      if (!extname(nome)) {
        const sub = (tipo.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        nome = `${nome}.${sub}`;
      }
      let final = nome;
      for (let i = 1; usados.has(final.toLowerCase()) || existsSync(join(pasta, final)); i += 1) {
        final = `${String(n).padStart(3, '0')}-${i}-${nome}`;
      }
      usados.add(final.toLowerCase());
      writeFileSync(join(pasta, final), buf);
    } catch (err) {
      avisos.push(`falhou ${it.url.slice(0, 120)}: ${String(err.message || err).slice(0, 80)}`);
    }
  }
  return { avisos, achados: itens.length, streams };
}

export async function baixarMidia(input, send) {
  const limite = Math.max(1, Math.min(Number(input.limite) || 100, 2000));
  const minPx = Number(input.min_px) || 300;
  const so = input.so || 'tudo';

  const contexto = await send('cap_midia_contexto', { params: { url: input.url } }, 20_000);
  const url = (input.url && String(input.url).trim()) || contexto.urlAba;
  if (!/^https?:/i.test(url)) throw new Error(`sem pagina para baixar (aba em "${url || 'vazio'}"): abra a pagina ou passe url.`);
  const host = new URL(url).hostname.replace(/^www\./, '');

  const agora = new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, (m) => (m === 'T' ? '-' : ''));
  const pasta = input.pasta && String(input.pasta).trim()
    ? String(input.pasta)
    : join(homedir(), 'Downloads', 'ponte-midia', `${host}-${agora}`);
  mkdirSync(pasta, { recursive: true });

  const pedido = input.motor || 'auto';
  let ordem;
  if (pedido !== 'auto') ordem = [pedido];
  else if (casa(host, SO_PELA_ABA)) ordem = ['pagina'];
  else if (casa(host, VIDEO)) ordem = ['yt-dlp', 'gallery-dl'];
  else if (casa(host, GALERIA)) ordem = so === 'videos' ? ['yt-dlp', 'gallery-dl'] : ['gallery-dl', 'yt-dlp'];
  else ordem = ['gallery-dl', 'yt-dlp'];
  // Pagina aberta na aba: o modo pagina e sempre a ultima rede de seguranca.
  if (pedido === 'auto' && !ordem.includes('pagina')) ordem.push('pagina');

  const antes = new Set(listar(pasta).map((a) => a.caminho));
  const cookies = arquivoDeCookies(contexto.cookies);
  const tentativas = [];
  let avisos = [];
  if (ordem.some((m) => m !== 'pagina')) {
    const a = await atualizarMotores(false);
    if (a) avisos.push(a);
  }
  let jaForcou = false;
  try {
    for (const motor of ordem) {
      if (motor === 'pagina') {
        const r = await motorPagina(send, pasta, contexto, limite, minPx, so, url, cookies);
        avisos = avisos.concat(r.avisos);
        tentativas.push({ motor, resultado: `${r.achados} itens na pagina${r.streams ? `, ${r.streams} video(s) em pedacos` : ''}` });
      } else {
        const rodarMotor = () => (motor === 'gallery-dl'
          ? motorGalleryDl(url, pasta, cookies, limite)
          : motorYtDlp(url, pasta, cookies, limite, so));
        let r = await rodarMotor();
        if (r.codigo !== 0 && !jaForcou && PARECE_VELHO.test(r.erro)) {
          jaForcou = true;
          const a = await atualizarMotores(true);
          avisos.push(`${motor} falhou com cara de site que mudou; ${a}; tentei de novo`);
          r = await rodarMotor();
        }
        const ultimaLinhaErro = r.erro.trim().split('\n').filter((l) => /error|erro|parado|unsupported/i.test(l)).slice(-2).join(' | ');
        tentativas.push({ motor, resultado: r.codigo === 0 ? 'ok' : `saiu com codigo ${r.codigo}${ultimaLinhaErro ? `: ${ultimaLinhaErro.slice(0, 300)}` : ''}` });
      }
      const novos = listar(pasta).filter((a) => !antes.has(a.caminho) && !EXT_PARCIAL.test(a.caminho) && a.bytes > 0);
      if (novos.length) break;
    }
  } finally {
    try { rmSync(cookies, { force: true }); } catch { /* best-effort */ }
  }

  let arquivos = listar(pasta).filter((a) => !antes.has(a.caminho) && !EXT_PARCIAL.test(a.caminho));
  if (so === 'imagens') arquivos = arquivos.filter((a) => !EXT_VIDEO.test(a.caminho));
  if (so === 'videos') arquivos = arquivos.filter((a) => EXT_VIDEO.test(a.caminho));
  const vazios = arquivos.filter((a) => a.bytes === 0);
  for (const v of vazios) { try { rmSync(v.caminho); } catch { /* */ } }
  arquivos = arquivos.filter((a) => a.bytes > 0);

  if (input.nome && String(input.nome).trim() && arquivos.length) {
    const base = String(input.nome).trim().replace(/[<>:"/\\|?*]+/g, '_');
    arquivos = arquivos.map((a, i) => {
      const destino = join(pasta, `${base}${arquivos.length > 1 ? `-${String(i + 1).padStart(2, '0')}` : ''}${extname(a.caminho)}`);
      if (destino === a.caminho) return a;
      if (existsSync(destino)) { avisos.push(`ja existia ${destino}: mantive o nome original`); return a; }
      renameSync(a.caminho, destino);
      return { ...a, caminho: destino };
    });
  }

  const relatorio = {
    ok: arquivos.length > 0,
    url,
    pasta,
    total: arquivos.length,
    mb: Number((arquivos.reduce((s, a) => s + a.bytes, 0) / 1048576).toFixed(1)),
    arquivos: arquivos.slice(0, 60).map((a) => ({ nome: a.caminho.slice(pasta.length + 1), kb: Math.round(a.bytes / 1024) })),
    ...(arquivos.length > 60 ? { mais: arquivos.length - 60 } : {}),
    tentativas,
    ...(avisos.length ? { avisos: avisos.slice(0, 15) } : {}),
  };
  return relatorio;
}
