/**
 * browser_roteiro — varios passos da ponte numa chamada so (16/09/2026).
 *
 * Por que existe: medido nos registros do Codex (15/09/2026), um cadastro no
 * PJe custou ~90 rodadas do modelo, cada uma reenviando ~150 mil tokens de
 * contexto, enquanto a ponte em si respondia em ~0,2 s. O caro nao era o
 * clique, era o modelo pensar entre um clique e outro. Tela repetitiva
 * (Portal OAB, abas do PJe) nao precisa de decisao entre passos — precisa de
 * CONFERENCIA entre passos. Isto executa a sequencia aqui, no servidor, e so
 * devolve ao agente quando acaba ou quando uma conferencia nao bate.
 *
 * O que NAO muda: cada passo passa por `rodarTool`, o mesmo caminho de uma
 * chamada avulsa — mesmo build, mesmo freio na extensao, mesmo `lido`. O
 * roteiro recusa `confirm` em qualquer passo: ato irreversivel (assinar,
 * protocolar, enviar) continua sendo chamada separada, com o OK do usuário.
 *
 * O roteiro mora num arquivo JSON na pasta da skill (`arquivo`), e o agente so
 * manda as variaveis. Quando o site muda de tela, conserta-se o JSON; a
 * extensao nao precisa de build.
 */
import { readFileSync } from 'node:fs';

// Tools que um roteiro nao pode chamar: a si mesmo (recursao), as que mexem na
// ponte inteira, e as que trocam para a aba ou o perfil do usuário.
const PROIBIDAS = new Set([
  'browser_roteiro', 'bridge_reload_extension', 'bridge_limpar', 'bridge_fechar_aba_admin',
  'bridge_faxina_ociosos', 'browser_usar_perfil', 'browser_use_current_tab', 'browser_use_tab',
  'browser_status',
]);

// O Codex desiste de uma tool MCP em ~60 s. O roteiro para sozinho antes disso
// e diz de onde continuar, em vez de ser cortado no meio sem relatorio.
//
// B2 (20/10/2026): o prazo agora vale DENTRO de cada passo, nao so entre eles.
// Antes ele so era conferido antes de cada passo, e um passo podia durar 120-315 s
// (teto proprio da tool, ou `conferir` com ate_ms grande) -- o Codex cortava aos
// ~60 s sem relatorio. Agora cada rodarTool recebe o TEMPO RESTANTE como teto de
// transporte, o laco do `conferir` olha o prazo, e o padrao baixou de 50 para 40 s
// (folga para o ultimo passo estourar e o relatorio ainda sair antes dos 60 s).
const PRAZO_PADRAO_MS = 40_000;
// Piso do teto de um passo: com menos que isso o passo falharia so por falta de
// tempo. O prazo pode ser ultrapassado em ate esse tanto.
const PASSO_MINIMO_MS = 1_000;
const PASSO_POLL_MS = 400;
// Tools que so LEEM: se estourarem, repetir o passo e seguro. Qualquer outra pode
// ter agido na pagina antes de o transporte desistir de esperar.
const TOOLS_DE_LEITURA = new Set([
  'browser_read_page', 'browser_find', 'browser_extract', 'browser_screenshot', 'browser_console_logs',
  'browser_network_requests', 'browser_network_body', 'browser_tabs_list', 'browser_tabs_all',
  'browser_wait', 'browser_wait_for_text', 'browser_wait_for_change', 'browser_wait_network',
  'browser_javascript_conferir',
]);
const CORTE_TEXTO = 400;
export const LEITURA_FINAL_MAX_CHARS_PADRAO = 3000;

export const ROTEIRO_TOOL = {
  name: 'browser_roteiro',
  description:
    'Executa VARIOS passos da ponte numa chamada so, conferindo a tela entre eles, e devolve um '
    + 'relatorio curto. Use em tela repetitiva com receita pronta (Portal OAB, abas do PJe): em vez '
    + 'de 20 chamadas suas, uma. Para no PRIMEIRO passo que falhar ou cuja conferencia nao bater, e '
    + 'diz qual, por que e a URL atual — dai voce decide. Normalmente passe `arquivo` (o roteiro JSON '
    + 'da skill) e `variaveis`; so escreva `passos` na mao para experimentar. Cada passo e '
    + '{nome, tool, args, conferir?, guardar?, guardar_ref?, tolerar_erro?}: `tool` e o nome de qualquer tool browser_* '
    + '(passa pelo mesmo freio de sempre); "{{var}}" nos args e trocado pela variavel; `guardar_ref` '
    + 'pega o [ref] do 1o resultado de um browser_find; `guardar` guarda o retorno; `tolerar_erro` (so com '
    + 'conferir) deixa a conferencia decidir quando a tool erra; `conferir` e '
    + '{js, ate_ms?}: expressao JS que tem de devolver true ou {ok:true,...}, repetida ate ate_ms ({parar:true} para na hora). '
    + 'Laco: {para_cada:"{{lista}}", passos:[...]} com {{item}} e {{indice}}. Decisao: {se:{js, ate_ms?, guardar?}, entao:[passos], senao?:[passos]} '
    + '(js true ou {ok:true} segue o entao; qualquer outra coisa, o senao; erro no js para o roteiro; so 1 nivel, so no topo; ramos so tem passos simples). PROIBIDO confirm em '
    + 'qualquer passo: ato irreversivel e chamada separada. Estourou o prazo: o relatorio traz '
    + 'continuar_de — chame de novo com a_partir_de. Se o prazo estourar DENTRO de um passo de acao, o '
    + 'relatorio diz "pode ter executado — nao repita": olhe a tela antes de retomar.',
  inputSchema: {
    type: 'object',
    properties: {
      arquivo: { type: 'string', description: 'Caminho do roteiro JSON ({nome, variaveis?:[obrigatorias], passos}).' },
      passos: { type: 'array', items: { type: 'object' }, description: 'Passos inline (alternativa a arquivo).' },
      variaveis: { type: 'object', description: 'Valores para "{{nome}}" nos passos.' },
      a_partir_de: { type: ['number', 'string'], description: 'Indice do passo (de continuar_de) para retomar. Padrao 0. Dentro de um ramo de se: "3.entao.1" (passo 3, ramo entao, 2o passo do ramo; a condicao nao e reavaliada).' },
      leitura_final: {
        type: 'object',
        description:
          'Opcional. Se presente, ao TERMINAR com sucesso o roteiro ja devolve a leitura da pagina (mesma de '
          + `browser_read_page) em "leitura", poupando uma chamada. {mode?: "interactive"|"full", max_chars?: padrao ${LEITURA_FINAL_MAX_CHARS_PADRAO}}. `
          + 'Passe {} para o padrao. Sem isto nao le nada (a URL final vem sempre).',
        properties: {
          mode: { type: 'string', enum: ['interactive', 'full'] },
          max_chars: { type: 'number' },
        },
      },
      prazo_ms: {
        type: 'number',
        description: `Para sozinho antes disto e devolve continuar_de. Vale tambem DENTRO de cada passo (o tempo que resta vira o teto dele). Padrao ${PRAZO_PADRAO_MS}.`,
      },
    },
  },
};

const cortar = (s) => {
  const t = typeof s === 'string' ? s : JSON.stringify(s);
  return t && t.length > CORTE_TEXTO ? `${t.slice(0, CORTE_TEXTO)}…` : t;
};

/** "item.tipo" le o campo tipo de item; variavel ausente e erro, nunca texto vazio calado. */
function lerVariavel(vars, caminho) {
  const [raiz, ...resto] = caminho.split('.');
  if (!(raiz in vars)) throw new Error(`variavel "${raiz}" nao informada`);
  let v = vars[raiz];
  for (const campo of resto) {
    if (v === null || typeof v !== 'object' || !(campo in v)) throw new Error(`variavel "${caminho}" nao existe`);
    v = v[campo];
  }
  return v;
}

/** Troca "{{var}}". String que e SO a variavel recebe o valor cru (array, numero). */
export function aplicarVariaveis(valor, vars) {
  if (typeof valor === 'string') {
    const inteira = valor.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (inteira) return lerVariavel(vars, inteira[1]);
    // {{json:var}} vira literal JSON — e o jeito seguro de pôr nome com aspas ou
    // acento dentro de um script de `conferir`/`codigo`.
    return valor.replace(/\{\{\s*(json:)?([\w.]+)\s*\}\}/g, (_, json, k) => {
      const v = lerVariavel(vars, k);
      if (json) return JSON.stringify(v);
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(valor)) return valor.map((v) => aplicarVariaveis(v, vars));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, aplicarVariaveis(v, vars)]));
  }
  return valor;
}

/**
 * `confirm` em qualquer lugar do roteiro derruba tudo antes do primeiro passo.
 * `ramo` = validando os passos de um `entao`/`senao` (V5): la dentro so passo simples.
 */
function validar(passos, caminho = '', ramo = false) {
  passos.forEach((p, i) => {
    const onde = `${caminho}${i}${p?.nome ? ` (${p.nome})` : ''}`;
    if (!p || typeof p !== 'object') throw new Error(`passo ${onde}: nao e objeto`);
    if (p.se !== undefined) {
      // V5: decisao declarativa. So 1 nivel: `se` nao entra em `se`, em ramo, nem em para_cada.
      if (ramo || caminho) throw new Error(`passo ${onde}: se so e aceito no nivel de cima do roteiro (sem aninhar em se ou para_cada)`);
      if (!p.se || typeof p.se !== 'object' || typeof p.se.js !== 'string' || !p.se.js.trim()) {
        throw new Error(`passo ${onde}: se precisa de {js}`);
      }
      if (p.tool || p.conferir || p.para_cada !== undefined) throw new Error(`passo ${onde}: se nao combina com tool, conferir ou para_cada no mesmo passo`);
      if (!Array.isArray(p.entao)) throw new Error(`passo ${onde}: se precisa de entao: [passos]`);
      if (p.senao !== undefined && !Array.isArray(p.senao)) throw new Error(`passo ${onde}: senao precisa ser lista de passos`);
      validar(p.entao, `${caminho}${i}.entao.`, true);
      if (p.senao) validar(p.senao, `${caminho}${i}.senao.`, true);
      return;
    }
    if (p.para_cada !== undefined) {
      if (ramo) throw new Error(`passo ${onde}: para_cada dentro de entao/senao nao e suportado`);
      if (!Array.isArray(p.passos)) throw new Error(`passo ${onde}: para_cada sem passos`);
      if (caminho) throw new Error(`passo ${onde}: para_cada dentro de para_cada nao e suportado`);
      validar(p.passos, `${caminho}${i}.`);
      return;
    }
    if (!p.tool && !p.conferir) throw new Error(`passo ${onde}: precisa de tool ou conferir`);
    if (p.tolerar_erro && !p.conferir) throw new Error(`passo ${onde}: tolerar_erro exige conferir (senao o erro passaria calado)`);
    if (p.tool && PROIBIDAS.has(p.tool)) throw new Error(`passo ${onde}: ${p.tool} nao pode ser usada em roteiro`);
    if (temConfirm(p.args)) {
      throw new Error(`passo ${onde}: confirm e proibido em roteiro — ato irreversivel e chamada separada, com OK do usuário`);
    }
  });
}

function temConfirm(v) {
  if (Array.isArray(v)) return v.some(temConfirm);
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k === 'confirm' || temConfirm(x));
  return false;
}

const guardadosCurtos = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, cortar(v)]));

const okDaConferencia = (v) => v === true || (v && typeof v === 'object' && v.ok === true);

/**
 * @param {object} entrada input da tool
 * @param {(name:string, input:object, opts?:object) => Promise<object>} rodarTool
 */
export async function executarRoteiro(entrada, rodarTool) {
  const inicio = Date.now();
  const prazo = Number(entrada.prazo_ms) > 0 ? Number(entrada.prazo_ms) : PRAZO_PADRAO_MS;
  const fimDoPrazo = inicio + prazo;
  /** Teto de transporte do proximo passo: o que resta do prazo, com piso. */
  const tetoDoPasso = () => Math.max(fimDoPrazo - Date.now(), PASSO_MINIMO_MS);
  let nome = 'inline';
  let passos;
  const vars = { ...(entrada.variaveis ?? {}) };
  const log = [];

  try {
    if (entrada.arquivo) {
      const def = JSON.parse(readFileSync(entrada.arquivo, 'utf8'));
      nome = def.nome ?? entrada.arquivo;
      passos = def.passos;
      const faltam = (def.variaveis ?? []).filter((v) => !(v in vars));
      if (faltam.length) throw new Error(`faltam variaveis obrigatorias: ${faltam.join(', ')}`);
    } else {
      passos = entrada.passos;
    }
    if (!Array.isArray(passos) || !passos.length) throw new Error('roteiro sem passos (informe arquivo ou passos)');
    validar(passos);
  } catch (err) {
    return { ok: false, roteiro: nome, feitos: 0, parou: { passo: null, motivo: 'roteiro invalido', detalhe: err.message } };
  }

  // Achata o para_cada ja com as variaveis do item, para o indice de retomada
  // (continuar_de) ser um numero so e estavel entre chamadas.
  const planos = [];
  for (const p of passos) {
    if (p.para_cada === undefined) { planos.push({ passo: p, extras: {} }); continue; }
    let lista;
    try { lista = aplicarVariaveis(p.para_cada, vars); } catch (err) {
      return { ok: false, roteiro: nome, feitos: 0, parou: { passo: null, motivo: 'roteiro invalido', detalhe: err.message } };
    }
    if (!Array.isArray(lista)) {
      return { ok: false, roteiro: nome, feitos: 0, parou: { passo: null, motivo: 'roteiro invalido', detalhe: 'para_cada nao e lista' } };
    }
    lista.forEach((item, indice) => {
      for (const sub of p.passos) planos.push({ passo: sub, extras: { item, indice } });
    });
  }

  // a_partir_de: indice (numero) ou "3.entao.1" (V5: retomar DENTRO do ramo de um `se`).
  let partida = 0;
  let retomada = null;
  const bruto = entrada.a_partir_de;
  if (typeof bruto === 'string' && /^\d+\.(entao|senao)\.\d+$/.test(bruto.trim())) {
    const [a, ramo, j] = bruto.trim().split('.');
    partida = Number(a);
    retomada = { ramo, j: Number(j) };
    if (!planos[partida]?.passo?.se) {
      return { ok: false, roteiro: nome, feitos: 0, parou: { passo: null, motivo: 'roteiro invalido', detalhe: `a_partir_de ${bruto}: o passo ${partida} nao e um se` } };
    }
  } else {
    partida = Math.max(0, Math.floor(Number(bruto) || 0));
  }
  const guardados = {};
  /** Indice (do plano) do passo de cima em execucao: base de `feitos`. */
  let topo = partida;

  const parar = async (i, passo, motivo, detalhe, extra = {}) => {
    let url;
    try {
      const r = await rodarTool('browser_javascript', { codigo: 'location.href', timeout_ms: 3000 }, { bruto: true, timeout_ms: 4000 });
      if (!r.isError) url = r.data;
    } catch { /* so contexto */ }
    return {
      ok: false, roteiro: nome, feitos: topo - partida, total: planos.length,
      parou: { passo: i, nome: passo?.nome, motivo, detalhe: cortar(detalhe) },
      url, guardados: guardadosCurtos(guardados), log, ms: Date.now() - inicio, ...extra,
    };
  };
  /** O transporte desistiu de esperar porque o prazo acabou no meio do passo? */
  const estouroDoPrazo = (texto) => Date.now() >= fimDoPrazo - 250 && /estourou .*sem resposta/.test(texto ?? '');

  /**
   * Um passo simples (tool e/ou conferir). Devolve undefined se deu certo, ou o relatorio
   * de parada. `pos` = {idx, prox}: o que vai em parou.passo/continuar_de (numero no nivel
   * de cima; "3.entao.1" dentro de ramo de `se`).
   */
  const rodarPasso = async (passo, extras, pos) => {
    const i = pos.idx;
    const escopo = { ...vars, ...guardados, ...extras };
    const t0 = Date.now();

    try {
      if (passo.tool) {
        const args = aplicarVariaveis(passo.args ?? {}, escopo);
        const r = await rodarTool(passo.tool, args, { bruto: true, timeout_ms: tetoDoPasso() });
        const texto = r.content?.map((c) => c.text).filter(Boolean).join('\n');
        if (r.isError && estouroDoPrazo(texto)) {
          // B2: o prazo acabou NO MEIO do passo. Uma acao pode ter chegado a rodar
          // na pagina; so uma leitura e segura de repetir.
          if (TOOLS_DE_LEITURA.has(passo.tool)) {
            return parar(i, passo, 'prazo', `prazo estourou no passo (leitura, nada mudou na pagina); pode repetir — chame de novo com a_partir_de: ${i}`, { continuar_de: i });
          }
          return parar(
            i, passo, 'prazo',
            `prazo estourou no passo; pode ter executado — nao repita. Olhe a tela (browser_read_page) e retome com a_partir_de: ${pos.prox}`,
            { continuar_de: pos.prox },
          );
        }
        // tolerar_erro: a tool erra mas quem decide e a conferencia do passo (ex.:
        // upload no Portal OAB, onde a conferencia padrao da ponte e a do PJe e
        // diz "nao apareceu" com o arquivo 100% na tela). Sem conferir, nao vale.
        if (r.isError && passo.tolerar_erro && passo.conferir) {
          log.push(`${i} ${passo.nome ?? passo.tool} erro tolerado: ${cortar(texto)}`);
        } else if (r.isError && /\[viewport mudou\]/.test(texto ?? '')) {
          // v6.1 (a): a janela mudou de tamanho desde a ultima leitura e o clique por coordenada
          // NAO saiu. Devolve a leitura nova junto: as coordenadas do roteiro/agente podem estar
          // velhas. Nada foi feito na pagina, entao retomar deste passo e seguro.
          const nova = await rodarTool('browser_read_page', { max_chars: LEITURA_FINAL_MAX_CHARS_PADRAO }, { timeout_ms: Math.max(tetoDoPasso(), 5000) }).catch(() => null);
          const leitura = nova && !nova.isError ? nova.content?.map((c) => c.text).filter(Boolean).join('\n') : undefined;
          return parar(i, passo, 'viewport mudou', texto, { continuar_de: i, ...(leitura ? { leitura } : {}) });
        } else if (r.isError) {
          // Freio da extensao dentro de roteiro: a mensagem dele manda repetir com
          // confirm, o que o roteiro recusa. Dizer o caminho certo aqui.
          const dica = /\[bloqueado\]/.test(texto ?? '')
            ? (/aguardando decis[aã]o/i.test(texto ?? '')
              ? 'DENTRO DE ROTEIRO: o usuário foi avisado no Windows. Espere com browser_decisao, faca este passo como chamada separada e retome com a_partir_de. || '
              : 'DENTRO DE ROTEIRO: faca este passo como chamada separada, com o OK do usuário, e retome com a_partir_de. || ')
            : '';
          return parar(i, passo, `${passo.tool} falhou`, `${dica}${texto}`);
        }
        if (passo.guardar) guardados[passo.guardar] = r.data ?? texto;
        if (passo.guardar_ref) {
          const ref = texto?.match(/\[(\d+)\]/)?.[1];
          if (!ref) return parar(i, passo, 'ref nao encontrada', texto);
          guardados[passo.guardar_ref] = Number(ref);
        }
      }

      if (passo.conferir) {
        const js = aplicarVariaveis(passo.conferir.js, escopo);
        const ate = Number(passo.conferir.ate_ms) || 0;
        // B2: ate_ms nunca passa do prazo do roteiro.
        const limiteConferir = Math.min(t0 + ate, Math.max(fimDoPrazo, t0));
        const limitadoPeloPrazo = ate > 0 && t0 + ate > fimDoPrazo;
        // Depois de uma acao no mesmo passo, repetir o passo repetiria a acao.
        const prazoDaConferencia = () => parar(
          i, passo, 'prazo',
          passo.tool
            ? `conferencia ainda nao bateu quando o prazo acabou; a acao do passo JA rodou — nao repita. Olhe a tela e retome com a_partir_de: ${pos.prox}`
            : `conferencia ainda nao bateu quando o prazo acabou; nada falhou — chame de novo com a_partir_de: ${i}`,
          { continuar_de: passo.tool ? pos.prox : i },
        );
        let ultimo;
        for (;;) {
          const r = await rodarTool('browser_javascript', { codigo: js, timeout_ms: 15_000 }, { bruto: true, timeout_ms: tetoDoPasso() });
          ultimo = r.isError ? r.content?.[0]?.text : r.data;
          if (!r.isError && okDaConferencia(r.data)) break;
          // {parar:true}: a conferencia viu algo que esperar nao resolve (ex.: nenhuma opcao
          // identica). Para ja, em vez de gastar o ate_ms inteiro repetindo.
          if (!r.isError && r.data && typeof r.data === 'object' && r.data.parar === true) {
            return parar(i, passo, 'conferencia pediu para parar', ultimo);
          }
          if (Date.now() >= limiteConferir) {
            return limitadoPeloPrazo ? prazoDaConferencia() : parar(i, passo, 'conferencia nao bateu', ultimo);
          }
          await new Promise((res) => setTimeout(res, PASSO_POLL_MS));
        }
        if (passo.conferir.guardar) guardados[passo.conferir.guardar] = ultimo;
      }
    } catch (err) {
      return parar(i, passo, 'erro no roteiro', err.message);
    }

    log.push(`${i} ${passo.nome ?? passo.tool ?? 'conferir'} ok ${Date.now() - t0}ms`);
    return undefined;
  };

  /**
   * V5: `se` decide por avaliacao JS (mesma mecanica do conferir: true ou {ok:true} = sim; erro no
   * proprio JS nao vira "nao": para o roteiro) e roda os passos do ramo escolhido, que passam
   * pelas mesmas travas de qualquer passo (confirm e tools proibidas ja foram barrados em validar()).
   */
  const rodarSe = async (passo, extras, i, retomar) => {
    let ramo;
    if (retomar) {
      ramo = retomar.ramo;
    } else {
      const escopo = { ...vars, ...guardados, ...extras };
      const t0 = Date.now();
      let js;
      try { js = aplicarVariaveis(passo.se.js, escopo); } catch (err) { return parar(i, passo, 'erro no roteiro', err.message); }
      const ate = Number(passo.se.ate_ms) || 0;
      const limite = Math.min(t0 + ate, Math.max(fimDoPrazo, t0));
      const limitadoPeloPrazo = ate > 0 && t0 + ate > fimDoPrazo;
      let ultimo;
      let sim = false;
      for (;;) {
        const r = await rodarTool('browser_javascript', { codigo: js, timeout_ms: 15_000 }, { bruto: true, timeout_ms: tetoDoPasso() });
        if (r.isError) {
          const texto = r.content?.[0]?.text;
          if (estouroDoPrazo(texto)) return parar(i, passo, 'prazo', 'prazo estourou ao avaliar a condicao do se (so leitura); chame de novo com a_partir_de: ' + i, { continuar_de: i });
          return parar(i, passo, 'condicao do se falhou', texto);
        }
        ultimo = r.data;
        if (okDaConferencia(r.data)) { sim = true; break; }
        if (Date.now() >= limite) {
          if (limitadoPeloPrazo) return parar(i, passo, 'prazo', `a condicao do se ainda nao era verdadeira quando o prazo acabou; nada foi feito — chame de novo com a_partir_de: ${i}`, { continuar_de: i });
          break;
        }
        await new Promise((res) => setTimeout(res, PASSO_POLL_MS));
      }
      if (passo.se.guardar) guardados[passo.se.guardar] = ultimo;
      ramo = sim ? 'entao' : 'senao';
      log.push(`${i} ${passo.nome ?? 'se'} -> ${ramo}${ramo === 'senao' && !passo.senao ? ' (sem senao: nada a fazer)' : ''}`);
    }
    const lista = passo[ramo] ?? [];
    for (let j = retomar ? retomar.j : 0; j < lista.length; j++) {
      if (Date.now() - inicio > prazo) {
        const rotulo = `${i}.${ramo}.${j}`;
        const r = await parar(rotulo, lista[j], 'prazo', `passou de ${prazo} ms dentro do ramo; nada falhou — chame de novo com a_partir_de: "${rotulo}"`);
        return { ...r, continuar_de: rotulo };
      }
      const prox = j + 1 < lista.length ? `${i}.${ramo}.${j + 1}` : i + 1;
      const falha = await rodarPasso(lista[j], extras, { idx: `${i}.${ramo}.${j}`, prox });
      if (falha) return falha;
    }
    return undefined;
  };

  for (let i = partida; i < planos.length; i++) {
    topo = i;
    const { passo, extras } = planos[i];
    if (Date.now() - inicio > prazo) {
      const r = await parar(i, passo, 'prazo', `passou de ${prazo} ms; nada falhou — chame de novo com a_partir_de: ${i}`);
      return { ...r, continuar_de: i };
    }
    const falha = passo.se !== undefined
      ? await rodarSe(passo, extras, i, i === partida ? retomada : null)
      : await rodarPasso(passo, extras, { idx: i, prox: i + 1 });
    if (falha) return falha;
  }

  // V4: a URL final vem sempre; a leitura so quando pedida (leitura_final).
  let url;
  try {
    const r = await rodarTool('browser_javascript', { codigo: 'location.href', timeout_ms: 3000 }, { bruto: true, timeout_ms: Math.min(4000, tetoDoPasso()) });
    if (!r.isError) url = r.data;
  } catch { /* so contexto */ }
  const final = { ok: true, roteiro: nome, feitos: planos.length - partida, total: planos.length, url, guardados: guardadosCurtos(guardados), log };
  const lf = entrada.leitura_final;
  if (lf !== undefined && lf !== null && lf !== false) {
    const cfg = typeof lf === 'object' ? lf : {};
    const maxChars = Number(cfg.max_chars) > 0 ? Math.floor(Number(cfg.max_chars)) : LEITURA_FINAL_MAX_CHARS_PADRAO;
    const args = { max_chars: maxChars, ...(cfg.mode ? { mode: cfg.mode } : {}) };
    try {
      const r = await rodarTool('browser_read_page', args, { timeout_ms: Math.max(tetoDoPasso(), 5000) });
      const texto = r.content?.map((c) => c.text).filter(Boolean).join('\n');
      if (r.isError) final.leitura_erro = cortar(texto);
      else final.leitura = texto;
    } catch (err) {
      final.leitura_erro = cortar(err.message);
    }
  }
  final.ms = Date.now() - inicio;
  return final;
}
