/**
 * Teste do browser_roteiro (16/09/2026) — varios passos numa chamada, com
 * conferencia entre eles (src/roteiro.js).
 *
 * O que precisa provar:
 *   1. caminho feliz: find + guardar_ref + type + click + conferir, tudo numa
 *      chamada, ok:true e o efeito na pagina.
 *   2. conferencia que nao bate PARA ali: os passos seguintes NAO rodam, e o
 *      relatorio diz qual passo, o motivo e a URL.
 *   3. confirm em qualquer passo recusa o roteiro inteiro ANTES do 1o passo.
 *   4. tool proibida (browser_use_current_tab) idem.
 *   5. o freio da extensao vale dentro do roteiro: clique em "Assinar" e
 *      barrado e o roteiro para — roteiro nao e porta dos fundos.
 *   6. para_cada roda os subpassos por item, com {{item}}.
 *   7. prazo estourado devolve continuar_de, e a_partir_de retoma dali.
 *   8. arquivo JSON com variavel obrigatoria faltando e recusado; com ela, roda.
 *
 *   node test/roteiro.js
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClient, esperarExtensao } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-roteiro');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: nunca a do Dr. Cezar.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {}).catch(() => {});

  const montar = () => c.tool('browser_javascript', {
    codigo: `(function(){
      window.__marca = [];
      document.body.innerHTML =
        '<input id="campo" aria-label="Campo do roteiro" placeholder="nome do cliente">' +
        '<button id="ir" aria-label="Botao seguir etapa">Seguir etapa</button>' +
        '<button id="assina" aria-label="Assinar documento">Assinar</button>';
      document.getElementById('ir').onclick = function(){ location.hash = '#/etapa-2'; };
      document.getElementById('assina').onclick = function(){ window.__assinou = true; };
      history.replaceState(null, '', location.pathname);
      return 'montado';
    })()`,
  });
  const roteiro = async (input) => {
    const r = (await c.call('tools/call', { name: 'browser_roteiro', arguments: input })).result;
    return { erro: !!r.isError, rel: JSON.parse(r.content[0].text) };
  };
  const js = async (codigo) => {
    const t = (await c.tool('browser_javascript', { codigo })).content[0].text;
    try { return JSON.parse(t); } catch { return t; }
  };

  // ── 1. caminho feliz ────────────────────────────────────────────────────
  await montar();
  const feliz = await roteiro({
    variaveis: { nome: 'MARIA TESTE' },
    passos: [
      { nome: 'achar campo', tool: 'browser_find', args: { query: 'nome do cliente' }, guardar_ref: 'refCampo' },
      { nome: 'digitar', tool: 'browser_type', args: { ref: '{{refCampo}}', text: '{{nome}}' } },
      { nome: 'achar botao', tool: 'browser_find', args: { query: 'Seguir etapa' }, guardar_ref: 'refIr' },
      { nome: 'clicar', tool: 'browser_click', args: { ref: '{{refIr}}' } },
      { nome: 'etapa 2', conferir: { js: "location.hash === '#/etapa-2'", ate_ms: 3000 } },
    ],
  });
  check(!feliz.erro && feliz.rel.ok === true, '1. roteiro feliz volta ok', JSON.stringify(feliz.rel));
  check(feliz.rel.feitos === 5 && feliz.rel.total === 5, '1b. feitos 5 de 5', `${feliz.rel.feitos}/${feliz.rel.total}`);
  check((await js("document.getElementById('campo').value")) === 'MARIA TESTE', '1c. o texto foi mesmo digitado');

  // ── 2. conferencia que nao bate para ali ────────────────────────────────
  await montar();
  const parado = await roteiro({
    passos: [
      { nome: 'marca 1', tool: 'browser_javascript', args: { codigo: "window.__marca.push(1)" } },
      { nome: 'confere impossivel', conferir: { js: "document.title === 'titulo que nao existe'", ate_ms: 800 } },
      { nome: 'marca 2', tool: 'browser_javascript', args: { codigo: "window.__marca.push(2)" } },
    ],
  });
  check(parado.erro && parado.rel.ok === false, '2. conferencia falha devolve erro');
  check(parado.rel.parou?.passo === 1 && parado.rel.parou?.motivo === 'conferencia nao bateu',
    '2b. diz o passo e o motivo', JSON.stringify(parado.rel.parou));
  check(typeof parado.rel.url === 'string' && parado.rel.url.includes('example.com'), '2c. traz a URL atual', parado.rel.url);
  check(JSON.stringify(await js('window.__marca')) === '[1]', '2d. o passo seguinte NAO rodou', JSON.stringify(await js('window.__marca')));

  // ── 3. confirm recusa tudo antes de comecar ─────────────────────────────
  await montar();
  const comConfirm = await roteiro({
    passos: [
      { nome: 'marca', tool: 'browser_javascript', args: { codigo: "window.__marca.push('x')" } },
      { nome: 'clique liberado', tool: 'browser_click', args: { ref: 1, confirm: true } },
    ],
  });
  check(comConfirm.erro && comConfirm.rel.parou?.motivo === 'roteiro invalido' && /confirm/.test(comConfirm.rel.parou.detalhe),
    '3. confirm recusa o roteiro', JSON.stringify(comConfirm.rel.parou));
  check(JSON.stringify(await js('window.__marca')) === '[]', '3b. nenhum passo rodou');

  // ── 4. tool proibida ────────────────────────────────────────────────────
  const proibida = await roteiro({ passos: [{ tool: 'browser_use_current_tab', args: {} }] });
  check(proibida.erro && /nao pode ser usada/.test(proibida.rel.parou?.detalhe ?? ''), '4. tool proibida recusada', JSON.stringify(proibida.rel.parou));

  // ── 5. o freio vale dentro do roteiro ───────────────────────────────────
  await montar();
  const freio = await roteiro({
    passos: [
      { nome: 'achar assinar', tool: 'browser_find', args: { query: 'Assinar documento' }, guardar_ref: 'refA' },
      { nome: 'clicar assinar', tool: 'browser_click', args: { ref: '{{refA}}' } },
    ],
  });
  check(freio.erro && freio.rel.parou?.passo === 1 && freio.rel.parou?.motivo === 'browser_click falhou',
    '5. clique em Assinar para o roteiro', JSON.stringify(freio.rel.parou));
  check((await js('window.__assinou === true')) === false, '5b. o botao NAO foi acionado');

  // ── 6. para_cada ────────────────────────────────────────────────────────
  await montar();
  const laco = await roteiro({
    variaveis: { itens: ['a', 'b', 'c'] },
    passos: [
      { para_cada: '{{itens}}', passos: [
        { nome: 'push', tool: 'browser_javascript', args: { codigo: "window.__marca.push('{{item}}{{indice}}')" } },
      ] },
      { nome: 'tres', conferir: { js: "window.__marca.join(',') === 'a0,b1,c2'" } },
    ],
  });
  check(!laco.erro && laco.rel.total === 4, '6. para_cada expande e roda', JSON.stringify(laco.rel));

  // ── 7. prazo e retomada ─────────────────────────────────────────────────
  await montar();
  const passosPrazo = [
    { nome: 'p0', tool: 'browser_javascript', args: { codigo: "window.__marca.push(0)" } },
    { nome: 'espera', tool: 'browser_javascript', args: { codigo: 'new Promise(r => setTimeout(() => r(1), 700))' } },
    { nome: 'p2', tool: 'browser_javascript', args: { codigo: "window.__marca.push(2)" } },
  ];
  const cortado = await roteiro({ prazo_ms: 300, passos: passosPrazo });
  check(cortado.erro && cortado.rel.parou?.motivo === 'prazo' && cortado.rel.continuar_de === 2,
    '7. prazo devolve continuar_de', JSON.stringify(cortado.rel.parou) + ' continuar_de=' + cortado.rel.continuar_de);
  const retomado = await roteiro({ a_partir_de: cortado.rel.continuar_de, passos: passosPrazo });
  check(!retomado.erro && JSON.stringify(await js('window.__marca')) === '[0,2]', '7b. a_partir_de retoma sem repetir', JSON.stringify(await js('window.__marca')));

  // ── 8. arquivo com variavel obrigatoria ─────────────────────────────────
  await montar();
  const dir = mkdtempSync(join(tmpdir(), 'roteiro-'));
  const arq = join(dir, 'teste.json');
  writeFileSync(arq, JSON.stringify({
    nome: 'roteiro de arquivo', variaveis: ['valor'],
    passos: [{ nome: 'grava', tool: 'browser_javascript', args: { codigo: "window.__marca.push('{{valor}}')" } }],
  }));
  const semVar = await roteiro({ arquivo: arq });
  check(semVar.erro && /valor/.test(semVar.rel.parou?.detalhe ?? ''), '8. arquivo sem variavel obrigatoria e recusado', JSON.stringify(semVar.rel.parou));
  const comVar = await roteiro({ arquivo: arq, variaveis: { valor: 'ok-arquivo' } });
  check(!comVar.erro && comVar.rel.roteiro === 'roteiro de arquivo' && JSON.stringify(await js('window.__marca')) === '["ok-arquivo"]',
    '8b. arquivo com variavel roda', JSON.stringify(comVar.rel));

  // ── 9. tolerar_erro: a conferencia decide, e so com conferencia ─────────
  await montar();
  const tolerado = await roteiro({
    passos: [
      { nome: 'erra', tool: 'browser_click', args: { ref: 999999 }, tolerar_erro: true,
        conferir: { js: "document.getElementById('campo') !== null" } },
      { nome: 'segue', tool: 'browser_javascript', args: { codigo: "window.__marca.push('seguiu')" } },
    ],
  });
  check(!tolerado.erro && JSON.stringify(await js('window.__marca')) === '["seguiu"]',
    '9. erro tolerado com conferencia ok segue', JSON.stringify(tolerado.rel));
  const semConferir = await roteiro({ passos: [{ tool: 'browser_click', args: { ref: 999999 }, tolerar_erro: true }] });
  check(semConferir.erro && /tolerar_erro exige conferir/.test(semConferir.rel.parou?.detalhe ?? ''),
    '9b. tolerar_erro sem conferir e recusado', JSON.stringify(semConferir.rel.parou));
  await montar();
  const toleradoFalso = await roteiro({
    passos: [{ nome: 'erra', tool: 'browser_click', args: { ref: 999999 }, tolerar_erro: true,
      conferir: { js: 'false', ate_ms: 300 } }],
  });
  check(toleradoFalso.erro && toleradoFalso.rel.parou?.motivo === 'conferencia nao bateu',
    '9c. erro tolerado com conferencia falsa PARA', JSON.stringify(toleradoFalso.rel.parou));

  // ── 10. {parar:true} para na hora; item.campo le campo do item ──────────
  await montar();
  const t10 = Date.now();
  const paraJa = await roteiro({
    passos: [{ nome: 'pede parada', conferir: { js: "({ok:false, parar:true, erro:'sem saida'})", ate_ms: 20000 } }],
  });
  check(paraJa.erro && paraJa.rel.parou?.motivo === 'conferencia pediu para parar' && Date.now() - t10 < 8000,
    '10. parar:true interrompe sem gastar o ate_ms', `${Date.now() - t10}ms ${JSON.stringify(paraJa.rel.parou)}`);
  await montar();
  const campos = await roteiro({
    variaveis: { lote: [{ nome: 'x', tipo: 'A' }, { nome: 'y', tipo: 'B' }] },
    passos: [
      { para_cada: '{{lote}}', passos: [
        { nome: 'push', tool: 'browser_javascript', args: { codigo: "window.__marca.push({{json:item.nome}}+'{{item.tipo}}')" } },
      ] },
      { nome: 'confere', conferir: { js: "window.__marca.join(',') === 'xA,yB'" } },
    ],
  });
  check(!campos.erro, '10b. {{item.campo}} e {{json:item.campo}} leem o campo do item', JSON.stringify(campos.rel));
} catch (err) {
  console.log(`FALHA erro inesperado — ${err.stack}`);
  process.exitCode = 1;
} finally {
  await c.tool('bridge_limpar', {}).catch(() => {});
  c.close();
}
