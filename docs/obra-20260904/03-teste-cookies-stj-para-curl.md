# Obra 03 — Medir: `browser_cookies` do STJ passa o Cloudflare em `curl`? (jurisprudência)

**Lote 0. Sem código. É uma medição autorizada pelo Cezar (decisão 3).**

## Objetivo em uma frase

Descobrir, com números, se o cookie `cf_clearance` (e companhia) exportado pela ponte de uma
sessão real do SCON do STJ faz um `curl` passar do desafio Cloudflare — o que tiraria o SCON do
degrau "navegador" e resolveria a disputa pela janela única da ponte.

## Por que existe

O SCON (`scon.stj.jus.br`) devolve **403 com "Verificação automática em andamento"** para `curl`,
inclusive no inteiro teor (`GetInteiroTeorDoAcordao`). O Chrome real passa, mas em 03/09/2026
cinco agentes abrindo o SCON em sequência prenderam até a aba do Chrome real no desafio por mais
de dez minutos (memória `reference_stj-scon-cloudflare.md`). A tool `browser_cookies` já existe
(`capabilities.ts:259-263`: `chrome.cookies.getAll({url})` → header `Cookie:` pronto). Ninguém
testou se o cookie sobrevive fora do navegador — o Cloudflare pode validar a impressão TLS além
do cookie (estudo 4, §C).

## Regras desta medição (não negociáveis)

- **Uma abertura por vez, espaçada de pelo menos 5 s.** Total de aberturas do SCON pela ponte:
  **no máximo 4**. É o Chrome de uso diário do Cezar; queimar a cota dele é o risco.
- Apareceu "Verificação automática em andamento" ou "Just a moment" na aba: **pare, não insista,
  reporte**. Quem resolve o desafio é o Cezar, se quiser; você não espera nem repete.
- Só leitura. Nada de protocolo, nada de aba do usuário (`browser_use_current_tab` proibido):
  trabalhe na **sua aba própria** na janela da ponte, que é o padrão.
- A extensão pode ser recarregada pela obra 01 no meio (o reload derruba sua sessão): se um
  comando falhar com "extensao desconectada"/"[aba trocou]", espere 30 s, `browser_status`, e
  refaça só o passo perdido. Não conte isso como bloqueio do STJ.

## Passos

1. `browser_status` (extensão conectada). `browser_navigate` para `https://scon.stj.jus.br/SCON/`;
   `browser_wait_network`; `browser_read_page`. Se for desafio → pare (regra acima). Se for a
   home, siga.
2. Faça **uma** busca de verdade pelo formulário: campo `#pesquisaLivre` (skill `juris-tribunais`,
   seção STJ: na home é `#pesquisaLivre`; digite com `browser_type` modo `teclado` e submeta com
   `browser_press_key Enter`). Termo: `"energia solar" e ICMS`. Confirme na página de resultados
   que a busca saiu (leia as quatro contagens: súmulas/acórdãos/monocráticas/informativos).
3. `browser_cookies { url: "https://scon.stj.jus.br" }`. Guarde o header. **Não cole o header
   inteiro no relatório** — cite só os **nomes** dos cookies e o tamanho. Anote também o
   `navigator.userAgent` da aba (`browser_javascript { codigo: "navigator.userAgent" }`).
4. `curl` **com** o header e cabeçalhos idênticos aos do Chrome (`User-Agent` do passo 3,
   `Accept`, `Accept-Language: pt-BR,pt;q=0.9`, `Referer: https://scon.stj.jus.br/SCON/`,
   `sec-ch-ua*` se souber montar). Três alvos, um `curl` cada, ≥5 s entre eles:
   a. `https://scon.stj.jus.br/SCON/` (home) — espera-se 200 com o formulário.
   b. A **mesma busca** do passo 2, reproduzida por URL/POST — a skill avisa que a URL de busca só
      funciona quando o formulário a gera; então capture a requisição real: `browser_javascript`
      lendo `performance.getEntriesByType('resource')` ou o `form.action` + campos do formulário
      da página de resultados. Se não conseguir reproduzir a busca, registre "não reproduzível
      por curl" e siga para (c).
   c. Um inteiro teor: `GetInteiroTeorDoAcordao?num_registro=...&dt_publicacao=...` — pegue um
      link **da própria página de resultados** (`browser_find "inteiro teor"` ou
      `browser_extract`), não invente número.
   Para cada: código HTTP, `Content-Type`, primeiros 200 chars do corpo, e se contém
   "Verificação automática"/"cf-chl"/"Just a moment".
5. Variante de controle: o mesmo `curl` do 4a **sem** o header `Cookie` → deve dar 403. Se der
   200 sem cookie, o bloqueio mudou e o teste inteiro precisa ser reinterpretado.
6. Se 4a/4c passarem: repita 4c **uma vez** 60 s depois para ver se o cookie continua valendo.

## Ferramentas

MCP `praxedes-bridge` (`browser_*`). `curl` do Git Bash (`curl.exe` no PowerShell; acento em
argumento quebra no Git Bash — a busca aqui não tem acento, mas se precisar, PowerShell). Não use
Camoufox nem o navegador interno do app (o STJ derruba o app: memória
`project_stj-derruba-navegador-interno.md`). Não use Bright Data (reprovado por política).

## Entregável

`docs/obra-20260904/relatorio-03-cookies-stj.md`, curto, com: tabela (alvo × com cookie × sem
cookie × código × marca de desafio), nomes dos cookies vistos, UA usado, quantas aberturas do SCON
foram feitas, e **uma recomendação em uma frase**: "SCON pode ir para curl com cookie da ponte
(validade ≥ N min)" **ou** "não passa; fica no navegador, uma abertura por vez". Se o desafio
apareceu no navegador, diga em qual passo e pare aí — resultado parcial é resultado válido.

## O que NÃO fazer

- Não editar a skill `juris-tribunais` nem nenhuma outra: a regra da casa é proposta antes de
  substituir, e quem decide é o capataz com o relatório na mão.
- Não abrir mais de uma aba do SCON, não paralelizar, não "tentar de novo" o desafio.
- Não escrever código no repo. Não commitar.

## Como reportar

Cole o relatório inteiro na resposta final (o capataz não abre arquivo para saber o resultado).
