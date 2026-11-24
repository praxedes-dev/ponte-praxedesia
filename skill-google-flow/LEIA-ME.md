# google-flow — skill do Claude Code

Ensina o Claude Code a gerar **arte e vídeo no Google Flow** (flow.google.com) controlando o seu
Chrome logado, e, mais importante, a **tirar bom resultado**: método de prompt, as 11 regras que
evitam texto traduzido ou com acento errado, referência em SVG, logo como "personagem", arte que
vira matriz, custo real de cada modelo, refilmagem de vídeo próprio com o Omni, Ferramentas do Flow
(IA no fundo, canvas no texto), o site do Gemini para conferir vídeo e o Flow Music.

Tudo foi aferido na tela entre agosto e novembro de 2026. O Flow muda rápido: confira na sua tela.

## O que precisa

- **Claude Code** instalado.
- **Conta Google com plano pago do Flow** (os números são do Google AI Pro).
- **Uma ponte de navegador (servidor MCP) que controle o seu Chrome real, já logado.** Playwright
  com perfil novo esbarra no login do Google. A extensão oficial Claude in Chrome é uma opção. A
  seção "O que precisa para rodar" do `SKILL.md` lista as ações que a ponte precisa ter.
- Opcional: ferramentas de uma chamada (`flow_subir`, `flow_gerar`, `flow_incluir`, `flow_baixar`)
  na sua ponte. Sem elas, a skill traz as receitas manuais, que são mais lentas.

## Como instalar

Crie uma pasta chamada `google-flow` dentro da pasta de skills do Claude Code e ponha nela o
`SKILL.md` e este `LEIA-ME.md`:

- Windows: `%USERPROFILE%\.claude\skills\google-flow\`
- macOS/Linux: `~/.claude/skills/google-flow/`

Fica assim:

```
~/.claude/skills/google-flow/
  SKILL.md
  LEIA-ME.md
```

Abra uma sessão nova do Claude Code e peça, por exemplo: "faz uma arte 3:4 no Flow para um post
sobre X". A skill entra sozinha quando você fala em Flow, Nano Banana, Veo ou Omni.

## Avisos

- Gerar vídeo gasta crédito da sua conta. A skill manda mostrar prompt e custo antes de gerar.
- A skill não contorna captcha nem barreira anti-robô do Google, de propósito.
- A skill não traz endereço de rota interna. Ela ensina o Claude a descobrir a rota da vez lendo
  a rede depois de um clique seu, só para ler e baixar a sua própria mídia. Não é API oficial e
  pode parar de funcionar sem aviso.
