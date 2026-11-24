/**
 * Pecas compartilhadas por mais de um arquivo de tools por dominio.
 */

/** L5: so browser_click e browser_type declaram esta propriedade. */
export const REF_MOLDURA_PROP = {
  ref_moldura: {
    type: 'string',
    description: 'Ref de elemento DENTRO de moldura (iframe) de outro site, no formato f1:3, como browser_read_page mostra. Vale so aqui; o ref numerico nao serve la dentro.',
  },
};

export const SEMANTIC_TARGET_PROPS = {
  ref: {
    type: 'number',
    description: 'Referencia do elemento vinda de browser_read_page (backendNodeId). Prefira sempre isto: e exato.',
  },
  text: { type: 'string', description: 'Texto visivel do elemento, quando nao houver ref.' },
  role: { type: 'string', description: 'Papel de acessibilidade (button, link, textbox...).' },
  placeholder: { type: 'string', description: 'Placeholder do campo.' },
  ariaLabel: { type: 'string', description: 'aria-label do elemento.' },
  exato: {
    type: 'boolean',
    description:
      'Na busca por text/role/placeholder/ariaLabel (sem ref): casa o nome INTEIRO (sem diferenciar maiuscula) '
      + 'em vez de substring e, se mais de um elemento casar, RECUSA e lista os candidatos em vez de '
      + 'escolher o primeiro. Use quando houver nomes parecidos ("Assinar" x "Nao assinar"). Padrao: false.',
  },
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
  // L5: ref de elemento dentro de moldura de outro site (f1:3). Estrategia propria: a
  // extensao desvia para o caminho da moldura (com o mesmo freio) e recusa em outras tools.
  if (typeof input.ref_moldura === 'string' && input.ref_moldura) {
    return { strategy: 'moldura-ref', ref: input.ref_moldura };
  }
  if (input.ref !== undefined) {
    return { strategy: 'agent-id', agentId: input.ref };
  }
  const { text, role, placeholder, ariaLabel, exato } = input;
  if (text || role || placeholder || ariaLabel) {
    return {
      strategy: 'semantic',
      ...(text && { text }),
      ...(role && { role }),
      ...(placeholder && { placeholder }),
      ...(ariaLabel && { ariaLabel }),
      ...(exato === true && { exato: true }),
    };
  }
  return undefined;
}
