import { safeExecuteScript } from './safe-scripting';
import { debuggerManager as dm } from '../debugger-manager';
import type { InteractiveElement, PageState } from '../../../shared/types';

export async function getPageStructureViaCDP(tabId: number): Promise<PageState> {
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
      // conversao, com escala 1,25 no notebook do Dr. Cezar toda coordenada do
      // read_page/find saia 25% ao lado (medido: link em 22,17 anunciado em
      // 44,34 numa janela de escala 2), e numa pagina rolada saia deslocada.
      let escala = 1;
      let rolX = 0;
      let rolY = 0;
      try {
        const m = await dm.send<{ result?: { value?: { d: number; x: number; y: number } } }>(tabId, 'Runtime.evaluate', {
          expression: '({d: devicePixelRatio, x: scrollX, y: scrollY})', returnByValue: true,
        });
        escala = Number(m?.result?.value?.d) || 1;
        rolX = Number(m?.result?.value?.x) || 0;
        rolY = Number(m?.result?.value?.y) || 0;
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

  let textLines: string[] = [];
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
      if (depth > 15) return;

      // ── Pruning: skip nodes with no name AND no interactive role ──
      if (!name && !INTERACTIVE_ROLES.has(role)) {
        if (node.children) {
          for (const child of node.children) buildSemanticString(child, depth, sectionCtx);
        }
        return;
      }

      const nodeText = name ? `"${name}"` : '';
      const backendId = node.backendDOMNodeId;

      let suffix = '';
      const coords = coordsMap.get(backendId);
      if (coords && coords.width > 0 && coords.height > 0) {
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
      if (INTERACTIVE_ROLES.has(role) && backendId) {
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
          rect: coords && coords.width > 0
            ? { x: coords.x, y: coords.y, w: coords.width, h: coords.height }
            : { x: 0, y: 0, w: 0, h: 0 },
        });
      }

      if (role || name) {
        const indent = '  '.repeat(Math.min(depth, 10));
        textLines.push(`${indent}- ${sectionPrefix}${role} ${nodeText}${suffix}`.trimRight());
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

      // Root is usually the first node in the returned list
      if (axTreeRes.nodes.length > 0) {
        buildSemanticString(axTreeRes.nodes[0], 0);
      }
    }
  } catch (err) {
    console.warn('[AXTree] Failed to get AX Tree:', err);
    textLines = ['(Semantic tree unavailable. Debugger may be detached.)'];
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
  const treeText = textLines.join('\n');

  return {
    url: info?.url || '',
    title: info?.title || '',
    interactiveElements,
    textContent: treeText,
    contentLength: treeText.length,
    accessibilityTree: treeText,
  };
}
