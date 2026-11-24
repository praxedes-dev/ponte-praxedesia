# PraxedesIA — ponte entre os agentes locais e o Chrome real

Extensão Chrome + servidor MCP que dá aos agentes deste PC (Claude Code, OpenCode, Codex)
acesso ao **Chrome de verdade**: o que já está aberto, logado, com as sessões e a reputação
de perfil que os sites reconhecem.

Ela não decide nada. Quem decide é o agente do outro lado; a extensão é o braço.

## Por que existe

A extensão Claude in Chrome deixou de estar conectada neste PC. O plano B óbvio —
Playwright por `connectOverCDP` — está bloqueado: desde o Chrome 136 o
`--remote-debugging-port` é recusado no perfil padrão, e só funcionaria num perfil separado,
deslogado de tudo. A PraxedesIA roda **dentro** do Chrome já aberto, com `chrome.debugger`,
e contorna exatamente esse bloqueio.

## Como funciona

```
Claude Code ⇄ stdio ⇄┐
OpenCode    ⇄ stdio ⇄┤ hub WS 127.0.0.1:8788 ⇄ extensão ⇄ chrome.debugger ⇄ abas
Codex       ⇄ stdio ⇄┘
```

Cada agente sobe seu próprio servidor MCP. O primeiro a bindar a porta 8788 vira **hub** e
conversa com a extensão; os demais viram **peers** e são roteados por ele. Se o hub morre,
outro assume. **Não há daemon para manter no ar** — nada de PM2.

## Cada agente tem a sua aba, numa janela da ponte

A ponte **não usa a aba do usuário**. No primeiro comando, cada agente ganha uma aba própria
dentro de **uma janela da ponte**, compartilhada por todos os agentes. Duas sessões abertas
não navegam uma em cima da outra, e o que o usuário está vendo nunca é trocado por um link
que o agente precisava abrir.

A janela **lembra onde foi deixada**: o usuário a arrasta uma vez para o canto ou monitor que
menos incomoda e ela volta lá sempre. Ela nasce com foco e o devolve em seguida — criada sem
foco ela nunca é pintada, e aba não pintada ignora clique. Uma aba âncora a mantém aberta
quando o último agente sai, para não abrir e fechar (e piscar) a cada sessão.

Como todos dividem a janela e clicar exige a aba ativa nela, o input passa por uma **fila**:
sem isso, dois agentes clicando juntos ativariam a aba um do outro.

**Janela coberta funciona.** Testado com a janela da ponte inteira atrás da janela do usuário
maximizada: o clique chegou e navegou. O usuário pode trabalhar por cima dela sem que o agente
perca a capacidade de clicar. Existe um fallback desligado (`focarParaClicar` no storage) para
o caso de algum ambiente suspender a pintura de janela coberta; até hoje não foi preciso.

### "Olha isso aqui": a aba do usuário é somente leitura

`browser_use_current_tab` aponta para a aba que o usuário está vendo, e `browser_use_tab`
para uma aba específica dele (PJe já logado, por exemplo). As duas entram em **modo somente
leitura**: ler, procurar, extrair, screenshot e JS funcionam; navegar, clicar, digitar, rolar
e preencher ficam **barrados**. Um erro do agente não pode custar a aba em que o usuário
trabalha. Só quando ele pedir explicitamente para agir ali, o agente repete com
`permitir_acao: true`. `browser_use_own_tab` volta para a aba própria.

O histórico desse desenho está no diário interno do projeto (não incluído nesta cópia): foi a segunda reversão. Grupo por agente
exigia foco e acumulava grupo; aba corrente resolveu isso e criou a colisão entre sessões e a
troca da aba do usuário. Cada versão corrigiu o sintoma da anterior; esta ataca a raiz —
compartilhar o que é do usuário.

## Instalação

1. `cd bridge-server && npm install`
2. Na raiz: `npm run build`
3. Em `chrome://extensions`, ligar o **Modo de desenvolvedor** e **Carregar sem compactação**
   apontando para `.output/chrome-mv3`
4. Pegar o token em `~/.praxedes-bridge/token` e colar no painel da extensão (ícone na barra)
5. Registrar nos agentes:

```bash
claude mcp add --scope user praxedes-bridge -- node "<pasta-do-projeto>\bridge-server\src\index.js" --name "Claude Code"
```

No OpenCode, o bloco equivalente já está em `~/.config/opencode/opencode.jsonc`.

## O que ela faz que a extensão do Claude não faz

O servidor MCP roda no Windows e **tem disco** — extensão nenhuma tem. Daí vêm:

| Tool | Para quê |
|---|---|
| `browser_upload_file` | Anexar um arquivo do disco direto num formulário do site |
| `browser_download` | Baixar com a sessão logada, gravando onde você escolher |
| `browser_save_pdf` | Comprovante de protocolo em PDF de verdade, não print |
| `browser_cookies` | Exportar a sessão como header pronto para `curl` |
| `browser_emulate_device` | Testar layout mobile sem Playwright |
| `browser_use_tab` | Trabalhar numa aba que você já abriu e logou |
| `browser_javascript` | Rodar JS na página, no contexto real, e receber o retorno |
| `browser_form_input` | `select`, checkbox e radio pelo valor |
| `browser_wait_for_change` | Esperar a página crescer e estabilizar |

## Leitura de página é barata de propósito

`browser_read_page` vem no modo **interativo**: só o que dá para clicar ou preencher, uma
linha por elemento com a ref. `browser_find` procura por descrição e devolve só os
candidatos. Medido no g1.globo.com: árvore inteira ~5.268 tokens, modo padrão ~2.024,
`find` ~27.

## Freio

Campo de senha não passa nem com confirmação. Banco, meio de pagamento e botão que parece
irreversível ("excluir", "pagar", "protocolar") exigem `confirm: true` — e a ponte devolve
**erro explicando o motivo**, para o agente perguntar ao usuário no chat. Modal no painel
não serviria: ninguém está olhando para ele.

O freio decide por hostname de verdade e lê o texto real do elemento no DOM antes do
clique, porque o agente clica por `ref` e a ref sozinha não diz o que o botão faz.

## Desenvolvimento

```bash
npm run build && cd bridge-server && npm run reload
```

`npm run reload` recarrega a extensão no Chrome sem ninguém clicar em nada.

```bash
cd bridge-server && npm test
```

Roda a bateria (exige o Chrome aberto com a extensão carregada): eleição de hub, navegação,
leitura, clique por ref, capacidades novas e adoção de aba.

## Armadilhas que já custaram caro

- **Input exige aba renderizada.** Aba em segundo plano aceita navegação, leitura e até
  screenshot, mas **ignora clique** — e a ação ainda retorna sucesso. Por isso, antes de
  qualquer input, a ponte ativa a aba do agente *na janela da ponte* (nunca na do usuário),
  passando por uma fila para dois agentes não ativarem a aba um do outro.
  `Page.setWebLifecycleState` foi testado e **não** resolve: aba em segundo plano ignora
  evento de mouse mesmo com o ciclo de vida ativo. Janela criada com `focused: false` também
  não pinta — ela precisa nascer com foco e devolvê-lo.
- **O Chrome recusa agrupar aba de janela sem foco.** Foi o que condenou o desenho de grupo
  por agente. Fica registrado para ninguém tentar de novo.
- **A extensão não pode aparecer na leitura que ela mesma faz.** O indicador visual ("Agente
  rodando") era um `<div>` no body, então entrava em `document.body.innerText` — que é justamente
  o que `wait_for_text`, `wait_for_change` e `extract` leem. Em 19/08/2026 isso travou um
  `wait_for_text {text:"Agente rodando", present:false}` por 180s: quem mandava desenhar a pílula
  era o próprio `wait_for_text`, e ninguém mandava apagar. Hoje a UI vive num **shadow root
  fechado**, fora do `<body>` e com `aria-hidden` — invisível para innerText, para a árvore de
  acessibilidade e para o screenshot, sem sumir da tela do usuário. Quem acende e apaga é a ponte,
  por comando. **Nada da extensão pode nascer fora desse shadow root.**
- **`chrome.scripting` roda no mundo isolado**, onde a CSP proíbe avaliar string como
  código. JS de página vai por `Runtime.evaluate` do CDP.
- **`replMode` no `Runtime.evaluate` quebra a serialização**: todo objeto volta `{}`.
- **A árvore de acessibilidade lista cada `<option>` como elemento próprio**, então a ref que
  chega costuma ser da opção e não do `select`. `form_input` sobe sozinho para o select.
- **DevTools aberto na mesma aba conflita** com `chrome.debugger`.
- A barra "PraxedesIA está depurando este navegador" fica permanente. É inofensiva.
- **Aba do agente fechada por fora não troca em silêncio.** O comando seguinte **falha alto**
  ("[aba trocou] sua aba (X) nao existe mais… abri outra (Y)") e o agente precisa navegar de
  novo. Em 03/09/2026 a versão anterior trocou calada para a aba em que o usuário tinha um
  cadastro do PJe aberto; uma aba nova em branco, calada, faria estrago parecido — o agente
  leria `about:blank` achando que era a página anterior.
- **`bridge_limpar` fecha só aba órfã.** Havia um `tudo` que esvaziava o conjunto inteiro de
  abas da ponte; com cinco agentes no mesmo Chrome, um limpando derrubava os outros.
- **`browser_tab_switch` para aba que não é da ponte entra em somente leitura**, igual a
  `browser_use_tab`. Era o último caminho até a aba do usuário que nascia em modo ação.
- **Servidor MCP antigo com extensão nova** recebe "capacidade desconhecida" com a instrução
  de reiniciar a sessão do agente. Os nomes de 19/08 (`cap_janela_propria`,
  `cap_voltar_aba_corrente`) têm alias por uma versão.
