# Obra 09 — Reconhecer página de desafio (Cloudflare/captcha) e falhar alto (item 3)

**Lote A. Depende da obra 01 (stub `capacidades/desafio.ts`, gancho `depois`).**

## Objetivo em uma frase

Depois de `navigate`, `read_page` e `extract`, a ponte olha o DOM: se a página **inteira** é um
desafio (Cloudflare "Verificação automática em andamento", hCaptcha interstitial, "suspeita de
acesso via robô"), devolve **erro** dizendo "isto é um desafio, não a página"; se é uma página
normal **com um widget** de captcha no formulário (caso TJ-SP), devolve a página com um **aviso**.

## Por que existe

Sem isso um agente lê "Verificação automática em andamento" como se fosse o resultado da busca e
conclui coisa errada — o mesmo padrão do bug do `extract` que devolvia a cauda e fez um subagente
ler a última súmula do STF como se fosse a primeira (ESTADO, 03/09). O SCON do STJ devolve o
desafio para `curl` sempre e para o Chrome real depois de rajada (memória
`reference_stj-scon-cloudflare.md`); o eSAJ do TJ-SP responde "suspeita de acesso via robô" ao
Camoufox (skill `juris-tribunais`, seção TJ-SP). Hoje "se aparecer captcha, suba de degrau" é
regra de skill para o agente lembrar — fácil de esquecer (estudo 4, §C).

## Âncoras conferidas na fonte (05/09/2026)

- `execution-engine/index.ts:194-199` `navigate` (devolve `{ success: true }` sem dado);
  `29-32` `read_page` (devolve `PageState`); `370-398` `extract` (devolve string).
- `ax-tree.ts:210-217` — `read_page` já pega `url`/`title` por `safeExecuteScript`; você **não**
  edita aqui: o gancho `depois` faz a própria leitura por `Runtime.evaluate`.
- `bridge-server/src/format.js:33-52` `formatarPagina(page, input)` — monta o texto de
  `read_page` a partir de `page.url`, `page.title`, `page.interactiveElements`, `page.textContent`.
  Um campo novo `page.aviso` é ignorado hoje; você acrescenta a linha.
- `capabilities.ts:23-40` (pós-01: `js.ts`) — `executarJs` por `Runtime.evaluate` com
  `returnByValue`; use `dm.send` direto no seu módulo com os mesmos parâmetros (sem `replMode`).
- Skill `juris-tribunais`, TJ-SP: "Preencher por JavaScript faz o reCAPTCHA barrar"; o eSAJ é
  página **normal com widget** — o único caminho que funciona no TJ-SP é pela ponte; um detector
  que erra aqui bloqueia esse caminho.

## O que construir (desenho do capataz)

`capacidades/desafio.ts`, sem capacidade nova; só gancho `depois(ctx, r)` para
`ctx.acao ∈ { navigate, read_page, extract }` e `r.ok === true`:

1. Um `Runtime.evaluate` (`returnByValue`) que devolve `{ titulo, url, interstitial: string[],
   widget: string[], elementos: number }`:
   - `interstitial` (página inteira é desafio): título casa
     `/just a moment|um momento|attention required|verifica[cç][aã]o autom[aá]tica|checking your browser|please wait/i`;
     ou existe `#challenge-running, #challenge-form, #challenge-stage, .cf-browser-verification,
     #cf-chl-widget, iframe[src*="challenges.cloudflare.com"]` **e** o `body` tem poucos elementos
     (`elementos < 60`, meça na página falsa); ou `body.innerText` contém
     `Verificação automática em andamento` / `Verifying you are human` / `suspeita de acesso via robô`.
   - `widget` (captcha dentro de página normal): `.g-recaptcha, iframe[src*="recaptcha"],
     .h-captcha, iframe[src*="hcaptcha"], .cf-turnstile` presentes **e** não é interstitial.
2. `interstitial` não vazio → `{ ok: false, error: '[desafio] a pagina em <url> e um desafio
   (<marcas>), nao o conteudo pedido. Nao insista nem repita: avise o usuario (ele pode resolver na
   janela da ponte) ou espere alguns minutos. Se for SCON/eSAJ, uma abertura por vez.' }`.
3. `widget` não vazio → mantém `ok`; para `read_page`, `r.data.aviso = 'esta pagina tem um
   captcha (<marcas>) no formulario: digite de verdade (browser_type modo teclado) e clique com
   mouse real — preencher por JS faz o captcha barrar'`; para `extract`, prefixe a string com
   `[aviso] ...\n`; para `navigate`, `r.data = { aviso }`.
4. `format.js` `formatarPagina`: se `page.aviso`, imprime `[aviso] ...` logo abaixo do cabeçalho
   (`url\ntitle`). Uma linha. Só isso ali.

Custo: um `evaluate` a mais por navegação/leitura. Sem estado.

## Arquivos que você PODE tocar

`entrypoints/background/bridge/capacidades/desafio.ts`, `bridge-server/src/format.js` (só o
`aviso`), `bridge-server/test/desafio.js` (novo).

## Arquivos que você NÃO PODE tocar

`ax-tree.ts`, `execution-engine/**`, `bridge/index.ts`, `registro.ts`/`index.ts` dos dois lados,
`tools/**`, qualquer outro módulo, `package.json`, `README.md`, `ESTADO.md`, skills.

## Quem mais está construindo agora

Lote A: 04, 05, 06, 07, 08, 10, 11, 12, cada uma no próprio módulo. A 08 toca `bridge/index.ts`.
Ninguém mais toca `format.js`. Trava de build compartilhada.

## Padrão da casa a imitar

- **Erro que diz o remédio e proíbe insistir:** `bridge/index.ts:486-490`; e a memória do SCON:
  "não insistir na mesma hora: esperar e voltar".
- **Leitura da página feita pela própria tool, não delegada ao agente:** `preencherCampo`
  relendo o campo (`capabilities.ts:110-127`).
- Teste com páginas `data:` montadas no próprio teste: `test/digitacao-real.js:31-51` (via JS).
  Aqui `browser_navigate` para `data:text/html,...` funciona pelo CDP.

## O que NÃO fazer, e por quê

- **Não trate widget como desafio.** O TJ-SP 2º grau só funciona pela ponte; um erro ali bloqueia
  a única receita. Widget é aviso.
- **Não use `document.body.innerText` inteiro em página enorme** para procurar a frase: limite a
  `innerText.slice(0, 4000)` (o desafio é curto e fica no topo).
- **Não tente resolver o desafio** (clicar em "sou humano", esperar em laço): a regra da casa é
  "não bypassar captcha", e o clique da ponte na janela coberta nem pintaria.
- **Não bloqueie `screenshot`**: é como o agente mostra a tela ao Cezar.
- **Defeito irmão:** o `depois` rodar quando `r.ok === false` e mascarar o erro original (por
  exemplo `[aba trocou]`). Só atue em `r.ok === true`.

## Armadilhas conhecidas

- `replMode` quebra serialização (`capabilities.ts:32`): não use.
- A extensão não pode aparecer na própria leitura: seu `evaluate` lê o DOM da página; o
  indicador da ponte vive em shadow root fechado e não entra em `innerText` — não o confunda com
  marca de desafio.
- Página `about:blank`/`data:` sem `body`? Guarde nulo.
- `Runtime.evaluate` numa aba com diálogo aberto trava — a obra 04 barra antes; se você rodar
  sem a 04 pronta e um teste travar, não é seu.

## Critério de pronto

`bridge-server/test/desafio.js` (novo):
1. `browser_navigate` para `data:text/html,<title>Just a moment...</title><div id="challenge-running"></div><p>Verificando</p>`
   → `isError` com `[desafio]`; `browser_read_page` na mesma aba → `isError` `[desafio]`;
   `browser_extract` idem; `browser_screenshot` **funciona**.
2. `data:text/html,<title>Consulta</title><form><input name=q><div class="g-recaptcha"></div><button>Pesquisar</button></form><p>Jurisprudencia...</p>`
   → `navigate` ok com `aviso`; `read_page` ok e a segunda/terceira linha do texto começa com
   `[aviso]` e contém `captcha`; `extract` começa com `[aviso]`.
3. `https://example.com` → sem `[aviso]`, sem erro.
4. Página com `innerText` contendo `suspeita de acesso via robô` → `[desafio]`.
`npx tsc --noEmit` só com o erro pré-existente.

**Como rodar** (com a trava): raiz `npm run build` → `cd bridge-server && npm run reload` →
`node test/desafio.js`.

## Protocolo de trava de build

`C:\Users\Cezar\claudecode\PraxedesIA-v5\.obra-lock`. Git Bash:
`cd /c/Users/Cezar/claudecode/PraxedesIA-v5 && (set -o noclobber; echo "obra-09 $(date +%H:%M)" > .obra-lock)`.
Existe → 60 s, repita (até 15 min; >10 min abandonada). Com a trava: build → reload → seu teste →
`rm .obra-lock`. Nunca reload sem trava. Build quebrado em arquivo alheio: solte, 2 min, até 3
vezes, depois reporte. Sem commit, sem `git checkout`/`stash`; backup é `cp`.

## Regra ADITIVO

`format.js` ganha uma linha condicional; nada mais muda ali. Regressão inaceitável: `e2e.js`
(que confere o formato de `read_page`) vermelho — rode só ele além do seu se tocou `format.js`.

## Se concluir que não vale

Se a distinção interstitial × widget se mostrar indecidível por DOM em algum caso real que você
conheça, construa só o interstitial (erro) e deixe o widget sem aviso; diga por quê.

## Como reportar

Saída do teste; as marcas finais (lista); notas para a skill `juris-tribunais` (a ponte agora
avisa; a regra "suba de degrau" continua) e para o README (armadilha nova). Não edite nenhum.
