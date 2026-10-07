/**
 * Obra 05 — upload em lote que nao mente.
 * docs/obra-20260904/05-upload-em-lote-que-nao-mente.md
 *
 * Nao da para testar contra o PJe real (exige sessao e processo, e nao se
 * testa em processo de verdade). A pagina de prova imita o Dropzone dele:
 *
 *   - input[type=file][multiple] com opacity:0 (como no PJe real).
 *   - a cada `change`, cria um .dz-preview por arquivo ACEITO — e RECUSA EM
 *     SILENCIO (sem criar preview, sem erro, sem evento) todo nome >= 80
 *     caracteres, exatamente como o incidente que a obra existe para matar.
 *   - o PRIMEIRO preview tem um <script> vazio antes do nome dentro do
 *     [data-dz-name] (a sujeira real do template do Dropzone) — testa que a
 *     capacidade le a ULTIMA linha, nao o texto inteiro.
 *   - cada preview carrega um input[id$=":descDoc"] com o nome (o campo que o
 *     PJe realmente grava) e os dois marcadores (.dz-success-mark e
 *     .dz-error-mark) com opacity:0, para provar que so a opacity decide.
 *
 * Tres buracos fechados nesta rodada (mutation-tested, ver relatorio):
 *
 *   6. Limiar exato do nome comprido: 80 caracteres tem de ser RECUSADO pelo
 *      pre-voo, 79 tem de PASSAR. O unico nome comprido de antes (85) nunca
 *      testou a fronteira — trocar o `>=` do pre-voo por `>` nao quebrava
 *      nada.
 *   7. Comparacao POSICIONAL, nao por conjunto: pagina de prova propria
 *      (PAGINA_JS_TROCA) que devolve os MESMOS nomes em ORDEM TROCADA — prova
 *      que a capacidade marca isso como falha (o comentario do proprio codigo
 *      diz que e para isto que a posicao existe), coisa que uma comparacao
 *      por multiset/indexOf deixaria passar batido.
 *   8. Input recriado ENTRE LOTES da MESMA chamada (PAGINA_JS_RECRIA): quem
 *      cachear o nodeId do input fora do loop (em vez de reachar por seletor
 *      a cada lote) aponta pro elemento morto no 2o lote em diante — a mesma
 *      classe de falha do incidente (CLIENTE A/CLIENTE B) que a obra existe para
 *      matar.
 *
 *   node test/upload-lote.js
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

// ── arquivos de prova ──────────────────────────────────────────────────────
const DIR = join(tmpdir(), 'ponte-upload-lote');
if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const caminhoDe = (nome) => join(DIR, nome);
const nomeCurto = (i) => `doc-${String(i).padStart(2, '0')}.txt`;
const nomeLongo = `${'x'.repeat(81)}.pdf`; // 85 caracteres — medido na skill: 89 falhou, 57 passou
check(nomeLongo.length === 85, 'nome de prova (comprido) tem exatamente 85 caracteres', `len=${nomeLongo.length}`);

const curtos = Array.from({ length: 12 }, (_, i) => nomeCurto(i + 1));
for (const nome of curtos) writeFileSync(caminhoDe(nome), `conteudo de ${nome}`);
writeFileSync(caminhoDe(nomeLongo), 'conteudo do arquivo de nome comprido');

// O comprido na 6a posicao: o 1o lote (tamanho 10) fica com 5 curtos + o
// comprido + 4 curtos = 10; o 2o lote (3 curtos) so existiria DEPOIS — prova
// que "os posteriores" ficam marcados como nao enviados quando o 1o falha.
const listaComLongo = [...curtos.slice(0, 5), nomeLongo, ...curtos.slice(5)];
check(listaComLongo.length === 13, 'lista de prova (com o comprido) tem 13 arquivos');

// ── pagina de prova: Dropzone do PJe, imitado ───────────────────────────────
const PAGINA_JS = `(function(){
  document.body.innerHTML =
    '<input id="upload" type="file" multiple style="opacity:0">' +
    '<div id="lista"></div>';

  var input = document.getElementById('upload');
  var lista = document.getElementById('lista');
  window.__contadorPreview = 0;

  input.addEventListener('change', function () {
    var arquivos = Array.prototype.slice.call(input.files);
    arquivos.forEach(function (f) {
      // Recusa EM SILENCIO nome >= 80 caracteres — sem erro, sem evento, o
      // arquivo so nunca aparece na lista. E o defeito real do PJe.
      if (f.name.length >= 80) return;

      var idx = window.__contadorPreview++;
      var preview = document.createElement('div');
      preview.className = 'dz-preview';

      var nomeEl = document.createElement('div');
      nomeEl.setAttribute('data-dz-name', '');
      if (idx === 0) {
        // Sujeira real do template do Dropzone: um <script> antes do nome,
        // so no PRIMEIRO preview.
        nomeEl.innerHTML = '<script></script>';
        nomeEl.appendChild(document.createTextNode('\\n' + f.name));
      } else {
        nomeEl.textContent = f.name;
      }
      preview.appendChild(nomeEl);

      var descDoc = document.createElement('input');
      descDoc.type = 'hidden';
      descDoc.id = 'formAnexo:j_id' + idx + ':descDoc';
      descDoc.value = f.name;
      preview.appendChild(descDoc);

      var okMark = document.createElement('span');
      okMark.className = 'dz-success-mark';
      okMark.style.opacity = '0';
      preview.appendChild(okMark);

      var errMark = document.createElement('span');
      errMark.className = 'dz-error-mark';
      errMark.style.opacity = '0';
      preview.appendChild(errMark);

      lista.appendChild(preview);
    });
  });

  return 'montado';
})()`;

const c = startClient('teste-upload-lote');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: sem isto o teste anexaria arquivo na aba do usuario.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  const montarPagina = async () => {
    await c.tool('browser_javascript', { codigo: PAGINA_JS });
    await sleep(200);
  };
  const contarPreviews = async () => Number(
    (await c.tool('browser_javascript', { codigo: "document.querySelectorAll('.dz-preview').length" }))
      .content[0].text.trim(),
  );

  // ── 1. 12 arquivos, tamanho_lote 10 -> 2 lotes, todos entram, na ordem ────
  await montarPagina();
  {
    const r = await c.tool('browser_upload_batch', {
      caminhos: curtos.map(caminhoDe),
      tamanho_lote: 10,
      timeout_lote_ms: 5000,
    });
    const relatorio = JSON.parse(r.content[0].text);
    check(relatorio.total === 12 && relatorio.entraram === 12, 'lote 1: 12 de 12 arquivos entraram',
      `total=${relatorio.total} entraram=${relatorio.entraram}`);
    check(relatorio.lotes === 2, 'lote 1: dividiu em 2 lotes (tamanho_lote=10)', `lotes=${relatorio.lotes}`);
    check(relatorio.arquivos.every((a) => a.entrou === true), 'lote 1: todo item veio com entrou:true');
    check(relatorio.arquivos.map((a) => a.nome).join(',') === curtos.join(','),
      'lote 1: ordem dos nomes preservada', relatorio.arquivos.map((a) => a.nome).join(','));
    check(relatorio.parou_no_lote === undefined, 'lote 1: sem parou_no_lote (nada falhou)');
    check(typeof relatorio.proximo_passo === 'string' && relatorio.proximo_passo.length > 0,
      'lote 1: devolveu proximo_passo em portugues');
  }

  // ── 2. nome >= 80 caracteres -> pre-voo BARRA antes de anexar qualquer coisa
  await montarPagina();
  {
    const antes = await contarPreviews();
    const resp = await c.call('tools/call', {
      name: 'browser_upload_batch',
      arguments: { caminhos: listaComLongo.map(caminhoDe), tamanho_lote: 10, timeout_lote_ms: 2000 },
    });
    const texto = resp.result?.content?.[0]?.text ?? '';
    check(resp.result?.isError === true, 'lote 2: pre-voo devolve isError antes de tentar anexar',
      texto.slice(0, 90));
    check(texto.includes(nomeLongo) && texto.includes('80'), 'lote 2: erro lista o nome comprido e o limiar',
      texto.slice(0, 140));
    const depois = await contarPreviews();
    check(depois === antes && depois === 0, 'lote 2: nenhum .dz-preview foi criado (nada foi anexado)',
      `antes=${antes} depois=${depois}`);
  }

  // ── 3. mesmo caso, forcar:true -> isError com relatorio: o comprido falha,
  //      o lote para, e o 2o lote (nunca enviado) vem marcado como tal ───────
  await montarPagina();
  {
    const resp = await c.call('tools/call', {
      name: 'browser_upload_batch',
      arguments: {
        caminhos: listaComLongo.map(caminhoDe), tamanho_lote: 10, timeout_lote_ms: 2000, forcar: true,
      },
    });
    check(resp.result?.isError === true, 'lote 3 (forcar): devolve isError (nao "ok" com relatorio parcial)');
    const relatorio = JSON.parse(resp.result?.content?.[0]?.text ?? '{}');
    check(relatorio.parou_no_lote === 1, 'lote 3: parou no 1o lote (onde esta o nome comprido)',
      `parou_no_lote=${relatorio.parou_no_lote}`);
    check(relatorio.total === 13 && relatorio.arquivos?.length === 13, 'lote 3: relatorio cobre os 13 arquivos');

    const doLongo = relatorio.arquivos?.find((a) => a.nome === nomeLongo);
    check(Boolean(doLongo) && doLongo.entrou === false, 'lote 3: o arquivo comprido veio com entrou:false',
      JSON.stringify(doLongo));

    const curtosDoLote1 = relatorio.arquivos?.filter((a) => a.nome !== nomeLongo).slice(0, 9) ?? [];
    check(curtosDoLote1.length === 9 && curtosDoLote1.every((a) => a.entrou === true),
      'lote 3: os 9 curtos do 1o lote entraram (o comprido nao desalinhou os outros)',
      curtosDoLote1.map((a) => `${a.nome}:${a.entrou}`).join(' '));

    const doLote2 = relatorio.arquivos?.slice(10);
    check(doLote2?.length === 3 && doLote2.every((a) => a.entrou === false && /nao enviado/.test(a.motivo ?? '')),
      'lote 3: os 3 arquivos do 2o lote (nunca enviado) vem marcados "nao enviado"',
      JSON.stringify(doLote2));

    check(relatorio.entraram === 9, 'lote 3: contagem "entraram" bate (9 de 13)', `entraram=${relatorio.entraram}`);
  }

  // ── 4. browser_upload_verify le a opacity, nao offsetParent ───────────────
  await montarPagina();
  {
    const tres = curtos.slice(0, 3);
    await c.tool('browser_upload_batch', { caminhos: tres.map(caminhoDe), tamanho_lote: 10, timeout_lote_ms: 5000 });

    await c.tool('browser_javascript', {
      codigo: `(function(){
        var itens = document.querySelectorAll('.dz-preview');
        itens[0].querySelector('.dz-success-mark').style.opacity = '1';
        itens[1].querySelector('.dz-success-mark').style.opacity = '1';
        return itens.length;
      })()`,
    });

    const v1 = await c.json('browser_upload_verify', {});
    check(Array.isArray(v1) && v1.length === 3, 'verify: devolveu os 3 itens', JSON.stringify(v1));
    check(v1[0]?.ok === true && v1[1]?.ok === true && v1[2]?.ok === false,
      'verify: 2 com opacity 1 -> ok:true, 1 com opacity 0 -> ok:false', JSON.stringify(v1));
    check(v1.every((x, i) => x.nome === tres[i]), 'verify: nome de cada item bate com o esperado (via descDoc)',
      v1.map((x) => x.nome).join(','));

    // dz-error-mark visivel no lugar do sucesso: o item continua ok:false —
    // so a opacity do SUCCESS-mark decide, os dois convivem no mesmo lugar.
    await c.tool('browser_javascript', {
      codigo: `(function(){
        document.querySelectorAll('.dz-preview')[2].querySelector('.dz-error-mark').style.opacity = '1';
        return 'ok';
      })()`,
    });
    const v2 = await c.json('browser_upload_verify', {});
    check(v2[2]?.ok === false, 'verify: dz-error-mark visivel nao vira ok:true (so o success-mark decide)',
      JSON.stringify(v2[2]));
  }

  // ── 5. caminho inexistente -> erro do SERVIDOR, antes de chegar na extensao
  {
    const inexistente = join(DIR, `nao-existe-${Date.now()}.txt`);
    const resp = await c.call('tools/call', {
      name: 'browser_upload_batch',
      arguments: { caminhos: [inexistente] },
    });
    const mensagem = resp.error?.message ?? resp.result?.content?.[0]?.text ?? '';
    const eErro = Boolean(resp.error) || resp.result?.isError === true;
    check(eErro && /nao encontrado/i.test(mensagem), 'lote 5: caminho inexistente falha no servidor',
      mensagem.slice(0, 120));
  }

  // ── 6. limiar exato: 80 caracteres e RECUSADO pelo pre-voo, 79 PASSA ──────
  //      (mutation: trocar o `>=` do filtro de compridos por `>` deixa o de
  //      80 passar direto — este caso e o que fica vermelho.)
  await montarPagina();
  {
    const nome80 = `${'z'.repeat(76)}.pdf`; // 76 + 4 = 80
    const nome79 = `${'z'.repeat(75)}.pdf`; // 75 + 4 = 79
    check(nome80.length === 80, 'limiar: nome de prova tem exatamente 80 caracteres', `len=${nome80.length}`);
    check(nome79.length === 79, 'limiar: nome de prova tem exatamente 79 caracteres', `len=${nome79.length}`);
    writeFileSync(caminhoDe(nome80), 'conteudo do arquivo de 80 caracteres');
    writeFileSync(caminhoDe(nome79), 'conteudo do arquivo de 79 caracteres');

    const antes80 = await contarPreviews();
    const resp80 = await c.call('tools/call', {
      name: 'browser_upload_batch',
      arguments: { caminhos: [caminhoDe(nome80)], tamanho_lote: 10, timeout_lote_ms: 1500 },
    });
    const texto80 = resp80.result?.content?.[0]?.text ?? '';
    check(resp80.result?.isError === true, 'limiar: nome com EXATOS 80 caracteres e recusado', texto80.slice(0, 140));
    check(texto80.includes('[pre-voo]'), 'limiar: a recusa de 80 caracteres vem do PRE-VOO (nao de timeout depois)',
      texto80.slice(0, 60));
    check(texto80.includes(nome80) && texto80.includes('80 chars'), 'limiar: a mensagem cita o nome e "80 chars"',
      texto80.slice(0, 220));
    const depois80 = await contarPreviews();
    check(depois80 === antes80, 'limiar: nada foi anexado para o nome de 80 caracteres (pre-voo barrou antes)',
      `antes=${antes80} depois=${depois80}`);

    const relatorio79 = JSON.parse((await c.tool('browser_upload_batch', {
      caminhos: [caminhoDe(nome79)], tamanho_lote: 10, timeout_lote_ms: 5000,
    })).content[0].text);
    check(relatorio79.total === 1 && relatorio79.entraram === 1, 'limiar: nome com EXATOS 79 caracteres passa e entra',
      JSON.stringify(relatorio79));
    check(relatorio79.parou_no_lote === undefined, 'limiar: 79 caracteres nao para em lote nenhum');
  }

  // ── 7. TROCA de posicao: mesmos nomes, mesma quantidade, ordem diferente —
  //      a comparacao tem de ser POSICIONAL e acusar isso como falha, nunca
  //      "por conjunto" (que diria que esta tudo bem so por contar igual).
  //      (mutation: compararEmOrdem por indexOf/multiset deixa passar como
  //      2 de 2 -- este caso fica vermelho.)
  {
    const nomeX = 'troca-x.txt';
    const nomeY = 'troca-y.txt';
    writeFileSync(caminhoDe(nomeX), 'x');
    writeFileSync(caminhoDe(nomeY), 'y');

    // Pagina de prova PROPRIA: devolve os previews na ordem INVERTIDA da que
    // os arquivos chegaram no <input> — simula "um sumiu e outro entrou no
    // lugar" sem fazer nenhum nome sumir de fato (mesmo total, mesmos nomes).
    await c.tool('browser_javascript', {
      codigo: `(function(){
        document.body.innerHTML =
          '<input id="upload" type="file" multiple style="opacity:0">' +
          '<div id="lista"></div>';
        var input = document.getElementById('upload');
        var lista = document.getElementById('lista');
        input.addEventListener('change', function () {
          var arquivos = Array.prototype.slice.call(input.files).reverse();
          arquivos.forEach(function (f) {
            var preview = document.createElement('div');
            preview.className = 'dz-preview';
            var nomeEl = document.createElement('div');
            nomeEl.setAttribute('data-dz-name', '');
            nomeEl.textContent = f.name;
            preview.appendChild(nomeEl);
            lista.appendChild(preview);
          });
        });
        return 'montado (ordem invertida)';
      })()`,
    });
    await sleep(200);

    const resp = await c.call('tools/call', {
      name: 'browser_upload_batch',
      arguments: { caminhos: [caminhoDe(nomeX), caminhoDe(nomeY)], tamanho_lote: 10, timeout_lote_ms: 1500 },
    });
    check(resp.result?.isError === true,
      'troca: pagina que devolve os 2 nomes em ORDEM TROCADA e tratada como FALHA (posicional, nao conjunto)',
      resp.result?.content?.[0]?.text?.slice(0, 200));

    const relatorio = JSON.parse(resp.result?.content?.[0]?.text ?? '{}');
    const doX = relatorio.arquivos?.find((a) => a.nome === nomeX);
    const doY = relatorio.arquivos?.find((a) => a.nome === nomeY);
    check(doX?.entrou === false, 'troca: o 1o nome esperado (x) veio com entrou:false (nao bateu na posicao 0)',
      JSON.stringify(doX));
    check(doY?.entrou === true, 'troca: o 2o nome esperado (y) veio com entrou:true (bateu quando o ponteiro chegou nele)',
      JSON.stringify(doY));
    check(relatorio.entraram === 1, 'troca: contagem "entraram" bate com 1 (NAO conta por conjunto/presenca)',
      `entraram=${relatorio.entraram}`);
  }

  // ── 8. input DESTRUIDO E RECRIADO entre lotes da MESMA chamada — quem
  //      cacheia o nodeId fora do loop (em vez de reachar por seletor a cada
  //      lote) aponta pro elemento morto no 2o lote em diante.
  //      (mutation: cachear nodeId numa variavel local reusada entre lotes
  //      faz este caso ficar vermelho.)
  {
    await c.tool('browser_javascript', {
      codigo: `(function(){
        document.body.innerHTML =
          '<input id="upload" type="file" multiple style="opacity:0">' +
          '<div id="lista"></div>';
        var lista = document.getElementById('lista');
        function onChange(ev) {
          var alvo = ev.target;
          var arquivos = Array.prototype.slice.call(alvo.files);
          arquivos.forEach(function (f) {
            var preview = document.createElement('div');
            preview.className = 'dz-preview';
            var nomeEl = document.createElement('div');
            nomeEl.setAttribute('data-dz-name', '');
            nomeEl.textContent = f.name;
            preview.appendChild(nomeEl);
            lista.appendChild(preview);
          });
          // O coracao do teste: como frameworks reais (Dropzone/RichFaces no
          // PJe), o input e DESTRUIDO e RECRIADO a cada lote. O antigo fica
          // sem listener (morto de vez) -- quem guardou o nodeId dele aponta
          // pra um elemento que nunca mais recebe nada.
          var novo = document.createElement('input');
          novo.id = 'upload'; novo.type = 'file'; novo.multiple = true; novo.style.opacity = '0';
          alvo.replaceWith(novo);
          alvo.removeEventListener('change', onChange);
          novo.addEventListener('change', onChange);
        }
        document.getElementById('upload').addEventListener('change', onChange);
        return 'montado (input recria a cada lote)';
      })()`,
    });
    await sleep(200);

    const nomesRecria = Array.from({ length: 4 }, (_, i) => `recria-${i + 1}.txt`);
    for (const nome of nomesRecria) writeFileSync(caminhoDe(nome), `conteudo de ${nome}`);

    const resp = await c.call('tools/call', {
      name: 'browser_upload_batch',
      arguments: { caminhos: nomesRecria.map(caminhoDe), tamanho_lote: 2, timeout_lote_ms: 2000 },
    });
    const texto = resp.result?.content?.[0]?.text ?? resp.error?.message ?? '';
    let relatorio = null;
    try { relatorio = JSON.parse(texto); } catch { /* mensagem de erro nao-JSON: relatorio fica null */ }
    const tudoEntrou = resp.result?.isError !== true && relatorio?.total === 4 && relatorio?.entraram === 4;
    check(tudoEntrou,
      'input recriado entre lotes: os 4 arquivos entram (a capacidade reacha o input a cada lote, nunca reusa nodeId)',
      relatorio ? JSON.stringify(relatorio) : texto.slice(0, 200));
    check(tudoEntrou && relatorio.lotes === 2, 'input recriado entre lotes: dividiu em 2 lotes de 2 (tamanho_lote=2)',
      `lotes=${relatorio?.lotes}`);
    check(tudoEntrou && relatorio.parou_no_lote === undefined, 'input recriado entre lotes: nao parou em lote nenhum');
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
  falhou = true;
} finally {
  c.close();
  if (!falhou) console.log('\nTODOS OS TESTES PASSARAM');
}
