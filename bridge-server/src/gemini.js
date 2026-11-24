/**
 * Gemini (gemini.google.com) como "semi-API" em uma chamada (27/10/2026).
 * Dirige a UI do Chrome real logado pelas MESMAS tools da ponte (rodarTool:
 * freio, aba explicita) e devolve o arquivo baixado. A geracao em si vai por
 * WebChannel do site e NAO e replicada: so se clica e se digita.
 *
 * Mapa da tela aferido em 27/10/2026:
 * - /images e /videos: prompt = div.ql-editor (contenteditable); Enter envia;
 * - botao "Proporção" (aria "Proporção" / "Proporção, 9:16" / "Proporção,
 *   Retrato (9:16)") abre menu [role=menuitemradio]: imagem "1:1|9:16|3:4|4:3|
 *   16:9", video "Paisagem (16:9)|Retrato (9:16)";
 * - estilo = <media-gen-template-card aria-label="Cinematográfico">; clicar
 *   poe um chip ("close <nome>") ao lado do prompt. Em /images os cards so
 *   existem no DOM depois de abrir "Ver mais imagens"; em /videos ja estao la;
 * - "Envio de arquivos" (so em /videos) abre direto o seletor de arquivo
 *   (entregue por browser_upload_por_clique, sem janela do Windows);
 * - enviar leva a URL a /app/<id>; "Parar resposta" aparece enquanto gera;
 * - imagem pronta: img.image com src lh3.googleusercontent.com/gg-dl/...;
 *   botao aria "Baixar imagem no tamanho original" (arquivo JPEG grande,
 *   ex. 1536x2752 para 9:16). fetch() da ppagina para esse src falha por
 *   CORS, e o download ARMADO da ponte tenta rebuscar o arquivo e falha: o
 *   clique vai SEM armar e o arquivo e pego na pasta Downloads do Chrome.
 */
import { existsSync, mkdirSync, readdirSync, statSync, renameSync, copyFileSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';
import { criarContexto } from './flow.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const PASTA_PADRAO = join(homedir(), 'Downloads', 'gemini');
const PROPORCOES_IMAGEM = ['1:1', '9:16', '3:4', '4:3', '16:9'];
const PROPORCOES_VIDEO = ['16:9', '9:16'];

export const GEMINI_TOOLS = [
  {
    name: 'browser_gemini_imagem',
    description:
      'Gemini (site, Chrome logado): gera UMA imagem em gemini.google.com/images numa chamada so e devolve o '
      + 'arquivo baixado no tamanho original (caminho + URL). Opcional: proporcao e estilo pronto do site '
      + '(ex.: "Cinematográfico", "Pintura a óleo", "Esboço"). Usa a cota do Gemini do usuário: nao gere '
      + 'em loop. Se estilo nao existir, falha antes de enviar e lista os nomes que existem.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'O que desenhar (obrigatorio, exceto com "conversa").' },
        proporcao: { type: 'string', enum: PROPORCOES_IMAGEM, description: 'Padrao: a que o site escolher.' },
        estilo: { type: 'string', description: 'Nome de um estilo pronto do site (aria-label do card).' },
        pasta: { type: 'string', description: `Onde gravar. Padrao ${PASTA_PADRAO}.` },
        nome: { type: 'string', description: 'Nome do arquivo sem extensao. Padrao: o que o Gemini der.' },
        espera_s: { type: 'number', description: 'Teto de espera da geracao. Padrao 180.' },
        conversa: { type: 'string', description: 'URL /app/<id> de uma imagem ja pedida: so espera e baixa, sem gerar outra.' },
      },
    },
  },
  {
    name: 'browser_gemini_video',
    description:
      'Gemini (site, Chrome logado): gera UM video em gemini.google.com/videos numa chamada so e devolve o '
      + '.mp4 baixado. Demora minutos (timeout padrao 600 s). Opcional: proporcao (16:9 ou 9:16), estilo pronto '
      + 'do site (ex.: "Anime", "Noir"), imagem (caminho local de uma foto para animar, pelo "Envio de arquivos"). '
      + 'A cota diaria de video e BAIXA: uma tentativa por vez, sem repetir a ma. Se estourar o timeout, o '
      + 'resultado traz "conversa" (URL); chame de novo com "conversa" para so recolher o video, sem gerar outro.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Descricao do video (obrigatorio, exceto com "conversa").' },
        proporcao: { type: 'string', enum: PROPORCOES_VIDEO },
        estilo: { type: 'string', description: 'Nome de um estilo pronto do site (aria-label do card).' },
        imagem: { type: 'string', description: 'Caminho local de uma foto para animar.' },
        pasta: { type: 'string', description: `Onde gravar. Padrao ${PASTA_PADRAO}.` },
        nome: { type: 'string', description: 'Nome do arquivo sem extensao.' },
        timeout: { type: 'number', description: 'Segundos de espera pelo video. Padrao 600.' },
        conversa: { type: 'string', description: 'URL /app/<id> de um video ja pedido: so espera e baixa, sem gerar.' },
      },
    },
  },
];

const norm = `function norm(s){return String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim();}`;
const xy = `function xy(e){var r=e.getBoundingClientRect();return r.width?{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}:null;}`;

/** Dimensoes de JPEG/PNG/WEBP lendo so o cabecalho. */
function dimensoes(caminho) {
  const fd = openSync(caminho, 'r');
  try {
    const b = Buffer.alloc(65536);
    const n = readSync(fd, b, 0, b.length, 0);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < n) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const t = b.toString('ascii', 12, 16);
      if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    }
    return null;
  } finally { closeSync(fd); }
}

const pastaDownloads = () => join(homedir(), 'Downloads');
function fotografar(dir) {
  const m = new Map();
  for (const f of readdirSync(dir)) { try { m.set(f, statSync(join(dir, f)).mtimeMs); } catch { /* sumiu */ } }
  return m;
}

/** Espera aparecer na pasta Downloads um arquivo novo e completo; devolve o caminho. */
async function pegarNovoDownload(dir, antes, t0, tetoMs, extensoes) {
  const fim = Date.now() + tetoMs;
  let ultimo = null;
  while (Date.now() < fim) {
    await esperar(1000);
    for (const f of readdirSync(dir)) {
      if (/\.(crdownload|tmp)$/i.test(f)) continue;
      if (extensoes && !extensoes.includes(extname(f).toLowerCase())) continue;
      const p = join(dir, f);
      let s; try { s = statSync(p); } catch { continue; }
      if (!s.isFile() || (antes.has(f) && antes.get(f) === s.mtimeMs) || s.mtimeMs < t0 - 3000) continue;
      if (ultimo && ultimo.p === p && ultimo.size === s.size && s.size > 0) return p;
      ultimo = { p, size: s.size };
    }
  }
  return null;
}

function guardar(origem, pasta, nome) {
  mkdirSync(pasta, { recursive: true });
  const ext = extname(origem);
  const base = nome ? String(nome).replace(/[\\/:*?"<>|]/g, '_') : basename(origem, ext);
  let destino = join(pasta, `${base}${ext}`);
  if (destino.toLowerCase() === origem.toLowerCase()) return origem;
  for (let i = 2; existsSync(destino); i++) destino = join(pasta, `${base}-${i}${ext}`);
  try { renameSync(origem, destino); } catch { copyFileSync(origem, destino); unlinkSync(origem); }
  return destino;
}

async function clicarAchado(ctx, codigoComXY, ms = 5000, passo = 300) {
  const p = await ctx.ate(`${xy} ${codigoComXY}`, ms, passo);
  if (!p) return null;
  await ctx.tool('browser_click', { x: p.x, y: p.y });
  return p;
}

async function abrirRota(ctx, rota) {
  await ctx.tool('browser_navigate', { url: `https://gemini.google.com/${rota}` });
  const ok = await ctx.ate(`var e=document.querySelector('div.ql-editor'); return !!(e && e.getBoundingClientRect().width);`, 30_000);
  if (!ok) throw new Error(`o campo de prompt nao apareceu em gemini.google.com/${rota} (logado no Gemini?)`);
}

async function escolherEstilo(ctx, nome, rota) {
  const achar = `${norm} var alvo=norm(${JSON.stringify(nome)});
    var cs=Array.from(document.querySelectorAll('media-gen-template-card'));
    var c=cs.find(function(c){return norm(c.getAttribute('aria-label'))===alvo;}) || cs.find(function(c){return norm(c.getAttribute('aria-label')).indexOf(alvo)>=0;});
    return {n:cs.length, nomes:cs.map(function(c){return c.getAttribute('aria-label');}), achou:!!c, nomeReal:c&&c.getAttribute('aria-label')};`;
  let r = await ctx.js(achar);
  if (!r.achou && rota === 'images') {
    // Em /images os cards de estilo so entram no DOM depois de "Ver mais imagens".
    await ctx.js(`var b=document.querySelector('[aria-label="Ver mais imagens"]'); if(b) b.scrollIntoView({block:'center'}); return 1;`);
    await clicarAchado(ctx, `var b=document.querySelector('[aria-label="Ver mais imagens"]'); return b?xy(b):null;`, 8000);
    r = (await ctx.ate(`var v=(function(){${achar}})(); return v.n>0?v:null;`, 8000, 500)) || await ctx.js(achar);
  }
  if (!r.achou) throw new Error(`estilo "${nome}" nao existe no site agora. Nada foi enviado. Estilos vistos: ${(r.nomes || []).join(', ') || '(nenhum carregou)'}`);
  const chip = `${norm} var alvo=norm(${JSON.stringify(r.nomeReal)});
    return Array.from(document.querySelectorAll('button')).some(function(b){return b.getBoundingClientRect().width>0 && norm(b.getAttribute('aria-label')||b.innerText).indexOf(alvo)>=0 && /^close/.test(norm(b.getAttribute('aria-label')||b.innerText));});`;
  const clique = `var c=Array.from(document.querySelectorAll('media-gen-template-card')).find(function(c){return c.getAttribute('aria-label')===${JSON.stringify(r.nomeReal)};});`;
  // 1o: clique por JS (funciona com o card fora da tela); 2o: clique real.
  await ctx.js(`${clique} c.scrollIntoView({block:'center'}); c.click(); return 1;`);
  await esperar(1200);
  if (!(await ctx.js(chip))) {
    await clicarAchado(ctx, `${clique} if(!c) return null; c.scrollIntoView({block:'center'}); return xy(c);`, 3000);
    await esperar(1200);
    if (!(await ctx.js(chip))) throw new Error(`cliquei no estilo "${r.nomeReal}" mas o chip do estilo nao apareceu no prompt. Nada foi enviado.`);
  }
  return r.nomeReal;
}

async function escolherProporcao(ctx, valor, rota) {
  const lista = rota === 'images' ? PROPORCOES_IMAGEM : PROPORCOES_VIDEO;
  if (!lista.includes(valor)) throw new Error(`proporcao "${valor}" invalida para ${rota}: use ${lista.join(', ')}`);
  const abrir = await clicarAchado(ctx, `var b=Array.from(document.querySelectorAll('button')).find(function(e){return /^Propor/.test((e.getAttribute('aria-label')||e.innerText||'').trim()) && e.getBoundingClientRect().width>0;}); return b?xy(b):null;`, 8000);
  if (!abrir) throw new Error('botao "Proporção" nao achado');
  const item = rota === 'images' ? `(e.innerText||'').trim()===${JSON.stringify(valor)}` : `(e.innerText||'').indexOf(${JSON.stringify(`(${valor})`)})>=0`;
  const ok = await clicarAchado(ctx, `var e=Array.from(document.querySelectorAll('[role=menuitemradio]')).find(function(e){return ${item} && e.getBoundingClientRect().width>0;}); return e?xy(e):null;`, 5000);
  if (!ok) throw new Error(`item de proporcao ${valor} nao apareceu no menu`);
  await esperar(500);
  const conf = await ctx.js(`var b=Array.from(document.querySelectorAll('button')).find(function(e){return /^Propor/.test((e.getAttribute('aria-label')||'').trim()) && e.getBoundingClientRect().width>0;}); return b?(b.getAttribute('aria-label')||''):'';`);
  if (!String(conf).includes(valor)) throw new Error(`a proporcao nao pegou (botao diz "${conf}")`);
}

async function anexarImagem(ctx, caminho, uploadPorClique, rodarTool) {
  if (!existsSync(caminho)) throw new Error(`imagem nao encontrada: ${caminho}`);
  const btn = await ctx.ate(`${xy} var b=Array.from(document.querySelectorAll('button')).find(function(e){return (e.getAttribute('aria-label')||'')==='Envio de arquivos' && e.getBoundingClientRect().width>0;}); return b?xy(b):null;`, 8000);
  if (!btn) throw new Error('botao "Envio de arquivos" nao achado (so existe em /videos)');
  await uploadPorClique({ caminhos: [caminho], x: btn.x, y: btn.y, ...ctx.aba }, rodarTool, ctx.send);
  const pronto = await ctx.ate(`return Array.from(document.querySelectorAll('button')).some(function(b){return (b.getAttribute('aria-label')||'')==='fechar anexo';});`, 30_000, 500);
  if (!pronto) throw new Error('o Gemini nao mostrou o anexo ("fechar anexo") depois do envio. Nada foi enviado ao Gemini.');
  await esperar(1500);
}

async function digitarEEnviar(ctx, prompt) {
  const alvo = String(prompt).replace(/\s+/g, ' ').trim();
  let escrito = '';
  for (let tent = 0; tent < 2; tent++) {
    await clicarAchado(ctx, `var e=document.querySelector('div.ql-editor'); return e?xy(e):null;`, 5000);
    await ctx.tool('browser_type', { text: String(prompt), modo: 'teclado', delay_ms: 8 });
    escrito = await ctx.js(`var e=document.querySelector('div.ql-editor'); return (e.innerText||'').replace(/\\s+/g,' ').trim();`);
    if (escrito === alvo) break;
    await ctx.tool('browser_press_key', { key: 'a', modifiers: ['Control'] }, false);
    await ctx.tool('browser_press_key', { key: 'Delete' }, false);
  }
  if (escrito !== alvo) throw new Error(`o prompt nao ficou igual no campo (ficou: "${String(escrito).slice(0, 120)}"); nada foi enviado`);
  await ctx.tool('browser_press_key', { key: 'Enter' });
  const url = await ctx.ate(`return /\\/app\\/[0-9a-f]+/.test(location.pathname) ? location.href : null;`, 30_000, 500);
  if (!url) throw new Error('enviei o prompt mas a URL nao virou /app/<id>; confira a aba (pode nao ter enviado)');
  return url;
}

const ESTADO_RESPOSTA = `var gerando=Array.from(document.querySelectorAll('button')).some(function(b){return (b.getAttribute('aria-label')||'')==='Parar resposta';});
  var txt=(document.body.innerText||'').replace(/\\s+/g,' ').trim();`;

// ---------- imagem ----------

async function gerarImagem(input, ctx) {
  const pasta = input.pasta || PASTA_PADRAO;
  let conversa = input.conversa ? String(input.conversa) : null;
  let estilo = null;
  if (conversa) {
    if (!/gemini\.google\.com\/app\/[0-9a-f]+/.test(conversa)) throw new Error('"conversa" deve ser uma URL gemini.google.com/app/<id>');
    await ctx.tool('browser_navigate', { url: conversa });
  } else {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) throw new Error('prompt obrigatorio (ou passe "conversa" de uma imagem ja pedida)');
    await abrirRota(ctx, 'images');
    estilo = input.estilo ? await escolherEstilo(ctx, String(input.estilo), 'images') : null;
    if (input.proporcao) await escolherProporcao(ctx, String(input.proporcao), 'images');
    conversa = await digitarEEnviar(ctx, prompt);
  }

  const fim = Date.now() + (Number(input.espera_s) || 180) * 1000;
  await esperar(5000);
  let pronta = null; let semImagem = 0; let texto = ''; let srcVisto = null;
  while (Date.now() < fim) {
    const st = await ctx.js(`${ESTADO_RESPOSTA}
      var btns=Array.from(document.querySelectorAll('button')).filter(function(b){return /^Baixar imagem/.test(b.getAttribute('aria-label')||'');});
      var imgs=Array.from(document.querySelectorAll('img.image')).filter(function(i){return /googleusercontent\.com/.test(i.src);});
      var i=imgs[imgs.length-1];
      return {gerando:gerando, n:btns.length, src:i&&i.src, w:i&&i.naturalWidth, h:i&&i.naturalHeight, txt:txt.slice(-400)};`);
    texto = st.txt;
    if (st.src && /^https:/.test(st.src)) srcVisto = st.src; // vira blob: depois de carregar
    if (st.n && !st.gerando) { pronta = st; break; }
    semImagem = !st.gerando && !st.n ? semImagem + 1 : 0;
    if (semImagem >= 10) throw new Error(`o Gemini terminou sem imagem (recusa ou pergunta). Conversa: ${conversa}. Texto final da pagina: ${texto}`);
    await esperar(3000);
  }
  if (!pronta) throw new Error(`a imagem nao ficou pronta em ${input.espera_s || 180}s. Conversa: ${conversa}`);

  const dir = pastaDownloads();
  const antes = fotografar(dir);
  const t0 = Date.now();
  const clicou = await clicarAchado(ctx, `var bs=Array.from(document.querySelectorAll('button')).filter(function(e){return /^Baixar imagem/.test(e.getAttribute('aria-label')||'');});
    var b=bs[bs.length-1]; if(!b) return null; b.scrollIntoView({block:'center'}); return xy(b);`, 8000);
  if (!clicou) throw new Error(`botao "Baixar imagem" nao achado. Conversa: ${conversa}`);
  const baixado = await pegarNovoDownload(dir, antes, t0, 60_000, ['.jpg', '.jpeg', '.png', '.webp']);
  if (!baixado) throw new Error(`cliquei em baixar mas nenhum arquivo novo apareceu em ${dir} em 60 s. Conversa: ${conversa}`);
  const caminho = guardar(baixado, pasta, input.nome);
  const d = dimensoes(caminho);
  return {
    caminho, url: srcVisto || conversa, url_tipo: srcVisto ? 'imagem (lh3.googleusercontent, pode expirar)' : 'conversa', conversa, estilo, proporcao_pedida: input.proporcao ?? null,
    largura: d?.w ?? null, altura: d?.h ?? null, bytes: statSync(caminho).size,
    ...(d ? { proporcao_real: Math.round((d.w / d.h) * 1000) / 1000 } : {}),
  };
}

// ---------- video ----------

async function gerarVideo(input, ctx, uploadPorClique, rodarTool) {
  const pasta = input.pasta || PASTA_PADRAO;
  let conversa = input.conversa ? String(input.conversa) : null;
  let estilo = null;
  if (!conversa) {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) throw new Error('prompt obrigatorio (ou passe "conversa" de um video ja pedido)');
    if (input.imagem && !existsSync(String(input.imagem))) throw new Error(`imagem nao encontrada: ${input.imagem}`);
    await abrirRota(ctx, 'videos');
    estilo = input.estilo ? await escolherEstilo(ctx, String(input.estilo), 'videos') : null;
    if (input.proporcao) await escolherProporcao(ctx, String(input.proporcao), 'videos');
    if (input.imagem) await anexarImagem(ctx, String(input.imagem), uploadPorClique, rodarTool);
    conversa = await digitarEEnviar(ctx, prompt);
  } else {
    if (!/gemini\.google\.com\/app\/[0-9a-f]+/.test(conversa)) throw new Error('"conversa" deve ser uma URL gemini.google.com/app/<id>');
    await ctx.tool('browser_navigate', { url: conversa });
  }
  return recolherVideo(input, ctx, conversa, pasta, estilo);
}

async function recolherVideo(input, ctx, conversa, pasta, estilo) {
  const teto = (Number(input.timeout) || 600) * 1000;
  const fim = Date.now() + teto;
  await esperar(5000);
  let pronto = null; let ultimoTxt = ''; let recargas = 0; let ultimaRecarga = Date.now();
  while (Date.now() < fim) {
    const st = await ctx.js(`${ESTADO_RESPOSTA}
      var vs=Array.from(document.querySelectorAll('video')).filter(function(v){return (v.currentSrc||v.src);});
      var v=vs[vs.length-1];
      return {gerando:gerando, n:vs.length, src:v&&(v.currentSrc||v.src), w:v&&v.videoWidth, h:v&&v.videoHeight, txt:txt.slice(-300)};`);
    ultimoTxt = st.txt;
    if (st.n && !st.gerando) { pronto = st; break; }
    // "Estou gerando o video ... volte depois": se a pagina nao se atualiza sozinha, recarrega a conversa a cada 90 s.
    if (!st.gerando && !st.n && Date.now() - ultimaRecarga > 90_000) {
      await ctx.tool('browser_navigate', { url: conversa });
      ultimaRecarga = Date.now(); recargas++;
    }
    await esperar(5000);
  }
  if (!pronto) throw new Error(`o video nao ficou pronto em ${teto / 1000}s (recargas: ${recargas}). Chame de novo com conversa="${conversa}" para so recolher. Ultimo texto: ${ultimoTxt}`);

  const dir = pastaDownloads();
  const antes = fotografar(dir);
  const t0 = Date.now();
  const clicou = await clicarAchado(ctx, `var bs=Array.from(document.querySelectorAll('button')).filter(function(e){return /^Baixar/.test(e.getAttribute('aria-label')||'') && e.getBoundingClientRect().width>0;});
    var b=bs[bs.length-1]; if(!b) return null; return xy(b);`, 8000);
  if (!clicou) throw new Error(`botao de baixar o video nao achado. Conversa: ${conversa}`);
  const baixado = await pegarNovoDownload(dir, antes, t0, 120_000, ['.mp4', '.webm', '.mov']);
  if (!baixado) throw new Error(`cliquei em baixar mas nenhum video novo apareceu em ${dir} em 120 s. Conversa: ${conversa}`);
  const caminho = guardar(baixado, pasta, input.nome);
  return { caminho, conversa, estilo, proporcao_pedida: input.proporcao ?? null, largura: pronto.w, altura: pronto.h, bytes: statSync(caminho).size };
}

export async function executarGemini(nome, input, rodarTool, send, uploadPorClique) {
  const ctx = criarContexto(input, rodarTool, send);
  if (nome === 'browser_gemini_imagem') return gerarImagem(input, ctx);
  if (nome === 'browser_gemini_video') return gerarVideo(input, ctx, uploadPorClique, rodarTool);
  throw new Error(`tool do gemini desconhecida: ${nome}`);
}
