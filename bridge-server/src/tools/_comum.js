/**
 * Pecas compartilhadas por mais de um arquivo de tools por dominio.
 */

export const SEMANTIC_TARGET_PROPS = {
  ref: {
    type: 'number',
    description: 'Referencia do elemento vinda de browser_read_page (backendNodeId). Prefira sempre isto: e exato.',
  },
  text: { type: 'string', description: 'Texto visivel do elemento, quando nao houver ref.' },
  role: { type: 'string', description: 'Papel de acessibilidade (button, link, textbox...).' },
  placeholder: { type: 'string', description: 'Placeholder do campo.' },
  ariaLabel: { type: 'string', description: 'aria-label do elemento.' },
};

/**
 * Monta o alvo: por ref quando houver, senao busca semantica.
 *
 * ATENCAO ao campo `text` (obra 25, 06/09/2026). Aqui ele e o TEXTO DO
 * ELEMENTO que se procura na pagina. Em `browser_type`, `text` e o texto A
 * DIGITAR -- coisa completamente diferente -- e passar o input inteiro para ca
 * fazia o segredo digitado virar criterio de busca:
 *
 *   browser_type({ text: 'SEGREDO1', placeholder: 'Senha de acesso' })
 *     -> target { strategy:'semantic', text:'SEGREDO1', placeholder:'Senha...' }
 *     -> resolveTarget nao acha nada (nenhum elemento "diz" SEGREDO1)
 *     -> o motor cai no document.activeElement e escreve a senha ali.
 *
 * MEDIDO no mesmo campo: `text:'Senha'` (substring do placeholder) era
 * BLOQUEADO e `text:'SEGREDO1'` passava e escrevia -- o freio so enxergava o
 * campo quando o segredo digitado por acaso casava com o rotulo dele. Por isso
 * `browser_type` chama `buildTarget` com `text: i.texto_do_elemento` (ver
 * `interacao.js`): quem quer buscar o campo pelo texto visivel usa o campo
 * proprio, e ninguem mais confunde os dois.
 */
export function buildTarget(input) {
  if (input.ref !== undefined) {
    return { strategy: 'agent-id', agentId: input.ref };
  }
  const { text, role, placeholder, ariaLabel } = input;
  if (text || role || placeholder || ariaLabel) {
    return {
      strategy: 'semantic',
      ...(text && { text }),
      ...(role && { role }),
      ...(placeholder && { placeholder }),
      ...(ariaLabel && { ariaLabel }),
    };
  }
  return undefined;
}
