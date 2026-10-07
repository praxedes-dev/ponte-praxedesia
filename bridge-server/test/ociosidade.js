/**
 * O grupo de um agente parado tem de sumir sozinho.
 *
 * Sem isto, um comando as 9h deixaria o grupo na tela ate a noite: o processo
 * MCP vive enquanto a sessao do agente estiver aberta, mesmo sem ninguem usar.
 *
 *   node test/ociosidade.js
 */
import { startClient, esperarExtensao } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const c = startClient('teste-ociosidade');
try {
  await c.handshake();
  if (!(await esperarExtensao(c))) throw new Error('extensao nao conectou');

    // Aba propria: sem isto o teste navegaria na aba que o usuario esta usando,
  // porque a ponte trabalha na aba corrente por padrao. EM BRANCO de proposito
  // (obra "entregar aba", 11/09/2026): a faxina por ociosidade agora ENTREGA
  // aba com pagina de verdade em vez de fechar (rede de seguranca do incidente
  // do PJe) — se esta fosse example.com, cada rodada deste teste deixaria uma
  // aba de sobra na janela real do Dr. Cezar. about:blank continua sendo
  // fechado como sempre; ver test/faxina-entrega.js para o caminho de entrega.
await c.tool('browser_tab_open', {});
  const antes = await c.json('browser_tabs_list');
  check(antes.abas.length > 0, `agente abriu ${antes.abas.length} aba(s), grupo ${antes.tabGroupId}`);

  // Quem acabou de agir nao pode ser fechado.
  const poupou = (await c.tool('bridge_faxina_ociosos')).content[0].text;
  const depoisDeAtivo = await c.json('browser_tabs_list');
  check(depoisDeAtivo.abas.length > 0, 'faxina poupou o agente que acabou de agir', poupou);

  // Com janela zero, todo mundo conta como parado: as abas tem de ir embora.
  const fechou = (await c.tool('bridge_faxina_ociosos', { janela_ms: 0 })).content[0].text;
  // Nao fixar o numero de agentes: outras sessoes do Cezar podem estar ativas.
  // O que precisa valer e terminar em zero.
  check(/, 0 depois/.test(fechou), 'faxina fechou os agentes ociosos', fechou);

  // Pedir de novo recria o workspace do zero — ociosidade nao pode deixar o
  // agente aleijado depois da limpeza.
  await c.tool('browser_navigate', { url: 'https://example.com' });
  const revivido = await c.json('browser_tabs_list');
  check(revivido.abas.length > 0, 'agente voltou a funcionar depois da faxina',
    `grupo ${revivido.tabGroupId}`);
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  c.close();
}
