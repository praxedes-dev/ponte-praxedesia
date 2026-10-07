/**
 * MUTATION TESTING da obra 26 — cada defesa e desligada no CODIGO DE PRODUCAO,
 * o bundle e refeito e as duas bancadas rodam. Mutacao que sobrevive e defesa
 * sem teste que a prove.
 *
 * Nao toca `.output/` nem a extensao (so gera bundle em pasta temporaria), e
 * RESTAURA cada arquivo antes de sair — inclusive se estourar no meio.
 *
 *   node bridge-server/test/_obra26-mutacoes.mjs
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'obra26-'));

const ARQ = {
  motor: join(RAIZ, 'entrypoints/background/execution-engine/index.ts'),
  cdp: join(RAIZ, 'entrypoints/background/execution-engine/cdp-tools.ts'),
  freio: join(RAIZ, 'entrypoints/background/bridge/policy.ts'),
  form: join(RAIZ, 'entrypoints/background/bridge/capacidades/formulario.ts'),
};

/** [arquivo, trecho original, trecho mutado] — o trecho tem de casar 1 vez. */
const MUTACOES = [
  {
    nome: 'A1-resolvedor: desliga o desvio da escrita para o elemento FOCADO',
    arq: 'motor',
    de: "if (!cliqueApenasFoca && como !== 'foco' && ACOES_QUE_ESCREVEM_POR_FOCO.has(acao.type)) {",
    para: "if (false && !cliqueApenasFoca && como !== 'foco' && ACOES_QUE_ESCREVEM_POR_FOCO.has(acao.type)) {",
  },
  {
    nome: 'A1-motor: volta o `undefined` do `case type` (motor escolhe o alvo sozinho)',
    arq: 'motor',
    de: 'const alvoDaEscrita = alvo.efetivo.backendNodeId;',
    para: "const alvoDaEscrita = alvo.como === 'foco' || !efetivoEhCampoDigitavel(alvo.efetivo)\n            ? undefined : alvo.efetivo.backendNodeId;",
  },
  {
    nome: 'A1-familia: o receptor focado deixa de sofrer a travessia da acao',
    arq: 'motor',
    de: 'const doFoco = await percorrerAteOEfetivo(tabId, f.objectId, f.backendNodeId, familia);',
    para: "const doFoco = await percorrerAteOEfetivo(tabId, f.objectId, f.backendNodeId, 'nenhuma');",
  },
  {
    nome: 'A2-catch cego: volta o `.catch(() => {})` do DOM.focus em digitarTeclaATecla',
    arq: 'form',
    de: '    try {\n      await dm.send(tabId, \'DOM.focus\', { backendNodeId });\n    } catch (err) {',
    para: '    try {\n      await dm.send(tabId, \'DOM.focus\', { backendNodeId }).catch(() => {});\n    } catch (err) {',
  },
  {
    nome: 'A2-conferencia: nao confere se o foco realmente foi para o campo',
    arq: 'form',
    de: '    if (focou?.result?.value !== true) {',
    para: '    if (false && focou?.result?.value !== true) {',
  },
  {
    nome: 'A3/A4-tecla: freio volta a ler a tecla pela conta propria (partesDaTecla)',
    arq: 'freio',
    de: '  const t = lerTecla(key, modifiersParam);\n  return teclaImprimivel(t.key, t.modifiers);',
    para: "  const partes = key.split('+').map((p) => p.trim()).filter(Boolean);\n"
      + '  const teclaFinal = partes[partes.length - 1] ?? key;\n'
      + "  const mods = [...(modifiersParam ?? []), ...partes.slice(0, -1)].map((m) => m.toLowerCase());\n"
      + "  const cmd = mods.some((m) => ['alt', 'ctrl', 'control', 'meta', 'cmd', 'command'].includes(m));\n"
      + '  return teclaFinal.length === 1 && !cmd;',
  },
  {
    nome: 'A3-ativa: pressKeyAtiva volta a comparar o nome CRU da tecla',
    arq: 'freio',
    de: '  if (!TECLAS_QUE_ATIVAM.has(t.key)) return false;',
    para: '  if (!TECLAS_QUE_ATIVAM.has(key)) return false;',
  },
  {
    nome: 'regra 4: volta a perguntar sobre o RECEPTOR em vez do no nomeado',
    arq: 'motor',
    de: '      cliqueApenasFoca, escritaCaiuNoFoco,',
    para: '      cliqueApenasFoca: efetivoEhCampoDigitavel(efetivo), escritaCaiuNoFoco,',
  },
  {
    nome: 'mensagem: o veto de senha volta a esconder o clique irreversivel',
    arq: 'freio',
    de: 'if (alvoResolvido.efetivo.tipo === \'password\') return vetoDeSenha(achadoDoClique);',
    para: "if (alvoResolvido.efetivo.tipo === 'password') return vetoDeSenha();",
  },
  {
    nome: 'cdpType: volta a escrever por insertText mesmo com o foco FALHADO',
    arq: 'cdp',
    de: "    if (focoFalhou || probe.type === 'no-focus') {",
    para: "    if (false && (focoFalhou || probe.type === 'no-focus')) {",
  },
];

const rodar = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, args, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  p.stdout.on('data', (d) => { saida += d; });
  p.stderr.on('data', (d) => { saida += d; });
  p.on('close', (code) => resolve({ code, saida }));
});

async function baterias(tag) {
  const bundle = join(TMP, `b-${tag}.mjs`);
  const b = await rodar([join(AQUI, '_obra26-bundle.mjs'), bundle]);
  if (b.code !== 0) return { falhas: -1, detalhe: `bundle nao compilou: ${b.saida.slice(0, 200)}` };
  let falhas = 0;
  const quais = [];
  for (const arquivo of ['receptor-da-escrita-bancada.mjs', 'alvo-unico-bancada.mjs']) {
    const r = await rodar([join(AQUI, arquivo), bundle]);
    for (const l of r.saida.split('\n')) {
      if (l.startsWith('FALHA')) { falhas++; quais.push(`${arquivo.replace('.mjs', '')}: ${l.slice(6, 80).trim()}`); }
    }
  }
  return { falhas, quais };
}

const originais = Object.fromEntries(
  Object.entries(ARQ).map(([k, p]) => [k, readFileSync(p, 'utf8')]),
);
const restaurar = () => { for (const [k, p] of Object.entries(ARQ)) writeFileSync(p, originais[k]); };
process.on('exit', restaurar);
process.on('SIGINT', () => { restaurar(); process.exit(130); });

console.log('=== MUTATION TESTING — obra 26 ===');
const base = await baterias('base');
console.log(`base (sem mutacao): ${base.falhas} falha(s)`);
if (base.falhas !== 0) {
  console.log('ERRO base ja esta vermelha, nao da para medir mutacao:', base.quais?.join(' | '));
  process.exitCode = 1;
} else {
  let sobreviventes = 0;
  for (const m of MUTACOES) {
    const alvo = ARQ[m.arq];
    const texto = originais[m.arq];
    const ocorrencias = texto.split(m.de).length - 1;
    if (ocorrencias !== 1) {
      console.log(`ERRO  ${m.nome} -- trecho casou ${ocorrencias}x (esperado 1). Mutacao NAO aplicada.`);
      sobreviventes++;
      continue;
    }
    writeFileSync(alvo, texto.replace(m.de, m.para));
    const r = await baterias('mut');
    restaurar();
    const morreu = r.falhas > 0;
    if (!morreu) sobreviventes++;
    console.log(`${morreu ? 'MORREU  ' : 'SOBREVIVE'} ${m.nome} -- ${r.falhas} falha(s)`);
    if (morreu) console.log(`          matada por: ${r.quais.slice(0, 3).join(' | ')}`);
  }
  console.log(`\n=== ${MUTACOES.length - sobreviventes}/${MUTACOES.length} mutacoes mortas ===`);
  if (sobreviventes > 0) process.exitCode = 1;
}
