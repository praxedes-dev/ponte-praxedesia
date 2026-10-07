/**
 * CUSTO E FALSO POSITIVO — a ponte ainda opera uma tela com a cara do PJe?
 *
 * A pergunta do briefing: depois de tantos freios acrescentados hoje, clique,
 * digitacao, formulario, autocomplete, troca de aba e tecla continuam
 * funcionando? E quanto custa cada um (a resolucao unica encareceu alguma
 * acao)?
 *
 * Pagina de prova com as pecas que o PJe tem: aba RichFaces (rich-tab-header),
 * combo select2 (span que so vira campo depois do clique), campo com
 * autocomplete, campo de texto, campo de senha, botao inocente ("Salvar
 * rascunho") e botao irreversivel ("Protocolar inicial").
 *
 * Cada acao e cronometrada no CLIENTE (round-trip inteiro: MCP -> hub ->
 * extensao -> CDP -> volta), que e o custo que o agente sente.
 *
 * Aba-cobaia propria. Nunca a aba do Dr. Cezar.
 *   node test/_cetico-custo-e-falso-positivo.mjs
 */
import { WebSocket } from 'ws';
import { getToken } from '../src/token.js';
import { HOST, PORT } from '../src/hub.js';
import { startClient, esperarExtensao, sleep } from './client.js';

const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

function peer(clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${PORT}`);
    const p = new Map();
    let s = 0;
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'peer', clientId, name: clientId, token: getToken() })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'welcome') {
        if (!m.extensionOnline) return reject(new Error('sem extensao'));
        resolve({
          cmd: (action, args = {}, t = 60000) => new Promise((res, rej) => {
            const id = `${clientId}:${++s}`;
            const tm = setTimeout(() => { p.delete(id); rej(new Error('timeout ' + action)); }, t);
            p.set(id, (x) => { clearTimeout(tm); res(x); });
            ws.send(JSON.stringify({ type: 'cmd', id, clientId, name: clientId, action, args }));
          }),
          fechar: () => ws.close(),
        });
        return;
      }
      if (m.type === 'result') { const e = p.get(m.id); if (e) { p.delete(m.id); e(m); } }
    });
    ws.on('error', reject);
  });
}

const js = (m, codigo) => m.cmd('cap_js', { params: { codigo } }).then((r) => (r.ok ? r.result : `ERRO:${r.error}`));

const tempos = [];
async function cronometrar(rotulo, fn) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  tempos.push({ rotulo, ms });
  return { r, ms };
}

const PAGINA = [
  'document.head.innerHTML = "";', // fora o CSS do example.com, para a geometria ser minha
  'window.__protocolou = 0; window.__salvou = 0; window.__abriuAba = 0; window.__sugestoes = 0;',
  'document.body.innerHTML = "'
    + '<a class=\\"rich-tab-header\\" id=abaConf href=\\"#conf\\" tabindex=0>PROTOCOLAR INICIAL</a>'
    + '<form id=f>'
    + '<input id=nome placeholder=\\"Nome completo\\" style=\\"display:block;width:300px\\">'
    + '<input id=senha type=password placeholder=\\"Senha do certificado\\" style=\\"display:block;width:300px\\">'
    + '<input id=assunto placeholder=\\"Assunto\\" autocomplete=off style=\\"display:block;width:300px\\">'
    + '<ul id=sug style=\\"display:none\\"></ul>'
    + '<select id=comp class=\\"select2-hidden-accessible\\" style=\\"display:block\\">'
    + '<option value=\\"\\">Selecione</option><option value=1>1a Vara Civel</option><option value=2>2a Vara Civel</option>'
    + '</select>'
    + '<span class=\\"select2 select2-container\\" role=combobox style=\\"display:block;width:300px;height:28px;border:1px solid #999\\">Selecione</span>'
    + '<button type=button id=salvar>Salvar rascunho</button>'
    + '<button type=button id=protocolar>Concluir e assinar</button>'
    + '</form>";',
  'document.getElementById("salvar").addEventListener("click", function(){ window.__salvou++; });',
  'document.getElementById("protocolar").addEventListener("click", function(){ window.__protocolou++; });',
  'document.getElementById("abaConf").addEventListener("mousedown", function(){ window.__abriuAba++; });',
  // autocomplete estilo RichFaces: digitou, aparece a lista
  'document.getElementById("assunto").addEventListener("input", function(){',
  '  var ul = document.getElementById("sug");',
  '  ul.innerHTML = "<li tabindex=0>ICMS sobre energia compensada</li><li tabindex=0>ICMS - outros</li>"; Array.prototype.forEach.call(ul.children, function(li){ li.addEventListener("mousedown", function(){ document.getElementById("assunto").value = li.textContent; }); });',
  '  ul.style.display = "block"; window.__sugestoes++;',
  '});',
  '"montado"',
].join('\n');

const sonda = startClient('sonda-custo');
await sonda.handshake();
await esperarExtensao(sonda);
sonda.close();

const m = await peer('cetico-custo');
let aba;
try {
  aba = (await m.cmd('open_tab', { params: { url: 'https://example.com' } })).result?.newTabId;
  await sleep(600);
  console.log('montagem:', await js(m, PAGINA));

  const pg = await m.cmd('read_page', {});
  const els = pg.result?.interactiveElements ?? [];
  const refDe = (re) => els.find((e) => re.test(`${e.text || ''} ${e.placeholder || ''} ${e.ariaLabel || ''}`))?.agentId;
  const refNome = refDe(/Nome completo/i);
  const refAssunto = refDe(/Assunto/i);
  const refSalvar = refDe(/Salvar rascunho/i);
  const refCombo = refDe(/Selecione/i);
  console.log(`refs: nome=${refNome} assunto=${refAssunto} salvar=${refSalvar} combo=${refCombo}`);

  // 1. type por ref num campo comum
  const a1 = await cronometrar('type por ref', () => m.cmd('type', {
    target: { strategy: 'agent-id', agentId: refNome }, params: { text: 'Cezar Praxedes', clear: true },
  }));
  const v1 = await js(m, 'document.getElementById("nome").value');
  check(a1.r.ok === true && v1 === 'Cezar Praxedes', `1. type por ref escreve no campo (${a1.ms}ms)`, `ok=${a1.r.ok} valor=${JSON.stringify(v1)}`);

  // 2. type semantico por placeholder
  await js(m, 'document.getElementById("nome").value=""; "z"');
  const a2 = await cronometrar('type semantico', () => m.cmd('type', {
    target: { strategy: 'semantic', placeholder: 'Nome completo' }, params: { text: 'Fulano de Tal', clear: true },
  }));
  const v2 = await js(m, 'document.getElementById("nome").value');
  check(a2.r.ok === true && v2 === 'Fulano de Tal', `2. type semantico por placeholder escreve no campo (${a2.ms}ms)`, `ok=${a2.r.ok} valor=${JSON.stringify(v2)} erro=${(a2.r.error || '').slice(0, 90)}`);

  // 3. clique por ref num botao inocente
  const a3 = await cronometrar('click por ref', () => m.cmd('click', { target: { strategy: 'agent-id', agentId: refSalvar } }));
  const s3 = Number(await js(m, 'window.__salvou'));
  check(a3.r.ok === true && s3 === 1, `3. clique por ref em "Salvar rascunho" funciona (${a3.ms}ms)`, `ok=${a3.r.ok} salvou=${s3} erro=${(a3.r.error || '').slice(0, 90)}`);

  // 4. clique semantico no mesmo botao
  await js(m, 'window.__salvou=0; "z"');
  const a4 = await cronometrar('click semantico', () => m.cmd('click', { target: { strategy: 'semantic', text: 'Salvar rascunho' } }));
  const s4 = Number(await js(m, 'window.__salvou'));
  check(a4.r.ok === true && s4 === 1, `4. clique semantico em "Salvar rascunho" funciona (${a4.ms}ms)`, `ok=${a4.r.ok} salvou=${s4}`);

  // 5. a ABA de conferencia do PJe (texto "PROTOCOLAR INICIAL") continua clicavel
  const a5 = await cronometrar('click na aba', () => m.cmd('click', { target: { strategy: 'semantic', text: 'PROTOCOLAR INICIAL' } }));
  const ab5 = Number(await js(m, 'window.__abriuAba'));
  check(a5.r.ok === true && ab5 === 1, `5. aba "PROTOCOLAR INICIAL" (rich-tab-header) NAO virou falso positivo (${a5.ms}ms)`, `ok=${a5.r.ok} abriu=${ab5} erro=${(a5.r.error || '').slice(0, 90)}`);

  // 6. o BOTAO "Protocolar inicial" continua barrado (regra 4 viva)
  const a6 = await cronometrar('click barrado', () => m.cmd('click', { target: { strategy: 'agent-id', agentId: refDe(/Concluir e assinar/i) } }));
  const p6 = Number(await js(m, 'window.__protocolou'));
  check(a6.r.ok === false && p6 === 0, `6. botao "Concluir e assinar" continua BARRADO (${a6.ms}ms)`, `ok=${a6.r.ok} protocolou=${p6}`);

  // 7. o mesmo botao COM confirm passa
  const a7 = await cronometrar('click confirmado', () => m.cmd('click', { target: { strategy: 'agent-id', agentId: refDe(/Concluir e assinar/i) }, confirm: true }));
  const p7 = Number(await js(m, 'window.__protocolou'));
  check(a7.r.ok === true && p7 === 1, `7. o MESMO botao com confirm: true passa (${a7.ms}ms)`, `ok=${a7.r.ok} protocolou=${p7}`);

  // 8. cap_form_input no combo select2 (span -> <select> real)
  const a8 = await cronometrar('cap_form_input select2', () => m.cmd('cap_form_input', {
    target: { strategy: 'agent-id', agentId: refCombo },
    params: { ref: refCombo, valor: '1a Vara Civel' },
  }));
  const v8 = await js(m, 'document.getElementById("comp").value');
  check(a8.r.ok === true && v8 === '1', `8. cap_form_input no span do select2 escreve no <select> real (${a8.ms}ms)`, `ok=${a8.r.ok} valor=${JSON.stringify(v8)} erro=${(a8.r.error || '').slice(0, 90)}`);

  // 9. cap_digitar tecla a tecla
  const a9 = await cronometrar('cap_digitar', () => m.cmd('cap_digitar', {
    target: { strategy: 'agent-id', agentId: refAssunto },
    params: { ref: refAssunto, text: 'ICMS', delay_ms: 10 },
  }, 30000));
  const v9 = await js(m, 'document.getElementById("assunto").value');
  check(a9.r.ok === true && /ICMS/.test(String(v9)), `9. cap_digitar escreve tecla a tecla (${a9.ms}ms)`, `ok=${a9.r.ok} valor=${JSON.stringify(v9)} erro=${(a9.r.error || '').slice(0, 90)}`);

  // 10. cap_autocomplete (digita, espera a lista, escolhe)
  await js(m, 'document.getElementById("assunto").value=""; document.getElementById("sug").style.display="none"; "z"');
  const a10 = await cronometrar('cap_autocomplete', () => m.cmd('cap_autocomplete', {
    target: { strategy: 'agent-id', agentId: refAssunto },
    params: { ref: refAssunto, texto: 'ICMS', escolher: 'ICMS sobre energia', timeout_ms: 4000, delay_ms: 10 },
  }, 40000));
  const sug10 = Number(await js(m, 'window.__sugestoes'));
  check(a10.r.ok === true && sug10 > 0, `10. cap_autocomplete digita e escolhe da lista (${a10.ms}ms)`, `ok=${a10.r.ok} sugestoes=${sug10} erro=${(a10.r.error || '').slice(0, 120)}`);

  // 11. press_key Enter num campo de texto (submeter formulario) NAO e falso positivo
  await js(m, 'document.getElementById("nome").focus(); "focado"');
  const a11 = await cronometrar('press_key Enter', () => m.cmd('press_key', { params: { key: 'Enter' } }));
  check(a11.r.ok === true, `11. press_key Enter com campo de texto focado passa (${a11.ms}ms)`, `ok=${a11.r.ok} erro=${(a11.r.error || '').slice(0, 90)}`);

  // 12. digitar no campo de SENHA continua proibido
  const a12 = await cronometrar('type senha', () => m.cmd('type', {
    target: { strategy: 'agent-id', agentId: refDe(/Senha do certificado/i) }, params: { text: 'segredo123' },
  }));
  const v12 = await js(m, 'document.getElementById("senha").value');
  check(a12.r.ok === false && !v12, `12. campo de senha continua proibido (${a12.ms}ms)`, `ok=${a12.r.ok} valor=${JSON.stringify(v12)}`);

  console.log('\n── custo por acao (round-trip do cliente) ──');
  for (const t of tempos) console.log(`  ${String(t.ms).padStart(6)} ms  ${t.rotulo}`);
} finally {
  try { if (aba) await m.cmd('close_tab', { params: { tabId: aba } }); } catch {}
  m.fechar();
}
