/**
 * Google AI Studio (aistudio.google.com) PELA TELA, em uma chamada (09/11/2026,
 * pedido do usuário). Mesmo molde do flow.js: cada tool junta o que custava
 * dezenas de chamadas, passando pelas MESMAS tools da ponte (rodarTool: freio,
 * aba explicita). Clique e digitacao reais. NAO chama a API interna do site e
 * nao toca no BotGuard: o estudo apis-internas\ai-studio.md so serviu para
 * mapear a tela.
 *
 * Mapa da tela aferido em 09/11/2026 (conta PRO, viewport 1280x800):
 * - prompt novo: /app/u/0/prompts/new_chat?model=<id>; o cartao
 *   button.model-selector-card mostra o id do modelo carregado;
 * - campo: textarea[aria-label="Enter a prompt"] (digitar com modo teclado);
 *   botao "Run" (texto "Run Ctrl keyboard_return"); enquanto gera vira "Stop";
 * - painel Run settings: mat-select[aria-label=...] "Aspect ratio",
 *   "Resolution" (imagem) / "Video Resolution" (Omni), "Thinking Level";
 *   Omni: input[aria-label="Video duration in seconds"] (spinbutton);
 *   as opcoes abrem em [role=option] e podem ficar abaixo da dobra (scroll);
 * - conversa: ms-chat-turn; o turno do modelo e .chat-turn-container.model.
 *   O turno de raciocinio tem ms-thought-chunk (tambem traz uma imagem
 *   rascunho: NAO e o resultado). Resultado: ms-image-chunk img.loaded-image
 *   (src blob:), texto em ms-text-chunk;
 * - depois da 1a resposta o site grava o prompt na biblioteca do usuario
 *   (comportamento do site; a tool nao apaga nada).
 */
import { existsSync, mkdirSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { criarContexto } from './flow.js';
import { uploadPorClique } from './upload-clique.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const PASTA_PADRAO = join(homedir(), 'Downloads', 'ai-studio');
const TETO_PADRAO_S = 300;
const FATIA = 400_000; // caracteres de base64 por leitura (a ponte aceita max_chars alto)

export const AISTUDIO_TOOLS = [
  {
    name: 'browser_aistudio_gerar',
    description:
      'Google AI Studio (Chrome logado), PELA TELA: abre um prompt NOVO com o modelo, ajusta no painel Run settings so '
      + 'o que voce passar (clique real nos selects, conferido por leitura), digita o prompt, clica em Run e, se '
      + 'esperar (padrao), espera o resultado e baixa a midia gerada (imagem ou video) para a pasta. Devolve '
      + '{estado, arquivos[], texto?, url_do_prompt}. Modelos: gemini-nano-banana-2.1 (imagem), '
      + 'gemini-omni-1.2-flash (video), gemini-3.8-flash (texto). Usa a cota do usuário: uma geracao por chamada, '
      + 'sem laco. O site grava cada prompt na biblioteca dele. Se o controle nao existir para o modelo '
      + '(ex.: duracao_s fora do Omni), falha antes de enviar e nada e gasto.',
    inputSchema: {
      type: 'object',
      properties: {
        modelo: { type: 'string', description: 'Id do modelo, ex. gemini-nano-banana-2.1, gemini-omni-1.2-flash, gemini-3.8-flash.' },
        prompt: { type: 'string', description: 'O que gerar.' },
        proporcao: { type: 'string', description: 'Aspect ratio do painel: Auto, 1:1, 16:9, 9:16... (imagem e Omni). Padrao: o do site.' },
        resolucao: { type: 'string', description: 'Imagem: 1K, 2K, 4K. Omni: 360p, 720p, 1080p, 4k. Padrao: o do site.' },
        duracao_s: { type: 'number', description: 'Omni: duracao do video em segundos (3 a 15). Padrao: o do site (10).' },
        thinking: { type: 'string', description: 'Thinking Level do painel: Minimal, Low, Medium, High (os que o modelo oferecer).' },
        esperar: { type: 'boolean', description: 'Esperar o resultado e baixar. Padrao true. Com false so envia (depois: browser_aistudio_esperar).' },
        espera_s: { type: 'number', description: `Teto da espera, em segundos. Padrao ${TETO_PADRAO_S}.` },
        pasta: { type: 'string', description: `Onde gravar a midia. Padrao ${PASTA_PADRAO}.` },
        anexos: { type: 'array', items: { type: 'string' }, description: 'Arquivos do disco (caminho completo) a anexar ao prompt antes de enviar: imagem ou video de referencia (ex. para o Omni). Pelo menu "Insert images, videos, or files" > "Upload files", sem janela do Windows.' },
      },
      required: ['modelo', 'prompt'],
    },
  },
  {
    name: 'browser_aistudio_esperar',
    description:
      'Google AI Studio: espera a geracao em andamento terminar SEM mexer na pagina (so le a tela, a cada 1 s, por no '
      + 'maximo 300 s) e responde uma vez: terminou (com o que apareceu), falhou (com o texto do erro) ou '
      + 'ainda_gerando (chame de novo). Use depois de browser_aistudio_gerar com esperar:false, na mesma aba. '
      + 'Opcional baixar:true grava a midia pronta na pasta (unico passo que mexe na pagina, so le o arquivo).',
    inputSchema: {
      type: 'object',
      properties: {
        max_s: { type: 'number', description: `Teto em segundos. Padrao e maximo: ${TETO_PADRAO_S}.` },
        baixar: { type: 'boolean', description: 'Ao terminar, baixar a midia para a pasta. Padrao false.' },
        pasta: { type: 'string', description: `Com baixar:true. Padrao ${PASTA_PADRAO}.` },
        nome: { type: 'string', description: 'Com baixar:true: prefixo do nome dos arquivos. Padrao aistudio.' },
      },
    },
  },
];

// ---------- trechos que rodam na pagina ----------

const VIS = `function vis(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0;}`;
const XY = `${VIS} function xy(e){var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}`;
const NORM = `function norm(s){return String(s||'').toLowerCase().replace(/\\s+/g,'').replace(/p$/,'');}`;

/** Achata os elementos de midia do RESULTADO (fora do turno de raciocinio), na ordem da tela. */
const ACHAR_MIDIAS = `function achar(){
  var out=[];
  Array.from(document.querySelectorAll('ms-chat-turn')).forEach(function(t){
    if(!t.querySelector('.chat-turn-container.model')||t.querySelector('ms-thought-chunk')) return;
    t.querySelectorAll('img').forEach(function(i){ if(i.closest('ms-image-chunk')||/loaded-image/.test(i.className)) out.push(i); });
    t.querySelectorAll('video').forEach(function(v){ out.push(v); });
  });
  return out;
}`;

/** Le o estado da tela sem mexer em nada. */
const LER_TELA_VAR = `${VIS} ${ACHAR_MIDIAS}
  var stop=Array.from(document.querySelectorAll('button')).some(function(b){return vis(b)&&/(^|\\s)Stop$/.test((b.innerText||'').trim());});
  var turnos=Array.from(document.querySelectorAll('ms-chat-turn'));
  var texto=[];
  turnos.forEach(function(t){
    if(!t.querySelector('.chat-turn-container.model')||t.querySelector('ms-thought-chunk')) return;
    t.querySelectorAll('ms-text-chunk').forEach(function(c){ var s=(c.innerText||'').trim(); if(s) texto.push(s); });
  });
  var midias=achar().map(function(e){
    if(e.tagName==='IMG') return {tipo:'imagem',src:e.currentSrc||e.src,w:e.naturalWidth,h:e.naturalHeight,pronta:e.complete&&e.naturalWidth>0};
    var s=e.currentSrc||e.src||((e.querySelector('source')||{}).src)||'';
    return {tipo:'video',src:s,w:e.videoWidth,h:e.videoHeight,dur:isFinite(e.duration)?Math.round(e.duration*100)/100:null,pronta:!!s&&e.readyState>=1};
  });
  var RUIM=/error|fail|quota|exhaust|block|unable|could not|couldn.t|try again|limit|safety|polic|denied|permission|exceed|unavailable|overloaded|went wrong/i;
  var falha=null;
  Array.from(document.querySelectorAll('mat-snack-bar-container,simple-snack-bar,[role=alert],ms-chat-turn [class*="error"],ms-error-message')).forEach(function(e){
    if(falha||!vis(e)) return; var s=(e.innerText||'').replace(/\\s+/g,' ').trim(); if(s&&RUIM.test(s)) falha=s.slice(0,400);
  });
  var dialogo=null;
  Array.from(document.querySelectorAll('mat-dialog-container,[role=dialog],[role=alertdialog]')).forEach(function(e){ if(!dialogo&&vis(e)) dialogo=(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,300); });
  var r={gerando:stop, turnos:turnos.length, midias:midias, texto:texto.join('\\n\\n'), falha:falha, dialogo:dialogo, url:location.href};`;
const LER_TELA = `${LER_TELA_VAR} return r;`;

async function lerTela(ctx) {
  const r = await ctx.js(LER_TELA);
  if (!r || typeof r !== 'object') throw new Error(`nao consegui ler a tela do AI Studio (${String(r).slice(0, 120)})`);
  return r;
}

/** JS assincrono na pagina (fetch/FileReader). Devolve o valor ja decodificado. */
async function jsAsync(ctx, corpo, timeout_ms = 55_000) {
  const r = await ctx.tool('browser_javascript', {
    codigo: `(async function(){ ${corpo} })().then(function(v){return JSON.stringify(v);}, function(e){return JSON.stringify({erro:String(e&&e.message||e)});})`,
    so_valor: true, max_chars: 100_000, timeout_ms,
  });
  try { return JSON.parse(r.texto); } catch { return r.texto; }
}

// ---------- ajustes do painel ----------

async function abrirSeletor(ctx, rotulos, nomeParam) {
  const achar = `${XY} var rot=${JSON.stringify(rotulos)};
    var e=Array.from(document.querySelectorAll('mat-select')).find(function(e){return rot.indexOf(e.getAttribute('aria-label'))>=0&&vis(e);});
    if(!e) return {falta:true, tem:Array.from(document.querySelectorAll('mat-select,input[aria-label]')).filter(vis).map(function(e){return e.getAttribute('aria-label');})};
    e.scrollIntoView({block:'nearest'}); var p=xy(e); p.atual=(e.innerText||'').trim(); p.rotulo=e.getAttribute('aria-label'); return p;`;
  let p = await ctx.js(achar);
  if (p && p.falta) {
    // Painel Run settings recolhido? Abre uma vez e tenta de novo.
    const abre = await ctx.js(`${XY} var b=Array.from(document.querySelectorAll('button')).find(function(b){return vis(b)&&/run settings/i.test(b.getAttribute('aria-label')||'')&&!/^close/i.test(b.getAttribute('aria-label')||'');}); return b?xy(b):null;`);
    if (abre) { await ctx.tool('browser_click', { x: abre.x, y: abre.y }); await esperar(800); p = await ctx.js(achar); }
  }
  if (!p || p.falta) {
    throw new Error(`o painel Run settings nao tem o controle "${nomeParam}" (${rotulos.join(' / ')}) neste modelo. Controles vistos: ${(p?.tem || []).join(', ') || '(nenhum)'}. Nada foi enviado.`);
  }
  return p;
}

async function escolherSelect(ctx, rotulos, valor, nomeParam) {
  const alvo = String(valor).trim();
  const sel = await abrirSeletor(ctx, rotulos, nomeParam);
  const casa = (txt) => { const a = txt.toLowerCase().replace(/\s+/g, ''); const b = alvo.toLowerCase().replace(/\s+/g, ''); return a === b || a === `${b}p`; };
  if (casa(sel.atual)) return sel.atual; // ja esta
  await ctx.tool('browser_click', { x: sel.x, y: sel.y });
  const lista = await ctx.ate(`${VIS} var o=Array.from(document.querySelectorAll('[role=option]')).filter(vis).map(function(o){return (o.innerText||'').trim();}); return o.length?o:null;`, 4000, 250);
  if (!lista) throw new Error(`cliquei em "${nomeParam}" mas a lista de opcoes nao abriu. Nada foi enviado.`);
  const exato = lista.find(casa);
  if (!exato) {
    await ctx.tool('browser_press_key', { key: 'Escape' }, false);
    throw new Error(`"${valor}" nao e opcao de ${nomeParam} neste modelo. Opcoes: ${lista.join(', ')}. Nada foi enviado.`);
  }
  // A opcao pode estar abaixo da dobra: rola a lista e MEDE de novo na hora do clique.
  await ctx.js(`${VIS} var o=Array.from(document.querySelectorAll('[role=option]')).filter(vis).find(function(o){return (o.innerText||'').trim()===${JSON.stringify(exato)};}); if(o) o.scrollIntoView({block:'nearest'}); return 1;`);
  await esperar(200);
  const opc = await ctx.js(`${XY} var o=Array.from(document.querySelectorAll('[role=option]')).filter(vis).find(function(o){return (o.innerText||'').trim()===${JSON.stringify(exato)};}); return o?xy(o):null;`);
  if (!opc) throw new Error(`a opcao "${exato}" de ${nomeParam} sumiu antes do clique. Nada foi enviado.`);
  await ctx.tool('browser_click', { x: opc.x, y: opc.y });
  const leu = await ctx.ate(`var e=Array.from(document.querySelectorAll('mat-select')).find(function(e){return e.getAttribute('aria-label')===${JSON.stringify(sel.rotulo)};});
    var t=e?(e.innerText||'').trim():''; return t===${JSON.stringify(exato)}?t:null;`, 3000, 250);
  if (!leu) throw new Error(`escolhi "${exato}" em ${nomeParam}, mas a tela nao mostra esse valor. Nada foi enviado.`);
  return leu;
}

async function ajustarDuracao(ctx, segundos) {
  const alvo = String(Math.round(Number(segundos)));
  // O controle deslizante tem um input type=range com o MESMO aria-label: pegar o campo de texto.
  const SEL = 'input[aria-label="Video duration in seconds"]:not([type=range])';
  const campo = await ctx.js(`${XY} var e=document.querySelector('${SEL}'); if(!e||!vis(e)) return null; e.scrollIntoView({block:'nearest'}); return xy(e);`);
  if (!campo) throw new Error('o painel nao tem "Video duration in seconds" neste modelo (duracao_s so vale no Omni). Nada foi enviado.');
  await ctx.tool('browser_click', { x: campo.x, y: campo.y });
  await ctx.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
  await ctx.tool('browser_type', { text: alvo, modo: 'teclado', delay_ms: 30 });
  await ctx.tool('browser_press_key', { key: 'Tab' });
  const leu = await ctx.ate(`var e=document.querySelector('${SEL}'); return e&&e.value===${JSON.stringify(alvo)}?e.value:null;`, 3000, 250);
  if (!leu) {
    const v = await ctx.js(`var e=document.querySelector('${SEL}'); return e?e.value:null;`);
    throw new Error(`pedi ${alvo} s de duracao mas o campo ficou em "${v}" (o Omni aceita 3 a 15). Nada foi enviado.`);
  }
  return Number(leu);
}

// ---------- gerar ----------

async function abrirPrompt(ctx, modelo) {
  await ctx.tool('browser_navigate', { url: `https://aistudio.google.com/app/u/0/prompts/new_chat?model=${encodeURIComponent(modelo)}` });
  const ok = await ctx.ate(`${VIS} var t=document.querySelector('textarea[aria-label="Enter a prompt"]'); var c=document.querySelector('.model-selector-card');
    return (t&&vis(t)&&c)?{modelo:(c.innerText||'').replace(/\\s+/g,' ').trim()}:null;`, 40_000, 400);
  if (!ok) throw new Error('o campo de prompt do AI Studio nao apareceu (logado em aistudio.google.com?). Nada foi enviado.');
  if (!ok.modelo.toLowerCase().includes(modelo.toLowerCase())) {
    throw new Error(`o AI Studio nao carregou o modelo "${modelo}" (a tela mostra "${ok.modelo.slice(0, 80)}"). Nada foi enviado.`);
  }
}

/**
 * Digita o prompt tecla a tecla (modo teclado), em pedacos de 40 caracteres, LENDO o campo entre
 * um e outro. A pagina as vezes trava alguns segundos no meio da digitacao (aferido 09/11/2026:
 * pedaco de 5 teclas levando 4 a 9 s, e uma chamada unica estourando 68 s): se um pedaco estoura,
 * espera o campo parar de mudar, relê e continua do que faltou, sem repetir nem perder tecla.
 * Depois de 3 pedacos sem progresso cai no modo rapido (valor + eventos de input) e avisa.
 */
// Anexos (10/11/2026, pedido da sessao Imersos): menu "Insert images, videos, or files" >
// "Upload files" e o seletor de arquivo interceptado pela ponte (sem janela do Windows).
async function anexar(ctx, caminhos) {
  const faltam = caminhos.filter((c) => !existsSync(c));
  if (faltam.length) throw new Error(`anexo(s) nao encontrado(s) no disco: ${faltam.join(', ')}. Nada foi enviado.`);
  // Conta toda imagem/video da pagina: o anexo vira uma miniatura nova (o seletor exato do
  // chip mudou de nome mais de uma vez no AI Studio).
  const contar = `return document.querySelectorAll('img, video').length;`;
  const antes = Number(await ctx.js(contar)) || 0;
  const menu = await ctx.js(`${XY} var b=Array.from(document.querySelectorAll('button')).find(function(b){return vis(b)&&/insert images, videos, or files/i.test(b.getAttribute('aria-label')||'');}); return b?xy(b):null;`);
  if (!menu) throw new Error('botao "Insert images, videos, or files" nao achado. Nada foi enviado.');
  await ctx.tool('browser_click', { x: menu.x, y: menu.y });
  const item = await ctx.ate(`${XY} var e=Array.from(document.querySelectorAll('[role=menuitem],button')).find(function(e){return vis(e)&&/^upload files?$/i.test((e.innerText||'').trim().split('\\n').pop().trim());}); return e?xy(e):null;`, 5000, 300);
  if (!item) { await ctx.tool('browser_press_key', { key: 'Escape' }, false); throw new Error('item "Upload files" do menu nao apareceu. Nada foi enviado.'); }
  await uploadPorClique({ caminhos, x: item.x, y: item.y, ...ctx.aba }, ctx.rodarTool, ctx.send);
  // Espera os anexos aparecerem no prompt (video grande demora a subir).
  const fim = Date.now() + 120_000;
  let n = antes;
  while (Date.now() < fim) {
    await esperar(1500);
    n = Number(await ctx.js(contar)) || 0;
    const subindo = await ctx.js(`return !!document.querySelector('mat-progress-bar, mat-spinner, [class*="upload"][class*="progress"]');`);
    if (n >= antes + caminhos.length && !subindo) break;
  }
  return { pedidos: caminhos.length, na_tela: n - antes };
}

async function digitarPrompt(ctx, prompt) {
  const SEL = 'textarea[aria-label="Enter a prompt"]';
  const alvo = String(prompt).replace(/\r\n/g, '\n');
  const ler = async () => String((await ctx.js(`var e=document.querySelector('${SEL}'); return e?e.value:null;`)) ?? '').replace(/\r\n/g, '\n');
  const focar = async () => {
    const campo = await ctx.js(`${XY} var e=document.querySelector('${SEL}'); if(!e||!vis(e)) return null; return xy(e);`);
    if (!campo) throw new Error('campo de prompt sumiu. Nada foi enviado.');
    await ctx.tool('browser_click', { x: campo.x, y: campo.y });
  };
  const estabilizar = async () => {
    let ant = null; let iguais = 0;
    for (let i = 0; i < 30 && iguais < 3; i++) {
      await esperar(700);
      const v = await ler();
      iguais = v === ant ? iguais + 1 : 0; ant = v;
    }
    return ant ?? '';
  };

  await focar();
  await ctx.tool('browser_press_key', { key: 'a', modifiers: ['Control'] }, false);
  await ctx.tool('browser_press_key', { key: 'Delete' }, false);
  let semProgresso = 0; let recomecos = 0; let modo = 'teclado';
  for (let volta = 0; volta < 200; volta++) {
    const atual = await ler();
    if (atual === alvo) return modo;
    if (!alvo.startsWith(atual)) {
      // O campo tem algo que nao e prefixo do prompt (tecla perdida ou repetida): limpa e recomeca.
      if (++recomecos > 2) throw new Error(`o prompt nao ficou igual no campo (ficou: "${atual.slice(0, 120)}"); nada foi enviado`);
      await focar();
      await ctx.tool('browser_press_key', { key: 'a', modifiers: ['Control'] }, false);
      await ctx.tool('browser_press_key', { key: 'Delete' }, false);
      continue;
    }
    if (semProgresso >= 3 && modo === 'teclado') {
      modo = 'teclado+rapido';
      await focar();
      await ctx.tool('browser_type', { text: alvo, modo: 'rapido', clear: true });
      await esperar(500);
      continue;
    }
    if (semProgresso >= 6) throw new Error(`o prompt nao ficou igual no campo (ficou: "${atual.slice(0, 120)}"); nada foi enviado`);
    const pedaco = alvo.slice(atual.length, atual.length + 40);
    let estourou = false;
    try {
      await ctx.tool('browser_type', { text: pedaco, modo: 'teclado', delay_ms: 8, timeout_ms: 25_000 });
    } catch { estourou = true; }
    const depois = estourou ? await estabilizar() : await ler();
    semProgresso = depois.length > atual.length ? 0 : semProgresso + 1;
  }
  throw new Error('digitacao do prompt nao terminou; nada foi enviado');
}

async function clicarRun(ctx) {
  // O Run demora a habilitar depois da digitacao (Angular): espera ate 8 s antes de desistir.
  const ler = () => ctx.js(`${XY} var b=Array.from(document.querySelectorAll('button')).find(function(b){return vis(b)&&/^Run(\\s|$)/.test((b.innerText||'').trim());});
    if(!b) return null; return Object.assign(xy(b),{dis:b.disabled||b.getAttribute('aria-disabled')==='true'});`);
  let run = await ler();
  for (let i = 0; i < 16 && run && run.dis; i++) { await esperar(500); run = await ler(); }
  if (!run) throw new Error('botao "Run" nao achado. Nada foi enviado.');
  if (run.dis) throw new Error('o botao "Run" esta desabilitado (prompt vazio ou site pedindo algo). Nada foi enviado.');
  await ctx.tool('browser_click', { x: run.x, y: run.y });
  // Confirma que a geracao comecou: aparece "Stop" ou um turno de resposta.
  const come = await ctx.ate(`${LER_TELA_VAR} r.ok = r.gerando || r.turnos>=2 || r.midias.length>0 || !!r.falha || !!r.dialogo; return r.ok ? r : null;`, 30_000, 400);
  if (!come) throw new Error('cliquei em Run mas a geracao nao comecou em 30 s (nenhum "Stop" nem resposta na tela). Confira a aba.');
  if (come.dialogo && !come.gerando && !come.midias.length) throw new Error(`apareceu uma janela depois do Run: "${come.dialogo}". Confira a aba.`);
}

// ---------- esperar ----------

/** Le a tela a cada 1 s ate terminar, falhar ou estourar o teto. Nao mexe na pagina. */
async function aguardar(ctx, tetoS) {
  const teto = Math.min(TETO_PADRAO_S, Math.max(1, Number(tetoS) || TETO_PADRAO_S)) * 1000;
  const ini = Date.now();
  const seg = () => Math.round((Date.now() - ini) / 1000);
  let st = null; let vazioDesde = null; let falhasSeguidas = 0;
  while (Date.now() - ini < teto) {
    st = await lerTela(ctx);
    falhasSeguidas = st.falha ? falhasSeguidas + 1 : 0;
    // Erro na tela: vale na hora se parou de gerar; se ainda mostra "Stop", so depois de 3 leituras seguidas.
    if (st.falha && (!st.gerando || falhasSeguidas >= 3)) return { estado: 'falhou', falha: st.falha, segundos: seg(), tela: st };
    if (!st.gerando) {
      const temResultado = st.midias.length > 0 || !!st.texto;
      if (temResultado) {
        vazioDesde = null;
        if (st.midias.every((m) => m.pronta)) return { estado: 'terminou', segundos: seg(), tela: st };
      } else {
        vazioDesde ??= Date.now();
        // Parou de gerar, sem midia e sem texto, e nada mudou por 8 s: nao ha o que esperar.
        if (Date.now() - vazioDesde > 8000) {
          return { estado: 'falhou', falha: st.falha || 'a tela nao mostra geracao em andamento nem resultado (a geracao pode ter sido bloqueada ou nem comecou)', segundos: seg(), tela: st };
        }
      }
    } else { vazioDesde = null; }
    await esperar(1000);
  }
  return { estado: 'ainda_gerando', segundos: seg(), tela: st };
}

// ---------- baixar ----------

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

function conferirMagia(caminho, tipo) {
  const fd = openSync(caminho, 'r');
  try {
    const b = Buffer.alloc(16); readSync(fd, b, 0, 16, 0);
    if (tipo === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8;
    if (tipo === 'image/png') return b[0] === 0x89 && b[1] === 0x50;
    if (tipo === 'image/webp') return b.toString('ascii', 0, 4) === 'RIFF';
    if (tipo.startsWith('video/')) return b.toString('ascii', 4, 8) === 'ftyp' || (b[0] === 0x1a && b[1] === 0x45);
    return true;
  } finally { closeSync(fd); }
}

const carimbo = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** Le o blob/data da midia DENTRO da pagina, em base64, e grava no Node (nunca a API do site). */
async function baixarMidias(ctx, midias, pasta, prefixo) {
  mkdirSync(pasta, { recursive: true });
  const base = carimbo();
  const arquivos = [];
  for (let i = 0; i < midias.length; i++) {
    const m = midias[i];
    const info = await jsAsync(ctx, `${ACHAR_MIDIAS}
      var el=achar()[${i}]; if(!el) return {erro:'elemento de midia ${i} sumiu da tela'};
      var src=el.currentSrc||el.src||((el.querySelector('source')||{}).src)||'';
      var b=await (await fetch(src)).blob();
      var s=await new Promise(function(res,rej){var fr=new FileReader(); fr.onload=function(){res(String(fr.result));}; fr.onerror=rej; fr.readAsDataURL(b);});
      window.__aistudioB64=s.slice(s.indexOf(',')+1);
      return {tipo:b.type||'', bytes:b.size, chars:window.__aistudioB64.length};`, 120_000);
    if (!info || info.erro) throw new Error(`nao consegui ler a midia ${i + 1} da pagina: ${info?.erro ?? JSON.stringify(info)}`);
    const partes = [];
    for (let o = 0; o < info.chars; o += FATIA) {
      const r = await ctx.tool('browser_javascript', { codigo: `window.__aistudioB64.slice(${o},${o + FATIA})`, so_valor: true, max_chars: FATIA + 1000 });
      partes.push(r.texto);
    }
    await ctx.js(`delete window.__aistudioB64; return 1;`);
    const buf = Buffer.from(partes.join(''), 'base64');
    if (buf.length !== info.bytes) throw new Error(`a midia ${i + 1} chegou com ${buf.length} bytes, mas a pagina tem ${info.bytes}`);
    const tipo = info.tipo || (m.tipo === 'video' ? 'video/mp4' : 'image/jpeg');
    const ext = EXT[tipo] || (m.tipo === 'video' ? '.mp4' : '.jpg');
    const nome = `${prefixo}_${base}${midias.length > 1 ? `-${i + 1}` : ''}`;
    let caminho = join(pasta, `${nome}${ext}`);
    for (let k = 2; existsSync(caminho); k++) caminho = join(pasta, `${nome}-${k}${ext}`);
    writeFileSync(caminho, buf);
    if (!conferirMagia(caminho, tipo)) throw new Error(`gravei ${caminho}, mas o cabecalho do arquivo nao e de ${tipo}`);
    arquivos.push({
      caminho, tipo, bytes: buf.length,
      ...(m.w ? { largura: m.w, altura: m.h } : {}),
      ...(m.dur ? { duracao_s: m.dur } : {}),
    });
  }
  return arquivos;
}

async function urlDoPrompt(ctx) {
  // Depois da 1a resposta o site troca new_chat por /prompts/<id>.
  const u = await ctx.ate(`return /\\/prompts\\/new_chat/.test(location.pathname)?null:location.href;`, 6000, 500);
  return u || (await ctx.js(`return location.href;`));
}

function resumo(est, arquivos, st, url) {
  return {
    estado: est.estado, segundos: est.segundos, arquivos,
    ...(st?.texto ? { texto: st.texto } : {}),
    ...(est.falha ? { falha: est.falha } : {}),
    url_do_prompt: url,
  };
}

async function gerar(input, ctx) {
  const modelo = String(input.modelo || '').trim().replace(/^models\//, '');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(modelo)) throw new Error('modelo invalido: use o id, ex. gemini-nano-banana-2.1');
  const prompt = String(input.prompt ?? '');
  if (!prompt.trim()) throw new Error('prompt obrigatorio');
  if (input.duracao_s !== undefined && !(Number(input.duracao_s) >= 3 && Number(input.duracao_s) <= 15)) {
    throw new Error('duracao_s deve ficar entre 3 e 15 (Omni)');
  }
  const pasta = input.pasta || PASTA_PADRAO;

  await abrirPrompt(ctx, modelo);
  const ajustes = {};
  if (input.proporcao) ajustes.proporcao = await escolherSelect(ctx, ['Aspect ratio'], input.proporcao, 'proporcao');
  if (input.resolucao) ajustes.resolucao = await escolherSelect(ctx, ['Resolution', 'Video Resolution'], input.resolucao, 'resolucao');
  if (input.thinking) ajustes.thinking = await escolherSelect(ctx, ['Thinking Level'], input.thinking, 'thinking');
  if (input.duracao_s !== undefined) ajustes.duracao_s = await ajustarDuracao(ctx, input.duracao_s);
  if (Array.isArray(input.anexos) && input.anexos.length) ajustes.anexos = await anexar(ctx, input.anexos.map(String));
  const digitacao = await digitarPrompt(ctx, prompt);
  if (digitacao !== 'teclado') ajustes.digitacao = digitacao;
  await clicarRun(ctx);

  if (input.esperar === false) {
    return { estado: 'enviado', modelo, ajustes, url_do_prompt: await ctx.js(`return location.href;`), aviso: 'enviado; chame browser_aistudio_esperar (baixar:true) na mesma aba' };
  }
  const est = await aguardar(ctx, input.espera_s);
  const url = await urlDoPrompt(ctx);
  if (est.estado === 'falhou') return { modelo, ajustes, ...resumo(est, [], est.tela, url) };
  if (est.estado === 'ainda_gerando') {
    return { modelo, ajustes, ...resumo(est, [], est.tela, url), aviso: 'passou do teto; chame browser_aistudio_esperar (baixar:true) na mesma aba' };
  }
  const arquivos = est.tela.midias.length ? await baixarMidias(ctx, est.tela.midias, pasta, modelo) : [];
  return { modelo, ajustes, ...resumo(est, arquivos, est.tela, url) };
}

async function esperarGeracao(input, ctx) {
  const est = await aguardar(ctx, input.max_s);
  const st = est.tela;
  const midias = (st?.midias || []).map((m) => ({ tipo: m.tipo, largura: m.w, altura: m.h, ...(m.dur ? { duracao_s: m.dur } : {}), pronta: m.pronta }));
  const base = { estado: est.estado, segundos: est.segundos, midias, ...(st?.texto ? { texto: st.texto } : {}), ...(est.falha ? { falha: est.falha } : {}), url_do_prompt: st?.url };
  if (est.estado === 'terminou' && input.baixar === true && st.midias.length) {
    base.arquivos = await baixarMidias(ctx, st.midias, input.pasta || PASTA_PADRAO, String(input.nome || 'aistudio').replace(/[\\/:*?"<>|]/g, '_'));
  }
  return base;
}

export async function executarAistudio(nome, input, rodarTool, send) {
  const ctx = criarContexto(input, rodarTool, send);
  ctx.rodarTool = rodarTool;
  if (nome === 'browser_aistudio_gerar') return gerar(input, ctx);
  if (nome === 'browser_aistudio_esperar') return esperarGeracao(input, ctx);
  throw new Error(`tool do aistudio desconhecida: ${nome}`);
}
