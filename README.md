# Ponte PraxedesIA

Deixa o **Claude Code** usar o **seu Chrome de verdade**, aquele que já está aberto e
logado nas suas contas. O Claude abre abas, lê a página, clica, digita, sobe e baixa
arquivos, como você faria, sem precisar de senha e sem cair no bloqueio de "navegador
inseguro" do Google.

O destaque é o **Google Flow**: com quatro ferramentas, o Claude sobe imagem, gera
imagem ou vídeo, anexa personagem e baixa em 2K, cada uma em **uma chamada só**.

Feita por um advogado que não programava, com o próprio Claude Code. Código aberto
(licença MIT): use, mude e mande melhorias.

---

## O que ela faz

São duas peças que conversam entre si:

- **Extensão do Chrome**: o "braço" dentro do navegador. Não decide nada sozinha.
- **Servidor MCP** (Node): é por onde o Claude Code chama as ferramentas `browser_*`.

Ferramentas principais (todas começam com `browser_`):

| O que | Ferramentas |
|---|---|
| Abas | `tab_open`, `tab_close`, `tabs_list`, `navigate`, `back` |
| Ler a página | `read_page`, `find`, `extract`, `screenshot`, `javascript` |
| Agir | `click`, `type`, `press_key`, `scroll`, `form_fill`, `drag` |
| Arquivos | `upload_file`, `upload_por_clique`, `download`, `save_pdf` |
| Esperar | `wait_for_text`, `wait_for_change`, `wait_network` |

Vários agentes podem usar a ponte ao mesmo tempo, **cada um na sua aba**, numa janela
própria da ponte. A aba em que você está trabalhando nunca é trocada.

### ⭐ Google Flow em uma chamada

Com o Flow logado no seu Chrome (plano pago do Google, ex.: Google AI Pro):

| Ferramenta | O que faz |
|---|---|
| `browser_flow_subir` | Sobe imagens ou vídeos para o projeto **sem abrir a janela do Windows** e devolve os IDs |
| `browser_flow_gerar` | Escreve o pedido, envia, espera terminar e devolve o que nasceu (tamanho e link) |
| `browser_flow_incluir` | Anexa ao pedido uma imagem ou personagem do projeto, pelo nome |
| `browser_flow_esperar` | Espera uma geração longa (vídeo) terminar |
| `browser_flow_baixar` | Baixa em 2K, já com o nome que você escolher |

Na prática você só fala com o Claude: *"gera no meu projeto do Flow uma arte 3:4 de um café
na mesa, luz da manhã, e baixa em 2K"*.

Para tirar **bom resultado** (prompt, custo de cada modelo, texto sem erro de acento),
use junto a skill **google-flow**, distribuída à parte.

Também tem ferramentas de uma chamada para o **Google AI Studio**
(`browser_aistudio_gerar`, `browser_aistudio_esperar`) e para o site do **Gemini**
(`browser_gemini_imagem`, `browser_gemini_video`).

### Travas de segurança (ligadas por padrão)

- **Senha nunca passa pela ponte.** O Claude não digita senha.
- **Ato irreversível** (pagar, assinar, excluir, enviar) para e pede a sua confirmação
  numa notificação do Windows.
- **Site de banco e pagamento**: a ponte não clica em login.
- A aba que **você** está vendo entra em modo **somente leitura**; o Claude só age nela
  se você pedir.
- Janelas nativas do navegador (alertas, "tem certeza?") chamam você, nunca são
  respondidas sozinhas.

---

## Como instalar

Leva uns 10 minutos. Você vai precisar de:

- **Google Chrome** (versão 125 ou mais nova);
- **Node.js 22** ou mais novo ([nodejs.org](https://nodejs.org), botão "LTS");
- **Claude Code** instalado.

### 1. Baixar o código

Baixe este repositório (botão verde **Code → Download ZIP**) e descompacte numa pasta
fixa, por exemplo `Documentos\ponte`. Ou, se usa git:

```
git clone <endereço deste repositório> ponte
```

### 2. Montar a extensão

Abra o terminal **dentro da pasta da ponte** e rode:

```
npm ci
npm run build
```

Isso cria a pasta `.output\chrome-mv3`.

### 3. Instalar a extensão no Chrome

1. No Chrome, abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `.output\chrome-mv3`.
4. Fixe o ícone da ponte na barra do Chrome (ícone de quebra-cabeça → alfinete).

### 4. Instalar o servidor

Ainda no terminal, na pasta da ponte:

```
cd bridge-server
npm ci
```

### 5. Ligar no Claude Code

Troque `CAMINHO` pelo endereço completo da pasta da ponte:

```
claude mcp add praxedes-bridge --scope user -- node "CAMINHO/bridge-server/src/index.js"
```

Exemplo no Windows: `node "C:/Users/voce/Documentos/ponte/bridge-server/src/index.js"`.

### 6. Parear a extensão com o servidor (uma vez só)

1. Abra uma sessão nova do Claude Code e peça qualquer coisa no navegador, por exemplo
   *"abre o google.com pela ponte"*. Na primeira vez o servidor cria um código de pareamento.
2. Veja o código:
   - Windows: `type %USERPROFILE%\.praxedes-bridge-v6\token`
   - macOS/Linux: `cat ~/.praxedes-bridge-v6/token`
3. Clique no ícone da ponte no Chrome. Abre um painel lateral: cole o código e salve.

Pronto. Peça de novo e o Claude vai abrir uma janela da ponte e trabalhar nela.

---

## Dicas

- **Deixe a janela da ponte de lado, mas não minimizada.** Coberta por outra janela ela
  funciona; minimizada o Chrome congela a página.
- O Claude só vê o que está logado **no seu Chrome**. Entre no Flow (ou em qualquer site)
  uma vez, normalmente, antes de pedir.
- Downloads caem na pasta Downloads do Chrome.
- Algo travou? Peça ao Claude `browser_status`: ele mostra se a extensão está conectada.

## Avisos

- Gerar vídeo no Flow gasta crédito da **sua** conta Google.
- A ponte **não** contorna captcha nem barreira anti-robô, de propósito.
- As funções do Flow, do AI Studio e do Gemini dependem da tela desses sites, que muda
  sem aviso. Se parar de funcionar, abra uma *issue* ou mande a correção.

## Para quem programa

- `docs/LEIA-ME-TECNICO.md`: arquitetura (hub e peers, janela da ponte, fila de input).
- `bridge-server/src/`: o servidor MCP. `entrypoints/background/`: a extensão (TypeScript, WXT).
- Porta do hub: `127.0.0.1:8789` (mude com `PRAXEDES_BRIDGE_PORT` no servidor e em
  `entrypoints/background/bridge/index.ts`).

## Licença

MIT. Veja [`LICENSE`](LICENSE).
