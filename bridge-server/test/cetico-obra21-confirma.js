/**
 * Confirma a consequencia pratica do achado: Ctrl+A nao seleciona de
 * verdade (so parou de inserir "a"). Fluxo real de uso: Ctrl+A para
 * "limpar e escrever de novo" seguido de type — sem o loop de backspace
 * que o teste da obra usa como muleta.
 *
 *   node test/cetico-obra21-confirma.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-cetico-confirma');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

  await c.tool('browser_navigate', { url: 'https://example.com' });
  await c.tool('browser_wait_network', {});
  await c.tool('browser_javascript', {
    codigo: `(function(){
      document.body.innerHTML = '<input id="campo" type="text" aria-label="Campo de edicao">';
      document.getElementById('campo').value = 'PROCESSO-ANTIGO-0001';
      return 'ok';
    })()`,
  });
  await sleep(200);
  const js = async (codigo) => (await c.tool('browser_javascript', { codigo })).content[0].text.trim();
  const pagina = (await c.tool('browser_read_page')).content[0].text;
  const refCampo = Number(pagina.split('\n').find((l) => l.toLowerCase().includes('campo de edicao'))?.match(/\[(\d+)\]/)?.[1]);

  await c.tool('browser_click', { ref: refCampo });
  // Cenario real: agente pressupoe que Ctrl+A seleciona tudo, depois digita
  // caractere a caractere (press_key, nao browser_type) o valor novo por
  // cima — jeito comum de "substituir" campo num formulario do PJe.
  await c.tool('browser_press_key', { key: 'a', modifiers: ['Control'] });
  for (const ch of 'X99') {
    await c.tool('browser_press_key', { key: ch });
  }
  const valorFinal = await js("document.getElementById('campo').value");
  check(
    valorFinal === 'X99',
    'depois de Ctrl+A + digitar "X99", o campo contem SO "X99" (selecao funcionou)',
    `valor real="${valorFinal}"`,
  );
  if (valorFinal !== 'X99') {
    console.log(`ACHADO: Ctrl+A nao seleciona nada de verdade — o texto novo foi INSERIDO no meio/fim do texto antigo. Num campo do PJe isso vira valor corrompido sem nenhum erro reportado.`);
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
