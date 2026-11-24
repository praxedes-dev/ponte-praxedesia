---
name: google-flow
description: Gera ARTE e VÍDEO no Google Flow (flow.google.com) pelo Chrome real e logado, por uma ponte de navegador (MCP), e ensina a tirar bom resultado, não só a clicar. Imagem com Nano Banana 2.1/Pro custa ZERO crédito no plano pago (Google AI Pro); vídeo com Omni Flash e Veo 3.1 custa crédito (tabela conferida na tela). Cobre também as FERRAMENTAS do Flow, mini-apps criados por descrição onde a IA gera o fundo e um canvas compõe a tipografia e de texto. Use quando pedirem arte de post/carrossel/anúncio, imagem para HTML, cena de vídeo, clipe curto, trocar o texto de uma arte já aprovada, criar ou consertar ferramenta no Flow, ou falarem em Flow, Nano Banana, Veo, Omni. Também: o SITE do Gemini para diagnosticar vídeo/imagem e o Flow Music para música.
---

# Google Flow pela ponte

Tudo aqui foi aferido na tela, numa conta **Google AI Pro**, entre agosto e novembro de 2026. Quando a
fonte é a Central de Ajuda do Google, está dito; quando é teste nosso, também. Interface, modelos e
preços mudam: **confira na sua tela** antes de prometer número.

**Endereço:** o app é **`https://flow.google.com`** (projeto: `flow.google.com/project/<uuid>`). O antigo
`labs.google/fx/tools/flow` redireciona; o Flow TV ainda mora em `labs.google/flow/tv`.

**Modelos de vídeo (nov/2026):** o padrão é **Omni 1.2 Flash** (3 a 15 s, 9:16 e 16:9, 360p/720p).
Conferido em nov/2026; o Flow troca modelos em 05/12, confira na tela (o anúncio era de que Veo 3.1
Fast, Veo 3.1 Quality e Omni 1.1 saem do seletor e ficam Omni 1.2 Flash e Veo 3.1 Lite). Custo lido na tela (vídeo enviado, 720p): 5 s = 15 créditos, 8 s = 24
(3 por segundo).

**Na sua conta:** se o Chrome tiver mais de um login Google, abra o Flow já na conta certa pela URL
`flow.google.com/?authuser=<seu-email>` (vira `/u/1/`, `/u/2/`) e confira o perfil no canto antes de gerar.

**Projeto de testes:** crie um projeto só para aferir recurso novo (ex.: "TESTES (skill)") e guarde a
URL em `<SEU_PROJETO_DE_TESTES>`. Aferição nunca em projeto de trabalho em andamento.

## O que precisa para rodar

1. **Conta Google com plano pago do Flow** (os números desta skill são do Google AI Pro). Conta grátis
   gera bem menos e com outra tabela.
2. **Uma ponte de navegador (MCP) que controle o seu Chrome real, já logado no Google.** Perfil novo de
   Playwright cai no bloqueio de "navegador inseguro" do login do Google; por isso é o Chrome de verdade.
   A extensão oficial **Claude in Chrome** serve de ponte genérica (não testada com esta skill de ponta
   a ponta).
3. A ponte precisa expor estas ações genéricas (os nomes variam de uma ponte para outra):

| Ação | Para quê |
|---|---|
| navegar para URL / abrir aba própria | abrir o Flow numa aba só sua |
| ler a página e **achar elemento** (devolve uma referência clicável) | achar botões de menu sem errar o alvo |
| **clicar** por referência ou por coordenada | quase todo passo |
| **digitar** como teclado real | campo de comando |
| **arrastar** | selecionar texto dentro de Ferramenta |
| **rodar JavaScript na página** e devolver o valor | focar o campo, rotas internas |
| **anexar arquivo** a um `input[type=file]` | subir imagem/vídeo |
| **armar e esperar download** (ou ler a pasta Downloads) | baixar 2K |
| screenshot e **esperar texto aparecer/sumir** | saber quando terminou |
| **ler as requisições de rede** da aba | descobrir a rota interna da vez (ver "Rotas internas") |

4. **Opcional, mas é o que faz a skill render:** quatro "ferramentas de uma chamada" que embrulham as
   receitas manuais desta skill. Se a sua ponte não as tiver, use as receitas manuais (PARTE 4) ou
   escreva-as na sua ponte com estes contratos:

| Para | Contrato sugerido | O que faz |
|---|---|---|
| subir arquivo(s) | `flow_subir {projeto, caminhos[]}` | "+" > Enviar **sem janela do Windows** (intercepta o seletor de arquivo), espera o "%" sumir, devolve `novos_ids` |
| gerar imagem/vídeo | `flow_gerar {projeto, comando, incluir?[]}` | clique real no campo, digita, confere o texto, envia, espera o "Parar" sumir; devolve `novos` (id, largura, altura, URL) e a resposta do agente |
| anexar imagem/personagem ao pedido | `flow_incluir {projeto, nomes[]}` | "+" da barra > busca pelo nome > clica no recurso (clicar **já inclui e fecha** o seletor) |
| baixar em 2K | `flow_baixar {projeto, ids? \| recentes?, tamanho:"2K", pasta, nomes?[]}` | abre `/project/<p>/edit/<media-id>` direto, arma o download, "Baixar mídia" > "2K Aprimorada", renomeia |

Nas aferições, `flow_subir` levou 19 s para 1 arquivo, `flow_gerar` 45 a 55 s (1024×1024) e
`flow_baixar` 35 s para 2 imagens 2048×2048.

**Regra de operação:** com as ferramentas de uma chamada disponíveis, subir, gerar, incluir e baixar
**sempre** por elas. Clique, digitação e download passo a passo só se a ferramenta falhar, e aí avise.

**Baixar muitas de uma vez:** descubra a rota da vez pela rede e repita só ela (seção "Rotas
internas"). Serve para o 1K de qualquer mídia e o 2K que já tenha sido aprimorado uma vez.

---

# PARTE 1 — COMO TIRAR BOM RESULTADO

Esta é a parte que importa. O resto é operação.

## O método (não tente acertar de primeira)

```
1. Fecha o TEXTO primeiro          -> conversando, sem gerar imagem nenhuma
2. Gera a peça                     -> 1 imagem, Nano Banana 2.1, custo 0
3. Confere o texto letra por letra -> é aqui que o modelo erra
4. Refina por EDIÇÃO               -> luz, cor, enquadramento; o texto sobrevive
5. Aprova e vira MATRIZ            -> troca só a manchete a cada pauta nova
```

Por que nesta ordem: imagem é grátis e a **edição preserva a tipografia**, então o caro (seu tempo)
está em conferir texto. Gerar 4 variações e escolher é pior que gerar 1 e corrigir: cada geração
nova é uma chance nova de errar o acento.

## O template de prompt

Preencha os cinco blocos. Escreva em **prosa corrida**, em português, sem lista de palavras-chave:

```
[FORMATO]   Gere UMA imagem no formato retrato 3:4, com o modelo Nano Banana 2.1.
[GÊNERO]    É uma arte de post de <tipo de marca>: fotografia realista com sobreposição
            gráfica, acabamento de agência.
[FUNDO]     <cena, ângulo, luz, hora do dia, cor dominante, textura> + como a área do texto se
            resolve (ex.: "a metade inferior escurece num degradê preto suave, de baixo para cima,
            para o texto ficar legível").
[TEXTO]     O idioma de todo o texto desta arte é português do Brasil.
            Para CADA bloco: o que está escrito entre aspas + onde fica + estilização + hierarquia.
[LIMPEZA]   O que fica liso e vazio (ex.: "a faixa inferior, 12% da altura, lisa e escura,
            reservada para assinatura").
```

## As 11 regras

1. **Declare o idioma do texto.** Sem isso ele **traduz**. Aferido: pedi uma manchete em português,
   entre aspas, com o prompt todo em português, e ela saiu traduzida para o inglês. Repetindo com
   "O idioma de todo o texto desta arte é português do Brasil", saiu correta. Curiosidade que confirma
   a regra: a linha de apoio, que eu mandei *preservar*, ficou em português; só o bloco que eu mandei
   *escrever* foi traduzido.
2. **Cada texto entre aspas, na grafia exata**, com os acentos escritos.
3. **Framing POSITIVO**: descreva o que quer, nunca o que não quer. Oficial do Google: "rua vazia",
   não "sem carros". Foi ao violar isto ("NOT a dark silhouette", "sem logotipo, sem ícone, sem
   marca d'água") que saiu a palavra inventada **"MEIS"** no lugar de "VOCÊ".
4. **Tipografia por característica, não por nome de fonte.** "Condensada, muito pesada, caixa alta,
   entrelinha apertada" funciona; nome de fonte comercial, não.
5. **Nomeie o modelo.** No modo agente a ajuda oficial diz que ele *"routes your request to the best
   image model"*: escolhe sozinho se você não mandar, e a arte pode sair no 2 Lite.
6. **Diga onde cada coisa fica**: canto superior esquerdo, terço inferior, sobre a faixa. Sem
   posição, ele centraliza tudo e a peça vira template.
7. **Diga o que fica vazio.** O espaço reservado para a logo só existe se for pedido.
8. **Na edição, liste o que deve permanecer idêntico**: texto, etiqueta, foto, rodapé. Recomendação
   oficial: "seja explícito sobre o que deve permanecer exatamente igual".
9. **Escreva em português.** Não há fonte oficial dizendo que o Nano Banana entende melhor inglês
   (ver "o mito do inglês" abaixo).
10. **Não presuma limite de 25 caracteres.** Esse teto é do **Imagen** (modelo antigo, desativado em
    17/08/2026). O Pro é vendido oficialmente para pôster com texto longo.
11. **Vídeo: declare no PROMPT formato, duração, resolução e quantidade.** Pelo modo Agente, o
    que não vem escrito sai no padrão dele. Aferido em 22/09/2026: prompt sem isso gerou 9:16 e
    8 s quando se queria outra coisa. O painel do Flow só oferece **16:9 ou 9:16**,
    **3 a 15 s** (Omni 1.2), **360p/720p** e **x1–x4**, e duração livre e 360p só no Omni (Veo no Pro
    é só 8 s em 720p, reconferido em 03/11/2026; a ajuda do Google fala em 4/6/8 s para Veo, mas isso
    vale no Ultra). 3:4 NÃO existe em vídeo: peça 16:9 ou 9:16 e recorte depois. Escreva, por exemplo:
    "vídeo 16:9, 4 segundos, 720p, uma variação (x1)".

## Trabalhar com imagem de referência (e com a logo da marca)

Dá para gerar arte a partir de imagens que já estão no projeto: referência de estilo, referência de
diagramação, e a **logo**, que o modelo reproduz fielmente em vez de inventar uma parecida.

**O mecanismo, que não é óbvio:** subir a imagem para o projeto NÃO basta. É preciso **incluí-la no
comando**:

```
1. botão "+" (add_2) à esquerda do botão Agente, na barra de prompt
2. abre o painel de recursos do projeto
3. clicar em "Incluir no comando"   <- é isto que faz o modelo olhar a imagem
4. repetir: o painel reabre já com o PRÓXIMO item selecionado, e some os já incluídos
```

As incluídas viram miniaturas na barra de prompt. Sem esse passo, a imagem é ignorada.
Clique em "Incluir no comando" **pela referência do elemento** (achar → clicar na referência); o clique
por texto falha de forma intermitente. E os itens da lista não aparecem como elementos interativos:
por isso o fluxo de reabrir o painel a cada inclusão é o caminho, não tentar selecionar item a item.

**A regra que faz três referências somarem em vez de confundir: declare o PAPEL de cada uma.**
Aferido em 19/08/2026, cartaz de evento com 3 imagens anexadas:

```
A arte "<X>" é a referência de DIREÇÃO DE ARTE e DIAGRAMAÇÃO: <o que copiar da organização
dela>. Recrie essa atmosfera com fotografia própria.
A imagem "<Y>" é referência de TEXTURA: <brilho, partículas, profundidade>.
A imagem "<Z>" é a LOGO OFICIAL: reproduza fielmente <o desenho e o tipo de letra>, aplicada
como <onde entra na peça>.
```

Resultado: a logo saiu reproduzida com o mesmo desenho e a mesma letra rasgada de pincel, o texto
todo em português com acentos, e a diagramação da referência respeitada. O medo de "muita referência
confunde" é verdadeiro só quando os papéis ficam implícitos.

## Referência desenhada em SVG (layout que o prompt não segura)

Quando não existe imagem de referência e o que importa é **escala, margens, enquadramento e
hierarquia** (pôster com blocos, logo, produto, cena com móveis), desenhe a referência em SVG e
anexe no Flow junto com o prompt detalhado. Aferido em 12/10/2026: 7 cenários, média 9,8 contra
8,9 do prompt puro, e foi o único grupo sem nota abaixo de 9.

**Receita**

```
1. SVG chapado e limpo, na MESMA proporção da saída (4:3 = 1600x1200). Sem gradiente, sombra,
   tracejado ou enfeite: tudo que é decoração no SVG vaza para a foto (o tracejado do tapete
   virou costura).
2. Converter em PNG (cairosvg), subir com flow_subir.
3. Proporção pela INTERFACE, nunca pelo prompt: apagar o Agente, chip de configurações,
   aba Imagem, 4:3, x1. A saída vem em 1200x896.
4. flow_incluir EM CADA geração: a miniatura some depois de enviar.
5. Prompt em prosa, descrevendo cada elemento, e fechando com:
   "Use the attached image as a strict composition and layout reference. Keep exactly the same
   positions, proportions, shapes and colors of <lista>, but render everything as <foto / design
   final>."
```

**Quando usar e quando não**

| Situação | Referência SVG? |
|---|---|
| Escala, margens, hierarquia, peso dos blocos (pôster, logo, produto, sala com móveis) | Sim |
| Posição esquerda/direita, ordem, contagem ("dois", "um de cada lado") | Não precisa, o prompt puro já acerta |
| Forma 3D ambígua (triângulo sobre retângulo = telhado) | Não: virou quatro águas em 2 de 3 imagens, mesmo com o texto pedindo duas. Descreva em texto e confira |

**O que dá errado**

- **Só "foto realista" com a referência** (sem a frase de rigidez e sem listar cores): o modelo
  troca fundo, cor e estilo (mascote ganhou floresta, logo ganhou gradiente 3D). Média 8,7, a pior.
- **Cor e fundo não descritos no prompt** são trocados. Diga a cor de cada elemento e o fundo.
- **Frase do Google** ("Follow the structure of the attached reference image exactly") ficou um
  pouco abaixo da receita acima e, num caso, fez o vaso copiar o estilo chapado do desenho.
- **Logo ou marca de teste:** use nome inventado, para o modelo não reproduzir de memória.
- Texto curto com acento saiu certo em 14 de 14 imagens, com ou sem referência: não é motivo
  para usar o método.

**Não testado:** referência em proporção diferente da saída, duas referências, referência
fotográfica real, e a frase de rigidez isolada, sem o prompt longo.

## Reaproveitar a arte como matriz

Aferido: numa arte aprovada, pedir só a troca da manchete **preserva o layout inteiro**: mesma
tipografia, mesmo peso, mesmo alinhamento, mesma posição, mesma foto, mesma etiqueta, mesma linha de
apoio. É assim que uma peça vira esteira de conteúdo: aprova-se um layout, e cada pauta nova custa
uma edição de texto, não uma arte nova.

Fórmula da edição de troca de texto:

```
Troque somente as palavras da manchete. No lugar do texto atual, escreva "<NOVA FRASE>",
em <N> linhas, com "<PALAVRA>" em <cor de destaque> e o restante em branco.
O idioma de todo o texto desta arte é português do Brasil.
Preserve a mesma tipografia, tamanho, alinhamento, entrelinha e posição.
Preserve idênticos a fotografia, a etiqueta "<...>", a linha de apoio "<...>" e o rodapé vazio.
```

## O mito do inglês

A frase "supports English only prompts" existe na documentação do Google, mas é do **Imagen**,
modelo diferente e em desativação. É daí que o boato nasce. Para o Nano Banana, os três guias
oficiais (DeepMind, ai.google.dev, blog.google) **não** dizem nada disso; a orientação é escrever o
prompt num idioma e declarar o idioma-alvo do texto de saída.

Aferição de 19/08/2026, mesma peça, mesmo modelo: **prompts em português → nenhum erro de texto;
1 prompt em inglês pedindo 2 variações → 1 correta e 1 com "SQBRE" e "MEIS"**.

## Fórmula oficial do Google (para o fundo)

`[Assunto] + [Ação] + [Cenário] + [Composição] + [Estilo]`, em frase narrativa. Erros que a
documentação manda evitar: lista de palavras-chave soltas e framing negativo.

## Erros aferidos — sintoma, causa, correção

| Sintoma | Causa provável | Correção |
|---|---|---|
| Texto traduzido para inglês | idioma-alvo não declarado | "O idioma de todo o texto é português do Brasil" |
| Palavra inventada ("MEIS", "SQBRE") | framing negativo no fim do prompt | reescrever tudo como afirmação |
| Manchete em 3 linhas quando pedi 4 | quebra de linha é sugestão, não comando | aceitar, ou reescrever a frase no tamanho que cabe |
| Casa em silhueta/contraluz | luz descrita sem dizer o que deve ficar legível | "a fachada permanece clara e legível" |
| Arte com cara de template | falta de posição e hierarquia | dizer onde cada bloco fica e qual é manchete/apoio |
| Letras trocadas em texto circular | texto em curva/arco | pedir "em LINHA RETA, não em curva" |
| Logo/fonte da marca redesenhada | anexada como imagem comum | cadastrar a logo como PERSONAGEM (ver abaixo) |
| Texto que ninguém pediu na cena (ex.: horário) | veio da descrição do personagem ou de frase no prompt | descrição do personagem só diz o que ele É |
| Rosto infantil (olho grande c/ brilho, bochecha rosa) ou debochado (pálpebra caída) | expressão não declarada | "olhos bem abertos e alegres, sorriso aberto, sem bochecha rosada" |
| Pediu 2 mudanças, fez 1 | edição com mudanças de natureza diferente | uma mudança por comando |

## Personagem: o recurso que faz o Flow RESPEITAR (aferido 27–28/09/2026)

Aba **Personagens** (menu "+" → "Criar personagem"). Não serve só para mascote:
- **Logo, letreiro, palavra em fonte da marca = personagem.** Anexado como personagem, o Flow reproduziu
  o logotipo da marca com letras, cores e sombra certas, até **bordado em boné de lado** e em caneca.
  Anexado como imagem comum, ignorava e redesenhava (inclusive com "cole como imagem").
- **Uma versão de cor = um personagem** (colorido, escuro, branco, marinho, preto). Com uma só, ele
  sempre puxa aquela.
- **A descrição do personagem vira contexto de TODA cena.** Escreva só o que ele É e como reproduzir
  ("É a LOGO OFICIAL, não um personagem: … reproduzir exatamente, sem redesenhar letras, sem trocar
  cor, sem rosto"). Slogan, horário ou frase de campanha na descrição aparecem nas imagens.
- **Manter igual → anexe o PERSONAGEM. Mudar estilo/rosto → anexe a IMAGEM** (o personagem prende o
  Flow ao visual cadastrado).
- **"Criar corpo" devolve a folha inteira** se o retrato for uma folha de poses: peça "somente UM,
  o desenho 1, sozinho, fundo liso" e, se vier sobra, edite "apague os outros".
- Consistência entre cenas foi muito boa.
- **Criar personagem sem subir nada (30/09):** a tela "Novo personagem" tem **"Adicionar do
  projeto"** (usa imagem que já está na galeria) além de "Enviar", e um campo "Descreva seu
  personagem" com botão "Formatar" e escolha de modelo (padrão Nano Banana 2.1, que é o desta skill).
- **Upload pela ponte:** ver "Subir arquivo" na PARTE 4.

## Várias imagens de uma vez

**Modo Agente ligado + um prompt só** pedindo "Gere N imagens SEPARADAS (uma por X, não junte numa
folha)" e descrevendo cada uma numerada. Sai tudo numa chamada. **Uma pose por imagem**: folha com
várias poses perde qualidade e serve só de teste.

## Produto (mockup)

- **Plano (camiseta):** peça ao Flow a peça LISA ("sem logo, sem texto, sem etiqueta"; camiseta
  oversized: "corpo LONGO, bem mais alta que larga", senão sai curta) e aplique a estampa em código
  (por exemplo Python com PIL, modulando a estampa pela luz e pelas dobras do tecido). Sai exato.
- **Curvo/de lado (boné, caneca, moletom):** Flow com o personagem-logo anexado; em código fica colado.

---

# PARTE 2 — CUSTO

**Imagem = 0 créditos.** Conferido: várias imagens em Nano Banana Pro, saldo antes 1050, depois
1050. Vale para Pro, 2.1 e 2 Lite; a ajuda oficial confirma que gerar e aprimorar imagem não gasta
crédito. Em 03/11/2026 a barra mostrava "A geração vai usar 0 créditos" para Nano Banana 2.1 x2.
**Leia sempre o rótulo "A geração vai usar X créditos"** antes de prometer volume.

**Mas há cota diária (oficial, Central de Ajuda, conferida em 03/11/2026), no plano Pro:**

| O quê | Por dia |
|---|---|
| Nano Banana Pro | 100 |
| Nano Banana 2.1 + 2 Lite (cota somada) | 1.000 |
| Aprimorar para 2K | 200 |
| Aprimorar para 4K | só Ultra |

Geração que falha ou é barrada pelo filtro não conta. Para lote grande no Pro, use o 2.1.

**Vídeo custa.** Por geração, em x1 (x2/x3/x4 multiplicam). Revisto em 30/09/2026. Conferido em
nov/2026; o Flow troca modelos em 05/12 (saem Omni 1.1, Veo Fast e Veo Quality), confira na tela:

| Modelo | Resolução | 4s | 6s | 8s | 10s |
|---|---|---|---|---|---|
| Omni 1.1 Flash (conferido em nov/2026; o Flow troca modelos em 05/12, confira na tela) | **360p** | **4** | 5 | 6 | 7 |
| Omni 1.1 Flash | 720p | 7 | 10 | 12 | 15 |
| Veo 3.1 Lite | 720p | — | — | 10 | — |
| Veo 3.1 Fast | 720p | — | — | 20 | — |
| Veo 3.1 Quality | 720p | — | — | 100 | — |

Fonte de cada número: **4 créditos (Omni 360p 4s) aferido** na confirmação do agente. O resto da
tabela foi dito pelo próprio agente do Flow quando perguntado, e bate com o registro oficial de
26/08/2026 ("360p pela metade do crédito do 720p"). No plano Pro, **Veo só gera 8 s em 720p**; 4 s e
6 s de Veo são só do Ultra. Omni é o único com 360p e duração livre (até 15 s no 1.2). Com vídeo
enviado, 720p custa 3 créditos por segundo.

**360p é o modo rascunho.** Oficial (changelog 26/08/2026): metade do crédito do 720p, vale em todas
as durações e modos, e plano pago tem **upscaler de 360p para 720p**, que **custa 0 crédito** (ajuda
oficial, 03/11/2026), para o clipe escolhido. Na tela de 03/11, Omni 720p 8s x2 marcava 24 créditos
e Veo 3.1 Fast x2 marcava 40, o que bate com a tabela acima. O fluxo barato é testar movimento em
360p e subir só o aprovado.

**"Retornar vídeos sem áudio" (engrenagem) não baixa o custo**, segundo o agente. Serve só para
vir mudo quando a trilha é externa.

Saldo Pro: 1.000/mês + 50/dia de bônus (renova diariamente, não acumula). Dá ~140 clipes de 10 s em
Omni 360p, ~70 em 720p, ou 10 em Veo Quality.

**Vídeo pelo Flow × pela API do Gemini:** com os créditos mensais do plano, o vídeo (Omni) sai mais
barato no Flow do que pela API paga, que cobra à parte.

## Qual dos três modelos de imagem — o nome engana

Lista conferida no seletor do Flow em 06/10/2026: **Nano Banana Pro, Nano Banana 2 Lite, Nano Banana
2.1**. O Nano Banana 2 saiu da lista; o 2.1 entrou no lugar e já veio como padrão.

| No Flow (chip) | ID na Gemini API | O que é |
|---|---|---|
| 🍌 Nano Banana 2.1 | `gemini-nano-banana-2.1` | Geração mais nova (Gemini 3.6 Flash), 06/10/2026. **Padrão desta skill** |
| 🍌 Nano Banana Pro | `gemini-3-pro-image` | Topo da geração anterior (Gemini 3), nov/2025. Segunda opinião |
| 🍌 Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | Econômico, até 1K |

**Use o 2.1 por padrão; o Pro é a segunda opinião.** O Google diz (posts oficiais no X, 06/10/2026)
que o 2.1 supera os anteriores, o Pro inclusive, em design visual, texto na imagem, edição por
máscara (só a área marcada muda) e consistência de personagem. Faz até 4K.

**Teste A/B no Flow (06/10/2026, mesmo prompt de post 3:4 com título e subtítulo acentuados):** os
dois acertaram todas as letras e todos os acentos (ê, ã, é, á). Deu empate no texto. O 2.1 fez
tipografia mais pesada, com cara de anúncio, e o Pro fez um "cartão sobre fundo" mais sóbrio. Se a
arte errar texto no 2.1, gere de novo no Pro antes de desistir.

**Custo no Flow continua zero.** O saldo estava em 996 créditos antes das duas imagens e continuou em
996 depois. Na API o 2.1 custa US$ 0,034 por imagem 1K, um quarto do Pro.

**Pegadinha (06/10/2026):** a ferramenta `flow_gerar` recusou um comando que tinha travessão e aspas
("o comando não ficou igual no campo"); sem eles, passou. Se a sua ferramenta confere o texto digitado,
escreva o comando sem aspas tipográficas e sem travessão.

---

# PARTE 3 — FERRAMENTAS (o recurso mais forte do Flow)

Ferramenta no Flow é **mini-app criado por descrição em linguagem natural**: o Flow escreve o
código React+TypeScript e monta a interface, com campos, sliders e uploads de verdade. Caminho:
**Ferramentas → Criar** (ou "Criar ferramenta" na aba Modelos) → descrever → Gerar → Salvar.

Três abas: **Minhas ferramentas** (as suas), **Comunidade** (de outros criadores) e **Modelos**
(as oficiais do Google, em Imagem / Vídeo / Comandos / Experimental).

## A descoberta que inverte tudo: IA no fundo, canvas no texto

A ferramenta que o Flow gera **desenha a arte num `<canvas>` HTML** e o botão só exporta o canvas
para PNG (`toDataURL` → `Flow.save` + `Flow.download`). O texto é `fillText` com fonte real
carregada do Google Fonts: **não passa por modelo de imagem**.

Consequência: **acabam por construção** o acento errado, a tradução indevida e a palavra inventada.
O texto sai exatamente como digitado, em resolução exata de feed (1080×1440 em 3:4, 1080×1080 em
1:1, 1080×1920 em 9:16), e é determinístico: mesma entrada, mesma saída.

**A arquitetura certa para peça com texto é essa:** a IA gera o **fundo**, o canvas compõe a
**tipografia**. É o contrário do que se faz pedindo a arte inteira ao Nano Banana.

E o SDK permite as duas coisas no mesmo app; `flow-sdk` expõe:

```js
await Flow.generate.image({ prompt, modelDisplayName: '🍌 Nano Banana 2.1', aspectRatio: '3:4' })
await Flow.save({ base64, mimeType, name })       // vai para a galeria do projeto
await Flow.download({ base64, mimeType, filename }) // baixa no computador
```

Aferido em 19/08/2026: uma ferramenta com campo "Descreva o fundo" + botão "Gerar fundo" gera a
foto pelo Nano Banana Pro **já na proporção selecionada** e aplica como fundo da arte, sem sair do
app. Ao pedir isso ao Criador, **exija que ele diga se a API não existe em vez de simular**: a
trava evita botão de fachada.

## Custo e limites

**Criar ferramenta não custa crédito** (dito na própria tela), mas há **cota diária** de criações,
sem número publicado. A doc avisa que "mídia gerada através de ferramentas usa seus créditos", e
a página de créditos **não publica valor para imagem**, nem zero. Na prática, a ferramenta de
canvas puro não consumiu nada, porque não chama modelo. **Leia o banner de aviso** na primeira
execução de qualquer ferramenta que chame IA.

**Criar e remixar exige assinatura paga**; usar é livre para todos. Ferramentas só funcionam em
**web/PC**, não no app de celular.

**Não publique ferramenta com a identidade da sua marca.** Compartilhar deixa qualquer um
**remixar**, e o link congela a versão do momento (edições posteriores não chegam a quem já tem o
link). Ferramenta com timbre, tipografia ou layout de vocês fica **privada**.

## O código gerado nasce com bugs de júnior — leia antes de confiar

A ferramenta funciona de primeira, mas o código tem defeitos reais. Numa revisão de um único
arquivo apareceram **sete**, três deles disparando em quase toda geração:

- quebra de linha do título **invertendo a ordem das linhas** (`lines.unshift` + `reverse`);
- texto de apoio **invadindo a barra do rodapé** (posição fixa, sem checar o limite);
- destaque de cor **mudo com mais de uma palavra** (`word.includes` compara palavra isolada contra
  a frase inteira) e acendendo em **pedaço de palavra maior**;
- fonte de tamanho fixo, desequilibrando o 9:16;
- largura do fundo colorido da etiqueta **calculada diferente** do desenho do texto (+4 vs +6 por
  caractere), fazendo a letra vazar;
- imagem corrompida **travando o desenho inteiro em silêncio** (`img.onload` sem `onerror`: a
  Promise nunca resolve);
- **condição de corrida no export**: o desenho é assíncrono (espera a imagem carregar) e o
  `toDataURL` disparava antes de terminar → **PNG totalmente preto**. Só apareceu depois que o
  fundo por IA entrou.

Fluxo que funciona: **aba Código → extrair os arquivos → mandar um subagente revisar → colar
os pedidos de correção no Criador**, em português, como quem encomenda explicando para programador. O
Criador conserta bem, mas **cria regressão**: ao corrigir a ordem das linhas, passou a desenhar o
texto de apoio por cima da manchete.

Regra que emergiu: **corrigir vários bugs de uma vez funciona**, desde que sejam da mesma natureza;
misturar naturezas diferentes não. Sete correções de layout num comando: ok. Reorganizar layout
**e** trocar uma palavra no mesmo comando: ele reorganiza e ignora a troca.

## Limite da ponte dentro do app

A ferramenta roda em **iframe cross-origin**: não dá para ler nem preencher os campos por
JavaScript. O que funciona e o que não funciona, aferido:

- **Selecionar texto por arrasto do mouse FUNCIONA** (ação de arrastar cobrindo o texto), e com a
  seleção ativa, `Delete` e digitação substituem. É o único jeito.
- **Atalho de teclado NÃO atravessa o iframe**: `Ctrl+A`, `Ctrl+End`, `Shift+Home` vão para a
  página, não para o campo. Digitar sem selecionar **insere no meio do texto existente**.
- Campo com rolagem: a seleção só pega o trecho visível; repita arrasto + `Delete` até esvaziar.
- Trocar de aba **Ferramenta ↔ Editar reinicia o app** e limpa o estado (fundo carregado inclusive).

Ao criar a ferramenta, peça de saída: **botão "Limpar textos"**, um **X por campo**, e que cada
campo **selecione todo o conteúdo ao receber o foco**. Isso a torna operável por agente.

# PARTE 4 — OPERAÇÃO

## A barra de comando (versão de 30/09/2026)

**Há dois modos.** O botão **Agente** é o interruptor:
- **Agente ACESO (branco):** modo agente. Enviar abre o **painel lateral de conversa**, com
  histórico de **sessões** (ícone ≡), "nova sessão" e sugestões ("Desenvolva um storyboard",
  "Organize minha grade em coleções", "Transforme um conceito em comandos").
- **Agente APAGADO:** modo manual. A barra mostra o chip **modelo · proporção · quantidade** (ex.:
  "🍌 Nano Banana Pro ▭ x1"); clicando no chip se escolhe na mão.
- **Para sair do agente, feche o painel lateral no ×** (canto superior direito do painel).
- **Painel recolhido × expandido (03/11/2026):** com o painel **recolhido**, a barra fica embaixo
  da grade com `expand_content` ("Abrir"), `+`, chip **Agente**, instruções, `tune` e enviar. Depois
  de **recarregar a página**, o painel pode abrir **expandido** à direita ("Sessão sem título", com
  as sugestões "Discuta ideias comigo", "Crie algumas versões de uma imagem" e "Saiba mais sobre os
  custos de geração"), e aí **o chip Agente não existe no DOM** (o agente está ligado). O `×` do
  painel volta para a barra recolhida, com o Agente ainda aceso.

Ícones da barra no modo agente:

| Ícone | O que abre |
|---|---|
| `+` (à esquerda) | incluir imagem/personagem do projeto no comando |
| `article_spark` — "Instruções para o agente" | instruções fixas (ver abaixo) |
| `tune` — "Configurações" | **Configurações do agente**: os padrões |
| `arrow_forward` | enviar |
| `×` dentro do campo | limpa o texto digitado |

**Configurações do agente** (padrões usados quando o prompt não diz):
- *Confirmar antes de gerar*: **Sempre** (manter) / Nunca.
- *Padrão de imagem*: proporção 16:9 · 4:3 · 1:1 · 3:4 · 9:16, quantidade x1–x4, modelo Nano
  Banana Pro / 2.1 / 2 Lite. Vem de fábrica em **16:9, x2**, com Nano Banana 2.1.
- *Padrão de vídeo*: 16:9 ou 9:16, x1–x4, modelo **Omni 1.2 Flash** / Veo 3.1 Lite (e Omni 1.1,
  Veo Fast e Quality, conferido em nov/2026; o Flow troca modelos em 05/12, confira na tela).
- **O prompt continua mandando mais que o padrão.** Aferido 30/09: com o padrão em 16:9/x2, o prompt
  "UMA imagem 3:4 com Nano Banana Pro" gerou 1 peça 896×1200 no Pro. As regras 5 e 11 continuam
  valendo; o padrão só evita desperdício quando o prompt esquece.
- **O padrão é por projeto** (a tela diz "Configurações do agente neste projeto", 03/11/2026).
  Abrir as configurações pela ponte abre o painel lateral com botão **Salvar**: sair pela seta
  voltar não grava nada.

**Instruções para o agente**: lista de instruções com **título, liga/desliga, imagem de
referência opcional e texto**, que entram em todo pedido. **Valem por projeto** (aferido: a criada
num projeto não aparece em outro). O ícone fica aceso quando há instrução ativa. É o lugar certo
para o que hoje se repete em todo prompt: *"Todo texto escrito dentro das imagens e dos vídeos é em
português do Brasil, com os acentos corretos"*, modelo preferido, a identidade da marca com a logo
como referência. Ainda não medido se ela substitui a declaração no prompt; até medir, **declare no
prompt também**.

**Modo manual (Agente apagado), reconferido em 03/11/2026:** o chip ("Gatilho de configurações",
ex.: "🍌 Nano Banana 2.1 ▯ x2") abre um painel com **Imagem | Vídeo**.
- Imagem: 16:9 · 4:3 · 1:1 · 3:4 · 9:16, modelo, x1–x4 e o rótulo "A geração vai usar N créditos".
- Vídeo: sub-abas **Frames | Elementos**, 16:9 · 9:16, modelo, 360p/720p e 3 a 15 s (só no Omni;
  no Veo somem e fica 8 s), x1–x4.
- **Frames** põe na barra dois espaços, **Início ⇄ Fim** (quadro inicial e final; o ⇄ troca os
  dois). Arraste ou inclua a imagem em cada um. Todos os modelos de vídeo aceitam primeiro e último
  quadro (tabela oficial de modelos).
- **Elementos** = vídeo por referências (ingredientes). Veo Lite/Fast só em 8 s; Veo Quality não
  aceita. A **voz** (abaixo) só funciona em Elementos com Omni.
- Trocar Imagem → Vídeo → Imagem pode mudar a proporção da imagem para 9:16. Confira o chip antes
  de gerar.
- **Qual usar:** **Elementos funciona muito bem** e é o padrão (vídeo e imagens de referência:
  refilmagem, personagem, cenário). **Frames** é para quando já há imagem de início e de fim
  aprovadas; também dá bom resultado.

## Refilmagem no Flow, ponta a ponta (aprovado em uso real, 06/11/2026)

Seu vídeo real → o mesmo take noutro lugar e com outra roupa, pelo Omni do Flow, com os créditos
mensais do plano (não gasta crédito de API).

**Requisito de conta:** envio de vídeo (.mp4) pode falhar com "Falha no envio do vídeo" enquanto
imagens sobem normalmente. Teste na sua conta antes de planejar.
Subir vídeo novo abre "Direitos de uso deste vídeo": quem aceita é o dono da conta.
Anexos: o vídeo em Elementos (o seletor de modelo some; vale o padrão) e até **5 imagens** junto,
citadas por posição ("the scene in the first attached image"; `<IMAGE_REF_0>` é só da API). Custo com
vídeo anexado é o dobro do vídeo sem anexo.

**Princípio:** o vídeo é a ÚNICA fonte de pessoa, enquadramento, câmera e ação; cada imagem empresta
UMA coisa (lugar, roupa) e nunca é quadro inicial. Não se edita o quadro do bruto.

1. **Bruto:** até 15 s (Omni 1.2), vertical, 720p 30 fps (`ffmpeg -vf scale=720:1280,fps=30`). Transcreva a fala.
2. **Projeto:** um por obra, aberto com `?authuser=<seu-email>`. Feche abas do Chrome antes (PC carregado trava o Flow).
3. **Imagens no Nano Banana 2.1 do Flow (0 crédito),** chip > Imagem > 9:16:
   - **lugar vazio, sem pessoa** (o lugar inteiro, com a luz e a hora);
   - **roupa sozinha**, foto de produto em manequim invisível, fundo cinza (só se for trocar roupa).
   Baixe e suba de volta com nome próprio que não contenha outro nome (`lugar-vazio.png`, `camiseta-areia.png`).
4. **Subir o bruto** (`flow_subir`): no modal "Direitos de uso deste vídeo", só o "Concordo" simples.
5. **Montar o pedido:** chip > Vídeo > Elementos > 9:16 > **360p** > x1. `flow_incluir` das imagens;
   o vídeo entra por `+` > Envios > clicar no vídeo > "Incluir no comando". **Nada de personagem** (troca a voz)
   e nada de recortes do rosto (o rosto vem do vídeo). Confira: a barra mostra a duração do vídeo e o custo
   dobra (9 s em 360p = 10 créditos). Mostre prompt e custo ao usuário; uma geração por vez.
6. **Prompt** (inglês, nesta ordem):
   `LOCATION AND WARDROBE CHANGE ONLY.` ·
   `REFERENCES: the attached video is my original video and the only source for the subject, framing, camera
   movement and action. The attached landscape image is a reference for the location, light and colour only.
   The attached t-shirt image is a reference for the clothing only. Do not copy the composition or camera angle
   of either image, and do not use them as a start frame.` ·
   `PRESERVE MY SHOT: Keep the same person, face, hair and beard exactly as in the original video. Preserve the
   camera movement, framing, duration, timing, head turns, expressions, gestures and lip sync exactly. Do not
   add, remove or reposition anything.` ·
   `WARDROBE: Replace only his <roupa> with the <roupa nova> from the t-shirt image, fitted naturally to his
   body and moving with him.` ·
   `LOCATION: Replace only the room around him with the place in the landscape image: <lugar>. Build it as one
   continuous real place around him, so that when the original camera moves, the background shows the matching
   part of that place from that new angle, with correct parallax. Light him with the <luz> of that place. Keep
   shadows, falloff and reflections physically believable and consistent as the subject and camera move.` ·
   `FINISH: Photorealistic, natural skin texture and the original lens perspective. Preserve the original speech
   and audio. No added music or text.` Fala com palavra rara: acrescente `He says, in Brazilian Portuguese:
   "<fala exata>"` (sem aspas o Omni troca palavras). Nome de pessoa pública nunca entre aspas.
7. **Digitar (prompt longo):** o editor do campo (ProseMirror) congelava a aba com digitação tecla a tecla.
   Funciona: rodar JavaScript na página com o texto como argumento:
   `document.querySelector('.ProseMirror').focus(); document.execCommand('insertText', false, TEXTO)`.
   Confira `innerText.length`; envie com clique real no `arrow_forward`. Um envio por vez (ver barreira abaixo).
8. **Baixar:** abra o card (`/edit/<id>`) > "Baixar mídia" > **"1080p Aprimorada"**: baixa o Omni já em 1080x1920
   (9:16), 24 fps, direto na pasta de Downloads do navegador (testado 2 vezes em 08/11, sem custo aparente). Saída
   preferida para reels. Reserva (360p/720p): descubra pela rede a requisição que devolve o link do
   vídeo (seção "Rotas internas") e baixe por `curl`. Entregue só o vídeo; quem julga fala e entonação é o dono do rosto.

**Lições que valem (06/11):**
- Sem personagem e com o vídeo mandando, a voz e a fala saem as originais.
- A luz fica coerente com o movimento (muda quando a pessoa vira de frente ou de costas para o sol).
- Câmera na mão passa; **giro de ~180° não passa por inteiro** (a 2ª metade sai imprecisa). Hipótese: no
  lado oposto o braço faz um movimento que o Omni não conhece. Para giro grande, descreva a órbita segundo a
  segundo ou use previsualização 3D.
- **Fala em vídeo com pessoa enviado:** pôr a fala entre aspas é recusado ("Our policies prevent editing or generating
  speech for people in uploaded videos"). Use "Keep the original audio and her/his speech exactly as in the original
  video ... lips move exactly with the original words". A voz final é a do vídeo original (a do Omni não entra).
- **"Notamos uma atividade incomum. As extensões do navegador que modificam a página podem causar problemas."**
  (medido 08/11) Pela ponte, ~1 geração passa e a seguinte, 5 a 15 min depois, é barrada; fila de várias barra quase
  todas; "Tentar de novo" volta barrado; cada barrada parece alongar a janela. Causa encontrada: extensão que mexe
  na página, como a **Microsoft Editor** do Chrome, que altera as caixas de texto (com ela desligada a
  geração passou na hora). Regra: nenhuma extensão que
  modifique a página ativa no Flow, um envio por vez, sem fila, e não insistir em sequência quando barrar (o card
  some ao recarregar). Não contornar.
- Nano Banana de perfil muda o rosto e espelha; editar o quadro do bruto (cenário + roupa) mexe no corpo: por isso
  o método acima não edita o quadro.
- Vozes do Flow não clonam (só vozes prontas); o site do Gemini recusa refilmar vídeo enviado.
- Comparação: a API aceita 6 imagens; o Flow (Omni 1.2, 15 s como a API) aceita 5 anexos e não gasta crédito
  de API.

---

**Registro da versão antiga (até set/2026)** — **Modo manual**: você escolhia na mão Imagem/Vídeo,
proporção, modelo, duração, quantidade. Em vídeo aparecem duas sub-abas:

- **Frames**: imagem **Inicial** e **Final**, o modelo gera o meio. É o modo de produção: a arte
  já foi aprovada de graça antes de gastar crédito no movimento.
- **Elementos**: vídeo só por prompt, sem referência. Menos controle.

**Modo agente**: conversa. Planeja, decide o que gerar e mantém o contexto do projeto: "gere mais
duas cenas do mesmo lugar, mesma luz" funciona **sem reenviar a imagem de referência**. É o modo de
montar a sequência de cenas de um vídeo: cada cena vira imagem (0 crédito), aprova-se, e só então
vira vídeo em Frames.

No modo agente, **peça tudo dentro da frase**: proporção, quantidade de variações e modelo. Ajuda
oficial confirma; aferido: "Generate 2 image variations, portrait 3:4, using the Nano Banana Pro
model" devolveu duas peças 3:4 sem tocar em painel. Ele narra o passo ("Defining the Goal",
"Refining Lighting and Text", "Generating Image Variations"): use esses textos na espera por texto,
não o "%".

Nas Configurações do agente, **"Confirmar antes de gerar"** deve ficar em **Sempre**. Em "Nunca"
ele gera vídeo sozinho e gasta crédito sem perguntar.

Não há fonte oficial comparando **qualidade** entre agente e manual; a diferença documentada é
funcional (roteamento de modelo + histórico de conversa).

## Editar imagem já gerada

Clicar numa imagem abre o **editor**: o campo vira "O que você quer mudar?". A fita de miniaturas no
topo é o **histórico de versões**, com Anterior/Avançar.

**A edição por texto preserva a tipografia**: aferido duas vezes (mudança de luz e troca completa
de manchete). Custa 0.

### Voltar a uma versão e reescrever o prompt dali

No painel de histórico, passando o mouse sobre o prompt de uma versão aparece o botão
**"Reutilizar comando de texto"** (ícone `redo`). Ele volta àquela versão **e** traz o prompt que a
gerou para edição. Existe em vários pontos do Flow.

É assim que se desfaz uma edição ruim: **não** corrija com outra edição por cima; volte à versão
boa e reescreva o comando de lá. A iteração deixa de ser uma fila e vira árvore.

### Mover elemento: dois erros que travam a mudança

**"Preserve X" congela a POSIÇÃO de X, não só a aparência.** Aferido em 19/08/2026: pedi para
centralizar tudo e terminei com "preserve o mesmo desenho da logo com a onda"; a logo não saiu do
lugar, e ele centralizou só o bloco de horário/data, que era o único que eu não tinha mandado
preservar. Quando quiser mover algo, o preserve tem que ser explicitamente sobre aparência:
"mantenha o mesmo desenho e tamanho da logo, **reposicionando-a**".

**"No centro" é vago; o modelo faz a menor mudança que satisfaz o pedido.** Posicione por faixa
percentual da altura: *"todo o conteúdo ocupa a faixa entre 30% e 70% da altura do quadro; acima e
abaixo só há água e luz"*. Aferido: com percentual, a logo finalmente saiu do teto, mas parou por
volta de 25% e o bloco de dados em 50%. **Percentual ele trata como direção, não como coordenada.**
Para fechar o conjunto, some a isso a distância entre os elementos ("a linha manuscrita e o bloco de
horário ficam logo abaixo da logo, separados por um espaço pequeno"): percentual resolve ONDE,
proximidade resolve QUÃO JUNTO.

**Texto novo entra melhor junto com a mudança de layout do que depois.** Uma troca de palavra foi
ignorada quando pedida junto com a reorganização, e obedecida quando isolada; mas, ao refazer a
reorganização **já escrevendo a palavra nova no comando**, ela saiu correta de primeira. A regra
"um comando, uma mudança" vale para mudanças de natureza diferente (mover × reescrever); o texto
final da peça pode ir declarado dentro do comando de layout.

**Um comando, uma mudança.** No mesmo prompt eu pedi reorganização de layout **e** a troca de
uma palavra: ele reorganizou e ignorou a troca. Separado, num comando só para isso, trocou na hora
e preservou o resto.

**Tirar um elemento:** "Apague somente X. No lugar, fica liso. Mantenha exatamente igual todo o
resto: …" funciona de primeira (aferido 28/09: tirou o "SEXTA · 22H" de uma caneca sem mexer no logo).

**Seleção de área (máscara):** o botão **Selecionar** abre **Caixa** e **Laço**. **A ponte não
conseguiu desenhar essa máscara**: o arrasto não é registrado pelo canvas e chega a virar seleção de
texto da página (3 tentativas, nenhuma pintou). É trabalho de mouse humano.
Se for tentar de novo: o arrasto costuma usar **CSS pixels** da janela, não os pixels do screenshot
(que vem maior por causa do devicePixelRatio); pegue o retângulo com
`document.querySelector('canvas').getBoundingClientRect()`. A arte é `<canvas>`, não `<img>`.

## O que mudou em 03/11/2026 (tela + Central de Ajuda)

Fontes: a tela de um projeto de testes e os artigos "Use the Google Flow Agent" (17093911), "Get
started" (16353333), "Create videos" (16353334), "Create & edit images" (16729550), "Edit videos &
build scenes" (16935718), "Avatar" (17102997), "Models & features" (16352836) e "Projects, assets &
collections" (16935308) em support.google.com/flow. O registro de alterações do site parou em
15/09/2026 (iOS) e não anuncia nada disto.

- **@ no campo de comando:** digitar `@` abre o mesmo seletor do `+` (Tudo · Imagens · Vídeos ·
  **Vozes** · Personagens · **Avatares** · Envios · **Enviar mídia**). `@Nome` cita personagem;
  `@me` cita o seu avatar; `@Voice: Nome` cita a voz. `flow_incluir` continua pelo `+` e
  funciona (aferido 03/11).
- **Vozes (Omni):** Elementos + Omni Flash → **Adicionar → Vozes** → escolher (prévia de 10 s) ou
  **Create New Voice** (voz base, nome, "Voice Performance" descrevendo o jeito de falar, diálogo de
  amostra opcional de 8 s, **Sync**, **Save New Voice**). Só funciona em geração por Elementos;
  nos outros modos dá erro. Algumas personalizações dependem do país. Não testado por nós.
- **Avatar = você mesmo, imagem e voz:** menu do perfil → **Criar avatar** → "Get started" → QR
  code, e termina no celular. Uso: `@me` no comando. Não pode ser compartilhado por Ferramenta nem
  por link público. Apaga-se em "Manage avatar". É o rosto e a voz do dono da conta: só ele cria,
  no celular dele.
- **Vídeo a partir de vídeo (Omni):** sobe um clipe (até 60 s e 1 GB, .mov/.mp4/.avi/.wmv; acima de
  30 s o Flow pede para cortar em 30 s), escolhe um trecho de até **15 s** (Omni 1.2), escreve o pedido
  e gera. Aceita até 3 ajustes seguidos. É o caminho da refilmagem dentro do Flow, sem API.
- **Estender:** só vídeo do **Veo** (botão **Extend** embaixo do clipe; tabela oficial: só Veo Lite,
  8 s). Clipe estendido não aceita outros modos de edição. Omni: "em breve".
- **Salvar quadro:** pausa o vídeo → **Save frame** → vira imagem para Início/Fim ou ingrediente.
- **Histórico → "Save to Project"** (passe o mouse na versão) guarda aquela versão como mídia do
  projeto, para citar no comando.
- **Mais (⋮) de cada mídia:** Add to Prompt, Add to Scene, Share (com "Include inputs"), Publish to
  YouTube (só clipe, não cena), Download (em vídeo, GIF sai em 270p), Move to trash.
- **Biblioteca** no menu lateral (com `+` "Criar coleção") e **Criar ferramenta** direto no menu.
  Coleção também nasce arrastando um bloco sobre outro, e pode ter coleção dentro de coleção.
- **Topo:** busca + "Opções de filtragem e ordenação", `+`, ajuda, engrenagem da grade, ⋮, chip
  **PRO** (menu da conta).
- **Grade em modo Lote:** lista com miniatura, prompt, referências usadas, data, modelo e proporção,
  botões baixar/reutilizar/lixeira. `img[data-media-id]` continua lá; a ordem continua sendo a mais
  recente primeiro.
- **Menu do perfil:** saldo ("N créditos do Google Flow", com a data de redefinição do limite) ·
  Fazer upgrade · **Criar avatar** · Gerenciar assinatura · **Marca-d'água visível**.
- **⋮ do topo** ganhou "Saiba mais sobre o Flow" e "Denunciar uma questão jurídica".

## Ferramentas de uma chamada — detalhes (aferidas em 30/09/2026)

Cada uma substitui a receita manual das seções abaixo (que ficam como referência e para quando a tela
mudar). Contratos na seção "O que precisa para rodar".

- `projeto` aceita URL ou uuid; sem ele, usa o projeto aberto na aba. Passada a URL completa, a
  ferramenta deve manter o `/u/N/` da conta.
- Os ids são o `data-media-id` das `<img>` da grade (ordem da grade = mais recente primeiro). O
  editor abre direto por `/project/<uuid>/edit/<data-media-id>`.
- Imagem **enviada** ao Flow não tem menu de tamanho: baixa no original.
- `flow_gerar` deve devolver `aviso` quando não surge mídia nova (o agente pode ter perguntado algo).
- Para subir arquivo em QUALQUER site cujo campo de arquivo só nasce no clique, a mesma técnica de
  interceptar o seletor serve (ver "Subir arquivo").
- **Teste de 03/11/2026 sem gastar crédito:** `flow_incluir ["logo.png"]` funcionou; `flow_baixar` 2K
  entregou 2752×1536 (2,69 MB) a partir de uma 16:9. Seletores usados e presentes na tela nessa data:
  "Menu para adicionar arquivos" > "Enviar", `[contenteditable]`, `button.agent-mode-chip`,
  "Iniciar geração", "Parar".
- **Aba que congela:** duas vezes a aba ficou parada no editor, e todo JavaScript (inclusive
  `document.title`) estourava o tempo, mesmo depois de navegar. Não é seletor: feche a aba, abra
  outra e repita.
- **Id do editor ≠ id da mídia.** Clicar numa miniatura dentro do editor leva a
  `/edit/<id da pilha de versões>`. Esse id não serve para buscar a mídia. Use o `data-media-id` da grade
  (o editor também abre direto por ele).
- **Passe sempre a aba** quando a ponte permitir: ferramenta sem aba definida toma a aba ativa
  (inclusive a de outro site) e pode travar.

## Download e entrega

Botão de baixar no editor: **1K (tamanho original) · 2K Aprimorada · 4K Aprimorada**. **4K está
bloqueado no plano Pro** (aparece apagado com "Fazer upgrade"); o teto real é 2K. O 2K de uma 3:4 sai
em 1792×2400 (~2 MB). Baixe em **2K** para papel e para HTML de entrega; 1K só serve para tela
pequena. O toggle **"Marca-d'água visível"** fica no menu do perfil; confira antes de baixar arte para
quem pediu.

Se a entrega for HTML, embuta a imagem como `data:` base64, nunca como link. Para tirar fundo: a
ferramenta **Background Remover** na aba Comunidade do próprio Flow, um removedor de fundo de sua
escolha.

Proporções comuns: feed **3:4** (1080×1440), story **9:16**.

**Baixar por script:** leia o `src` das `<img>` da grade (miniatura de até 1024 px). Se o link for
assinado, `curl` direto funciona enquanto não expira; se não, baixe pela sessão logada do navegador.
Se o link tiver um sufixo de tamanho, compare com a requisição da tela de edição para achar o maior.
2K só pelo botão de baixar (arme o download antes do clique). Figurinha/adesivo pequeno: 1024 basta.

**Baixar 2K à mão (reserva; o normal é `flow_baixar`), 5 passos por imagem:** clicar na miniatura
(abre o editor) → clicar no ícone de download (canto superior direito) → armar o download para a
pasta → clicar em "2K" → esperar o download. O arquivo chega com nome automático em inglês
(`Poster_with_text_..._2K_<data>.jpg`); renomeie depois.

**Baixar TUDO de uma vez: ⋮ → "Baixar projeto".** Aferido 30/09: devolve um `.zip` com o nome do
projeto e **cada mídia no tamanho original (1K)**, numa chamada só. Serve para backup e para
figurinha; **não** serve para peça de impressão, que precisa do 2K.

## Rotas internas: descobrir na hora, nunca decorar

O site conversa com o servidor por requisições internas, sem documentação, que mudam sem aviso. Por
isso esta skill **não grava endereço nenhum**: ela ensina a descobrir a rota da vez. Uso permitido:
**só ler e baixar a sua própria mídia**, com a sua sessão. Sem garantia: pode parar de funcionar a
qualquer dia.

**O método:**

```
1. Faça a ação UMA vez à mão, pela tela (abrir a mídia, clicar em baixar, esperar o vídeo ficar pronto).
2. Leia as requisições de rede que a página fez naquele clique (ação "ler requisições de rede" da
   ponte, ou a aba Network do DevTools).
3. Ache a que traz a lista ou o arquivo da PRÓPRIA mídia: a resposta tem o id que você clicou, o
   prompt que você escreveu, o tamanho, ou um link de arquivo de imagem/vídeo.
4. Repita só essa requisição, por JavaScript na mesma aba (a sessão já está lá), trocando o id.
5. Se o link do arquivo baixar fora do navegador (curl), ótimo; se der 403, baixe dentro da página.
6. Mudou, deu erro ou veio vazio: volte ao passo 1 e descubra de novo. Não insista no que quebrou.
```

- **Anote o que descobriu só na sessão** (no contexto da conversa), nunca no SKILL.md nem em
  arquivo: endereço gravado envelhece e vira erro silencioso na próxima vez.
- **O que já se sabe sobre o formato, sem endereço:** os links de arquivo do Flow costumam vir
  assinados e com validade (algumas horas), e aí baixam por `curl` sem login; o vídeo vem no
  tamanho gerado (360p = 640×360). O link da miniatura da grade dá 1024 px; 2K só pelo botão
  "2K Aprimorada", que cria uma mídia nova (outro id). Depois de aprimorada uma vez, a mesma
  requisição de leitura descoberta acima devolve o link 2K desse id novo.
- **Id do editor ≠ id da mídia:** use o `data-media-id` da grade na requisição descoberta.
- **Gerar por rota NÃO dá, e não se tenta.** Gerar (e aprimorar para 2K) leva token de reCAPTCHA, e o
  site arma uma armadilha para extensão que tenta chamar a geração direto (termina em "atividade
  incomum"). É barreira anti-robô: não contornar. Gerar continua pela tela (`flow_gerar`).
- **Conferir se respeitou o pedido:** depois de baixar, meça largura, altura, duração e áudio, por
  exemplo com `ffprobe -v error -show_entries stream=codec_type,width,height:format=duration -of json <arquivo>`,
  e compare com a proporção, a altura e a duração pedidas.
- **A proporção vale a da barra, nunca a do texto.** "16:9" escrito no prompt saiu 9:16 (768×1376) porque a
  barra estava em 9:16. Ajuste a barra antes de gerar e confira o arquivo.

## Subir arquivo (revisto 30/09/2026)

**O normal: `flow_subir`, sem janela do Windows.** A receita abaixo é a que a ferramenta embrulha, e
serve quando ela não existe.

O "Enviar" (menu `+` do topo, ou "Enviar" dentro de personagem/cena) abre a janela do Windows e o
`<input type=file>` só nasce na hora. Receita que funcionou:

```
1. JavaScript na página instalando um override de HTMLInputElement.prototype.click e
   showPicker: para type=file, em vez de abrir a janela, dá estilo visível e anexa ao body
2. `+` do topo (clique por coordenada) -> achar "Enviar" -> clicar na referência
3. anexar os arquivos ao seletor "input[type=file]"
4. conferir na tela: o bloco novo aparece na grade com "%" subindo; espere o "%" sumir
```

O input existe, mas não costuma entrar na lista de elementos interativos: anexe pelo seletor CSS,
não por referência. No primeiro "Enviar" da página o override pode não pegar e a **janela do Windows
abrir na tela do usuário**. Se o input não aparecer, peça para fechar a janela e clique "Enviar" de
novo. Depois de subir, a aba **Envios** aparece no menu lateral.

## Telas e menus (mapa de 30/09/2026)

**Menu lateral** (03/11/2026): Todas as mídias · Imagens · Vídeos · Personagens · **Cenas** ·
**Envios** · **Biblioteca** (+ "Criar coleção") · Ferramentas · **Criar ferramenta** · Lixeira ·
Fechar. Os itens de mídia aparecem conforme o projeto tem conteúdo.

**`+` do topo ("Adicionar mídia"):** Enviar · **Nova coleção** (pasta para organizar a grade; o
agente também organiza sozinho se pedir) · Criar personagem · **Nova cena**.

**Cena = linha do tempo de montagem** (o antigo Scenebuilder). Aferido: tela com proporção
(16:9), player, régua de tempo com zoom, `+` para inserir clipe (puxa de **Vídeos** do projeto ou de
**Envios**, então aceita vídeo feito fora do Flow), campo "Selecione um clipe para editar" com
Omni Flash, favoritar, **baixar a cena inteira**, excluir, histórico. Serve para montar a
sequência de clipes sem sair do Flow. Na grade, cada cena aparece como bloco "Untitled Scene <data>".

**Engrenagem ("Configurações da grade de blocos"):** Modo de visualização Grade/Lote · tamanho
P/M/G · Som ao passar o cursor · **Retornar vídeos sem áudio** (não reduz custo) · **Mostrar
detalhes do bloco** (aferido: põe na miniatura o ícone do tipo e o título automático da mídia) ·
**Limpar comando ao enviar** (desligue quando for ajustar e reenviar o mesmo prompt).

**⋮ do topo:** Baixar projeto · Ajuda do produto · Central de Ajuda · **Ver todos os registros de
alterações** (`flow.google.com/changelogs`) · Flow Music · Flow TV (vitrine de vídeos da
comunidade) · Sobre · Feedback · Aviso de privacidade.

**⋮ ao lado do nome do projeto:** Renomear · Ver lixeira · Excluir.

**Editor de imagem** ganhou: recorte (ícone acima da imagem), ⓘ detalhes, favoritar (coração),
compartilhar, excluir, baixar, histórico, e o chip do modelo usado ao lado do enviar (é por ele
que se confere qual modelo o agente escolheu).

**Registro de alterações:** cada novidade abre num iframe `gstatic.com/.../changelogs/<arquivo>.html`.
Para ler, pegue o `src` do iframe por JS e baixe com `curl`. O `el.click()` por JS não troca de
item; clique de verdade.

## Passo a passo pela ponte (reserva: sem as ferramentas de uma chamada)

```
1. conferir que a ponte está conectada ao Chrome logado
2. navegar para https://flow.google.com
3. fechar os modais de novidade (vêm em fila; "Comece já" / "Dispensar")
4. "Novo projeto" -> a URL vira flow.google.com/project/<uuid>; guarde o uuid
5. clicar no campo (coordenada) ou focar por JS; digitar como teclado real
6. clicar na seta de enviar por COORDENADA (a referência de "Iniciar geração" vem coberta pelo ícone)
7. esperar "%" sumir; no painel do agente, esperar "Pensando" sumir
```

## Pegadinhas da página (aferidas)

- **O campo de prompt é `contenteditable`, não `<input>`.** A busca por placeholder não o acha.
  Foque por JS: `document.querySelector('[contenteditable="true"]').focus()`
- **`return` solto no topo do script pode quebrar a execução de JavaScript da ponte.** Use `({...})`
  ou uma função async autoexecutada (IIFE).
- **Não brigue com os painéis flutuantes.** Clicar por texto neles erra o alvo: um clique em
  "Imagem" abriu o dropdown de modelos de vídeo, outro caiu dentro do editor. Declare proporção e
  modelo no prompt; se precisar do painel, clique pela referência obtida com "achar elemento".
- **Clicar numa imagem da grade abre o EDITOR** e o campo vira "O que você quer mudar?". Digitar ali
  edita aquela imagem em vez de gerar uma nova. Saia por "Concluir".
- **`el.click()` por JS não dispara o enviar**: o React ignora. Use clique real da ponte.
- **Menu lateral (Cenas, Personagens...):** se a sua ponte tiver trava de "ação perigosa" por palavra
  (o ícone `delete` da Lixeira fica ali), ela pode barrar o clique por falso positivo. Não libere a
  trava: clique no `mat-list-item` por JS, que ali funciona.
- **Clique por texto em menu cai no item vizinho** (pedi "Nova cena", abriu "Criar personagem";
  pedi "registros de alterações", abriu Flow TV). Sempre achar elemento → clicar pela referência.
- **Texto digitado pode sumir** se o foco foi dado por JS logo depois de navegar. Clique no campo por
  coordenada antes de digitar e confira por screenshot antes de enviar.
- **Botão "Create with Google Flow" da landing não navega** pela ponte. Vá direto na URL do app.
- **Modais de novidade vêm em fila** e reaparecem depois do login.
- **O saldo no menu do perfil não atualiza sozinho**: recarregue a página.
- Regex de saldo: casar `Cr[ée]ditos do Google Flow`. Só `créditos` pega o banner do bônus e
  devolve "50", que é falso.
- **"Notamos uma atividade incomum":** ver a regra completa em "Refilmagem no Flow" (nenhuma extensão
  que modifique a página, um envio por vez).

## O que o Flow NÃO tem

Sem API pública e sem MCP (só as rotas internas, descobertas na hora, que servem para ler e baixar). A ajuda oficial
não menciona acesso programático. Os "Veo MCP" de GitHub são wrappers da Gemini API/Vertex e **cobram
à parte: não consomem estes créditos**. Por isso esta skill é navegador, e não integração.

---

# PARTE 5 — OUTRAS PORTAS DA MESMA CONTA (pela ponte)

Mesma conta Google AI Pro, mesmo caminho (ponte, aba própria). Nenhuma gasta crédito do Google
Cloud nem da API paga do Gemini.

## Site do Gemini para diagnóstico

Quando precisar dos olhos do Gemini para **analisar** algo (assistir um vídeo gerado, conferir uma
animação, comparar com a referência, descrever uma cena), abra `gemini.google.com`, suba o arquivo
e pergunte. Limites: só análise (gerar continua sendo o Flow acima), e nada sigiloso (documento
ou dado pessoal de terceiros).

Antes de subir qualquer coisa, confira pela etiqueta "Conta do Google: ..." que está na sua conta.

### Gemini Spark (aba "Spark BETA" no topo da barra lateral do gemini.google.com)

Aferido na tela em 26/09/2026. É o **modo agente** do Gemini: em vez de conversar, você descreve uma
tarefa e ele executa (com navegador remoto próprio, apps conectados e código).

**Uso aqui: analisar áudio e vídeo** (e diagnóstico multimodal em geral). Em teste, o Spark foi
**muito mais preciso** que a conversa normal. Ativar ("Usar o Spark") pede aceite de termos: quem
aceita é o dono da conta. O aviso diz que ele compartilha dados com terceiros para cumprir a tarefa:
nada sigiloso.

**O Spark NÃO gera imagem** (testado 26/09/2026: pedido de Nano Banana ficou rodando sem entregar).
Imagem a partir de fotos de referência → chat normal do Gemini, "+" ▸ **Criar imagem**, anexar as
fotos e descrever (saiu ótimo em ~30 s: arranjo de flores das fotos dentro de um pote real); ou o
Flow acima. Cuidado: "Criar imagem" mostra estilos prontos ("anos 80"...) e um clique errado
anexa um deles. Spark fica para ANALISAR.

**Vídeo no chat do Gemini ("+" ▸ Criar vídeo) NÃO gasta crédito do Flow**, mas tem menos controle:
sem Frames inicial/final, sem escolher modelo e duração como no Flow. Regra: rascunho, teste de ideia
e cena simples → Gemini (grátis); peça final que precisa de quadro inicial/final, modelo ou duração
exata → Flow (gasta crédito).

**Upload pela ponte (Spark e Gemini):** "+" ▸ Enviar arquivos, depois anexar ao `input[type=file]`.
O `accept` do campo não lista vídeo, mas **mp4 entra** (o filtro é só do seletor de arquivos). Um
conferidor automático de upload pode dizer "não entrou" porque não conhece a lista do site: confira
por screenshot (as miniaturas aparecem acima do campo).

**As 4 abas da lateral:**
| Aba | O que é |
|---|---|
| Ações | a tela de tarefas: campo "Descreva uma tarefa" + lista Recentes / Todas as tarefas |
| Programações | tarefa que roda sozinha: repetindo, reagindo a evento ou monitorando algo |
| Habilidades | instruções reutilizáveis, chamadas sozinhas ou com "/" |
| Apps Conectados | Workspace (Gmail, Docs, Drive, Keep), Fotos, YouTube Music, Notebook, Contatos, Localiza + **apps personalizados** |

**Anexar (botão "+"):** enviar arquivos · adicionar do Drive · Mais uploads ▸ Google Fotos ·
Importar código. Não tem seletor de modelo (a conversa normal tem "Flash ▾").

**Duas portas que casam com skills do Claude Code** (só mapeadas, não usadas):
- **Habilidades aceitam upload no formato das skills:** `SKILL.md` com `name` (minúsculo,
  com hífen) e `description` no cabeçalho, em .md ou .zip com o SKILL.md na raiz; só texto, até
  100 MB. Ou seja, uma skill de `~/.claude/skills/` sobe quase sem mexer.
- **Apps personalizados = servidor MCP por URL** (campo "Adicione um link de app personalizado").
  Um MCP remoto seu poderia virar ferramenta do Spark. Cuidado: é dado saindo para o Google.

Fontes: support.google.com/gemini/answer/17209137 (apps personalizados/MCP) e
answer/17094296 (habilidades).

## Flow Music (`flowmusic.app`) — aferido na tela em 26/09/2026

**Custo:** plano Plus (vem do Google AI Pro). 10.000 créditos/mês + 30 grátis por dia + bônus. A
página de preços diz "10.000 créditos (~2000 músicas)", ou seja **~5 créditos por música**:
praticamente livre. Até 12 gerações ao mesmo tempo. Baixa mp3, wav, m4a e **stems** (faixas
separadas). Saldo e extrato: `flowmusic.app/settings`.

**Dois jeitos de criar** (em qualquer sessão):
1. **Conversar com o Producer** (a caixa "Ask Producer..."): ele é um co-produtor em chat que
   ajuda a escolher gênero, voz e letra, e remixa. Bom quando a ideia ainda está vaga.
2. **Painel Compose** (botão no canto superior direito): controle direto, sem conversa.
   - *Lyrics*: cola a letra, ou liga *Instrumental*.
   - *Sound*: descreve o som (gênero, instrumentos, voz, BPM). Os destaques da página mostram
     que descrição longa, marcada por tempo (`[0:00–0:18] Production: ... Vocal: ...`), funciona.
   - *Advanced* (liga no botão): **Dynamics, BPM, Length, Seed, Model**. Seed fixa = repetir o
     resultado mudando uma coisa só.
   - *Generate*.

**Botão "+" do campo:** gravar áudio na hora; subir **áudio** próprio (até 40 MB) para criar
em cima/remixar; subir **imagem** para inspirar letra ou virar capa.

**Botão de ajustes (ícone de controles) — o que cada item faz:**
| Item | Opções | Padrão |
|---|---|---|
| Instrument (o modelo de música) | Lyria 3.5 (principal) · Lyria 3 Pro (antigo) | Lyria 3.5 |
| Ghostwriter (letra) | Standard (rápido) · Pro (pensa mais a letra) | Standard |
| Producer (o chat) | Standard · rápido | Standard |
| Customize Producer | abre as abas abaixo | — |

**Customize Producer** (também no menu do perfil):
- *Progress*: pontos e medalhas por uso. Enfeite, ignore.
- *Instructions*: texto fixo sobre você (até 10.000 caracteres), entra em toda sessão nova. É
  aqui que cabe o seu gosto (gênero, público, idioma).
- *Flows*: atalhos "/comando" próprios, até 12.
- *Memories*: o Producer aprende com as conversas. Não ligue sem o dono da conta decidir.

**Configurações da conta** (`/settings`): letra moderada, marca d'água visível, **"Help improve"**
(se ligado, o conteúdo pode treinar o Google: não suba nada sigiloso), tema. Não mexa sem o dono da
conta.

**Primeira geração real (26/09/2026, trilha instrumental curta):** Compose, Instrumental ligado,
Advanced com BPM 72. Custou **5 créditos** (conferido no extrato). Saiu em ~40 s, com 1:02 de
duração: o campo Length voltou sozinho para 1:00 quando digitei 0:30 (parece ser o mínimo; corte no
editor). Pegadinhas: **ligar o Advanced apaga o texto do Sound**, então ligue primeiro e escreva
depois; a música **começa a tocar sozinha** no Chrome, pause. O download fica no "..." da faixa
(Download ▸ formato), e ali também tem Remix, Split stems e Details.

**Ainda não testado:** canto em português, Music videos, Spaces. Antes de gastar crédito em trilha
para um público específico, peça uma música de referência ao usuário.
