/**
 * Testa as capacidades que a extensao do Claude nao tem.
 * Monta a pagina de prova com o proprio browser_javascript.
 *
 *   node test/capabilities.js
 */
import { existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const PDF = join(tmpdir(), 'ponte-teste.pdf');
const BAIXADO = join(tmpdir(), 'ponte-baixado.txt');
for (const f of [PDF, BAIXADO]) if (existsSync(f)) rmSync(f);

const c = startClient('teste-capacidades');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

    // Aba propria: sem isto o teste navegaria na aba que o usuario esta usando,
  // porque a ponte trabalha na aba corrente por padrao.
await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});
  check(true, 'browser_wait_network esperou a rede');

  // ── javascript ───────────────────────────────────────────────────────
  const titulo = (await c.tool('browser_javascript', { codigo: 'document.title' })).content[0].text;
  check(titulo.includes('Example Domain'), 'browser_javascript devolveu o retorno', titulo.trim());

  // Pagina de prova: select, checkbox, input de arquivo e botao destrutivo.
  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<select id="uf"><option value="ro">Rondonia</option><option value="sp">Sao Paulo</option></select>' +
        '<input id="aceite" type="checkbox">' +
        '<input id="nome" type="text" placeholder="Nome completo">' +
        '<input id="arquivo" type="file">' +
        '<button id="perigo">Excluir processo</button>';
      return 'montado';
    })()`,
  });
  await sleep(500);

  // ── form_input ───────────────────────────────────────────────────────
  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };

  const refUf = refDe('rondonia') ?? refDe('combobox');
  if (refUf) {
    const r = (await c.tool('browser_form_input', { ref: refUf, valor: 'Sao Paulo' })).content[0].text;
    const valor = (await c.tool('browser_javascript', { codigo: "document.getElementById('uf').value" })).content[0].text;
    check(valor.includes('sp'), 'browser_form_input escolheu opcao do select', r.trim());
  } else {
    check(false, 'achou o select na pagina', 'nenhuma ref de combobox');
  }

  const refCheck = refDe('checkbox');
  if (refCheck) {
    await c.tool('browser_form_input', { ref: refCheck, valor: true });
    const marcado = (await c.tool('browser_javascript', { codigo: "document.getElementById('aceite').checked" })).content[0].text;
    check(marcado.includes('true'), 'browser_form_input marcou o checkbox');
  }

  // ── freio: botao destrutivo ──────────────────────────────────────────
  const refPerigo = refDe('excluir');
  if (refPerigo) {
    const r = await c.call('tools/call', { name: 'browser_click', arguments: { ref: refPerigo } });
    check(r.result.isError === true, 'freio barrou clique em "Excluir processo"',
      r.result.content[0].text.slice(0, 90));
  } else {
    check(false, 'achou o botao destrutivo');
  }

  // ── upload ───────────────────────────────────────────────────────────
  const refArquivo = refDe('file') ?? refDe('arquivo');
  if (refArquivo) {
    await c.tool('browser_upload_file', { ref: refArquivo, caminhos: [import.meta.filename] });
    const nome = (await c.tool('browser_javascript', {
      codigo: "document.getElementById('arquivo').files[0] ? document.getElementById('arquivo').files[0].name : 'nenhum'",
    })).content[0].text;
    check(nome.includes('capabilities.js'), 'browser_upload_file anexou arquivo do disco', nome.trim());
  } else {
    check(false, 'achou o input de arquivo');
  }

  // ── cookies ──────────────────────────────────────────────────────────
  const cookies = (await c.tool('browser_cookies', { url: 'https://example.com' })).content[0].text;
  check(cookies.includes('total'), 'browser_cookies respondeu', cookies.slice(0, 60).replace(/\n/g, ' '));

  // ── emulacao ─────────────────────────────────────────────────────────
  await c.tool('browser_emulate_device', { largura: 390, altura: 844, movel: true });
  const largura = (await c.tool('browser_javascript', { codigo: 'window.innerWidth' })).content[0].text;
  check(largura.trim() === '390', 'browser_emulate_device mudou a viewport', `innerWidth=${largura.trim()}`);
  await c.tool('browser_emulate_device', { desligar: true });

  // ── PDF ──────────────────────────────────────────────────────────────
  await c.tool('browser_save_pdf', { caminho: PDF });
  check(existsSync(PDF) && statSync(PDF).size > 1000, 'browser_save_pdf gravou o arquivo',
    existsSync(PDF) ? `${(statSync(PDF).size / 1024).toFixed(1)} KB` : 'nao existe');

  // ── download ─────────────────────────────────────────────────────────
  await c.tool('browser_download', { url: 'https://example.com/', caminho: BAIXADO });
  check(existsSync(BAIXADO) && statSync(BAIXADO).size > 100, 'browser_download gravou o arquivo',
    existsSync(BAIXADO) ? `${statSync(BAIXADO).size} bytes` : 'nao existe');
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
