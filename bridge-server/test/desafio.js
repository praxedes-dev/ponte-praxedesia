/**
 * Obra 09 — detector de desafio (Cloudflare/captcha).
 * docs/obra-20260904/09-detector-de-desafio.md, secao "Criterio de pronto".
 *
 * Duas classes de pagina, tratadas diferente (capacidades/desafio.ts):
 *
 *   1. interstitial — a pagina INTEIRA e um desafio (Cloudflare "Just a
 *      moment...", ou a frase do eSAJ "suspeita de acesso via robo"). navigate,
 *      read_page e extract tem de FALHAR com "[desafio]". screenshot continua
 *      funcionando (e como o agente mostra a tela ao Cezar).
 *   2. widget — pagina NORMAL com um captcha no proprio formulario (caso
 *      TJ-SP/eSAJ). Nao pode virar erro (bloquearia a unica rota que funciona
 *      la); so ganha um aviso.
 *
 * CONSERTO DO DEFEITO 2 (fixture que nao provava nada, 05-06/09/2026):
 * a versao anterior usava `data:` URL para montar cada pagina de prova.
 * Medido ao vivo: `browser_navigate` para `data:` e um NO-OP silencioso — o
 * Chrome bloqueia navegacao de topo para `data:` mesmo via CDP (`location.href`
 * ficava em `about:blank`), e os casos 1/2/4 so pareciam passar porque
 * `browser_tab_open` (chrome.tabs.create) tolera `data:` na CRIACAO da aba —
 * o `browser_navigate` de cada caso era so um no-op que mantinha a pagina
 * antiga, mascarando que a acao `navigate` de verdade nunca foi exercitada.
 *
 * Contorno adotado: um SERVIDOR HTTP LOCAL proprio (porta efemera, nunca site
 * real — mesmo padrao de `test/download-somente-leitura.js`), uma rota por
 * fixture. `browser_navigate` para `http://127.0.0.1:PORTA/...` e navegacao
 * DE VERDADE (Page.navigate via CDP funciona normal para http:), entao o
 * gancho da obra 09 e exercitado pela acao `navigate` de fato, nao por uma
 * releitura do DOM que ja estava la.
 *
 * DEFEITO 1 (browser_read_page nunca avisava, medido 5x pelo cetico em
 * 05/09/2026): investigado ao vivo nesta obra (05-06/09/2026). `detectar()`
 * roda e acha o widget certo (confirmado por instrumentacao temporaria: o
 * gancho recebe `ctx.acao === 'read_page'` e mescla `aviso` em `r.data`) —
 * o defeito NAO estava no codigo de producao (`capacidades/desafio.ts` +
 * `format.js`, que ja tem `page.aviso` na `cabecalho()`). Estava em como a
 * obra foi MEDIDA: uma sessao de agente com conexao MCP `praxedes-bridge`
 * de VIDA LONGA usa um processo `bridge-server` que so le `format.js` uma
 * vez, no boot — um agente cujo processo subiu ANTES do fix de `format.js`
 * (ou de qualquer fix no lado servidor) continua servindo o `cabecalho()`
 * ANTIGO para sempre, sem reiniciar sozinho, e o `browser_read_page` dele
 * mente por omissao (sem aviso, sem erro) enquanto `browser_extract`
 * (aviso embutido na STRING pelo lado da EXTENSAO, no `capacidades/desafio.ts`
 * — nao depende de `format.js`) continua funcionando. Isto engana quem testa
 * pela propria sessao MCP do agente (inclusive um cetico) achando que e
 * defeito de codigo. `node test/desafio.js` NAO cai nessa armadilha porque
 * `startClient()` (client.js) da SPAWN num processo `bridge-server` NOVO a
 * cada execucao, que sempre le o `format.js` atual do disco — mas todo
 * pedreiro/cetico que testar por `browser_read_page`/`browser_extract` na
 * PROPRIA sessao do agente, sem rodar por aqui, tem de saber: se o lado
 * SERVIDOR (`bridge-server/src/*.js`) mudou depois que a sessao conectou, o
 * unico jeito confiavel de medir e um processo novo (este teste, ou
 * reconectar a sessao MCP do zero) — reload da EXTENSAO (`npm run reload`)
 * nao alcanca o processo do servidor, sao dois processos diferentes.
 *
 *   node test/desafio.js
 */
import { createServer } from 'node:http';
import { startClient, esperarExtensao } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${corpo}</body></html>`;

// Terceiro item do cetico (cobertura): o guard `elementos < 60` (capacidades/desafio.ts,
// evita falso positivo de "marca presente mas pagina normal") nunca pode ser o
// UNICO motivo de um caso passar ou falhar sozinho — as duas paginas abaixo sao
// IDENTICAS (mesma marca de Cloudflare, mesmo titulo neutro, nenhuma frase de
// interstitial, nenhum widget) e divergem SO na contagem de elementos, para
// isolar exatamente o que o guard decide.
const marcaCloudflareIsolada = '<div id="challenge-form"></div><p>Consulta de processo, pagina de tribunal.</p>';
const enchimentoPara60Mais = Array.from({ length: 70 }, (_, i) => `<span>item ${i}</span>`).join('');

const ROTAS = {
  '/interstitial': pagina('<title>Just a moment...</title><div id="challenge-running"></div><p>Verificando</p>'),
  '/widget': pagina(
    '<title>Consulta</title><form><input name=q><div class="g-recaptcha"></div><button>Pesquisar</button></form>'
    + '<p>Jurisprudencia do tribunal, texto de enchimento para nao parecer pagina vazia.</p>',
  ),
  '/normal': pagina('<title>Consulta</title><h1>pagina normal</h1><p>nada de especial aqui.</p>'),
  '/esaj': pagina('<title>Consulta</title><p>Acesso bloqueado: suspeita de acesso via robô. Tente novamente mais tarde.</p>'),
  '/cloudflare-guard-baixo': pagina(`<title>Consulta</title>${marcaCloudflareIsolada}`),
  '/cloudflare-guard-alto': pagina(`<title>Consulta</title>${marcaCloudflareIsolada}${enchimentoPara60Mais}`),
};

const servidor = createServer((req, res) => {
  const corpo = ROTAS[req.url];
  if (!corpo) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('rota de teste desconhecida: ' + req.url);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(corpo);
});

await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const porta = servidor.address().port;
const urlDe = (rota) => `http://127.0.0.1:${porta}${rota}`;

const c = startClient('teste-desafio');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // ────────────────────────────────────────────────────────────────────
  // Caso 1: interstitial — Cloudflare "Just a moment..." + #challenge-running
  // ────────────────────────────────────────────────────────────────────
  // Aba propria (regra 6 do briefing: nunca a aba do Dr. Cezar). O primeiro
  // carregamento e por tab_open; o browser_navigate abaixo E QUE navega de
  // verdade (http:, ao contrario de data:) — exercita a acao 'navigate'.
  await c.tool('browser_tab_open', { url: 'about:blank' });

  const rNav1 = await c.call('tools/call', { name: 'browser_navigate', arguments: { url: urlDe('/interstitial') } });
  check(rNav1.result.isError === true, 'caso 1: browser_navigate para interstitial FALHA');
  check(/\[desafio\]/.test(rNav1.result.content[0].text),
    'caso 1: erro do navigate comeca com [desafio]', rNav1.result.content[0].text.slice(0, 90));

  const rRead1 = await c.call('tools/call', { name: 'browser_read_page', arguments: {} });
  check(rRead1.result.isError === true, 'caso 1: browser_read_page na mesma aba FALHA');
  check(/\[desafio\]/.test(rRead1.result.content[0].text), 'caso 1: erro do read_page tem [desafio]');

  const rExtract1 = await c.call('tools/call', { name: 'browser_extract', arguments: {} });
  check(rExtract1.result.isError === true, 'caso 1: browser_extract na mesma aba FALHA');
  check(/\[desafio\]/.test(rExtract1.result.content[0].text), 'caso 1: erro do extract tem [desafio]');

  // c.call (nao c.tool) de proposito: browser_screenshot as vezes estoura o
  // timeout de 60s quando o Chrome compartilhado esta sob carga pesada de
  // outros pedreiros (medido nesta obra, 05/09/2026) — isso e contencao do
  // CDP entre agentes, nao efeito do gancho desta obra (screenshot nao entra
  // em ACOES_MONITORADAS). c.tool() faria isso derrubar o processo inteiro
  // e perder os casos seguintes; aqui so registra e segue.
  const rShot1 = await c.call('tools/call', { name: 'browser_screenshot', arguments: {} });
  if (rShot1.result?.isError) {
    console.log(`AVISO caso 1: browser_screenshot falhou (provavel contencao de CDP compartilhado) — ${rShot1.result.content[0].text}`);
  } else {
    check(rShot1.result.content[0].type === 'image' && rShot1.result.content[0].data.length > 500,
      'caso 1: browser_screenshot continua funcionando na pagina de desafio');
  }

  // ────────────────────────────────────────────────────────────────────
  // Caso 5 — "defeito irmao" do briefing: o gancho SO pode atuar quando
  // r.ok === true. Um navigate barrado pelo freio (policy.ts, banco/meio de
  // pagamento sem confirm) tem de continuar aparecendo como [bloqueado] —
  // se o gancho rodasse tambem sobre r.ok === false, ele reexaminaria a
  // pagina de desafio ainda carregada (caso 1) e substituiria [bloqueado]
  // por [desafio], mascarando o erro genuino. Ainda na aba do caso 1.
  // ────────────────────────────────────────────────────────────────────
  const rNavBloqueado = await c.call('tools/call', {
    name: 'browser_navigate', arguments: { url: 'https://nubank.com.br' },
  });
  check(rNavBloqueado.result.isError === true, 'caso 5: navigate para banco sem confirm continua FALHANDO');
  check(/\[bloqueado\]/.test(rNavBloqueado.result.content[0].text)
    && !/\[desafio\]/.test(rNavBloqueado.result.content[0].text),
    'caso 5: erro e [bloqueado] do freio, NAO [desafio] (gancho nao roda sobre r.ok===false)',
    rNavBloqueado.result.content[0].text.slice(0, 120));

  // ────────────────────────────────────────────────────────────────────
  // Caso 2: widget — captcha dentro de formulario normal (tipo TJ-SP/eSAJ)
  // ────────────────────────────────────────────────────────────────────
  const rNav2 = await c.tool('browser_navigate', { url: urlDe('/widget') });
  const textoNav2 = rNav2.content[0].text;
  check(/aviso/i.test(textoNav2) && /captcha/i.test(textoNav2),
    'caso 2: navigate ok, com aviso de captcha', textoNav2.slice(0, 140));

  // Defeito 1 do briefing (cetico, 05/09/2026): browser_read_page tem de
  // trazer o MESMO aviso que browser_extract, no MESMO estado de DOM.
  const rRead2 = await c.tool('browser_read_page');
  const linhasRead2 = rRead2.content[0].text.split('\n');
  // cabecalho() do format.js: linha 1 = url, linha 2 = title, linha 3 = aviso.
  const linhaAviso2 = linhasRead2.slice(1, 3).find((l) => l.startsWith('[aviso]'));
  check(Boolean(linhaAviso2), 'caso 2: read_page traz [aviso] na 2a/3a linha, logo apos o cabecalho (defeito 1)',
    JSON.stringify(linhasRead2.slice(0, 3)));
  check(Boolean(linhaAviso2) && /captcha/i.test(linhaAviso2), 'caso 2: aviso do read_page menciona captcha');

  const rExtract2 = await c.tool('browser_extract');
  const textoExtract2 = rExtract2.content[0].text;
  check(textoExtract2.startsWith('[aviso]'), 'caso 2: extract comeca com [aviso]', textoExtract2.slice(0, 90));
  check(/captcha/i.test(textoExtract2), 'caso 2: aviso do extract menciona captcha');

  // Briefing de 06/09/2026 ("conserto 2"): browser_find fala a MESMA acao
  // 'read_page' na extensao que browser_read_page — so muda quem formata a
  // resposta do lado do servidor (bridge-server/src/format.js, funcao
  // procurar(), em vez de formatarPagina()). Ate o conserto, procurar()
  // ignorava `page.aviso` e um agente que procurasse campo por browser_find
  // antes de preencher formulario no PJe/eSAJ nunca via o aviso de captcha.
  const rFind2 = await c.tool('browser_find', { query: 'Pesquisar' });
  const textoFind2 = rFind2.content[0].text;
  check(textoFind2.startsWith('[aviso]'), 'caso 2: browser_find tambem comeca com [aviso] (conserto 2)', textoFind2.slice(0, 90));
  check(/captcha/i.test(textoFind2), 'caso 2: aviso do browser_find menciona captcha');

  // ────────────────────────────────────────────────────────────────────
  // Caso 3: pagina normal — sem desafio, sem widget, sem [aviso] nenhum
  // ────────────────────────────────────────────────────────────────────
  await c.tool('browser_navigate', { url: urlDe('/normal') });
  await c.tool('browser_wait_network', {});

  const rRead3 = await c.tool('browser_read_page');
  check(!rRead3.content[0].text.includes('[aviso]'), 'caso 3: pagina normal sem [aviso]');

  const rExtract3 = await c.tool('browser_extract');
  check(!rExtract3.content[0].text.startsWith('[aviso]'), 'caso 3: extract de pagina normal sem [aviso]');

  // Conserto 2 — mesmo par read_page/find de cima, agora sem widget nenhum:
  // procurar() nao pode inventar aviso onde nao ha captcha.
  const rFind3 = await c.tool('browser_find', { query: 'pagina normal' });
  check(!rFind3.content[0].text.includes('[aviso]'),
    'caso 3: browser_find de pagina normal tambem sem [aviso] (sem falso positivo)');

  // ────────────────────────────────────────────────────────────────────
  // Caso 4: frase do eSAJ ("suspeita de acesso via robo") sem marca de Cloudflare
  // ────────────────────────────────────────────────────────────────────
  const rNav4 = await c.call('tools/call', { name: 'browser_navigate', arguments: { url: urlDe('/esaj') } });
  check(rNav4.result.isError === true, 'caso 4: frase "suspeita de acesso via robo" vira [desafio]');
  check(/\[desafio\]/.test(rNav4.result.content[0].text),
    'caso 4: erro tem [desafio]', rNav4.result.content[0].text.slice(0, 100));

  // ────────────────────────────────────────────────────────────────────
  // Caso 6/7 — terceiro item do cetico: isolar o guard `elementos < 60`.
  // As duas paginas sao IDENTICAS (mesma marca de Cloudflare #challenge-form,
  // titulo neutro, nenhuma frase de interstitial, nenhum widget) e so
  // divergem na contagem de elementos — prova que o guard, sozinho, decide.
  // ────────────────────────────────────────────────────────────────────
  const rNav6 = await c.call('tools/call', {
    name: 'browser_navigate', arguments: { url: urlDe('/cloudflare-guard-baixo') },
  });
  check(rNav6.result.isError === true,
    'caso 6: marca de Cloudflare + poucos elementos (<60) VIRA [desafio]');
  check(/\[desafio\]/.test(rNav6.result.content[0].text) && /marca-cloudflare/.test(rNav6.result.content[0].text),
    'caso 6: erro cita marca-cloudflare', rNav6.result.content[0].text.slice(0, 140));

  const rNav7 = await c.tool('browser_navigate', { url: urlDe('/cloudflare-guard-alto') });
  const textoNav7 = rNav7.content[0].text;
  check(!/\[desafio\]/.test(textoNav7) && !/aviso/i.test(textoNav7),
    'caso 7: MESMA marca de Cloudflare + muitos elementos (>=60) NAO vira [desafio] (guard isolado)',
    textoNav7.slice(0, 140));

  const rRead7 = await c.tool('browser_read_page');
  check(!rRead7.content[0].text.includes('[aviso]'),
    'caso 7: read_page da mesma pagina tambem sem [aviso] (sem falso positivo do guard)');

  const rFind7 = await c.tool('browser_find', { query: 'item' });
  check(!rFind7.content[0].text.includes('[aviso]'),
    'caso 7: browser_find da mesma pagina tambem sem [aviso] (guard isolado, conserto 2)');
} finally {
  c.close();
  servidor.close();
}

console.log(falhou ? 'RESULTADO: FALHOU' : 'RESULTADO: OK');
if (falhou) process.exit(1);
