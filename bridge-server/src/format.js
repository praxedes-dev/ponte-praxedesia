/**
 * Formatacao das respostas de pagina.
 *
 * O motor devolve o estado inteiro: a arvore semantica em `textContent` E de
 * novo em `accessibilityTree` (mesma string, duplicada), mais a lista de
 * elementos interativos, que repete boa parte do mesmo conteudo. Mandar isso
 * cru para o agente gasta o triplo de janela por leitura — numa pagina do PJe
 * ou do CRM, poucas leituras ja comprometem a sessao.
 *
 * Aqui a resposta e reduzida ao que o agente realmente usa para agir.
 */

const PADRAO_MAX_CHARS = 8000;

/** Uma linha por elemento clicavel, com o ref que o click aceita. */
function linhaDeElemento(el) {
  // Moldura de outro site: ref f<n>:<id> (L5) quando lida por sessao filha; sem ref (mesmo processo), so a coordenada.
  const partes = [el.moldura ? (el.ref ? `  [${el.ref} ${el.moldura}] ${el.role}` : `  [x,y ${el.moldura}] ${el.role}`) : `  [${el.agentId}] ${el.role}`];
  if (el.text) partes.push(` "${el.text}"`);
  if (el.secreto) partes.push(' [valor oculto]');
  if (el.placeholder) partes.push(` placeholder="${el.placeholder}"`);
  if (el.href) partes.push(` -> ${el.href}`);
  if (el.rect?.w > 0 && !el.foraDaVista) {
    partes.push(` (${Math.round(el.rect.x + el.rect.w / 2)},${Math.round(el.rect.y + el.rect.h / 2)})`);
  }
  if (el.foraDaVista) partes.push(' [fora]');
  return partes.join('');
}

// `page.aviso` vem da obra 09 (capacidades/desafio.ts, gancho "depois"): a
// pagina tem um captcha no proprio formulario (nao a pagina inteira, que
// viraria erro antes de chegar aqui) — uma linha logo abaixo do cabecalho.
const cabecalho = (page) => `${page.url}\n${page.title}${page.aviso ? `\n[aviso] ${page.aviso}` : ''}`
  // B3: a extensao cortou nos fundos demais (ax-tree.ts) -- o agente precisa saber que a leitura nao e total.
  + `${page.avisoProfundidade ? `\n[aviso] ${page.avisoProfundidade}` : ''}`
  // Fase 4: escopo sem resultado, itens omitidos, pagina trocou durante a leitura.
  + `${page.avisoLeitura ? `\n[aviso] ${page.avisoLeitura}` : ''}`;

/** Uma linha so, no cabecalho, para as marcas "[fora]" (antes cada linha repetia a explicacao). */
const notaForaDaVista = (els) => {
  const n = els.filter((e) => e.foraDaVista).length;
  return n ? `\n[aviso] ${n} elemento(s) [fora]: browser_scroll ate eles e releia antes de clicar` : '';
};

/** `moldura`: so o conteudo das molduras cujo host contem o texto (L2); a pagina principal sai da leitura. */
function soMoldura(page, host) {
  const alvo = String(host).toLowerCase();
  const m = page.molduras;
  const els = (m?.elementos ?? []).filter((e) => String(e.moldura).toLowerCase().includes(alvo));
  const hosts = [...new Set((m?.elementos ?? []).map((e) => e.moldura))];
  const aviso = els.length ? '' : `nenhuma moldura com host "${host}". Molduras lidas: ${hosts.join(', ') || '(nenhuma)'}`;
  return {
    ...page,
    interactiveElements: [],
    textContent: '',
    accessibilityTree: '',
    avisoLeitura: [page.avisoLeitura, aviso].filter(Boolean).join('; '),
    molduras: { elementos: els, ilegiveis: m?.ilegiveis ?? [] },
  };
}

/**
 * `mode: 'interactive'` (padrao) devolve so o que da para clicar ou preencher.
 * `mode: 'full'` devolve a arvore semantica inteira, paginada.
 */
export function formatarPagina(pageBruta, input = {}) {
  const page = input.moldura ? soMoldura(pageBruta, input.moldura) : pageBruta;
  const modo = input.mode || 'interactive';
  const maxChars = input.max_chars ?? PADRAO_MAX_CHARS;
  const offset = input.offset ?? 0;

  if (modo === 'interactive') {
    const els = page.interactiveElements ?? [];
    const mold = secaoMolduras(page);
    if (!els.length && mold) return cortar(`${cabecalho(page)}${mold}`, maxChars, offset, 'browser_read_page com offset');
    if (!els.length) {
      return `${cabecalho(page)}\n\nNenhum elemento interativo encontrado. `
        + `Use mode "full" para ver a arvore da pagina, ou browser_extract para o texto.`;
    }
    const linhas = els.map(linhaDeElemento).join('\n');
    const corpo = `${cabecalho(page)}${notaForaDaVista([...els, ...(page.molduras?.elementos ?? [])])}\n\n${els.length} elementos interativos:\n${linhas}${mold}`;
    return cortar(corpo, maxChars, offset, 'browser_read_page com offset');
  }

  const arvore = page.textContent || page.accessibilityTree || '';
  const temFora = /\[fora\]$/m.test(arvore) ? '\n[aviso] linhas com [fora] estao fora da janela: browser_scroll ate elas e releia antes de clicar' : '';
  const corpo = `${cabecalho(page)}${temFora}\n\n${arvore}${secaoMolduras(page)}`;
  return cortar(corpo, maxChars, offset, 'browser_read_page com offset');
}

/**
 * Molduras de OUTRO SITE (iframe cross-origin: Google Payments, chats de
 * suporte). A extensao le la dentro por sessao filha do CDP e manda cada
 * elemento com a coordenada JA na tela da aba. Sem ref -- clica-se por x,y
 * (medido 23/09/2026: clique e tecla chegam dentro da moldura).
 */
function secaoMolduras(page) {
  const m = page.molduras;
  if (!m || (!m.elementos?.length && !m.ilegiveis?.length)) return '';
  let t = `\n\nDENTRO DE MOLDURAS DE OUTRO SITE (${m.elementos?.length ?? 0}) -- linha com ref f<n>:<id>: browser_click / browser_type com ref_moldura (o freio julga o botao de la de dentro); `
    + 'linha [x,y] (mesmo site): browser_click {x,y} na coordenada e, para digitar, clique no campo e use browser_type '
    + 'sem ref:\n';
  t += (m.elementos ?? []).map(linhaDeElemento).join('\n');
  if (m.ilegiveis?.length) t += `\n  molduras que nao deu para ler: ${m.ilegiveis.join('; ')}`;
  return t;
}

/** Corta e avisa quanto sobrou, para o agente saber que existe continuacao. */
export function cortar(texto, maxChars, offset = 0, comoContinuar = '') {
  const total = texto.length;
  const trecho = texto.slice(offset, offset + maxChars);
  const fim = offset + trecho.length;
  if (fim >= total && offset === 0) return trecho;

  const restante = total - fim;
  const aviso = restante > 0
    ? `\n\n[... ${restante} caracteres restantes de ${total}. Continue com ${comoContinuar}=${fim} ...]`
    : `\n\n[fim — mostrando de ${offset} a ${fim} de ${total}]`;
  return trecho + aviso;
}

/**
 * Procura elementos por descricao livre, para o agente nao precisar despejar a
 * pagina inteira so para achar um botao.
 *
 * `page.aviso` vem da MESMA fonte que `formatarPagina` (obra 09,
 * capacidades/desafio.ts, gancho "depois" de `read_page` — `browser_find`
 * fala a mesma acao 'read_page' na extensao, so muda a formatacao aqui do
 * lado do servidor). Ate 06/09/2026 esta funcao ignorava o campo e um agente
 * que procurasse um campo por `browser_find` antes de preencher formulario
 * no PJe/eSAJ nunca via o aviso de captcha que `browser_read_page` ja mostra.
 */
export function procurar(page, query, limite = 12) {
  const termos = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const els = [...(page.interactiveElements ?? []), ...(page.molduras?.elementos ?? [])];
  const prefixo = page.aviso ? `[aviso] ${page.aviso}\n\n` : '';

  const pontuados = els.map((el) => {
    const alvo = [el.text, el.role, el.placeholder, el.ariaLabel, el.href]
      .filter(Boolean).join(' ').toLowerCase();
    let pontos = 0;
    for (const termo of termos) {
      if (!alvo.includes(termo)) continue;
      pontos += 1;
      // Termo que casa com o comeco do texto visivel vale mais.
      if (el.text?.toLowerCase().startsWith(termo)) pontos += 1;
    }
    // Casar a frase inteira e o sinal mais forte.
    if (termos.length > 1 && alvo.includes(termos.join(' '))) pontos += 2;
    return { el, pontos };
  }).filter((p) => p.pontos > 0);

  pontuados.sort((a, b) => b.pontos - a.pontos);
  const achados = pontuados.slice(0, limite);

  if (!achados.length) {
    return `${prefixo}Nada casou com "${query}" entre os ${els.length} elementos interativos da pagina.\n`
      + `Tente outras palavras, ou browser_read_page para ver a lista inteira.`;
  }

  return `${prefixo}${achados.length} de ${els.length} elementos casaram com "${query}":\n`
    + achados.map((p) => linhaDeElemento(p.el)).join('\n');
}
