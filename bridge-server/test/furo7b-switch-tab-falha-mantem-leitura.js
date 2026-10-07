/**
 * FURO 7b — `switch_tab` que FALHA nao pode soltar o modo somente-leitura.
 *
 * O invariante e um so: se a troca de aba nao aconteceu, o agente continua
 * onde estava (a aba do usuario) e a protecao continua de pe. Ele foi furado
 * em DOIS pontos, e este arquivo cobre os dois.
 *
 * METADE 1 (fechada antes) — `bridge/index.ts`: o `somenteLeitura.delete`
 * rodava assim que o alvo provava ser "aba da ponte", ANTES de o motor sequer
 * tentar a troca. Hoje ele so roda depois de `result.success`.
 *
 * METADE 2 (fechada em 06/09/2026, este arquivo mediu) —
 * `execution-engine/index.ts`, `case 'switch_tab'`: a ordem era
 * `workspaceManager.switchActiveTab(...)` ANTES de `await
 * chrome.tabs.update(...)`. O workspace e o REGISTRO de onde o agente esta;
 * escrever nele antes de o Chrome confirmar transforma o registro numa
 * promessa. Com a aba alvo morta na janela de corrida, `chrome.tabs.update`
 * lancava, o motor devolvia `success:false` (e o `delete` da metade 1 nao
 * rodava, corretamente) — mas `ws.activeTabId` ja apontava para a aba morta.
 * No comando SEGUINTE, `resolveWorkspace` via a aba morta, apagava o
 * `somenteLeitura` do cliente e devolvia um workspace novo em modo acao: a
 * protecao caia pela porta dos fundos.
 *
 * MEDIDO com o codigo ainda torto: das tentativas que pegaram a corrida,
 * 6 de 6 violaram o invariante (a sonda de leitura, que devia responder
 * "[somente leitura]", respondeu "[aba trocou]"). Depois do conserto: 0.
 *
 * ── COMO O RAMO "MOTOR FALHOU" E ALCANCADO ───────────────────────────────
 *
 * Nao da para chamar esse ramo direto pelo protocolo da ponte: e preciso que o
 * freio ainda veja a aba alvo em `abasCriadasPelaPonte` (ela ainda nao morreu)
 * e que o `chrome.tabs.update` do motor ja a encontre morta. A unica alavanca
 * de fora e fechar a aba alvo, por OUTRO agente, dentro dessa janela.
 *
 * `Promise.all` dos dois comandos (a versao anterior deste teste) NAO serve
 * mais: com a ordem consertada, o `chrome.tabs.update` e despachado antes do
 * `chrome.tabs.remove` do concorrente e o switch vence 25 de 25 — o teste
 * ficava verde sem exercitar nada. MEDIDO por varredura de atraso
 * (06/09/2026): dando ao `close_tab` uma DIANTEIRA de 0,5 a 5 ms, o switch
 * nunca mais vence e cerca de 1/3 das tentativas caem no ramo do motor. E o
 * que este teste faz, variando o atraso a cada tentativa.
 *
 * ── COMO OS DOIS RAMOS DE FALHA SE DISTINGUEM ────────────────────────────
 *
 * Os dois devolvem "No tab with id: N", mas por caminhos diferentes:
 *   - FREIO  (`chrome.tabs.get` na adocao, quando `onRemoved` ja tirou a aba
 *     de `abasCriadasPelaPonte`): responde `err.message`, SEM prefixo.
 *   - MOTOR  (`chrome.tabs.update`, capturado pelo catch de `run`): responde
 *     `String(err)`, COM o prefixo "Error: ".
 * O invariante vale nos dois; so o ramo do MOTOR e o que este arquivo existe
 * para provar, entao ele e contado a parte.
 *
 *   node test/furo7b-switch-tab-falha-mantem-leitura.js [N]
 */
import { startClient, esperarExtensao, sleep } from './client.js';

let falhou = false;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) { falhou = true; process.exitCode = 1; }
};

const N = Number(process.argv[2]) || 15;

/** Dianteiras (ms) do close_tab sobre o switch_tab — a faixa medida que pega a corrida. */
const DIANTEIRAS = [0.5, 1, 2, 3, 5];

const dono = startClient('furo7b-dono');
const preso = startClient('furo7b-preso');

/**
 * `browser_tab_open` tolerante ao "[aba trocou]".
 *
 * O proprio teste mata as abas do `dono` (e a aba ativa dele e uma delas), e
 * `resolveWorkspace` responde ao comando seguinte com o erro "[aba trocou]"
 * DEPOIS de ja ter aberto uma aba nova — comportamento correto, que aqui e so
 * ruido de montagem.
 */
async function abrir(cli, url) {
  for (let t = 0; t < 3; t++) {
    const r = await cli.call('tools/call', { name: 'browser_tab_open', arguments: { url } });
    if (r.result?.isError !== true) return JSON.parse(r.result.content[0].text).newTabId;
  }
  throw new Error('nao consegui abrir aba-cobaia');
}

/** Sonda: `window.scrollBy` altera a pagina, entao em modo leitura tem de voltar barrado. */
async function presoEmLeitura() {
  const r = await preso.call('tools/call', {
    name: 'browser_javascript', arguments: { codigo: 'window.scrollBy(0,1); 1' },
  });
  const texto = r.result?.content?.[0]?.text || '';
  return r.result?.isError === true && /somente leitura/i.test(texto);
}

let ramoMotor = 0;
let ramoFreio = 0;
let tentativasComSucesso = 0;

try {
  await dono.handshake();
  if (!(await esperarExtensao(dono))) throw new Error('extensao nao conectou');
  await preso.handshake();

  for (let i = 1; i <= N; i++) {
    const dianteira = DIANTEIRAS[(i - 1) % DIANTEIRAS.length];
    const T = await abrir(dono, `https://example.com/furo7b-T-${i}`);
    const C = await abrir(dono, `https://example.com/furo7b-C-${i}`);
    await sleep(200);

    await preso.call('tools/call', { name: 'browser_use_tab', arguments: { tabId: C } });
    if (!(await presoEmLeitura())) {
      console.log(`  [${i}] montagem falhou (preso nao ficou em leitura) -- pulando tentativa`);
      await preso.call('tools/call', { name: 'browser_use_own_tab', arguments: {} });
      await dono.call('tools/call', { name: 'browser_tab_close', arguments: { tabId: C } });
      continue;
    }

    // O close sai na frente por `dianteira` ms: e a alavanca medida que faz o
    // `chrome.tabs.update` do motor encontrar a aba ja morta enquanto o freio
    // ainda a via viva.
    const pClose = dono.call('tools/call', { name: 'browser_tab_close', arguments: { tabId: T } });
    await sleep(dianteira);
    const pSwitch = preso.call('tools/call', { name: 'browser_tab_switch', arguments: { tabId: T } });
    const [, rSwitch] = await Promise.all([pClose, pSwitch]);

    const textoSwitch = rSwitch.result?.content?.[0]?.text || '';
    const switchOk = rSwitch.result?.isError !== true;
    const aindaEmLeitura = await presoEmLeitura();

    if (switchOk) {
      tentativasComSucesso++;
      console.log(`  [${i}] (+${dianteira}ms) switch_tab venceu a corrida -- fora do escopo deste invariante`);
    } else if (/Error:/.test(textoSwitch)) {
      ramoMotor++;
      console.log(`  [${i}] (+${dianteira}ms) ramo MOTOR (${textoSwitch.slice(0, 60)}) -- conferindo o invariante`);
      check(aindaEmLeitura,
        `[${i}] motor falhou e o modo somente-leitura CONTINUA de pe (nao foi solto cedo demais)`);
    } else {
      ramoFreio++;
      console.log(`  [${i}] (+${dianteira}ms) ramo FREIO (${textoSwitch.slice(0, 60)}) -- conferindo o invariante`);
      check(aindaEmLeitura,
        `[${i}] freio recusou e o modo somente-leitura CONTINUA de pe`);
    }

    await preso.call('tools/call', { name: 'browser_use_own_tab', arguments: {} });
    await dono.call('tools/call', { name: 'browser_tab_close', arguments: { tabId: C } });
  }

  console.log(`\n${ramoMotor} tentativa(s) no ramo MOTOR (o que este teste existe para provar), `
    + `${ramoFreio} no ramo FREIO, ${tentativasComSucesso} com troca bem-sucedida, de ${N}.`);
  check(ramoMotor > 0,
    'a corrida foi exercitada pelo menos uma vez no ramo do MOTOR (senao o verde nao prova nada)',
    ramoMotor === 0 ? 'aumente N ou rode de novo' : '');
} catch (err) {
  console.error('ERRO:', err.message);
  falhou = true;
  process.exitCode = 1;
} finally {
  if (!falhou) console.log('\nSEM VIOLACAO DO INVARIANTE em nenhuma tentativa.');
  dono.close();
  preso.close();
}
