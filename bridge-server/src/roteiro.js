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
 * protocolar, enviar) continua sendo chamada separada, com o OK do Dr. Cezar.
 *
 * O roteiro mora num arquivo JSON na pasta da skill (`arquivo`), e o agente so
 * manda as variaveis. Quando o site muda de tela, conserta-se o JSON; a
 * extensao nao precisa de build.
 */
import { readFileSync } from 'node:fs';

// Tools que um roteiro nao pode chamar: a si mesmo (recursao), as que mexem na
// ponte inteira, e as que trocam para a aba ou o perfil do Dr. Cezar.
const PROIBIDAS = new Set([
  'browser_roteiro', 'bridge_reload_extension', 'bridge_limpar', 'bridge_fechar_aba_admin',
  'bridge_faxina_ociosos', 'browser_usar_perfil', 'browser_use_current_tab', 'browser_use_tab',
  'browser_status',
]);

// O Codex desiste de uma tool MCP em ~60 s. O roteiro para sozinho antes disso
// e diz de onde continuar, em vez de ser cortado no meio sem relatorio.
const PRAZO_PADRAO_MS = 50_000;
const PASSO_POLL_MS = 400;
const CORTE_TEXTO = 400;

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
    + 'Laco: {para_cada:"{{lista}}", passos:[...]} com {{item}} e {{indice}}. PROIBIDO confirm em '
    + 'qualquer passo: ato irreversivel e chamada separada. Estourou o prazo: o relatorio traz '
    + 'continuar_de — chame de novo com a_partir_de.',
  inputSchema: {
    type: 'object',
    properties: {
      arquivo: { type: 'string', description: 'Caminho do roteiro JSON ({nome, variaveis?:[obrigatorias], passos}).' },
      passos: { type: 'array', items: { type: 'object' }, description: 'Passos inline (alternativa a arquivo).' },
      variaveis: { type: 'object', description: 'Valores para "{{nome}}" nos passos.' },
      a_partir_de: { type: 'number', description: 'Indice do passo (de continuar_de) para retomar. Padrao 0.' },
      prazo_ms: { type: 'number', description: `Para sozinho antes disto e devolve continuar_de. Padrao ${PRAZO_PADRAO_MS}.` },
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

/** `confirm` em qualquer lugar do roteiro derruba tudo antes do primeiro passo. */
function validar(passos, caminho = '') {
  passos.forEach((p, i) => {
    const onde = `${caminho}${i}${p?.nome ? ` (${p.nome})` : ''}`;
    if (!p || typeof p !== 'object') throw new Error(`passo ${onde}: nao e objeto`);
    if (p.para_cada !== undefined) {
      if (!Array.isArray(p.passos)) throw new Error(`passo ${onde}: para_cada sem passos`);
      if (caminho) throw new Error(`passo ${onde}: para_cada dentro de para_cada nao e suportado`);
      validar(p.passos, `${caminho}${i}.`);
      return;
    }
    if (!p.tool && !p.conferir) throw new Error(`passo ${onde}: precisa de tool ou conferir`);
    if (p.tolerar_erro && !p.conferir) throw new Error(`passo ${onde}: tolerar_erro exige conferir (senao o erro passaria calado)`);
    if (p.tool && PROIBIDAS.has(p.tool)) throw new Error(`passo ${onde}: ${p.tool} nao pode ser usada em roteiro`);
    if (temConfirm(p.args)) {
      throw new Error(`passo ${onde}: confirm e proibido em roteiro — ato irreversivel e chamada separada, com OK do Dr. Cezar`);
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

  const partida = Math.max(0, Math.floor(Number(entrada.a_partir_de) || 0));
  const guardados = {};

  const parar = async (i, passo, motivo, detalhe) => {
    let url;
    try {
      const r = await rodarTool('browser_javascript', { codigo: 'location.href', timeout_ms: 3000 }, { bruto: true });
      if (!r.isError) url = r.data;
    } catch { /* so contexto */ }
    return {
      ok: false, roteiro: nome, feitos: i - partida, total: planos.length,
      parou: { passo: i, nome: passo?.nome, motivo, detalhe: cortar(detalhe) },
      url, guardados: guardadosCurtos(guardados), log, ms: Date.now() - inicio,
    };
  };

  for (let i = partida; i < planos.length; i++) {
    const { passo, extras } = planos[i];
    if (Date.now() - inicio > prazo) {
      const r = await parar(i, passo, 'prazo', `passou de ${prazo} ms; nada falhou — chame de novo com a_partir_de: ${i}`);
      return { ...r, continuar_de: i };
    }
    const escopo = { ...vars, ...guardados, ...extras };
    const t0 = Date.now();

    try {
      if (passo.tool) {
        const args = aplicarVariaveis(passo.args ?? {}, escopo);
        const r = await rodarTool(passo.tool, args, { bruto: true });
        const texto = r.content?.map((c) => c.text).filter(Boolean).join('\n');
        // tolerar_erro: a tool erra mas quem decide e a conferencia do passo (ex.:
        // upload no Portal OAB, onde a conferencia padrao da ponte e a do PJe e
        // diz "nao apareceu" com o arquivo 100% na tela). Sem conferir, nao vale.
        if (r.isError && passo.tolerar_erro && passo.conferir) {
          log.push(`${i} ${passo.nome ?? passo.tool} erro tolerado: ${cortar(texto)}`);
        } else if (r.isError) {
          // Freio da extensao dentro de roteiro: a mensagem dele manda repetir com
          // confirm, o que o roteiro recusa. Dizer o caminho certo aqui.
          const dica = /\[bloqueado\]/.test(texto ?? '')
            ? 'DENTRO DE ROTEIRO: faca este passo como chamada separada, com o OK do Dr. Cezar, e retome com a_partir_de. || '
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
        let ultimo;
        for (;;) {
          const r = await rodarTool('browser_javascript', { codigo: js, timeout_ms: 15_000 }, { bruto: true });
          ultimo = r.isError ? r.content?.[0]?.text : r.data;
          if (!r.isError && okDaConferencia(r.data)) break;
          // {parar:true}: a conferencia viu algo que esperar nao resolve (ex.: nenhuma opcao
          // identica). Para ja, em vez de gastar o ate_ms inteiro repetindo.
          if (!r.isError && r.data && typeof r.data === 'object' && r.data.parar === true) {
            return parar(i, passo, 'conferencia pediu para parar', ultimo);
          }
          if (Date.now() - t0 >= ate) {
            return parar(i, passo, 'conferencia nao bateu', ultimo);
          }
          await new Promise((res) => setTimeout(res, PASSO_POLL_MS));
        }
        if (passo.conferir.guardar) guardados[passo.conferir.guardar] = ultimo;
      }
    } catch (err) {
      return parar(i, passo, 'erro no roteiro', err.message);
    }

    log.push(`${i} ${passo.nome ?? passo.tool ?? 'conferir'} ok ${Date.now() - t0}ms`);
  }

  return { ok: true, roteiro: nome, feitos: planos.length - partida, total: planos.length, guardados: guardadosCurtos(guardados), log, ms: Date.now() - inicio };
}
