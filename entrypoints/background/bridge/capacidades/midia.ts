import type { ModuloCapacidades } from './registro';
import { executarJs } from './js';
import { avaliarEmTodas } from '../../execution-engine/molduras';

/**
 * Baixar midia da pagina (26/09/2026, pedido do Dr. Cezar: "o motor dessas
 * extensoes de baixar do Behance/Instagram/YouTube dentro do nosso MCP").
 *
 * A extensao so faz o que so ela alcanca: o endereco da aba, os cookies
 * COMPLETOS da sessao (dominio, validade — o yt-dlp e o gallery-dl pedem o
 * arquivo no formato Netscape, nao "nome=valor") e a lista de imagens e
 * videos da pagina. Quem baixa e o servidor MCP, no Windows, com os motores
 * de comunidade (bridge-server/src/midia.js).
 */

interface CookieCompleto {
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expirationDate?: number;
  name: string;
  value: string;
}

async function cookiesDe(urls: string[]): Promise<CookieCompleto[]> {
  const vistos = new Map<string, CookieCompleto>();
  for (const url of urls) {
    if (!/^https?:/i.test(url)) continue;
    const lista = await chrome.cookies.getAll({ url }).catch(() => [] as chrome.cookies.Cookie[]);
    for (const c of lista) {
      vistos.set(`${c.domain}|${c.path}|${c.name}`, {
        domain: c.domain, hostOnly: c.hostOnly, path: c.path, secure: c.secure,
        expirationDate: c.expirationDate, name: c.name, value: c.value,
      });
    }
  }
  return [...vistos.values()];
}

const LISTAR = `(async function(minPx, rolar){
  // Rolagem ate o fim: Behance, Pinterest e cia so carregam a imagem quando ela
  // entra na tela (lazy load). Sem rolar, a lista sai com meia duzia.
  if (rolar) {
    var ultimo = -1;
    for (var passo = 0; passo < 80; passo++) {
      window.scrollBy(0, Math.max(400, innerHeight * 0.9));
      await new Promise(function (r) { setTimeout(r, 350); });
      var fim = document.documentElement.scrollHeight;
      if (window.scrollY + innerHeight >= fim - 5) {
        if (fim === ultimo) break;
        ultimo = fim;
        await new Promise(function (r) { setTimeout(r, 900); });
      }
    }
    window.scrollTo(0, 0);
    await new Promise(function (r) { setTimeout(r, 300); });
  }
  var out = new Map();
  function add(u, tipo, w, h) {
    if (!u || /^data:/i.test(u)) return;
    try { u = new URL(u, location.href).href; } catch (e) { return; }
    if (!out.has(u)) out.set(u, { url: u, tipo: tipo, w: w || 0, h: h || 0 });
  }
  // Maior candidato do srcset: e o truque de toda extensao "baixar em alta".
  function maior(el) {
    var ss = el.getAttribute('srcset') || '';
    var melhor = null, bw = -1;
    ss.split(',').forEach(function (p) {
      var partes = p.trim().split(/\\s+/);
      if (!partes[0]) return;
      var n = parseFloat(partes[1]) || 0;
      if (n >= bw) { bw = n; melhor = partes[0]; }
    });
    return melhor || el.currentSrc || el.src;
  }
  document.querySelectorAll('img').forEach(function (img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) < minPx) return;
    var pic = img.closest('picture');
    var fonte = pic ? pic.querySelector('source[srcset]') : null;
    add(fonte ? maior(fonte) : maior(img), 'imagem', w, h);
  });
  document.querySelectorAll('video').forEach(function (v) {
    var s = v.querySelector('source');
    var u = v.currentSrc || v.src || (s && s.src);
    if (u) add(u, /^blob:/i.test(u) ? 'video-em-pedacos' : 'video', v.videoWidth, v.videoHeight);
  });
  ['og:image', 'og:image:secure_url', 'twitter:image', 'og:video', 'og:video:secure_url'].forEach(function (p) {
    var m = document.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]');
    if (m && m.content) add(m.content, /video/.test(p) ? 'video' : 'imagem', 0, 0);
  });
  document.querySelectorAll('a[href]').forEach(function (a) {
    var h = a.getAttribute('href') || '';
    if (/\\.(jpe?g|png|webp|gif|avif|mp4|webm|mov)(\\?|#|$)/i.test(h)) add(h, /\\.(mp4|webm|mov)/i.test(h) ? 'video' : 'imagem', 0, 0);
  });
  return Array.from(out.values()).slice(0, 500);
})`;

/**
 * Videos em PEDACOS (HLS/DASH) carregados pela pagina ou por qualquer moldura:
 * o historico de recursos de cada frame (performance) guarda o endereco da
 * lista de pedacos, assinado, que o yt-dlp baixa direto. No player do Vimeo,
 * a configuracao traz tambem a lista HLS escolhida pelo proprio player.
 */
const STREAMS = `(function(){
  var out = [];
  try {
    performance.getEntriesByType('resource').forEach(function (e) {
      if (/\\.(m3u8|mpd)(\\?|$)|\\/(master|playlist)\\.json(\\?|$)/i.test(e.name)) out.push(e.name);
    });
  } catch (e) {}
  try {
    var cfg = window.playerConfig || (window.vimeo && window.vimeo.clip_page_config && window.vimeo.clip_page_config.player && window.vimeo.clip_page_config.player.config);
    var hls = cfg && cfg.request && cfg.request.files && cfg.request.files.hls;
    if (hls && hls.cdns) {
      var cdn = hls.cdns[hls.default_cdn] || hls.cdns[Object.keys(hls.cdns)[0]];
      if (cdn && cdn.url) out.unshift(cdn.url);
    }
    if (cfg && cfg.video) out.push('titulo:' + (cfg.video.title || '') + '|id:' + (cfg.video.id || ''));
  } catch (e) {}
  return out;
})()`;

export const modulo: ModuloCapacidades = {
  nome: 'midia',
  capacidades: [
    {
      nome: 'cap_midia_contexto',
      async executar(ctx) {
        const aba = await chrome.tabs.get(ctx.tabId);
        const urlAba = aba.url ?? '';
        const pedida = typeof ctx.params.url === 'string' ? (ctx.params.url as string) : '';
        const urls = [urlAba, pedida].filter(Boolean);
        return { urlAba, tituloAba: aba.title ?? '', cookies: await cookiesDe(urls) };
      },
    },
    {
      nome: 'cap_midia_streams',
      async executar(ctx) {
        return avaliarEmTodas<string[]>(ctx.tabId, STREAMS);
      },
    },
    {
      // Grava texto/HTML de um trecho da pagina direto no disco (26/09/2026,
      // sessao Storytelling: o Gemini barra fetch de blob:, e usar a area de
      // transferencia disputava o Ctrl+C do Dr. Cezar). O conteudo nao passa
      // pela conversa do agente: o servidor grava e devolve so o tamanho.
      nome: 'cap_salvar_texto',
      async executar(ctx) {
        const seletor = typeof ctx.params.seletor === 'string' ? (ctx.params.seletor as string) : '';
        const formato = ctx.params.formato === 'html' ? 'html' : 'texto';
        const r = await executarJs(ctx.tabId, `(function(sel, fmt){
          var els = sel ? Array.prototype.slice.call(document.querySelectorAll(sel)) : [document.body];
          if (!els.length) return { erro: 'nenhum elemento casou com o seletor ' + sel };
          var partes = els.map(function (e) { return fmt === 'html' ? e.outerHTML : (e.innerText || e.textContent || ''); });
          var nl = String.fromCharCode(10);
          return { texto: partes.join(fmt === 'html' ? nl : nl + nl), n: els.length };
        })(${JSON.stringify(seletor)}, ${JSON.stringify(formato)})`, ctx.emSomenteLeitura) as { texto?: string; n?: number; erro?: string } | undefined;
        if (!r || r.erro) throw new Error(r?.erro ?? 'a pagina nao devolveu o texto');
        const bytes = new TextEncoder().encode(r.texto ?? '');
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { base64: btoa(bin), tipo: formato === 'html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8', elementos: r.n };
      },
    },
    {
      nome: 'cap_midia_listar',
      async executar(ctx) {
        const minPx = Number(ctx.params.min_px ?? 200);
        const rolar = ctx.params.rolar === true;
        const r = await executarJs(
          ctx.tabId, `${LISTAR}(${Number.isFinite(minPx) ? minPx : 200}, ${rolar})`, ctx.emSomenteLeitura,
          undefined, 60_000,
        );
        return Array.isArray(r) ? r : [];
      },
    },
  ],
};
