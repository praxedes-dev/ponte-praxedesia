# Obra 02 — Freio: aba de conferência não é botão irreversível (item 4)

**Lote 0. Roda junto com a 01 (arquivos disjuntos) e a 03.**

## Objetivo em uma frase

Fazer o freio distinguir **aba/link de navegação** de **botão que executa** pelo papel do elemento,
para a aba "PROTOCOLAR INICIAL" do PJe (tela de conferência) deixar de ser barrada como se fosse o
protocolo, sem afrouxar o freio para o botão de verdade.

## Por que existe

Em 04/09/2026 o freio barrou o clique na aba "PROTOCOLAR INICIAL" do PJe — que é só a tela de
conferência final — como se fosse o próprio protocolo (estudo 1, §B.1). Falso positivo ensina o
agente e o Cezar a repetir com `confirm: true` sem pensar, que é o contrário do que o freio existe
para fazer: quando o botão real aparecer, o `confirm` já vem no automático.

## Âncoras conferidas na fonte (05/09/2026)

`entrypoints/background/bridge/policy.ts` (152 linhas):
- 37-42 `TEXTOS_DESTRUTIVOS` — inclui `'protocolar'` (41) e `'peticionar'`, `'assinar'`.
- 58-84 `descreverElemento(tabId, backendNodeId)` — lê do DOM `texto` (innerText || value ||
  aria-label, 200 chars, linha 74) e `tipo` = `type` **ou** `tagName`, em minúsculas (75). Para
  `<a>` devolve `'a'`; `<button>` → `'button'`; `<input type=submit>` → `'submit'`; `<td>`/`<div>`
  → `'td'`/`'div'`. **Não lê `role` nem o ancestral.**
- 134-149 regra 4: clique + texto casa por `includes` com algum gatilho (140) → bloqueado com a
  mensagem `o elemento diz "..." e parece irreversivel (casou com "...")`.

Não achei no repo nenhum teste do freio além de `test/capabilities.js:73-81` (barra "Excluir
processo") — não há teste negativo (algo que **deve** passar).

## O que construir (hipótese do capataz; meça na página falsa antes de decidir a regra)

Em `descreverElemento`, ler também `role` (atributo), a `tag`, se está dentro de `<form>`, e se o
elemento ou o ancestral clicável é `[role=tab]`, `<a>` sem `href` de ação, `li` de abas RichFaces
(`.rich-tab`, `.rich-tabhdr-*`). Na regra 4, **não barrar** quando o elemento é aba/guia de
navegação: `role=tab`, ou ancestral `.rich-tab*`/`[role=tablist]`, ou `<a href="#...">`/sem
`href` fora de `<form>` — mesmo que o texto case com um gatilho. **Continuar barrando**: `button`,
`submit`, `input[type=button|submit|image]`, `[role=button]`, `<a>` dentro de `<form>` ou com
`onclick`, e qualquer coisa cujo texto case e não se prove aba.

O ônus é do elemento **provar que é aba**; na dúvida, barra. Ajuste a mensagem para dizer o que
viu (`tag/role`), assim o falso positivo seguinte é diagnosticável.

Como é o DOM da aba do PJe? Não há cópia no repo. Modele no teste a estrutura RichFaces 3
(`<table class="rich-tabpanel"><td class="rich-tab-header"><a ...>PROTOCOLAR INICIAL</a>` ou
`<td ... onclick>` com o texto) **e** a variante ARIA (`<li role="tab">`). Se o Cezar tiver um
cadastro aberto, o capataz pode pedir um `browser_read_page` da aba real para você — peça no
relatório se a página falsa não te convencer.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/policy.ts`, `bridge-server/test/freio-aba.js` (novo).

## Arquivos que você NÃO PODE tocar

Tudo o mais. Em especial `bridge/index.ts`, `capabilities.ts`, `debugger-manager/**` e
`bridge-server/src/**` — a obra 01 está reescrevendo esses agora. `test/capabilities.js` fica como
está (é a prova de que o botão real continua barrado).

## Quem mais está construindo agora

A obra **01** (refatoração de `bridge/index.ts`, `capabilities.ts`, `debugger-manager`,
`tools.js`, `index.js`) e a obra **03** (sem código). Vocês três dividem o build e o Chrome:
protocolo de trava abaixo. Se o build quebrar em arquivo da 01, não é seu para consertar.

## Padrão da casa a imitar

- O freio decide pelo **texto real do elemento lido do DOM**, não pelo nome da tool
  (`policy.ts:4-16`, o comentário de cabeçalho). Continue lendo do DOM: agora `role` e ancestral.
- Erro que diz o remédio: `policy.ts:145-146` (`Confirme com o usuario e repita com confirm: true`).
- Teste com página de prova montada por `browser_javascript` e `refDe(rotulo)` para achar a ref:
  `test/digitacao-real.js:31-59`. Copie o esqueleto.

## O que NÃO fazer, e por quê

- **Não remova gatilho de `TEXTOS_DESTRUTIVOS`** nem troque `includes` por igualdade: "Protocolar
  petição" tem de continuar barrado.
- **Não acrescente `'emitir'`** (nem `emitir a guia`): é pergunta aberta ao Cezar
  (`00-PLANO-DE-OBRA.md` §12). Se a resposta vier antes de você começar, o capataz avisa.
- **Não decida por posição na tela nem por cor.** Só DOM.
- **Defeito irmão:** afrouxar por `<a>` sem olhar `<form>`/`onclick` libera o link "Excluir" que
  muitos sistemas fazem com `<a href="#" onclick=...>`. O teste negativo tem de ter esse caso.

## Armadilhas conhecidas

- `descreverElemento` é `Runtime.callFunctionOn` sobre o `objectId` do nó — roda na página, no
  mundo real; `this.closest(...)` funciona. Retorne um objeto simples (`returnByValue`).
- A árvore de acessibilidade lista cada `<option>` como elemento; irrelevante aqui, mas a ref que
  chega pode ser de um filho (o `<span>` dentro do `<a>`): suba até o ancestral clicável antes de
  decidir.

## Critério de pronto

`bridge-server/test/freio-aba.js` (novo), com página de prova contendo:
1. `<li role="tab">PROTOCOLAR INICIAL</li>` → `browser_click` **passa** (sem `confirm`).
2. Cabeçalho RichFaces: `<td class="rich-tab-header"><a>PROTOCOLAR INICIAL</a></td>` → **passa**.
3. `<button>Protocolar</button>` → **barra** (`isError`, texto com "casou com").
4. `<form><a href="#" onclick="">Excluir anexo</a></form>` → **barra**.
5. `<input type="submit" value="Assinar e protocolar">` → **barra**.
6. `<a href="/pje/ajuda">Protocolar: como funciona</a>` fora de `<form>` → decida e **documente** no
   teste (o capataz sugere passar: é link de navegação).
E `test/capabilities.js` continua verde (rode só ele, não a bateria).

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/freio-aba.js && node test/capabilities.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-02 $(date +%H:%M)" > .obra-lock)`.
Existe → espere 60 s, repita (até 15 min; >10 min é abandonada). Com a trava: build → reload →
seus testes → `rm .obra-lock`. Nunca reload sem trava (derruba a sessão dos outros). Build quebrado
em arquivo da obra 01: solte, espere 2 min, até 3 tentativas, depois reporte.

## Regra ADITIVO

Escopo é a regra 4 de `avaliar`. Não mexa nas regras 1-3 (senha, banco, input em site financeiro).
Regressão inaceitável: `capabilities.js` vermelho; botão com texto destrutivo passando sem
`confirm`.

## Se concluir que não vale

Se medir que o PJe real monta a aba de um jeito que nenhuma regra por DOM separa de botão, **não
construa** — reporte com o HTML que viu e proponha a alternativa (por exemplo, lista de exceções
por `hostname + texto`, que o capataz não gosta mas aceita ver).

## Como reportar

Regra final em uma frase; saída dos dois testes; o caso 6 decidido e por quê; se pediu o DOM real.
Não edite o README.
