/**
 * Testa browser_screenshot (recorte por ref/regiao) e browser_console_logs
 * (console real via CDP) — obra 14.
 * Ver docs/obra-20260904/14-diagnostico-screenshot-recorte-e-console-cdp.md.
 *
 *   node test/diagnostico.js
 *
 * Exige o Chrome aberto com a extensao PraxedesIA carregada e o token pareado.
 * Abre e trabalha SO na aba propria do agente — nunca na do Dr. Cezar.
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

/** Nao falha a bateria: usado quando o proprio ambiente decide o resultado (ex.: Log.enable). */
const aviso = (label, extra = '') => {
  console.log(`AVISO ${label}${extra ? ` — ${extra}` : ''}`);
};

/**
 * Le largura/altura de um JPEG pelos marcadores SOF (baseline C0, progressivo
 * C2, e as variantes menos comuns C1/C3/C5-C7/C9-CF — tudo em 0xC0-0xCF menos
 * DHT/JPG/DAC que nao sao SOF). Anda segmento por segmento (usa o comprimento
 * de cada um para pular) em vez de varrer byte a byte: dentro de um segmento
 * generico (APPn/EXIF) um byte 0xFF seguido de algo em 0xC0-0xCF por
 * coincidencia daria falso positivo antes do SOF de verdade.
 */
function dimensoesJpeg(base64) {
  const buf = Buffer.from(base64, 'base64');
  if (buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('nao comeca com SOI (FFD8) — nao parece JPEG');
  }
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; } // padding entre marcadores
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // SOI/EOI/RSTn: sem campo de comprimento
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    if (marker === 0xda) break; // Start of Scan: SOF tinha que ter vindo antes
    const length = buf.readUInt16BE(i + 2);
    i += 2 + length;
  }
  throw new Error('marcador SOF nao encontrado no JPEG');
}

const c = startClient('teste-diagnostico');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria em branco — nunca mexer na aba que o Dr. Cezar esta usando.
  // MEDIDO nesta obra (05/09/2026): `browser_tab_open` cria a aba com
  // `active: false` (mesma armadilha documentada em rede-inspecao.ts) — sem
  // ativa-la, ela fica em segundo plano, e o Chrome pode atrasar (e nesta
  // maquina, com ~12 outras obras batendo no mesmo Chrome ao mesmo tempo,
  // atrasou de verdade, de forma instavel) um `setTimeout` de pagina em
  // segundo plano por bem mais que alguns milissegundos — flakiness medida no
  // caso 2 antes deste `tab_switch` existir. Ativar a aba tira essa variavel.
  const aberta = await c.json('browser_tab_open', {});
  if (aberta?.newTabId) await c.tool('browser_tab_switch', { tabId: aberta.newTabId });

  // ── 1. Console: log e error, cronologico, nivel e origem certos ────────
  await c.tool('browser_javascript', {
    codigo: "console.log('marca-123'); console.error('erro-456'); 1",
  });
  await sleep(300);
  const c1 = await c.json('browser_console_logs', {});
  const marcaLog = c1.find((e) => e.texto.includes('marca-123'));
  const marcaErro = c1.find((e) => e.texto.includes('erro-456'));
  check(
    Boolean(marcaLog) && marcaLog.nivel === 'log' && marcaLog.origem === 'console',
    'console.log aparece com nivel log, origem console',
    JSON.stringify(marcaLog),
  );
  check(
    Boolean(marcaErro) && marcaErro.nivel === 'error' && marcaErro.origem === 'console',
    'console.error aparece com nivel error, origem console',
    JSON.stringify(marcaErro),
  );

  // ── 2. Excecao nao tratada ───────────────────────────────────────────────
  await c.tool('browser_javascript', {
    codigo: "setTimeout(() => { throw new Error('boom-789') }, 50); 1",
  });
  await sleep(600);
  const c2 = await c.json('browser_console_logs', {});
  const excecao = c2.find((e) => e.texto.includes('boom-789'));
  check(
    Boolean(excecao) && excecao.origem === 'excecao' && excecao.nivel === 'excecao',
    'excecao nao tratada aparece com origem excecao',
    JSON.stringify(excecao),
  );

  // ── 3. Erro de rede (404) — so se Log.enable foi permitido ──────────────
  // MEDIDO nesta obra (05/09/2026): fetch CROSS-ORIGIN para um alvo sem CORS
  // (a partir de about:blank, origin 'null') nao produz mensagem com "404" —
  // o navegador barra a resposta por CORS ANTES de expor o status, e o Log
  // so mostra "Failed to load resource: net::ERR_FAILED" (sem numero nenhum).
  // Same-origin (navega para a pagina, busca um caminho relativo dela) e o
  // unico jeito de o Chrome expor o status real: "...responded with a status
  // of 404 ()". Por isso navega antes de testar.
  await c.tool('browser_navigate', { url: 'https://example.com' });
  await sleep(500);
  await c.tool('browser_javascript', {
    codigo: "fetch('/nao-existe-404').catch(function(){ return 'ignorado'; })",
  });
  await sleep(1000);
  const c3 = await c.json('browser_console_logs', {});
  // Separado em dois: achar a entrada por TEXTO (independe de origem estar
  // certo) decide se Log.enable chegou (ambiental, so AVISO se faltar); uma
  // vez achada, origem==='rede' e uma AFIRMACAO da nossa propria funcao
  // (origemDeLogSource) e tem de ser check() de verdade. Sem esta separacao,
  // um bug em origemDeLogSource (ex.: mapear 'network' para 'outro') fazia o
  // find() falhar por inteiro e o teste degradar para AVISO em vez de FALHA —
  // mutacao que nao morria (medido nesta obra: `entrada.origem` mutado para
  // sempre 'outro' e a bateria continuava verde). Corrigido.
  const entradaPorTexto = c3.find((e) => e.texto.includes('404'));
  if (entradaPorTexto) {
    check(
      entradaPorTexto.origem === 'rede',
      'Log.enable permitido: 404 aparece com origem rede',
      JSON.stringify(entradaPorTexto),
    );
  } else {
    aviso(
      'nenhuma entrada com "404" no texto encontrada',
      'ou Log.enable nao foi permitido pelo chrome.debugger, ou o Chrome nao reporta 404 de fetch simples via Log — ver relatorio',
    );
  }

  // ── 4. Filtro por nivel ──────────────────────────────────────────────────
  const soErro = await c.json('browser_console_logs', { nivel: 'error' });
  check(
    soErro.length > 0 && soErro.every((e) => e.nivel === 'error'),
    'nivel:"error" filtra (so entradas error, e ha pelo menos uma)',
    `${soErro.length} entrada(s)`,
  );

  // ── 5. Recorte por ref, com a pagina rolada ─────────────────────────────
  await c.tool('browser_javascript', {
    codigo:
      "document.body.innerHTML = '<div style=\"height:3000px\"></div>"
      + "<div id=\"alvo\" role=\"button\" aria-label=\"alvo-recorte\" "
      + 'style="width:200px;height:100px;background:red"></div>\'; '
      + 'window.scrollTo(0, 0); 1',
  });
  await sleep(200);

  const dprTexto = (await c.tool('browser_javascript', { codigo: 'window.devicePixelRatio' })).content[0].text;
  const dpr = Number(dprTexto) || 1;

  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refAlvo = pagina.match(/\[(\d+)\] button "alvo-recorte"/)?.[1];
  check(Boolean(refAlvo), 'browser_read_page achou o ref do alvo', pagina.slice(0, 200));

  if (refAlvo) {
    const shot = await c.tool('browser_screenshot', { ref: Number(refAlvo) });
    const img = shot.content[0];
    check(img.type === 'image', 'browser_screenshot com ref devolve imagem', img.type);
    if (img.type === 'image') {
      const dim = dimensoesJpeg(img.data);
      const larguraCss = dim.width / dpr;
      const alturaCss = dim.height / dpr;
      check(
        Math.abs(larguraCss - 200) <= 3 && Math.abs(alturaCss - 100) <= 3,
        'recorte por ref mede ~200x100 CSS px, mesmo com a pagina rolada ao topo antes',
        `JPEG ${dim.width}x${dim.height}, dpr=${dpr}, => ${larguraCss.toFixed(1)}x${alturaCss.toFixed(1)} CSS px`,
      );
    }
  }

  // ── 6. Sem ref, continua a aba inteira (regra ADITIVO) ──────────────────
  const shotInteiro = await c.tool('browser_screenshot', {});
  check(
    shotInteiro.content[0].type === 'image' && shotInteiro.content[0].data.length > 1000,
    'browser_screenshot sem ref continua devolvendo a aba inteira como imagem',
  );

  // ── 7. Recorte por regiao explicita ──────────────────────────────────────
  await c.tool('browser_javascript', { codigo: 'window.scrollTo(0, 0); 1' });
  await sleep(100);
  const shotRegiao = await c.tool('browser_screenshot', { regiao: { x: 0, y: 0, w: 50, h: 50 } });
  check(shotRegiao.content[0].type === 'image', 'browser_screenshot com regiao devolve imagem', shotRegiao.content[0].type);
  if (shotRegiao.content[0].type === 'image') {
    const dimR = dimensoesJpeg(shotRegiao.content[0].data);
    const lCss = dimR.width / dpr;
    const aCss = dimR.height / dpr;
    check(
      Math.abs(lCss - 50) <= 3 && Math.abs(aCss - 50) <= 3,
      'recorte por regiao {0,0,50,50} mede ~50x50 CSS px',
      `JPEG ${dimR.width}x${dimR.height}, dpr=${dpr} => ${lCss.toFixed(1)}x${aCss.toFixed(1)} CSS px`,
    );
  }

  // ── 8. Elemento sem area visivel: erro claro, nao "ok" mentiroso ────────
  await c.tool('browser_javascript', {
    codigo:
      "document.body.innerHTML += '<div id=\"escondido\" role=\"button\" aria-label=\"escondido-recorte\" "
      + 'style="display:none"></div>\'; 1',
  });
  const pagina2 = (await c.tool('browser_read_page')).content[0].text;
  // display:none nao entra na arvore de interativos (sem layout) — nesse caso
  // o proprio browser_read_page ja nao acha o ref, o que E o comportamento
  // esperado (nao ha o que recortar). Se por algum motivo aparecer um ref
  // mesmo assim, confere que o recorte falha com a mensagem certa.
  const refEscondido = pagina2.match(/\[(\d+)\] button "escondido-recorte"/)?.[1];
  if (refEscondido) {
    const r = await c.call('tools/call', {
      name: 'browser_screenshot',
      arguments: { ref: Number(refEscondido) },
    });
    check(
      r.result.isError === true && r.result.content[0].text.includes('nao tem area visivel'),
      'ref de elemento display:none da erro claro ("nao tem area visivel"), nao ok mentiroso',
      r.result.content[0].text,
    );
  } else {
    aviso('elemento display:none nao apareceu na arvore de interativos', 'esperado — sem layout, sem ref; nao ha o que testar aqui');
  }

  // ── 9. Elemento COM ref mas tamanho zero: exercita o guard de verdade ───
  // Diferente do caso 8 (display:none, sem layout — nunca ganha ref, entao
  // nunca chega a chamar cap_screenshot_ref): um role="button" de
  // width:0;height:0 TEM layout (DOM.getBoxModel devolve um quad degenerado,
  // nao falha) e por ter role interativo ganha ref no browser_read_page —
  // esta e a entrada que de fato passa pelo `if (w<=0||h<=0)` de
  // screenshot-recorte.ts. Sem este caso, aquele guard nunca era exercitado
  // por teste nenhum (medido: mutation testing desta obra, ver relatorio).
  await c.tool('browser_javascript', {
    codigo:
      "document.body.innerHTML += '<div id=\"semarea\" role=\"button\" aria-label=\"semarea-recorte\" "
      + 'style="width:0;height:0;overflow:hidden"></div>\'; 1',
  });
  const pagina3 = (await c.tool('browser_read_page')).content[0].text;
  const refSemArea = pagina3.match(/\[(\d+)\] button "semarea-recorte"/)?.[1];
  check(Boolean(refSemArea), 'elemento 0x0 com role ganha ref (tem layout, so nao tem area)', pagina3.slice(0, 200));
  if (refSemArea) {
    const r2 = await c.call('tools/call', {
      name: 'browser_screenshot',
      arguments: { ref: Number(refSemArea) },
    });
    check(
      r2.result.isError === true && r2.result.content[0].text.includes('nao tem area visivel'),
      'ref de elemento 0x0 da erro claro ("nao tem area visivel"), nao ok mentiroso',
      r2.result.content[0].text,
    );
  }

  // ── 10. Ref que ficou obsoleto (elemento removido do DOM) ───────────────
  // Diferente dos casos 8/9 (elemento SEM area, mas presente): aqui o
  // elemento existiu, tinha ref, e foi removido — exercita o outro guard de
  // screenshot-recorte.ts (`!boxModel?.model?.content`, quando DOM.getBoxModel
  // falha por completo em vez de devolver um quad degenerado).
  if (refAlvo) {
    await c.tool('browser_javascript', { codigo: "document.getElementById('alvo').remove(); 1" });
    const r3 = await c.call('tools/call', {
      name: 'browser_screenshot',
      arguments: { ref: Number(refAlvo) },
    });
    check(
      r3.result.isError === true && r3.result.content[0].text.includes('nao tem area visivel'),
      'ref de elemento removido do DOM da erro claro, nao ok mentiroso',
      r3.result.content[0].text,
    );
  }

  // ── 11. Regiao explicita invalida (w ou h zero) ──────────────────────────
  const r4 = await c.call('tools/call', {
    name: 'browser_screenshot',
    arguments: { regiao: { x: 0, y: 0, w: 0, h: 50 } },
  });
  check(
    r4.result.isError === true && r4.result.content[0].text.includes('nao tem area visivel'),
    'regiao com largura zero da erro claro, nao ok mentiroso',
    r4.result.content[0].text,
  );
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
