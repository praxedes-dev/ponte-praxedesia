/**
 * A extensao nao pode aparecer na leitura que ela mesma faz.
 *
 * Bug de 19/08/2026: `browser_wait_for_text {text:"Agente rodando",
 * present:false}` estourava 180s em qualquer pagina. O chip "Agente rodando" e
 * da PROPRIA extensao, e era o proprio `wait_for_text` quem mandava desenha-lo
 * (heartbeat de 10s) — a espera fabricava o texto que esperava ver sumir, e
 * ninguem apagava depois.
 *
 * Correcao: a UI da extensao vive num shadow root fechado (fora de
 * body.innerText) e quem acende/apaga e a ponte, por comando.
 *
 * Este teste tambem confere que a leitura e AO VIVO — texto que entra e sai da
 * pagina no meio da espera e visto na hora, sem cache de DOM.
 *
 *   node test/indicador.js
 */
import { startClient, esperarExtensao } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-indicador');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: nao mexe na do usuario.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_for_text', { text: 'Example Domain', timeout_ms: 20_000 });

  // ── 1. O indicador existe na tela, mas nao no texto da pagina ────────
  const visto = await c.json('browser_javascript', {
    codigo: `JSON.stringify({
      host: !!document.getElementById('praxedes-agent-ui'),
      noTexto: document.body.innerText.includes('Agente rodando'),
      noTextContent: document.body.textContent.includes('Agente rodando'),
    })`,
  });
  check(visto.host, 'o indicador visual esta na tela (o efeito continua existindo)');
  check(!visto.noTexto, 'o texto do indicador NAO entra em body.innerText');
  check(!visto.noTextContent, 'nem em body.textContent');

  // ── 2. O bug em si: esperar o proprio chip sumir nao pode travar ─────
  const t0 = Date.now();
  const espera = await c.json('browser_wait_for_text', {
    text: 'Agente rodando',
    present: false,
    timeout_ms: 30_000,
  });
  check(!espera.timedOut, 'esperar "Agente rodando" sumir termina em vez de estourar',
    `${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ── 3. Leitura ao vivo: texto que aparece durante a espera e visto ───
  await c.tool('browser_javascript', {
    codigo: `(function () {
      setTimeout(function () {
        var p = document.createElement('p');
        p.id = 'marcador-teste';
        p.textContent = 'PROCESSANDO-XYZ';
        document.body.appendChild(p);
      }, 4000);
      return 'agendado';
    })()`,
  });
  const apareceu = await c.json('browser_wait_for_text', {
    text: 'PROCESSANDO-XYZ',
    present: true,
    timeout_ms: 30_000,
  });
  check(!apareceu.timedOut, 've o texto que ENTROU na pagina durante a espera');

  // ── 4. E o que sai da pagina tambem, sem cache de DOM ────────────────
  await c.tool('browser_javascript', {
    codigo: `(function () {
      setTimeout(function () {
        var el = document.getElementById('marcador-teste');
        if (el) el.remove();
      }, 4000);
      return 'agendado';
    })()`,
  });
  const sumiu = await c.json('browser_wait_for_text', {
    text: 'PROCESSANDO-XYZ',
    present: false,
    timeout_ms: 30_000,
  });
  check(!sumiu.timedOut, 've o texto que SAIU da pagina durante a espera');
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
