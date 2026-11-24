import { SEMANTIC_TARGET_PROPS, REF_MOLDURA_PROP, buildTarget } from './_comum.js';

/** Tools de interacao real com a pagina: clique, digitacao, tecla, rolagem, arrasto. */

export const TOOLS = [
  {
    name: 'browser_click',
    description:
      'Clique REAL (mouse de verdade via CDP, isTrusted). Login com usuario e senha ja preenchidos pelo gerenciador de senhas: pode clicar em Entrar/Login/Acessar sem perguntar (o usuário autorizou); nunca digite senha e, em site financeiro, nao clique em login. '
      + 'Por ref (preferido), por busca semantica, '
      + 'ou por coordenada x/y quando o alvo nao tem ref na arvore -- ex.: linha de sugestao criada na '
      + 'hora por um autocomplete. Para a coordenada, meca o elemento com browser_javascript '
      + '(getBoundingClientRect) e clique no centro. Depois do clique a ponte espera a rede acalmar '
      + '(ate 2,5 s) -- desligue com esperar:false em pagina que nunca acalma. "ok" do clique quer '
      + 'dizer que o evento SAIU, nao que a tela mudou; e "requisicoes: 0" e NORMAL em SPA que troca '
      + 'de tela por hash (#/rota) sem rede -- nao prova que o clique falhou. Para CONFIRMAR o '
      + 'resultado, passe esperar_texto e/ou esperar_url: a resposta ganha resultado.confirmado '
      + '(true/false), motivo e url_final. confirmado:false NAO e erro e NAO quer dizer que o clique '
      + 'nao aconteceu -- quer dizer que a tela nao chegou onde voce esperava no prazo; releia a '
      + 'pagina antes de clicar de novo.',
    inputSchema: {
      type: 'object',
      properties: {
        ...SEMANTIC_TARGET_PROPS,
        ...REF_MOLDURA_PROP,
        x: { type: 'number', description: 'X em pixels CSS do viewport. Use com y, quando nao houver ref.' },
        y: { type: 'number', description: 'Y em pixels CSS do viewport.' },
        esperar: { type: 'boolean', description: 'Esperar a rede acalmar depois do clique. Padrao: true.' },
        esperar_ms: { type: 'number', description: 'Teto da espera em ms, se esperar nao for false. Padrao: 2500.' },
        esperar_texto: {
          type: 'string',
          description:
            'Depois do clique, espera este texto aparecer na tela (texto VISIVEL, innerText; sem '
            + 'diferenciar maiuscula) para confirmar que o clique teve efeito. Nao vira erro se nao '
            + 'aparecer: volta resultado.confirmado:false.',
        },
        esperar_url: {
          type: 'string',
          description:
            'Depois do clique, espera location.href CONTER este trecho (pega o hash: "#/processos"). '
            + 'Com esperar_texto junto, as duas condicoes tem de bater.',
        },
        confirmar_ms: {
          type: 'number',
          description:
            'Prazo da confirmacao de esperar_texto/esperar_url, em ms, contado DEPOIS da espera de rede. '
            + 'Padrao: 10000. Teto: 60000. (Nao confunda com esperar_ms, que e o teto da espera de rede.)',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Teto do transporte, em ms, para o clique em si (sem contar esperar_ms, que se soma '
            + 'automaticamente por cima). Padrao: 60000.',
        },
      },
    },
    action: (i) => (i.x !== undefined && i.y !== undefined ? 'cap_click_xy' : 'click'),
    build: (i) => {
      // So entram no params quando vieram: sem eles o comando que vai para a
      // extensao e byte a byte o de antes (capacidades/confirmar.ts nem roda).
      const confirmacao = {
        ...(i.esperar_texto !== undefined ? { esperar_texto: i.esperar_texto } : {}),
        ...(i.esperar_url !== undefined ? { esperar_url: i.esperar_url } : {}),
        ...(i.confirmar_ms !== undefined ? { confirmar_ms: i.confirmar_ms } : {}),
      };
      return i.x !== undefined && i.y !== undefined
        ? { params: { x: i.x, y: i.y, esperar: i.esperar, esperar_ms: i.esperar_ms, ...confirmacao } }
        : { target: buildTarget(i), params: { esperar: i.esperar, esperar_ms: i.esperar_ms, ...confirmacao } };
    },
    // O clique em si cabe folgado no teto de sempre (60 s); o que muda por
    // fora e a espera de rede da obra 13 (`esperar`/`esperar_ms`, ate aqui
    // sem cobertura nenhuma no transporte) -- some-a ao teto, senao um
    // esperar_ms grande estoura o transporte antes de a extensao terminar de
    // esperar (obra 16, docs/obra-20260904/16-timeout-configuravel.md).
    timeout: (i) => {
      const esperarMs = i.esperar === false ? 0 : (typeof i.esperar_ms === 'number' && i.esperar_ms > 0 ? i.esperar_ms : 2500);
      const base = typeof i.timeout_ms === 'number' && i.timeout_ms > 0 ? i.timeout_ms : 60_000;
      // Confirmacao (esperar_texto/esperar_url): mesmo padrao e mesmo teto de
      // capacidades/confirmar.ts (10000, teto 60000), somado por cima -- senao
      // uma confirmacao longa estoura o transporte antes de a extensao responder.
      const querConfirmar = (typeof i.esperar_texto === 'string' && i.esperar_texto !== '')
        || (typeof i.esperar_url === 'string' && i.esperar_url !== '');
      const confirmarMs = !querConfirmar ? 0
        : (typeof i.confirmar_ms === 'number' && i.confirmar_ms > 0 ? Math.min(i.confirmar_ms, 60_000) : 10_000);
      return base + esperarMs + confirmarMs;
    },
    confirmavel: true,
  },
  {
    name: 'browser_type',
    description:
      'Escreve num campo e devolve o valor que ficou nele (campo "lido"). Modo "rapido" (padrao) seta o '
      + 'valor e dispara input/change: serve para a maioria dos campos. Modo "teclado" digita tecla a '
      + 'tecla com isTrusted, como gente: use em campo que so reage ao ATO de digitar (autocomplete, '
      + 'mascara, e TODO campo class="suggest" do PJe: CEP da parte, ente/autoridade). No modo rapido '
      + 'esses campos ficam com o texto mas a lista de sugestoes NAO abre -- nao troque por '
      + 'KeyboardEvent em browser_javascript, use modo:"teclado" (isTrusted de verdade, keyCode incluso). '
      + 'Sempre confira "lido" antes de seguir.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto a digitar.' },
        clear: { type: 'boolean', description: 'Limpar o campo antes (so no modo rapido). Padrao: false.' },
        modo: { type: 'string', enum: ['rapido', 'teclado'], description: 'rapido (padrao) ou teclado. Teclado = digitacao real, para autocomplete/suggest/mascara.' },
        delay_ms: { type: 'number', description: 'Intervalo entre teclas no modo teclado. Padrao: 60.' },
        texto_do_elemento: {
          type: 'string',
          description:
            'Texto VISIVEL do campo, quando nao houver ref e voce quiser acha-lo pelo rotulo. Nao '
            + 'confunda com "text", que e o que vai ser digitado.',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Piso do teto do transporte, em ms. O teto real e o MAIOR entre o calculado pela formula '
            + '(texto longo no modo teclado precisa de mais tempo) e este valor -- nunca menor que a formula.',
        },
        ...SEMANTIC_TARGET_PROPS,
        ...REF_MOLDURA_PROP,
      },
      required: ['text'],
    },
    action: (i) => (i.modo === 'teclado' ? 'cap_digitar' : 'type'),
    // `text` NUNCA entra na busca do elemento: aqui ele e o texto a DIGITAR, e
    // em `buildTarget` seria o texto do elemento a procurar. Confundir os dois
    // e a raiz alcancavel do furo 7-A -- o segredo digitado virava criterio de
    // busca, `resolveTarget` nao achava nada, o freio liberava por nao ter o
    // que examinar e o motor escrevia no `document.activeElement`. Quem quer
    // achar o campo pelo rotulo usa `texto_do_elemento`.
    build: (i) => {
      const alvo = buildTarget({ ...i, text: i.texto_do_elemento });
      return i.modo === 'teclado'
        ? { target: alvo, params: { text: i.text, delay_ms: i.delay_ms } }
        : { target: alvo, params: { text: i.text, clear: i.clear ?? false } };
    },
    timeout: (i) => {
      const formula = i.modo === 'teclado'
        // Cada tecla custa o delay MAIS a ida e volta ao Chrome (~45 ms medidos
        // com 5 agentes, 03/11/2026); so o delay estourava prompt longo do Flow.
        ? 30_000 + String(i.text ?? '').length * ((i.delay_ms ?? 60) + 50)
        : 60_000;
      return Math.max(formula, i.timeout_ms ?? 0);
    },
    confirmavel: true,
  },
  {
    name: 'browser_press_key',
    description:
      'Pressiona uma tecla de verdade (isTrusted). Tecla de controle (Enter, Tab, Escape, setas) ou um '
      + 'caractere, que e inserido no campo focado. Com modificadores: key "c" + modifiers ["Control"].',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Tecla (Enter, Tab, Escape, ArrowDown, Space, a...). Espaco e "Space".' },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modificadores: Control, Shift, Alt, Meta.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Teto do transporte, em ms. Padrao: 60000.',
        },
      },
      required: ['key'],
    },
    action: 'press_key',
    // " " (espaco literal) passava sem erro e nao digitava nada: o nome da tecla e "Space"
    // (relato de 30/09/2026: "39. NOME SOBRENOME" saiu "39.NOMESOBRENOME").
    build: (i) => ({ params: { key: i.key === ' ' ? 'Space' : i.key, modifiers: i.modifiers } }),
    timeout: (i) => i.timeout_ms ?? 60_000,
    confirmavel: true,
  },
  {
    name: 'browser_scroll',
    description: 'Rola a pagina. Aceita position "top"/"bottom", ou deltaY em pixels. Encontra sozinho o maior container rolavel, o que funciona em SPA.',
    inputSchema: {
      type: 'object',
      properties: {
        position: { type: 'string', enum: ['top', 'bottom'], description: 'Ir ao topo ou ao fim.' },
        deltaY: { type: 'number', description: 'Pixels a rolar (positivo desce). Padrao: 500.' },
        x: { type: 'number', description: 'X do ponto onde aplicar a roda, se precisar forcar.' },
        y: { type: 'number', description: 'Y do ponto onde aplicar a roda, se precisar forcar.' },
      },
    },
    action: 'scroll',
    build: (i) => ({ params: { position: i.position, deltaY: i.deltaY, x: i.x, y: i.y } }),
  },
  {
    name: 'browser_drag',
    description: 'Arrasta de um ponto a outro, em passos, simulando o movimento humano.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
        steps: { type: 'number', description: 'Passos intermediarios. Padrao: 10.' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
    action: 'drag',
    build: (i) => ({ params: { fromX: i.fromX, fromY: i.fromY, toX: i.toX, toY: i.toY, steps: i.steps } }),
    confirmavel: true,
  },
];
