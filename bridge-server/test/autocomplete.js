/**
 * Obra 06 — autocomplete-richfaces (docs/obra-20260904/06-autocomplete-richfaces.md).
 *
 * Pagina de prova que imita o suggest do RichFaces: o campo so mostra a lista
 * de sugestoes 200ms depois de uma tecla de VERDADE (o `onchange` que ignora
 * valor colado — "if (this.value != '') return false" — e o motivo pelo qual
 * a skill protocolo-pje-ponte precisava da gambiarra que esta obra aposenta).
 * A linha de sugestao e um <td> dentro de <tr> (sem `ref` na arvore de
 * acessibilidade — achado do pedreiro da 02, plano §18), entao so o clique por
 * coordenada resolve.
 *
 *   node test/autocomplete.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-autocomplete');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  // Widget falso, fiel ao RichFaces: <tr class="rich-sb-int"> dentro de uma
  // tabela, montado 200ms depois do keydown, filtrando por prefixo. Uma
  // sugestao "especial" so aceita evento SINTETICO (aceita = !isTrusted) —
  // o oposto de toda linha normal — para provar o caso 3 do criterio de pronto.
  await c.tool('browser_javascript', {
    codigo: `(function () {
      document.body.innerHTML =
        '<input id="cep" type="text" aria-label="Campo de CEP">' +
        '<div id="sug"><table><tbody></tbody></table></div>';
      var input = document.getElementById('cep');
      var tbody = document.querySelector('#sug tbody');
      var cidades = ['Porto Velho', 'Presidente Medici', 'Pimenta Bueno'];
      window.__eventos = [];

      function normalizar(s) {
        return String(s).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
      }

      function montarLista(valor) {
        tbody.innerHTML = '';
        var pref = normalizar(valor || '');
        var candidatos;
        if (!pref) {
          candidatos = [];
        } else if (pref === 'z') {
          candidatos = ['Zona Rural (so evento sintetico)'];
        } else if (pref === 'e') {
          // Buraco 1 (auditoria): sugestao com texto destrutivo — o freio
          // (policy.ts, TEXTOS_DESTRUTIVOS) tem de bloquear a escolha ANTES
          // do clique de verdade. Clique real, igual a qualquer cidade normal.
          candidatos = ['Excluir conta'];
        } else if (pref === 'm') {
          // Buraco 2 (auditoria): so bate por startsWith (tem sufixo, nunca
          // e igualdade exata) E exige normalizacao (o "escolher" do caso vem
          // com acento/caixa que este texto nao tem).
          candidatos = ['Presidente Medici - Zona Central'];
        } else {
          candidatos = cidades.filter(function (c) { return normalizar(c).indexOf(pref) === 0; });
        }
        candidatos.forEach(function (nome) {
          var tr = document.createElement('tr');
          tr.className = 'rich-sb-int';
          tr.textContent = nome;
          var especial = nome.indexOf('sintetico') !== -1;
          function selecionar(e) {
            var aceita = especial ? !e.isTrusted : e.isTrusted;
            window.__eventos.push({ tipo: e.type, isTrusted: e.isTrusted, nome: nome, aceita: aceita });
            if (!aceita) return;
            input.value = nome;
            tbody.innerHTML = '';
          }
          tr.addEventListener('mousedown', selecionar);
          tr.addEventListener('click', selecionar);
          tbody.appendChild(tr);
        });
      }

      // O coracao do defeito real do PJe: valor colado nunca dispara o ciclo.
      // A tool nunca chama isto — so digita tecla a tecla — mas o widget
      // fica fiel ao comportamento real mesmo assim.
      input.onchange = function () { if (this.value !== '') return false; };
      input.addEventListener('keydown', function () {
        setTimeout(function () { montarLista(input.value); }, 200);
      });
      return 'montado';
    })()`,
  });
  await sleep(200);

  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refDe = (rotulo) => {
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  const refCep = refDe('Campo de CEP');
  check(Boolean(refCep), `achou o campo de CEP (ref ${refCep})`);

  // Reseta valor E lista entre casos: um clique recusado (caso 3) nao limpa a
  // tabela de sugestoes (so uma selecao aceita limpa, fiel ao widget real), e
  // um leftover ali confundiria o proximo caso com uma sugestao que nao e dele.
  const limpar = () => c.tool('browser_javascript', {
    codigo: "document.getElementById('cep').value = ''; document.querySelector('#sug tbody').innerHTML = '';",
  });

  // ── 1. com acento, normaliza e escolhe certo ──────────────────────────
  const r1 = await c.json('browser_autocomplete', { ref: refCep, texto: 'P', escolher: 'presidente médici' });
  check(r1.lido === 'Presidente Medici', '1. lido bate com a sugestao (acento normalizado)', `lido="${r1.lido}"`);
  check(r1.escolhida === 'Presidente Medici', '1. escolhida correta', r1.escolhida);
  const tresVistas = ['Porto Velho', 'Presidente Medici', 'Pimenta Bueno']
    .every((nome) => r1.sugestoes_vistas.includes(nome));
  check(tresVistas, '1. sugestoes_vistas trouxe as tres', JSON.stringify(r1.sugestoes_vistas));

  // ── 2. timeout sem candidato bate com "escolher": erro lista o que viu ─
  await limpar();
  const chamada2 = await c.call('tools/call', {
    name: 'browser_autocomplete',
    arguments: { ref: refCep, texto: 'P', escolher: 'Ji-Parana', timeout_ms: 1500 },
  });
  const texto2 = chamada2.result?.content?.[0]?.text ?? '';
  check(chamada2.result?.isError === true, '2. timeout sem candidato para "Ji-Parana" da erro', texto2.slice(0, 90));
  check(
    texto2.includes('Porto Velho') && texto2.includes('Presidente Medici') && texto2.includes('Pimenta Bueno'),
    '2. erro lista as sugestoes vistas',
    texto2.slice(0, 140),
  );

  // ── 3. sugestao que so aceita evento sintetico: clique real nao pega ───
  await limpar();
  const chamada3 = await c.call('tools/call', {
    name: 'browser_autocomplete',
    arguments: { ref: refCep, texto: 'Z', escolher: 'zona rural' },
  });
  const texto3 = chamada3.result?.content?.[0]?.text ?? '';
  check(chamada3.result?.isError === true, '3. sugestao so-sintetica recusa o clique real', texto3.slice(0, 90));
  check(texto3.includes('a selecao nao pegou'), '3. mensagem nomeia "a selecao nao pegou"', texto3.slice(0, 140));

  // ── 4. seletor_sugestoes explicito funciona igual ao padrao ───────────
  await limpar();
  const r4 = await c.json('browser_autocomplete', {
    ref: refCep, texto: 'P', escolher: 'Pimenta Bueno', seletor_sugestoes: '#sug tr',
  });
  check(r4.lido === 'Pimenta Bueno', '4. seletor_sugestoes explicito escolheu certo', `lido="${r4.lido}"`);

  // ── 5. limpar: true apaga o que ja estava no campo antes de digitar ───
  // Campo com lixo (sem lista de sugestao pendurada, ao contrario do caso 3):
  // se o Ctrl+A+Backspace nao limpasse de verdade, o "P" digitado viraria
  // "LIXOP" e nenhuma sugestao bateria com "Porto Velho".
  await c.tool('browser_javascript', { codigo: "document.getElementById('cep').value = 'LIXO'" });
  const r5 = await c.json('browser_autocomplete', {
    ref: refCep, texto: 'P', escolher: 'Porto Velho', limpar: true,
  });
  check(r5.lido === 'Porto Velho', '5. limpar:true apagou o "LIXO" antes de digitar', `lido="${r5.lido}"`);

  // ── 6. buraco 1 (o mais grave): sugestao destrutiva tem de ser BLOQUEADA ─
  // Sem este caso, ninguem nunca exercitou o ramo "bloqueado" de avaliar() —
  // um cetico neutralizou o freio (`if (!veredito.permitido) throw` virou
  // `if (false && !veredito.permitido) throw`) e os outros 10 checks
  // continuaram verdes, porque nenhum usava sugestao com texto destrutivo.
  await limpar();
  const chamada6 = await c.call('tools/call', {
    name: 'browser_autocomplete',
    arguments: { ref: refCep, texto: 'E', escolher: 'Excluir conta' },
  });
  const texto6 = chamada6.result?.content?.[0]?.text ?? '';
  check(chamada6.result?.isError === true, '6. escolha destrutiva ("Excluir conta") e bloqueada pelo freio', texto6.slice(0, 160));
  check(texto6.includes('[bloqueado]') && texto6.toLowerCase().includes('excluir'), '6. mensagem nomeia o bloqueio e o gatilho', texto6.slice(0, 160));

  // ── 7. buraco 2: so bate por startsWith E precisa de normalizacao ──────
  // "Presidente Medici - Zona Central" nunca bate por igualdade exata (tem
  // sufixo); so pelo startsWith. E o "escolher" chega com acento e caixa
  // diferentes da sugestao — sem normalizar ALVO (nao o "escolher" cru) nas
  // linhas startsWith/includes, escolherMelhorCandidato nao acha nada e a
  // chamada estoura em timeout.
  await limpar();
  const r7 = await c.json('browser_autocomplete', {
    ref: refCep, texto: 'M', escolher: 'Presidente Médici', timeout_ms: 3000,
  });
  check(r7.lido === 'Presidente Medici - Zona Central', '7. bate via startsWith com normalizacao de acento/caixa', `lido="${r7.lido}"`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
