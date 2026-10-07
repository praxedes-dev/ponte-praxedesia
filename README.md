# Ponte PraxedesIA

> **Código visível, uso proibido.** Este repositório é *source-available*, não é
> open source. Pode ser lido e avaliado; não pode ser executado, copiado,
> modificado nem reaproveitado sem autorização por escrito do titular. Leia o
> [`LICENSE`](LICENSE).

## O que é

Uma ponte entre o **Claude** (Claude Code e outros agentes) e o **Chrome de verdade**
do usuário, aquele que já está aberto e logado. Duas peças:

- **Extensão do Chrome** (`entrypoints/`, TypeScript, WXT): o "braço" dentro do navegador.
  Age por `chrome.debugger` (CDP) e não decide nada sozinha.
- **Servidor MCP `praxedes-bridge`** (`bridge-server/`, Node): é por onde o Claude
  chama as ferramentas `browser_*` (abrir aba, ler a página, clicar, digitar, subir
  arquivo, baixar, capturar tela, rodar JavaScript, entre outras). Vários agentes
  dividem a mesma ponte, cada um na sua aba.

## O Claude está dentro

O Claude é o usuário do produto: ele recebe as ferramentas MCP e opera o navegador
por elas. A ponte foi construída com o Claude Code, por um advogado
que não programava (Ji-Paraná, RO), para automatizar o trabalho do escritório.
Cada ferramenta tem teste em `bridge-server/test/`, e o desenho de cada obra está
em `docs/`.

Algumas decisões de segurança que o código impõe, e que os testes cobrem:

- a aba que o usuário está vendo entra em **modo somente leitura**; o agente só
  age nela quando o usuário pede explicitamente;
- senha nunca passa pela ponte, e ações irreversíveis exigem confirmação explícita;
- diálogos nativos do navegador chamam o humano, nunca são respondidos sozinhos;
- cada agente tem aba própria, e uma auditoria registra quem fez o quê.

## Por onde começar a ler

- `docs/LEIA-ME-TECNICO.md`: arquitetura e decisões (hub e peers, janela da ponte, fila de input).
- `bridge-server/src/`: o servidor MCP.
- `entrypoints/background/bridge/capacidades/`: as capacidades da extensão.
- `docs/obra-20260904/`: o desenho de cada obra, com critério de pronto.

## Aviso

Todos os direitos reservados. Ver [`LICENSE`](LICENSE) (português e inglês).
