# Relatório 03 — cookie do `browser_cookies` passa o Cloudflare do SCON em `curl`?

**Data/hora:** 05/09/2026, ~19:49 (horário do evento registrado pela própria página do STJ).
**Aberturas do SCON pela ponte:** **1 de 4** permitidas. Parei aí, como a regra manda.

## Veredito em uma frase

**Não dá para responder a pergunta hoje** — nem o navegador real passou do desafio Cloudflare na
primeira tentativa, então não existe cookie de sessão válida (`cf_clearance`) para testar em
`curl`. Recomendação prática: **fica no navegador, uma abertura por vez, e nem isso está confiável
agora** — o SCON está devolvendo o desafio de cara para este Chrome/IP.

## O que aconteceu, passo a passo

1. `browser_status` — extensão conectada, papel `peer`, 1 agente ativo no grupo. OK.
2. Abri aba própria (`browser_tab_open` + `browser_use_tab`, nunca a aba do Cezar) e naveguei para
   `https://scon.stj.jus.br/SCON/`.
3. `browser_wait_network` acalmou, mas `browser_read_page` mostrou a página inteira sendo o
   desafio:
   - título da aba: "Um momento…"
   - heading: **"Verificação automática em andamento."**
   - iframe "Widget contendo um desafio de segurança da Cloudflare"
   - carimbo da própria página: evento em **05/09/2026, 19:49:24**
4. Pela regra da medição ("apareceu o desafio: pare, não insista, reporte, você não espera nem
   repete"), **parei aqui**. Não cliquei em nada, não recarreguei, não abri segunda aba, não
   esperei o desafio resolver sozinho.
5. Antes de fechar a aba, só *li* o estado (sem navegar de novo, sem interagir):
   - `browser_cookies { url: "https://scon.stj.jus.br" }` → **12 cookies**, nenhum é
     `cf_clearance` nem `cf_bm`. Nomes vistos (categorias, sem colar o header inteiro): telemetria/
     analytics (`_ga`, `_ga_F31N0L6Z6D`, `_gid`, `_gat_UA-179972319-1`, `_hjSession_3545185`,
     `_hjSessionUser_3545185`), APM da Dynatrace (`dtCookie14pbrr80`, `dtSa14pbrr80`,
     `dtPC14pbrr80`, `rxVisitor14pbrr80`, `rxvt14pbrr80`) e um cookie de sessão de borda
     (`TS717591ad027` — padrão F5 BIG-IP, não é do Cloudflare). **Nenhum cookie de "passei o
     desafio" existe** — confirma que a sessão está presa no desafio, não passou dele.
   - `browser_javascript { codigo: "navigator.userAgent" }` → `Mozilla/5.0 (Windows NT 10.0;
     Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36`.
   - Fechei a aba (`browser_tab_close`), sem tocar em mais nada.

**Não cheguei a fazer** a busca (`#pesquisaLivre`), nem os três `curl` do passo 4, nem a variante
de controle sem cookie, nem o reteste de validade em 60 s — todos dependem de ter passado do
desafio primeiro, e a home nem chegou a carregar.

## Por que não tentei "só mais uma vez" ou rodei os `curl` mesmo assim

- A regra da medição é explícita: apareceu o desafio, para, não insiste, não espera. Rodar `curl`
  contra o SCON agora só reproduziria o mesmo bloqueio com os 12 cookies de telemetria (sem
  `cf_clearance`), sem gerar informação nova sobre a pergunta real (cookie pós-desafio funciona em
  `curl`?) — e cada requisição extra é carga a mais num tribunal já em modo de verificação para
  este IP/Chrome, o oposto do que a medição pede ("não é alvo de carga").
- A memória do projeto (`reference_stj-scon-cloudflare.md`) já registrava que múltiplas aberturas
  em sequência prendem o Chrome real no desafio por mais de dez minutos. Bater nisso já na
  **primeira** abertura do dia sugere que o SCON está numa janela de bloqueio mais agressiva hoje
  (possivelmente por causa do volume de testes de outras obras em paralelo nesta mesma máquina/IP)
  — dado relevante por si só.

## Tabela pedida (preenchida com o que foi possível)

| Alvo | Com cookie | Sem cookie | Código | Marca de desafio |
|---|---|---|---|---|
| `https://scon.stj.jus.br/SCON/` (home) | não testado — sem `cf_clearance` disponível | não testado | — | **sim**, já no `browser_navigate` inicial: "Verificação automática em andamento" |
| Busca `"energia solar" e ICMS` | não alcançada | — | — | bloqueado antes de chegar ao formulário |
| `GetInteiroTeorDoAcordao` | não alcançado | — | — | bloqueado antes de chegar aos resultados |

## Cookies vistos (nomes, sem valor)

`_hjSessionUser_3545185`, `dtCookie14pbrr80`, `rxVisitor14pbrr80`, `dtSa14pbrr80`, `_gid`,
`_gat_UA-179972319-1`, `_ga`, `_ga_F31N0L6Z6D`, `_hjSession_3545185`, `rxvt14pbrr80`,
`dtPC14pbrr80`, `TS717591ad027` — 12 no total. **Nenhum `cf_clearance`/`cf_bm`.**

## User-Agent usado

`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0
Safari/537.36`

## Recomendação

**Não vale trocar Camoufox/navegador por `curl` com cookie no STJ — e a medição de hoje não
provou nem que o navegador real basta.** Não é que o `curl`-com-cookie tenha sido testado e
falhado; é que a sessão real do Chrome do Cezar bateu no desafio antes mesmo de existir um cookie
de sessão válida para testar. Duas leituras possíveis, e ambas apontam na mesma direção:

1. Se o cookie pós-desafio (`cf_clearance`) tem vida curta e é amarrado a mais do que o valor do
   cookie (impressão TLS/JA3, IP, `User-Agent` exato — hipótese que o próprio brief já levantava),
   então `curl` não serviria mesmo que eu tivesse conseguido capturá-lo hoje.
2. Se o problema de hoje é só "muita gente batendo no SCON pelo mesmo IP", isso é uma razão a
   **mais** para não adicionar tráfego automatizado via `curl`: cada requisição fora do navegador
   é mais uma chance de esticar a janela de bloqueio para todo mundo, inclusive para o Cezar
   resolvendo o desafio manualmente.

Em qualquer um dos dois casos, a conclusão prática para hoje é a mesma: **SCON continua no degrau
"navegador real, uma abertura por vez, espaçada"**, e a decisão de quando tentar de novo é do
Cezar (ele que resolve o desafio, se quiser).

## Sugestão para a skill `juris-tribunais` (proposta, sem editar nada)

A skill já diz "se aparecer captcha, suba de degrau". Sugiro acrescentar, na seção do STJ, uma
frase objetiva: **"antes de abrir o SCON, pergunte se alguma outra obra/agente já abriu hoje —
uma sequência de aberturas (mesmo de agentes diferentes) já derrubou a aba real no desafio por
>10 min (03/09/26), e hoje o desafio apareceu já na 1ª abertura do dia."** Quem decide se aplica é
o capataz; não editei a skill.

## Fiação pendente

Nenhuma — esta obra não gera código nem tool nova.
