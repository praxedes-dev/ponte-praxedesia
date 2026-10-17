import { focoEmMoldura } from '../../execution-engine/molduras';
import { debuggerManager as dm } from '../../debugger-manager';
import { cdpPressKey } from '../../execution-engine/cdp-tools';
import { resolverAlvoDaAcao, type AlvoResolvido } from '../../execution-engine';
import { avaliar } from '../policy';
import type { ModuloCapacidades } from './registro';

/**
 * Define o valor de um campo direto, disparando os eventos que frameworks
 * escutam. Clicar num `<select>` nativo por coordenada e sofrimento; isto
 * resolve select, checkbox, radio e input de uma vez.
 */
export async function preencherCampo(
  tabId: number,
  backendNodeId: number,
  valor: string | boolean,
): Promise<string> {
  const resolvido = await dm.send<{ object: { objectId: string } }>(
    tabId, 'DOM.resolveNode', { backendNodeId },
  );
  const objectId = resolvido?.object?.objectId;
  if (!objectId) throw new Error(`ref ${backendNodeId} nao existe mais na pagina`);

  const res = await dm.send<{ result: { value: { ok: boolean; detalhe: string } } }>(
    tabId, 'Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      arguments: [{ value: valor }],
      functionDeclaration: `function(valor) {
        // A arvore de acessibilidade lista cada <option> como elemento proprio,
        // entao o agente frequentemente manda a ref da opcao em vez da do select.
        // Subir sozinho evita "preencher" uma option, que nao muda nada na pagina.
        var alvo = this.tagName === 'OPTION' ? this.closest('select') : this;
        if (!alvo) return { ok: false, detalhe: 'option solta, sem select em volta' };

        // Select2 (os combos do PJe): o que a arvore de acessibilidade mostra e um
        // <span role=combobox> montado pela biblioteca; o <select> real fica ao
        // lado, com a classe select2-hidden-accessible. Setar o span "funcionava"
        // e o valor nao era gravado -- a tool respondia sucesso mentindo.
        if (alvo.tagName !== 'SELECT' && alvo.closest) {
          var container = alvo.closest('.select2, .select2-container');
          if (container) {
            var real = container.previousElementSibling;
            if (!(real && real.tagName === 'SELECT') && container.parentElement) {
              real = container.parentElement.querySelector('select.select2-hidden-accessible, select');
            }
            if (real && real.tagName === 'SELECT') alvo = real;
          }
        }

        // O CDP resolve o backendNodeId de um no DESANEXADO (removido do DOM
        // por um re-render, mas ainda vivo em memoria) e devolve objectId
        // valido -- sem isto a tool escreveria e releria do MESMO no fantasma,
        // "confirmando" o valor contra si mesma em vez de contra a pagina
        // viva, e devolveria ok:true para um campo que nao existe mais.
        // O PJe re-renderiza campo por AJAX o tempo todo: isto e o caso
        // normal, nao o exotico.
        if (!alvo.isConnected) {
          return {
            ok: false,
            detalhe: 'campo nao existe mais na pagina (foi removido ou re-renderizado antes de eu escrever). '
              + 'Releia a pagina com browser_read_page e repita com a ref nova.',
          };
        }

        const tag = alvo.tagName.toLowerCase();
        const tipo = (alvo.getAttribute('type') || '').toLowerCase();

        if (tipo === 'checkbox' || tipo === 'radio') {
          alvo.checked = valor === true || valor === 'true' || valor === alvo.value;
        } else if (tag === 'select') {
          var procurado = String(valor).toLowerCase();
          var opcao = Array.from(alvo.options).find(function (o) {
            return o.value.toLowerCase() === procurado || o.text.trim().toLowerCase() === procurado;
          });
          if (!opcao) {
            var disponiveis = Array.from(alvo.options).map(function (o) { return o.text.trim(); });
            return { ok: false, detalhe: 'opcao nao encontrada. Disponiveis: ' + disponiveis.join(' | ') };
          }
          alvo.value = opcao.value;
        } else if (alvo.isContentEditable) {
          alvo.textContent = String(valor);
        } else {
          alvo.value = String(valor);
        }

        // Frameworks so reagem ao evento, nao a atribuicao direta.
        alvo.dispatchEvent(new Event('input', { bubbles: true }));
        alvo.dispatchEvent(new Event('change', { bubbles: true }));

        // O proprio evento que acabei de disparar pode ter disparado um
        // re-render sincrono (framework que troca o campo na hora do
        // onchange) que arranca ESTE no do documento. Reler alvo.value dali
        // pra frente confirmaria contra o mesmo fantasma -- checa de novo,
        // agora depois do dispatch, antes de confiar na releitura.
        if (!alvo.isConnected) {
          return {
            ok: false,
            detalhe: 'escrevi o valor mas o campo saiu da pagina durante o input/change (provavel '
              + 're-render). Releia com browser_read_page antes de confiar neste campo.',
          };
        }

        // Reler e comparar. Sistema como o PJe quase nunca da erro: aceita o valor
        // errado, escolhe outro sozinho e segue. A leitura de volta e a unica
        // defesa, e tem de vir da propria tool -- nao bateu, e erro, nunca "ok".
        var esperado, lido;
        if (tipo === 'checkbox' || tipo === 'radio') {
          esperado = String(valor === true || valor === 'true' || valor === alvo.value);
          lido = String(alvo.checked);
        } else if (tag === 'select') {
          esperado = opcao.value;
          lido = alvo.value;
        } else {
          esperado = String(valor);
          lido = alvo.isContentEditable ? alvo.textContent : String(alvo.value);
        }
        if (lido !== esperado) {
          return { ok: false, detalhe: 'escrevi "' + esperado + '" mas o campo ficou com "' + lido + '"' };
        }
        return { ok: true, detalhe: tag + (tipo ? '[' + tipo + ']' : '') + ' = ' + lido, lido: lido };
      }`,
    },
  );

  const r = res?.result?.value;
  if (!r?.ok) throw new Error(r?.detalhe || 'nao consegui preencher o campo');
  return r.detalhe;
}

/** Valor atual de um campo, lido do DOM. E o que toda tool de escrita devolve. */
export async function lerValorDoElemento(tabId: number, backendNodeId: number): Promise<string | null> {
  try {
    const resolvido = await dm.send<{ object: { objectId: string } }>(
      tabId, 'DOM.resolveNode', { backendNodeId },
    );
    const objectId = resolvido?.object?.objectId;
    if (!objectId) return null;
    const res = await dm.send<{ result: { value: string } }>(tabId, 'Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function() {
        if (this.isContentEditable) return this.textContent;
        return this.value !== undefined ? String(this.value) : (this.innerText || '');
      }`,
    });
    return res?.result?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Digita como teclado humano: uma tecla por vez, com `isTrusted: true`.
 *
 * O `type` normal seta `.value` e dispara `input`/`change` -- rapido, e resolve
 * a maioria dos campos. Nao resolve campo cujo comportamento depende do ATO
 * de digitar: o CEP do PJe tem `onchange` que retorna antes de submeter se o
 * campo ja tiver valor, entao valor colado nunca dispara o ciclo. Aqui cada
 * caractere e um keyDown/keyUp de verdade via CDP.
 *
 * `Input.insertText` nao serviria: e `isTrusted` mas nao gera keydown/keyup,
 * e o widget do PJe escuta tecla.
 */
export async function digitarTeclaATecla(
  tabId: number,
  backendNodeId: number | undefined,
  texto: string,
  delayMs = 60,
): Promise<{ digitado: string; lido: string | null }> {
  if (backendNodeId !== undefined) {
    // OBRA 26 — aqui estava `.catch(() => {})`, o mesmo `catch` cego que ja
    // custou seis defeitos nesta casa. As teclas seguintes sao
    // `Input.dispatchKeyEvent`, que NAO aceita alvo: vao para quem estiver com
    // foco. Se o foco falhou (elemento `disabled`, escondido, nao focavel), as
    // teclas caem em quem estava focado ANTES — um elemento que o freio nunca
    // examinou. MEDIDO em bancada (06/09/2026): `cap_digitar` com a ref de um
    // campo desabilitado e um `<input type=password>` focado digitou a senha
    // inteira no campo de senha e devolveu sucesso.
    //
    // Falha FECHADA, em duas camadas: o erro do CDP sobe, e — quando o CDP nao
    // reclama mas o foco tambem nao anda — a CONFERENCIA de volta pega. Ler de
    // volta e a unica defesa desta casa contra sistema que aceita e ignora.
    try {
      await dm.send(tabId, 'DOM.focus', { backendNodeId });
    } catch (err) {
      // "Element is not focusable" num contenteditable que JA esta com o foco
      // (campo Nome do WhatsApp, relato MARCO 30/09/2026): o foco pedido ja e
      // o foco real, entao nao ha risco de as teclas cairem em outro lugar.
      const jaFocado = await dm.send<{ result?: { value?: boolean } }>(tabId, 'Runtime.callFunctionOn', {
        objectId: (await dm.send<{ object?: { objectId?: string } }>(
          tabId, 'DOM.resolveNode', { backendNodeId },
        ).catch(() => undefined))?.object?.objectId,
        returnByValue: true,
        functionDeclaration: 'function() { var a = document.activeElement; return a === this || (!!a && this.contains(a)) || (!!a && a.contains(this) && a.isContentEditable); }',
      }).catch(() => undefined);
      if (jaFocado?.result?.value !== true) throw new Error(
        `nao consegui colocar o foco no campo (ref ${backendNodeId}): ${String((err as Error)?.message ?? err)}. `
        + 'Nao digitei nada — as teclas iriam para o elemento que estava focado antes, que ninguem examinou. '
        + 'Confira se o campo esta habilitado e visivel, releia a pagina com browser_read_page e repita.',
      );
    }
    await new Promise((r) => setTimeout(r, 80));

    const focou = await dm.send<{ result?: { value?: boolean } }>(tabId, 'Runtime.callFunctionOn', {
      objectId: (await dm.send<{ object?: { objectId?: string } }>(
        tabId, 'DOM.resolveNode', { backendNodeId },
      ))?.object?.objectId,
      returnByValue: true,
      functionDeclaration: 'function() { var a = document.activeElement; return a === this || (!!a && this.contains(a)) || (!!a && a.contains(this) && a.isContentEditable); }',
    }).catch(() => undefined);
    if (focou?.result?.value !== true) {
      throw new Error(
        `pedi o foco no campo (ref ${backendNodeId}) e o foco nao foi para ele. Nao digitei nada — `
        + 'as teclas cairiam em outro elemento. Clique no campo antes, ou confira se ele aceita foco.',
      );
    }
  }

  for (const ch of texto) {
    if (ch === '\n') {
      await cdpPressKey(tabId, 'Enter');
    } else {
      // Direto, sem passar pela normalizacao de combo (um "+" literal viraria separador).
      // keyCode de verdade (23/09/2026): sem windowsVirtualKeyCode o evento
      // chega com keyCode 0, e o suggest do RichFaces no PJe (CEP, autoridade)
      // descarta tecla sem keyCode — a lista de sugestoes nunca abria.
      const tecla = codigoDaTecla(ch);
      await dm.send(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: ch, text: ch, unmodifiedText: ch, ...tecla,
      });
      await dm.send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch, ...tecla });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }

  let lido = backendNodeId !== undefined ? await lerValorDoElemento(tabId, backendNodeId) : null;
  // Foco dentro de moldura de outro site: a leitura acima nao alcanca. Le LA
  // DENTRO e diz onde foi, em vez de "lido: null" mudo (23/09/2026).
  const m = lido === null || lido === '' ? await focoEmMoldura(tabId) : null;
  if (m) {
    lido = m.valor;
    return {
      digitado: texto, lido,
      moldura: m.host,
      ...(m.valor === null ? { aviso: `o foco esta numa moldura de outro site (${m.host}) e nao deu para reler o campo la dentro: confira com browser_screenshot` } : {}),
    } as { digitado: string; lido: string | null };
  }
  return { digitado: texto, lido };
}

/** Codigo de tecla do Windows e `code` para um caractere digitado. */
function codigoDaTecla(ch: string): { windowsVirtualKeyCode?: number; nativeVirtualKeyCode?: number; code?: string } {
  const up = ch.toUpperCase();
  let vk: number | undefined;
  let code: string | undefined;
  if (/^[A-Z]$/.test(up)) { vk = up.charCodeAt(0); code = `Key${up}`; }
  else if (/^[0-9]$/.test(ch)) { vk = ch.charCodeAt(0); code = `Digit${ch}`; }
  else {
    const tab: Record<string, [number, string]> = {
      ' ': [32, 'Space'], '-': [189, 'Minus'], '.': [190, 'Period'], ',': [188, 'Comma'],
      '/': [191, 'Slash'], ';': [186, 'Semicolon'], '=': [187, 'Equal'], '@': [50, 'Digit2'],
      '(': [57, 'Digit9'], ')': [48, 'Digit0'], '_': [189, 'Minus'], ':': [186, 'Semicolon'],
    };
    const t = tab[ch];
    if (t) { vk = t[0]; code = t[1]; }
  }
  return vk === undefined ? {} : { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, code };
}

/**
 * Resolve o alvo de uma capacidade de formulario e passa pelo freio — as duas
 * coisas com o MESMO objeto, resolvido UMA vez (obra 25).
 *
 * O dispatch de `bridge/index.ts` so chama `avaliar()` no ramo do MOTOR: toda
 * capacidade `cap_*` que escreve na pagina tem de chamar o freio sozinha (foi
 * assim que nasceram o furo 5, em `cap_digitar`, e o furo 8, em
 * `cap_autocomplete`). Aqui isso vira uma linha so, e a travessia usada e a da
 * PROPRIA acao (`cap_form_input` lateraliza select2 como `preencherCampo`;
 * `cap_digitar` desce como `cdpType`) — por isso o nome real da acao vai
 * adiante, e nao um `type` generico.
 *
 * Sem `ref`, a acao resolve por FOCO (`document.activeElement`): e a pergunta
 * factual "quem esta com foco agora", nunca uma busca semantica — delegar isso
 * a `resolveTarget` responderia outra pergunta ("qual e o primeiro campo
 * visivel da pagina") e reabriria a familia de furo por dentro do proprio
 * freio.
 */
async function alvoLiberado(
  acao: { type: string; target?: { strategy: 'agent-id'; agentId: number }; params?: Record<string, unknown> },
  ctx: { tabId: number; ws: Parameters<typeof avaliar>[1]; confirm: boolean },
): Promise<AlvoResolvido> {
  const r = await resolverAlvoDaAcao(acao, ctx.tabId);
  if (!r.ok) {
    throw new Error(
      `[${acao.type}] nao consegui identificar com seguranca o campo que esta acao vai tocar `
      + `(${r.motivo}). Releia a pagina com browser_read_page e repita com uma ref atual.`,
    );
  }
  const veredito = await avaliar(acao, ctx.ws, ctx.confirm, r.alvo);
  if (!veredito.permitido) throw new Error(`[bloqueado] ${veredito.motivo}`);
  return r.alvo;
}

export const modulo: ModuloCapacidades = {
  nome: 'formulario',
  capacidades: [
    {
      nome: 'cap_form_input',
      altera: true,
      input: true,
      executar: async (ctx) => {
        if (ctx.ref === undefined) throw new Error('informe a ref do campo');

        const alvo = await alvoLiberado(
          { type: 'cap_form_input', target: { strategy: 'agent-id', agentId: ctx.ref } },
          ctx,
        );
        // Escreve no no EFETIVO — o mesmo que o freio julgou. Antes o freio
        // SUBIA ate o ancestral clicavel e `preencherCampo` lateralizava para o
        // `<select>` do select2 ou subia da `<option>`: dois nos diferentes na
        // mesma tool. A travessia de `preencherCampo` e idempotente (um
        // `<select>` nao lateraliza de novo, uma `<option>` ja virou select),
        // entao passar o efetivo nao muda o que a funcao faz — so garante que
        // ela faca no no que passou pelo freio.
        return preencherCampo(ctx.tabId, alvo.efetivo.backendNodeId, ctx.params.valor);
      },
    },
    {
      nome: 'cap_digitar',
      altera: true,
      input: true,
      executar: async (ctx) => {
        // FURO 5, achado do cetico (06/09/2026): esta capacidade nunca
        // chamava avaliar() -- o dispatch de bridge/index.ts so aciona o
        // freio no ramo do MOTOR, e toda capacidade `cap_*` que escreve na
        // pagina tem de chamar sozinha. Sem isto, `browser_type` com
        // `modo: "teclado"` preenchia campo de senha sem bloqueio -- medido.
        //
        // Com `ref`: o alvo resolve por ref e desce a mesma travessia de
        // `cdpType`; sem `ref`, resolve por FOCO. Nos dois casos quem recebe as
        // teclas e `efetivo`, e e ELE que o freio julgou.
        //
        // Recusar `cap_digitar` toda vez que vem sem `ref` fecharia o furo e
        // quebraria uso legitimo (clicar um campo do PJe e digitar nele sem
        // repassar a ref) -- por isso a recusa e so quando o freio nao
        // consegue provar nada, nunca pela ausencia de `ref` em si.
        const alvo = await alvoLiberado(
          ctx.ref === undefined
            ? { type: 'cap_digitar' }
            : { type: 'cap_digitar', target: { strategy: 'agent-id', agentId: ctx.ref } },
          ctx,
        );

        // Sem ref, `digitarTeclaATecla` nao chama `DOM.focus` e as teclas caem
        // em quem ja esta focado -- que e exatamente o `efetivo` que o freio
        // acabou de examinar (`como: 'foco'`). Com ref, focar o EFETIVO em vez
        // do no nomeado tira a chance de `DOM.focus` falhar calado num wrapper
        // e as teclas caírem no foco anterior, que o freio nunca viu.
        //
        // OBRA 26: quando a ref aponta para algo que NAO aceita texto, o
        // `efetivo` ja vem sendo o elemento FOCADO (e o freio o examinou) — e o
        // `DOM.focus` de `digitarTeclaATecla` agora FALHA ALTO em vez de
        // engolir o erro e digitar em quem estava focado.
        const paraDigitar = ctx.ref === undefined ? undefined : alvo.efetivo.backendNodeId;
        return digitarTeclaATecla(ctx.tabId, paraDigitar, String(ctx.params.text ?? ''), ctx.params.delay_ms);
      },
    },
  ],
};
