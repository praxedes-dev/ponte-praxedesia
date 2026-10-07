/**
 * FURO 5 (achado do cetico, 06/09/2026, ja coberto por `cetico-quarto-furo.js`
 * H2/C2 no caso COM `ref`): `cap_digitar` (browser_type modo:"teclado") nunca
 * chamava `avaliar()` -- o dispatch de bridge/index.ts so aciona o freio no
 * ramo do MOTOR, e cada capacidade `cap_*` tem de chamar sozinha (como
 * `cap_form_input`, no mesmo arquivo, ja fazia). Sem isto a ponte digitava
 * credencial de verdade num <input type=password>.
 *
 * Este arquivo cobre especificamente o caso que NENHUM outro teste cobre: o
 * QUE FAZER quando `cap_digitar` roda SEM `ref` -- "digitacao por teclado
 * solta", documentada no proprio `digitarTeclaATecla` (formulario.ts) como uso
 * legitimo (as teclas vao para quem ja estiver focado na aba, sem chamar
 * `DOM.focus`).
 *
 * Decisao medida aqui (ver comentario de `backendNodeIdDoFoco` em
 * formulario.ts): sem `ref`, o freio resolve `document.activeElement` de
 * verdade e examina ELE -- nunca `resolveTarget()` (o que `avaliar()` faria
 * sozinho recebendo `agentId: undefined`), que responde "qual e o primeiro
 * campo visivel da pagina", uma pergunta DIFERENTE de "quem esta focado
 * agora" e por isso reabriria a mesma familia de furo por outro caminho.
 *
 *   Caso 1 (o furo): campo de SENHA focado, `cap_digitar` SEM ref -> BARRADO,
 *   e o valor real do campo continua vazio (nada foi digitado antes do
 *   bloqueio).
 *   Caso 2 (falso positivo / uso legitimo): campo NORMAL focado, `cap_digitar`
 *   SEM ref -> continua funcionando, valor gravado de verdade.
 *   Caso 3 (regressao, com ref): confirma que o caminho COM `ref` (ja medido
 *   em cetico-quarto-furo.js) nao regride aqui.
 *
 *   node test/furo5-cap-digitar-sem-ref.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const c = startClient('teste-furo5-sem-ref');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  // Aba propria: nunca a do usuario.
  await c.tool('browser_tab_open', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});

  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML =
        '<input id="senha" type="password" aria-label="Senha de acesso furo5">' +
        '<input id="normal" type="text" aria-label="Campo normal furo5">';
      return 'montado';
    })()`,
  });
  await sleep(300);

  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const refDe = async (rotulo) => {
    const pagina = (await c.tool('browser_read_page')).content[0].text;
    const linha = pagina.split('\n').find((l) => l.toLowerCase().includes(rotulo.toLowerCase()));
    return linha ? Number(linha.match(/\[(\d+)\]/)?.[1]) : undefined;
  };
  const focar = async (id) => js(`document.getElementById('${id}').focus(); document.activeElement && document.activeElement.id`);

  console.log('\n---- Caso 1: campo de SENHA focado, cap_digitar SEM ref ----');
  await js("document.getElementById('senha').value=''; \"reset\"");
  const foco1 = await focar('senha');
  console.log('elemento focado antes do type:', JSON.stringify(foco1));
  check(foco1 === 'senha', 'montagem: o campo de senha esta de fato focado');

  const r1 = await c.call('tools/call', {
    name: 'browser_type',
    arguments: { text: 'segredo-furo5', modo: 'teclado', delay_ms: 5 },
  });
  const bloqueado1 = r1.result?.isError === true;
  const v1 = await js("document.getElementById('senha').value");
  console.log(`cap_digitar SEM ref, senha focada -> isError=${bloqueado1} | erro=${JSON.stringify((r1.result?.content?.[0]?.text || '').slice(0, 140))}`);
  console.log(`>>> VALOR REAL DO CAMPO DE SENHA: ${JSON.stringify(v1)}`);
  check(bloqueado1 && !v1, 'Caso 1: cap_digitar SEM ref, com senha focada, e BARRADO e o campo continua vazio',
    `isError=${bloqueado1} valor=${JSON.stringify(v1)}`);

  console.log('\n---- Caso 2 (falso positivo): campo NORMAL focado, cap_digitar SEM ref ----');
  await js("document.getElementById('normal').value=''; \"reset\"");
  const foco2 = await focar('normal');
  console.log('elemento focado antes do type:', JSON.stringify(foco2));
  check(foco2 === 'normal', 'montagem: o campo normal esta de fato focado');

  const r2 = await c.tool('browser_type', { text: 'Fulano da Silva', modo: 'teclado', delay_ms: 5 });
  const v2 = await js("document.getElementById('normal').value");
  console.log(`cap_digitar SEM ref, campo normal focado -> ok, resposta=${JSON.stringify(r2.content[0].text.slice(0, 80))}`);
  console.log(`>>> VALOR REAL DO CAMPO NORMAL: ${JSON.stringify(v2)}`);
  check(v2 === 'Fulano da Silva', 'Caso 2: cap_digitar SEM ref em campo normal continua funcionando (sem falso positivo)',
    `valor=${JSON.stringify(v2)}`);

  console.log('\n---- Caso 3 (regressao, COM ref) ----');
  await js("document.getElementById('senha').value=''; \"reset\"");
  const refSenha = await refDe('Senha de acesso furo5');
  check(Boolean(refSenha), `achou o agentId do campo de senha (ref ${refSenha})`);
  if (refSenha !== undefined) {
    const r3 = await c.call('tools/call', {
      name: 'browser_type',
      arguments: { ref: refSenha, text: 'segredo-furo5-b', modo: 'teclado', delay_ms: 5 },
    });
    const v3 = await js("document.getElementById('senha').value");
    check(r3.result?.isError === true && !v3, 'Caso 3: cap_digitar COM ref, em campo de senha, continua BARRADO',
      `isError=${r3.result?.isError} valor=${JSON.stringify(v3)}`);
  }
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nTODOS OS CASOS OK.');
  c.close();
}
