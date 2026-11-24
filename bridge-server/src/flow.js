/**
 * Google Flow em uma chamada (30/09/2026, pedido do usuário via sessao
 * "Google Flow alteracoes"). Cada tool aqui junta a sequencia que antes
 * custava de 5 a 12 chamadas, passando pelas MESMAS tools de sempre
 * (rodarTool: freio, somente leitura, aba explicita).
 *
 * Mapa da tela aferido em 30/09/2026 (num projeto de testes):
 * - grade: <img data-media-id="<uuid>">, ordem = mais recente primeiro;
 * - editor: /project/<p>/edit/<media-id> abre direto; "Baixar midia" (aria);
 *   imagem GERADA abre menu 1K / 2K Aprimorada / 4K (4K bloqueado no Pro);
 *   imagem ENVIADA baixa direto, sem menu;
 * - "+" do topo = aria "Menu para adicionar arquivos" > menuitem "Enviar";
 * - comando: [contenteditable] + aria "Iniciar geracao" (vira "Parar" enquanto
 *   gera); bloco novo na grade mostra "NN%" ate terminar;
 * - "+" da barra = aria "Adicionar elementos a caixa de comando" > busca
 *   "Pesquisar recursos" > [role=option] com o nome > botao "Incluir no comando".
 */
import { existsSync, renameSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { homedir } from 'node:os';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const PROJETO = {
  type: 'string',
  description: 'Projeto do Flow: URL ou uuid. Sem isto, o projeto aberto na aba.',
};

export const FLOW_TOOLS = [
  {
    name: 'browser_flow_baixar',
    description:
      'Google Flow: baixa imagens do projeto em 2K (ou 1K) numa chamada so. Sem ids, pega as N mais recentes da '
      + 'grade. Imagem gerada sai pelo menu "2K Aprimorada"; imagem enviada ao Flow baixa no tamanho original. '
      + 'Sem janela "Salvar como". Aceita nomes de destino.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: PROJETO,
        ids: { type: 'array', items: { type: 'string' }, description: 'data-media-id das imagens. Sem isto: as mais recentes.' },
        recentes: { type: 'number', description: 'Quantas das mais recentes (sem ids). Padrao 1.' },
        tamanho: { type: 'string', enum: ['1K', '2K'], description: 'Padrao 2K (4K e bloqueado no plano Pro).' },
        pasta: { type: 'string', description: 'Onde gravar. Padrao Downloads\\flow.' },
        nomes: { type: 'array', items: { type: 'string' }, description: 'Nome de cada arquivo (sem extensao), na ordem.' },
      },
    },
  },
  {
    name: 'browser_flow_subir',
    description:
      'Google Flow: sobe uma lista de arquivos para o projeto numa chamada, pelo "+" > Enviar, SEM abrir a janela do '
      + 'Windows, e espera o envio terminar. Devolve os data-media-id novos.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: PROJETO,
        caminhos: { type: 'array', items: { type: 'string' }, description: 'Caminhos completos dos arquivos.' },
      },
      required: ['caminhos'],
    },
  },
  {
    name: 'browser_flow_gerar',
    description:
      'Google Flow: escreve o comando na barra, envia e espera a geracao terminar. Devolve o texto final do agente e '
      + 'os data-media-id novos com as dimensoes. Declare no comando modelo, proporcao e quantidade (regra da skill '
      + 'google-flow). Opcional: incluir imagens/personagens do projeto pelo nome antes de enviar.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: PROJETO,
        comando: { type: 'string', description: 'O prompt.' },
        incluir: { type: 'array', items: { type: 'string' }, description: 'Nomes de recursos do projeto a anexar antes.' },
        espera_s: { type: 'number', description: 'Teto de espera da geracao. Padrao 240.' },
        agente: { type: 'boolean', description: 'Liga (true) ou desliga (false) o modo Agente antes de enviar. Sem isto, nao mexe.' },
        baixar: { type: 'string', enum: ['1K', '2K'], description: 'Ao terminar, ja baixa as midias novas nesse tamanho (mesmo caminho do browser_flow_baixar).' },
        pasta: { type: 'string', description: 'Com baixar: onde gravar. Padrao Downloads\\flow.' },
      },
      required: ['comando'],
    },
  },
  {
    name: 'browser_flow_esperar',
    description:
      'Google Flow: espera a geracao em andamento terminar SEM mexer na pagina (so le a tela, a cada 1 s, por no '
      + 'maximo 2 min) e responde uma vez: terminou, falhou (com o texto da falha, ex. "atividade incomum") ou '
      + 'ainda_gerando (chame de novo). Use depois de enviar o comando, na mesma aba, em vez de ficar olhando.',
    inputSchema: {
      type: 'object',
      properties: {
        max_s: { type: 'number', description: 'Teto em segundos. Padrao e maximo: 120.' },
        antes: { type: 'number', description: 'Quantas midias havia na grade antes de enviar (para contar as novas).' },
      },
    },
  },
  {
    name: 'browser_flow_incluir',
    description:
      'Google Flow: anexa ao comando imagens, personagens ou envios do projeto, pelo NOME (busca no "+" da barra > '
      + '"Incluir no comando"). Nao envia nada: so prepara a barra.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: PROJETO,
        nomes: { type: 'array', items: { type: 'string' }, description: 'Nomes (ou parte do nome) dos recursos.' },
      },
      required: ['nomes'],
    },
  },
];

export function criarContexto(input, rodarTool, send) {
  const aba = input.aba !== undefined ? { aba: input.aba } : {};
  const tool = async (nome, args, erroSe = true) => {
    const r = await rodarTool(nome, { ...args, ...aba }, { bruto: true });
    const texto = r.content?.[0]?.text ?? '';
    if (r.isError && erroSe) throw new Error(`${nome}: ${texto.slice(0, 300)}`);
    return { ...r, texto };
  };
  const js = async (codigo) => {
    const r = await tool('browser_javascript', { codigo: `JSON.stringify((function(){ ${codigo} })())` });
    try { return JSON.parse(r.texto); } catch { return r.texto; }
  };
  const ate = async (codigo, ms, passo = 500) => {
    const fim = Date.now() + ms;
    for (;;) {
      const v = await js(codigo);
      if (v) return v;
      if (Date.now() > fim) return null;
      await esperar(passo);
    }
  };
  const centro = (seletor) => js(`var e=document.querySelector(${JSON.stringify(seletor)}); if(!e) return null;
    var r=e.getBoundingClientRect(); if(!r.width) return null; return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};`);
  return { tool, js, ate, centro, aba, send: (a, args, t) => send(a, { ...args, ...aba }, t) };
}

async function abrirProjeto(ctx, input, sufixo = '') {
  const atual = await ctx.js('return location.href;');
  let uuid = String(input.projeto ?? '').match(UUID)?.[0];
  if (!uuid) uuid = String(atual).match(/\/project\/([0-9a-f-]{36})/)?.[1];
  if (!uuid) throw new Error('sem projeto: passe "projeto" (URL ou uuid) ou abra o projeto na aba');
  // Conta /u/N/ (08/11/2026): sem o prefixo o Flow abre "Projeto nao encontrado".
  const u = (String(input.projeto ?? '').match(/flow\.google\.com(\/u\/\d+)\//) || String(atual).match(/flow\.google\.com(\/u\/\d+)\//))?.[1] ?? '';
  ctx.base = `https://flow.google.com${u}`;
  const alvo = `${ctx.base}/project/${uuid}${sufixo}`;
  // Ja dentro do projeto (ex.: editor /edit/<midia>, 10/11/2026): fica onde esta. Antes
  // voltava para a grade e o comando caia no campo errado.
  const dentro = !sufixo && atual.split('?')[0].startsWith(`${alvo}/`);
  if (atual.split('?')[0] !== alvo && !dentro) {
    await ctx.tool('browser_navigate', { url: alvo });
  }
  return uuid;
}

const LISTAR_GRADE = `return Array.from(document.querySelectorAll('img[data-media-id]')).map(function(i){var r=i.getBoundingClientRect();
  return {id:i.getAttribute('data-media-id'), y:Math.round(r.y), x:Math.round(r.x)};}).sort(function(a,b){return a.y-b.y||a.x-b.x;})
  .filter(function(v,i,a){return a.findIndex(function(o){return o.id===v.id;})===i;});`;

async function baixar(input, ctx) {
  const tamanho = input.tamanho === '1K' ? '1K' : '2K';
  const pasta = input.pasta || join(homedir(), 'Downloads', 'flow');
  const uuid = await abrirProjeto(ctx, input);
  let ids = Array.isArray(input.ids) ? input.ids : null;
  if (!ids || !ids.length) {
    const grade = await ctx.ate(`var g=(function(){${LISTAR_GRADE}})(); return g.length ? g : null;`, 20_000);
    if (!grade) throw new Error('a grade do projeto nao mostrou nenhuma imagem');
    ids = grade.slice(0, Math.max(1, Number(input.recentes) || 1)).map((g) => g.id);
  }
  const nomes = Array.isArray(input.nomes) ? input.nomes : [];
  const saida = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      await ctx.tool('browser_navigate', { url: `${ctx.base}/project/${uuid}/edit/${id}` });
      // 24/11/2026: pode haver mais de um "Baixar midia" no DOM (um escondido); marca o VISIVEL com
      // aria-label proprio e clica nele pelo no, nao por coordenada.
      const btn = await ctx.ate(`var bs=Array.from(document.querySelectorAll('[aria-label="Baixar mídia"],[aria-label="ponte-baixar-midia"]'))
        .filter(function(e){var r=e.getBoundingClientRect(); return r.width>0 && r.height>0;});
        if(!bs.length) return null; bs[bs.length-1].setAttribute('aria-label','ponte-baixar-midia'); return true;`, 20_000);
      if (!btn) throw new Error('o editor nao mostrou o botao "Baixar midia"');
      await esperar(5000); // a pagina do editor ainda hidrata quando o botao aparece
      await ctx.tool('browser_click', { ariaLabel: 'ponte-baixar-midia', exato: true });
      // Imagem gerada abre o menu de tamanho; enviada baixa direto. 24/11/2026: clique por coordenada
      // caia fora do item (o menu abre animando); agora marca o item com um aria-label proprio e clica
      // nele pelo no, que a ponte mede na hora do clique.
      const MARCAR = `var its=Array.from(document.querySelectorAll('[role=menuitem]')).filter(function(e){return e.getBoundingClientRect().width>0;});
        var e=its.find(function(e){return (e.innerText||'').split(/\\s+/).indexOf(${JSON.stringify(tamanho)})>=0;}); if(!e) return null;
        e.setAttribute('aria-label','ponte-baixar-${tamanho}'); return true;`;
      const item = await ctx.ate(MARCAR, 6000, 300);
      // Armar so agora, com o menu aberto (medido: armado antes do "Baixar midia" nao pegava o 2K).
      await ctx.tool('browser_download_arm', { pasta, ttl_s: 180 });
      if (item) {
        await esperar(400);
        await ctx.tool('browser_click', { ariaLabel: `ponte-baixar-${tamanho}`, exato: true });
        // Menu ainda aberto = o clique nao pegou: tenta mais uma vez.
        await esperar(1200);
        if (await ctx.js(MARCAR)) await ctx.tool('browser_click', { ariaLabel: `ponte-baixar-${tamanho}`, exato: true }, false);
      }
      const w = await ctx.tool('browser_download_wait', { timeout_ms: 180_000 });
      let dado; try { dado = JSON.parse(w.texto); } catch { dado = { caminho: w.texto }; }
      let caminho = dado.caminho;
      if (nomes[i] && caminho && existsSync(caminho)) {
        const novo = join(dirname(caminho), `${nomes[i]}${extname(caminho)}`);
        if (!existsSync(novo)) { renameSync(caminho, novo); caminho = novo; }
      }
      saida.push({ id, ok: true, tamanho: item ? tamanho : 'original (imagem enviada, sem menu)', caminho, bytes: dado.bytes });
    } catch (err) {
      saida.push({ id, ok: false, erro: String(err.message || err).slice(0, 300) });
    }
  }
  return { projeto: uuid, pasta, total: saida.length, ok: saida.filter((s) => s.ok).length, arquivos: saida };
}

async function subir(input, ctx, uploadPorClique, rodarTool) {
  const caminhos = (input.caminhos || []).map(String);
  const faltam = caminhos.filter((c) => !existsSync(c));
  if (faltam.length) throw new Error(`arquivo(s) nao encontrado(s): ${faltam.join(', ')}`);
  const uuid = await abrirProjeto(ctx, input);
  await ctx.ate(`return !!document.querySelector('[aria-label="Menu para adicionar arquivos"]');`, 20_000);
  const antes = new Set(((await ctx.js(LISTAR_GRADE)) || []).map((g) => g.id));
  const mais = await ctx.centro('[aria-label="Menu para adicionar arquivos"]');
  if (!mais) throw new Error('botao "+" do topo nao achado');
  await ctx.tool('browser_click', { x: mais.x, y: mais.y });
  const enviar = await ctx.ate(`var e=Array.from(document.querySelectorAll('[role=menuitem]')).find(function(e){return /(^|\\n)Enviar$/.test((e.innerText||'').trim()) && e.getBoundingClientRect().width>0;});
    if(!e) return null; var r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};`, 5000, 300);
  if (!enviar) throw new Error('item "Enviar" do menu "+" nao apareceu');
  const r = await uploadPorClique({ caminhos, x: enviar.x, y: enviar.y, ...ctx.aba }, rodarTool, ctx.send);
  // Espera os blocos novos aparecerem e o "NN%" sumir.
  const fim = Date.now() + 60_000 + 30_000 * caminhos.length;
  let novos = [];
  while (Date.now() < fim) {
    await esperar(1500);
    const g = (await ctx.js(LISTAR_GRADE)) || [];
    novos = g.filter((x) => !antes.has(x.id)).map((x) => x.id);
    const pct = await ctx.js(`return /\\b\\d{1,3}%/.test(document.querySelector('main')?.innerText || document.body.innerText);`);
    if (novos.length >= caminhos.length && !pct) break;
  }
  return { projeto: uuid, entregues: r.entregues, novos_ids: novos, completo: novos.length >= caminhos.length };
}

async function incluir(input, ctx) {
  const nomes = (input.nomes || []).map(String);
  const feitos = [];
  for (const nome of nomes) {
    const mais = await ctx.centro('[aria-label="Adicionar elementos à caixa de comando"]');
    if (!mais) throw new Error('botao "+" da barra de comando nao achado');
    await ctx.tool('browser_click', { x: mais.x, y: mais.y });
    const busca = await ctx.ate(`var e=document.querySelector('input[placeholder="Pesquisar recursos"],input[aria-label="Pesquisar recursos"]'); if(!e) return null;
      var r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};`, 5000, 300);
    if (busca) {
      await ctx.tool('browser_click', { x: busca.x, y: busca.y });
      await ctx.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
      await ctx.tool('browser_type', { text: nome, modo: 'teclado', delay_ms: 20 });
      await esperar(800);
    }
    const opcao = await ctx.ate(`var alvo=${JSON.stringify(nome.toLowerCase())};
      var e=Array.from(document.querySelectorAll('[role=option]')).filter(function(o){return o.getBoundingClientRect().width>0;})
        .find(function(o){return (o.innerText||'').toLowerCase().indexOf(alvo)>=0;});
      if(!e) return null; var r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), nome:(e.innerText||'').split('\\n')[0]};`, 5000, 300);
    if (!opcao) { await ctx.tool('browser_press_key', { key: 'Escape' }, false); feitos.push({ nome, ok: false, erro: 'nao achei recurso com esse nome' }); continue; }
    await ctx.tool('browser_click', { x: opcao.x, y: opcao.y });
    // Aferido 30/09: clicar no recurso ja o inclui e FECHA o seletor. So se o
    // seletor continuar aberto e que ainda falta o botao "Incluir no comando".
    await esperar(700);
    const aberto = await ctx.js(`var e=document.querySelector('input[placeholder="Pesquisar recursos"],input[aria-label="Pesquisar recursos"]'); return !!(e && e.getBoundingClientRect().width);`);
    if (!aberto) { feitos.push({ nome, ok: true, recurso: opcao.nome }); continue; }
    const btn = await ctx.ate(`var e=Array.from(document.querySelectorAll('button')).find(function(b){return (b.innerText||'').trim()==='Incluir no comando' && b.getBoundingClientRect().width>0 && !b.disabled;});
      if(!e) return null; var r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};`, 4000, 300);
    if (!btn) { await ctx.tool('browser_press_key', { key: 'Escape' }, false); feitos.push({ nome, ok: false, erro: 'botao "Incluir no comando" nao apareceu' }); continue; }
    await ctx.tool('browser_click', { x: btn.x, y: btn.y });
    await esperar(600);
    feitos.push({ nome, ok: true, recurso: opcao.nome });
  }
  return { incluidos: feitos.filter((f) => f.ok).length, itens: feitos };
}

async function gerar(input, ctx) {
  const uuid = await abrirProjeto(ctx, input);
  const campo0 = await ctx.ate(`var e=Array.from(document.querySelectorAll('[contenteditable=true]')).find(function(e){return e.getBoundingClientRect().width>0;});
    return !!e;`, 20_000);
  if (!campo0) throw new Error('campo de comando nao achado');
  // Modo Agente (29/10/2026): o chip fica como o ultimo que mexeu deixou. Apagado,
  // o Flow gera no modo manual e ignora o que o comando pede de modelo e formato.
  // Modo Agente (10/11/2026): so mexe no chip se "agente" vier. Sem o parametro, fica
  // como esta na tela (o usuário nao quer o Agente ligado a revelia).
  const AGENTE = 'button.agent-mode-chip';
  if (typeof input.agente === 'boolean') {
    const quer = input.agente ? 'true' : 'false';
    if (await ctx.js(`var b=document.querySelector('${AGENTE}'); return !!b && b.getAttribute('aria-pressed')!=='${quer}';`)) {
      const chip = await ctx.centro(AGENTE);
      if (chip) await ctx.tool('browser_click', { x: chip.x, y: chip.y });
      const ok = await ctx.ate(`var b=document.querySelector('${AGENTE}'); return !!b && b.getAttribute('aria-pressed')==='${quer}';`, 4000, 300);
      if (!ok) throw new Error(`nao consegui ${input.agente ? 'ligar' : 'desligar'} o modo Agente do Flow; nada foi enviado. `
        + 'Se o painel lateral do agente estiver aberto, feche-o no X do canto do painel e repita.');
    }
  }
  let incluidos = null;
  if (Array.isArray(input.incluir) && input.incluir.length) incluidos = await incluir({ nomes: input.incluir }, ctx);
  const antes = new Set(((await ctx.js(LISTAR_GRADE)) || []).map((g) => g.id));
  const campo = await ctx.js(`var e=Array.from(document.querySelectorAll('[contenteditable=true]')).find(function(e){return e.getBoundingClientRect().width>0;});
    var r=e.getBoundingClientRect(); return {x:Math.round(r.x+Math.min(40,r.width/2)), y:Math.round(r.y+r.height/2)};`);
  // Clique REAL no campo antes de digitar: foco dado por JS logo depois de
  // navegar fazia o texto sumir (pegadinha aferida da skill).
  await ctx.tool('browser_click', { x: campo.x, y: campo.y });
  await ctx.tool('browser_type', { text: String(input.comando), modo: 'teclado', delay_ms: 8 });
  const escrito = await ctx.js(`var e=Array.from(document.querySelectorAll('[contenteditable=true]')).find(function(e){return e.getBoundingClientRect().width>0;});
    return (e.innerText||'').replace(/\\s+/g,' ').trim();`);
  const alvo = String(input.comando).replace(/\s+/g, ' ').trim();
  if (escrito !== alvo) throw new Error(`o comando nao ficou igual no campo (ficou: "${String(escrito).slice(0, 120)}"); nada foi enviado`);
  const env = await ctx.centro('[aria-label="Iniciar geração"]');
  if (!env) throw new Error('botao "Iniciar geracao" nao achado');
  await ctx.tool('browser_click', { x: env.x, y: env.y });
  // Espera: o botao vira "Parar" enquanto gera; termina quando volta e nao ha "NN%".
  const fim = Date.now() + (Number(input.espera_s) || 240) * 1000;
  await esperar(4000);
  let terminou = false;
  while (Date.now() < fim) {
    const st = await ctx.js(`return {parar: !!document.querySelector('[aria-label="Parar"]'), pct: /\\b\\d{1,3}%/.test((document.querySelector('main')||document.body).innerText)};`);
    if (!st.parar && !st.pct) { terminou = true; break; }
    await esperar(3000);
  }
  const g = (await ctx.js(LISTAR_GRADE)) || [];
  const novos = g.filter((x) => !antes.has(x.id)).map((x) => x.id);
  const dims = novos.length ? await ctx.js(`var ids=${JSON.stringify(novos)}; return ids.map(function(id){var i=document.querySelector('img[data-media-id="'+id+'"]');
    return {id:id, w:i&&i.naturalWidth, h:i&&i.naturalHeight, src:i&&i.src};});`) : [];
  const resposta = await ctx.js(`var t=document.body.innerText; var i=t.lastIndexOf('O que você quer criar?'); return (i>0?t.slice(Math.max(0,i-400),i):'').replace(/\\s+/g,' ').trim();`);
  // Pedido do usuario (24/11/2026): terminou, ja baixa, sem uma chamada por passo.
  const baixados = input.baixar && novos.length
    ? (await baixar({ projeto: uuid, ids: novos, tamanho: input.baixar, pasta: input.pasta }, ctx)).arquivos
    : undefined;
  return {
    projeto: uuid, terminou, novos: dims, resposta_do_agente: resposta,
    ...(baixados ? { baixados } : {}),
    ...(incluidos ? { incluidos } : {}),
    ...(!novos.length ? { aviso: 'nenhuma midia nova na grade: o agente pode ter respondido com pergunta. Leia resposta_do_agente.' } : {}),
  };
}

// Pedido do usuário (09/11/2026): a ponte espera, nao o agente. Le a tela a
// cada 1 s, ate 2 min, sem navegar nem instalar nada na pagina.
async function esperarGeracao(input, ctx) {
  const teto = Math.min(120, Math.max(1, Number(input.max_s) || 120)) * 1000;
  const inicio = Date.now();
  let st = null;
  while (Date.now() - inicio < teto) {
    st = await ctx.js(`var t=(document.querySelector('main')||document.body).innerText;
      var f=t.match(/Falha[^\\n]{0,200}/);
      return {parar: !!document.querySelector('[aria-label="Parar"]'), pct: /\\b\\d{1,3}%/.test(t),
        falha: f ? f[0] : (/atividade incomum/i.test(t) ? 'atividade incomum' : null),
        midias: document.querySelectorAll('img[data-media-id],video').length};`);
    if (st && st.falha) return { estado: 'falhou', falha: st.falha, segundos: Math.round((Date.now() - inicio) / 1000), midias: st.midias };
    if (st && !st.parar && !st.pct) {
      return { estado: 'terminou', segundos: Math.round((Date.now() - inicio) / 1000), midias: st.midias,
        ...(typeof input.antes === 'number' ? { novas: st.midias - input.antes } : {}) };
    }
    await esperar(1000);
  }
  return { estado: 'ainda_gerando', segundos: Math.round(teto / 1000), midias: st?.midias };
}

export async function executarFlow(nome, input, rodarTool, send, uploadPorClique) {
  const ctx = criarContexto(input, rodarTool, send);
  if (nome === 'browser_flow_baixar') return baixar(input, ctx);
  if (nome === 'browser_flow_subir') return subir(input, ctx, uploadPorClique, rodarTool);
  if (nome === 'browser_flow_gerar') return gerar(input, ctx);
  if (nome === 'browser_flow_esperar') return esperarGeracao(input, ctx);
  if (nome === 'browser_flow_incluir') { await abrirProjeto(ctx, input); return incluir(input, ctx); }
  throw new Error(`tool do flow desconhecida: ${nome}`);
}
