import { safeExecuteScript } from './safe-scripting';
import { debuggerManager as dm } from '../debugger-manager';
import type { InteractiveElement, PageState } from '../../../shared/types';
import { registrarLeitura } from './refs-documento';

/**
 * Profundidade maxima da arvore de acessibilidade lida (B3, 20/10/2026).
 * Antes era 15 e o que passava disso SUMIA da leitura sem aviso: um campo
 * dentro de dialogo dentro de formulario dentro de painel do PJe podia ficar de
 * fora e o agente concluir que "nao existe". Subiu para 40 (a recursao e rasa
 * ate para isso; o recuo do texto ja e travado em 10 niveis) e, se mesmo assim
 * algo for cortado, o resultado diz quantos nos ficaram de fora.
 */
const PROFUNDIDADE_MAXIMA = 40;

/** Opcoes de leitura (fase 4: L1, L2, X2). Tudo opcional; sem nada, a leitura e a de sempre. */
export interface OpcoesLeitura {
  /** 'viewport' corta o que esta fora da janela; 'page' (padrao) mantem tudo e so MARCA. */
  scope?: 'page' | 'viewport';
  /** Arvore: so os nos interativos. */
  so_interativos?: boolean;
  /** Arvore: niveis a partir da raiz. */
  profundidade?: number;
  /** Escopo por seletor CSS. */
  seletor?: string;
  /** Escopo por nome de painel/landmark (substring, sem diferenciar maiuscula). */
  secao?: string;
  /** Escopo: subarvore deste ref. */
  ref?: number;
}

async function loaderIdAtual(tabId: number): Promise<string | undefined> {
  try {
    const r = await dm.send<{ frameTree?: { frame?: { loaderId?: string } } }>(tabId, 'Page.getFrameTree');
    return r?.frameTree?.frame?.loaderId;
  } catch {
    return undefined;
  }
}

/**
 * L3 + L4: le a pagina e confere se ela trocou DURANTE a leitura (loaderId antes x depois).
 * Trocou: refaz 1 vez e avisa. O loaderId final fica guardado para os cliques por ref.
 */
export async function getPageStructureViaCDP(tabId: number, opts: OpcoesLeitura = {}): Promise<PageState> {
  const antes = await loaderIdAtual(tabId);
  let res = await lerUmaVez(tabId, opts);
  let depois = await loaderIdAtual(tabId);
  let aviso: string | undefined;
  if (antes && depois && antes !== depois) {
    res = await lerUmaVez(tabId, opts);
    const terceiro = await loaderIdAtual(tabId);
    aviso = terceiro === depois
      ? 'a pagina trocou durante a leitura; esta e a leitura refeita (a anterior foi descartada)'
      : 'a pagina continua trocando (navegacao em curso): releia quando assentar';
    depois = terceiro ?? depois;
  }
  if (depois) await registrarLeitura(tabId, depois);
  if (aviso) res.avisoLeitura = [res.avisoLeitura, aviso].filter(Boolean).join('; ');
  return res;
}

async function lerUmaVez(tabId: number, opts: OpcoesLeitura): Promise<PageState> {
  let janelaW = Infinity;
  let janelaH = Infinity;
  const coordsMap = new Map<number, { x: number; y: number; width: number; height: number }>();

  try {
    // 1. Get DOM snapshot to retrieve bounding boxes
    const snapshotRes = await dm.send<any>(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [],
    });

    if (snapshotRes && snapshotRes.documents && snapshotRes.documents.length > 0) {
      const doc = snapshotRes.documents[0];
      const nodes = doc.nodes;
      const layout = doc.layout;

      // DOMSnapshot returns parallel arrays.
      // layout.nodeIndex maps an index in 'layout' arrays back to an index in 'nodes' arrays.
      // ESCALA E ROLAGEM (23/09/2026): as caixas do DOMSnapshot vem em pixel
      // de TELA (vezes o devicePixelRatio) e em coordenada do DOCUMENTO. O
      // clique (Input.dispatchMouseEvent) quer pixel CSS da JANELA. Sem esta
      // conversao, com escala 1,25 no notebook do usuário toda coordenada do
      // read_page/find saia 25% ao lado (medido: link em 22,17 anunciado em
      // 44,34 numa janela de escala 2), e numa pagina rolada saia deslocada.
      let escala = 1;
      let rolX = 0;
      let rolY = 0;
      try {
        const m = await dm.send<{ result?: { value?: { d: number; x: number; y: number; w: number; h: number } } }>(tabId, 'Runtime.evaluate', {
          expression: '({d: devicePixelRatio, x: scrollX, y: scrollY, w: innerWidth, h: innerHeight})', returnByValue: true,
        });
        escala = Number(m?.result?.value?.d) || 1;
        rolX = Number(m?.result?.value?.x) || 0;
        rolY = Number(m?.result?.value?.y) || 0;
        janelaW = Number(m?.result?.value?.w) || Infinity;
        janelaH = Number(m?.result?.value?.h) || Infinity;
      } catch { /* sem medida: fica como vinha */ }

      if (layout && layout.nodeIndex && nodes && nodes.backendNodeId) {
        for (let i = 0; i < layout.nodeIndex.length; i++) {
          const nodeIdx = layout.nodeIndex[i];
          const backendNodeId = nodes.backendNodeId[nodeIdx];
          const bounds = layout.bounds[i]; // [x, y, width, height]

          if (bounds && bounds.length >= 4) {
            coordsMap.set(backendNodeId, {
              x: bounds[0] / escala - rolX,
              y: bounds[1] / escala - rolY,
              width: bounds[2] / escala,
              height: bounds[3] / escala,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[AXTree] Failed to get DOM Snapshot:', err);
  }

  interface Linha { texto: string; fora: boolean; nivel: number; interativo: boolean }
  let linhas: Linha[] = [];
  let omitidosPorProfundidade = 0;
  let omitidosForaDaVista = 0;
  const avisosEscopo: string[] = [];
  /** nodeIds dentro do escopo pedido (seletor/secao/ref); null = pagina inteira. */
  let permitidos: Set<string> | null = null;
  const interactiveElements: InteractiveElement[] = [];

  // Roles that make an element interactive (also used in pruning filter below)
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'combobox', 'listbox',
    'checkbox', 'radio', 'switch', 'tab', 'menuitem',
    'menu', 'menubar', 'searchbox', 'slider', 'spinbutton',
    'option', 'treeitem',
  ]);

  try {
    // 2. Get the full Accessibility Tree
    const axTreeRes = await dm.send<any>(tabId, 'Accessibility.getFullAXTree');

    // Landmark/region roles that establish a named section context.
    // When we enter one of these with a name, we track it so interactive
    // elements inside display their section (e.g. "[Run settings] INPUT ...").
    const LANDMARK_ROLES = new Set([
      'main', 'complementary', 'navigation', 'region', 'form',
      'dialog', 'alertdialog', 'banner', 'contentinfo', 'article',
      'aside', 'toolbar', 'tabpanel', 'search',
    ]);

    const buildSemanticString = (node: any, depth: number, sectionCtx = '') => {
      // ── Pruning: skip ignored nodes but recurse their children ────
      if (node.ignored) {
        if (node.children) {
          for (const child of node.children) buildSemanticString(child, depth, sectionCtx);
        }
        return;
      }

      const role = node.role?.value || '';

      // ── Pruning: skip useless structural roles ────────────────────
      const SKIP_ROLES = new Set([
        'none', 'presentation', 'separator', 'LineBreak',
        'InlineTextBox', 'paragraph',
        // NOTE: 'Section' intentionally removed — we now track named sections
        // for parent context (e.g. "Run settings > Add stop sequence")
      ]);
      if (SKIP_ROLES.has(role)) {
        if (node.children) {
          for (const child of node.children) buildSemanticString(child, depth, sectionCtx);
        }
        return;
      }

      const name = node.name?.value || '';

      // ── Track section context for landmark roles ───────────────────
      // This is the key fix: interactive elements inside "Run settings" panel
      // will be labelled with "[Run settings]" so the LLM doesn't confuse
      // them with elements in the main chat area.
      let nextCtx = sectionCtx;
      if (LANDMARK_ROLES.has(role) || role === 'Section') {
        if (name) {
          // Named landmark → becomes the section context for its descendants
          nextCtx = name;
        }
        // Unnamed section — keep parent context, just recurse
        if (node.children) {
          for (const child of node.children) buildSemanticString(child, depth, nextCtx);
        }
        return;
      }

      // ── Pruning: pass-through for structural containers ───────────
      if (role === 'RootWebArea' || role === 'generic' || role === 'group') {
        if (node.children) {
          for (const child of node.children) buildSemanticString(child, depth, sectionCtx);
        }
        return;
      }

      // ── Pruning: cap depth to prevent token explosion ─────────────
      if (depth > PROFUNDIDADE_MAXIMA) {
        // Conta o que ficou de fora (o no e seus descendentes que a leitura
        // normal listaria: nomeados ou interativos) para avisar no resultado.
        const pilha: any[] = [node];
        while (pilha.length) {
          const n = pilha.pop();
          if (!n.ignored && (n.name?.value || INTERACTIVE_ROLES.has(n.role?.value || ''))) omitidosPorProfundidade++;
          if (n.children) pilha.push(...n.children);
        }
        return;
      }

      // ── Pruning: skip nodes with no name AND no interactive role ──
      if (!name && !INTERACTIVE_ROLES.has(role)) {
        if (node.children) {
          for (const child of node.children) buildSemanticString(child, depth, sectionCtx);
        }
        return;
      }

      const nodeText = name ? `"${name}"` : '';
      const backendId = node.backendDOMNodeId;
      const emite = !permitidos || permitidos.has(node.nodeId);

      let suffix = '';
      const coords = coordsMap.get(backendId);
      const fora = !!coords && coords.width > 0 && coords.height > 0 && (() => {
        const cx0 = coords.x + coords.width / 2;
        const cy0 = coords.y + coords.height / 2;
        return cx0 < 0 || cy0 < 0 || cx0 > janelaW || cy0 > janelaH;
      })();
      if (coords && coords.width > 0 && coords.height > 0 && !fora) {
        const cx = Math.round(coords.x + coords.width / 2);
        const cy = Math.round(coords.y + coords.height / 2);
        suffix = ` [ref=${backendId}] (x=${cx},y=${cy})`;
      } else if (backendId) {
        suffix = ` [ref=${backendId}]`;
      }

      const props: any[] = node.properties || [];
      const valueProp = props.find((p: any) => p.name === 'value')?.value?.value;
      if (valueProp) suffix += ` value="${valueProp}"`;

      // ── Section context prefix for interactive elements ────────────
      // Shows the LLM which panel/region the element belongs to.
      // Example: "[Run settings] textbox "Add stop..." [ref=36]"
      //   vs     "[Chat] textbox "Start typing a prompt" [ref=219]"
      const sectionPrefix = sectionCtx ? `[${sectionCtx}] ` : '';

      // ── Populate interactiveElements from AX Tree ─────────────────
      if (INTERACTIVE_ROLES.has(role) && backendId && emite && opts.scope === 'viewport' && fora) {
        omitidosForaDaVista++;
      } else if (INTERACTIVE_ROLES.has(role) && backendId && emite) {
        const placeholder =
          props.find((p: any) => p.name === 'placeholder')?.value?.value ||
          props.find((p: any) => p.name === 'aria-placeholder')?.value?.value;
        const ariaLabel = props.find((p: any) => p.name === 'roledescription')?.value?.value;
        const href = props.find((p: any) => p.name === 'url')?.value?.value;

        interactiveElements.push({
          agentId: backendId,
          tag: 'unknown',
          role,
          text: (sectionCtx ? `[${sectionCtx}] ` : '') + (name || valueProp || ''),
          ...(ariaLabel && { ariaLabel }),
          ...(placeholder && { placeholder }),
          ...(href && { href }),
          ...(fora && { foraDaVista: true }),
          rect: coords && coords.width > 0
            ? { x: coords.x, y: coords.y, w: coords.width, h: coords.height }
            : { x: 0, y: 0, w: 0, h: 0 },
        });
      }

      if ((role || name) && emite) {
        const indent = '  '.repeat(Math.min(depth, 10));
        linhas.push({
          texto: `${indent}- ${sectionPrefix}${role} ${nodeText}${suffix}`.trimRight(),
          fora,
          nivel: depth,
          interativo: INTERACTIVE_ROLES.has(role),
        });
      }

      if (node.children) {
        for (const child of node.children) {
          buildSemanticString(child, depth + 1, sectionCtx);
        }
      }
    };

    if (axTreeRes && axTreeRes.nodes) {
      // Reconstruct the tree from the flat array using childIds
      const nodeMap = new Map<string, any>();
      for (const node of axTreeRes.nodes) {
        nodeMap.set(node.nodeId, node);
      }

      for (const node of axTreeRes.nodes) {
        if (node.childIds) {
          node.children = node.childIds.map((id: string) => nodeMap.get(id)).filter(Boolean);
        }
      }

      // ESCOPO (L2/X2): seletor CSS, nome de painel/landmark ou ref -> conjunto de nos permitidos.
      const sets: Array<Set<string>> = [];
      const descendentes = (n: any, acc: Set<string>) => {
        acc.add(n.nodeId);
        for (const f of n.children ?? []) descendentes(f, acc);
      };
      if (opts.ref !== undefined) {
        const acc = new Set<string>();
        const raiz = axTreeRes.nodes.find((n: any) => n.backendDOMNodeId === opts.ref);
        if (raiz) descendentes(raiz, acc);
        else avisosEscopo.push(`ref ${opts.ref} nao esta mais na arvore: releia a pagina`);
        sets.push(acc);
      }
      if (opts.secao) {
        const alvoSecao = opts.secao.toLowerCase();
        const acc = new Set<string>();
        const nomes: string[] = [];
        for (const n of axTreeRes.nodes) {
          const r = n.role?.value || '';
          const nm = n.name?.value || '';
          if (n.ignored || !nm || !(LANDMARK_ROLES.has(r) || r === 'Section')) continue;
          if (nm.toLowerCase().includes(alvoSecao)) descendentes(n, acc);
          else if (nomes.length < 15 && !nomes.includes(nm)) nomes.push(nm);
        }
        if (!acc.size) avisosEscopo.push(`secao "${opts.secao}" nao achada. Secoes nomeadas: ${nomes.join(' | ') || '(nenhuma)'}`);
        sets.push(acc);
      }
      if (opts.seletor) {
        const acc = new Set<string>();
        try {
          const doc = await dm.send<any>(tabId, 'DOM.getDocument', { depth: 0 });
          const q = await dm.send<any>(tabId, 'DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: opts.seletor });
          const ids = new Set<number>();
          for (const nodeId of (q?.nodeIds ?? []).slice(0, 50)) {
            const d = await dm.send<any>(tabId, 'DOM.describeNode', { nodeId });
            if (d?.node?.backendNodeId) ids.add(d.node.backendNodeId);
          }
          for (const n of axTreeRes.nodes) if (ids.has(n.backendDOMNodeId)) descendentes(n, acc);
          if (!ids.size) avisosEscopo.push(`seletor "${opts.seletor}" nao casou com nenhum elemento`);
        } catch (e) {
          avisosEscopo.push(`seletor "${opts.seletor}" invalido ou falhou (${String(e).slice(0, 80)})`);
        }
        sets.push(acc);
      }
      if (sets.length) {
        permitidos = new Set([...sets[0]].filter((id) => sets.every((x) => x.has(id))));
      }

      // Root is usually the first node in the returned list
      if (axTreeRes.nodes.length > 0) {
        buildSemanticString(axTreeRes.nodes[0], 0);
      }
    }
  } catch (err) {
    console.warn('[AXTree] Failed to get AX Tree:', err);
    linhas = [{ texto: '(Semantic tree unavailable. Debugger may be detached.)', fora: false, nivel: 0, interativo: false }];
  }

  // 3. Fallback info extraction
  const pageInfo = await safeExecuteScript({
    target: { tabId },
    func: () => ({
      url: location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }),
  });

  const info = pageInfo?.[0]?.result as any;
  const avisoProfundidade = omitidosPorProfundidade > 0
    ? `${omitidosPorProfundidade} elemento(s) da pagina ficaram de fora desta leitura por estarem aninhados `
      + `a mais de ${PROFUNDIDADE_MAXIMA} niveis. Use browser_find, browser_extract ou browser_javascript para alcanca-los.`
    : undefined;
  // Arvore em texto: aplica scope/profundidade/so_interativos. A lista de interativos ja saiu filtrada.
  let omitidosPorNivel = 0;
  const visiveis = linhas.filter((l) => {
    if (opts.scope === 'viewport' && l.fora) { omitidosForaDaVista++; return false; }
    if (opts.profundidade !== undefined && l.nivel >= opts.profundidade) { omitidosPorNivel++; return false; }
    if (opts.so_interativos && !l.interativo) return false;
    return true;
  });
  const treeText = visiveis.map((l) => (l.fora && opts.scope !== 'viewport' ? `${l.texto} [fora]` : l.texto)).join('\n');
  const notas = [...avisosEscopo];
  if (omitidosForaDaVista) notas.push(`${omitidosForaDaVista} item(ns) fora da vista omitidos (scope "viewport"); use scope "page" para ver tudo`);
  if (omitidosPorNivel) notas.push(`${omitidosPorNivel} no(s) abaixo do nivel ${opts.profundidade} omitidos (profundidade)`);

  return {
    url: info?.url || '',
    title: info?.title || '',
    interactiveElements,
    textContent: treeText,
    contentLength: treeText.length,
    accessibilityTree: treeText,
    ...(avisoProfundidade && { avisoProfundidade }),
    ...(notas.length && { avisoLeitura: notas.join('; ') }),
  };
}
