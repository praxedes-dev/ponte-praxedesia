/**
 * browser_upload_por_clique (30/09/2026). Sobe arquivos em site cujo campo de
 * arquivo so nasce no clique de "Enviar" (Google Flow, Gemini, Drive), SEM a
 * janela do Windows abrir na tela do Dr. Cezar: a extensao pede ao Chrome
 * para interceptar o seletor de arquivo, o clique passa pelo freio de sempre
 * (browser_click) e os arquivos vao direto no campo que o site abriu.
 */
import { existsSync } from 'node:fs';

export const UPLOAD_CLIQUE_TOOL = {
  name: 'browser_upload_por_clique',
  description:
    'Sobe arquivos clicando no botao de enviar do site, SEM abrir a janela de escolher arquivo do Windows: '
    + 'a ponte intercepta o seletor e entrega os arquivos direto no campo que o site criou. Use em site cujo '
    + '<input type=file> nao existe antes do clique (Google Flow, Gemini, Drive, formularios modernos). '
    + 'Indique o botao como no browser_click (ref, x/y, text ou ariaLabel). Se o botao abre um MENU antes '
    + '(ex.: "+" > "Enviar"), abra o menu com browser_click e aponte aqui o ITEM que envia. Quem prova que o '
    + 'site aceitou e a tela (miniatura, barra de progresso).',
  inputSchema: {
    type: 'object',
    properties: {
      caminhos: { type: 'array', items: { type: 'string' }, description: 'Caminhos completos dos arquivos no Windows.' },
      ref: { type: 'number', description: 'Ref do botao que abre o seletor de arquivo.' },
      x: { type: 'number', description: 'Ou: coordenada x do botao.' },
      y: { type: 'number', description: 'Ou: coordenada y do botao.' },
      text: { type: 'string', description: 'Ou: texto visivel do botao (ex.: "Enviar").' },
      ariaLabel: { type: 'string', description: 'Ou: aria-label do botao.' },
      timeout_ms: { type: 'number', description: 'Quanto esperar o site pedir o arquivo depois do clique. Padrao 10000.' },
    },
    required: ['caminhos'],
  },
};

export async function uploadPorClique(input, rodarTool, send) {
  const caminhos = Array.isArray(input.caminhos) ? input.caminhos.map(String) : [];
  if (!caminhos.length) throw new Error('informe caminhos');
  const faltam = caminhos.filter((c) => !existsSync(c));
  if (faltam.length) throw new Error(`arquivo(s) nao encontrado(s) no disco — nada foi feito: ${faltam.join(', ')}`);

  const aba = input.aba !== undefined ? { aba: input.aba } : {};
  await send('cap_seletor_armar', { ...aba }, 15_000);

  const alvo = {};
  for (const k of ['ref', 'x', 'y', 'text', 'ariaLabel', 'role']) if (input[k] !== undefined) alvo[k] = input[k];
  if (!Object.keys(alvo).length) throw new Error('indique o botao: ref, x/y, text ou ariaLabel');
  const clique = await rodarTool('browser_click', { ...alvo, ...aba, ...(input.confirm === true ? { confirm: true } : {}) }, { bruto: true });
  if (clique.isError) {
    // Desarma sem entregar nada: o clique nao aconteceu.
    await send('cap_seletor_entregar', { params: { caminhos, timeout_ms: 1 }, ...aba }, 10_000).catch(() => {});
    throw new Error(`o clique no botao falhou, nada foi enviado: ${clique.content?.[0]?.text ?? ''}`);
  }

  const timeout = Number(input.timeout_ms) || 10_000;
  const r = await send('cap_seletor_entregar', { params: { caminhos, timeout_ms: timeout }, ...aba }, timeout + 15_000);
  return { ...r, arquivos: caminhos.map((c) => c.split(/[\\/]/).pop()) };
}
