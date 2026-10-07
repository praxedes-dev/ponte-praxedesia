/**
 * Tools de download nativo (obra 08 — PLANO C, 06/09/2026). Ver
 * entrypoints/background/bridge/capacidades/download-nativo.ts para o desenho completo
 * (chrome.downloads + onDeterminingFilename, os dois metodos CDP tentados antes
 * NAO existem nesta versao do Chrome).
 *
 * A extensao so consegue mandar o Chrome gravar dentro da PROPRIA pasta de
 * Downloads dele (restricao da API `onDeterminingFilename`, nao nossa) — por
 * isso ela grava numa subpasta de staging la dentro e devolve o caminho
 * ABSOLUTO real. Quem MOVE o arquivo para a pasta que o agente pediu de fato
 * (que pode estar em outro lugar qualquer do disco, inclusive outra unidade)
 * e este processo, porque so ele tem `fs` de verdade.
 */

import {
  existsSync, mkdirSync, readdirSync, statSync, renameSync, copyFileSync, unlinkSync, rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Nome da subpasta de staging, igual ao SUBPASTA_STAGING de
// `entrypoints/background/bridge/capacidades/download-nativo.ts:64`. Serve de
// TRAVA: sem esta marca no caminho, este arquivo nao apaga diretorio nenhum.
const MARCA_STAGING = '.praxedes-bridge-staging';

const PASTA_PADRAO = join(homedir(), '.praxedes-bridge', 'downloads');

/** O arquivo mais recente da pasta, para quando o Chrome renomeia por colisao ("nome (1).ext"). */
function maisRecenteDe(pasta) {
  let entradas;
  try {
    entradas = readdirSync(pasta);
  } catch {
    return null;
  }
  const arquivos = entradas
    .map((nome) => {
      const caminho = join(pasta, nome);
      try {
        return { nome, caminho, st: statSync(caminho) };
      } catch {
        return null;
      }
    })
    .filter((a) => a && a.st.isFile());
  if (arquivos.length === 0) return null;
  arquivos.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return arquivos[0];
}

/**
 * Move `origem` (dentro da pasta de staging, na pasta de Downloads REAL do
 * Chrome) para `pastaDestino/nomeDestino` (a pasta que o agente pediu de
 * verdade). `renameSync` falha com EXDEV quando origem e destino estao em
 * unidades/discos diferentes (comum: Downloads em C:, pasta pedida em outro
 * lugar) — cai para copiar + apagar o original nesse caso.
 */
function moverParaDestino(origem, pastaDestino, nomeDestino) {
  mkdirSync(pastaDestino, { recursive: true });
  const destino = join(pastaDestino, nomeDestino);
  try {
    renameSync(origem, destino);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    copyFileSync(origem, destino);
    unlinkSync(origem);
  }
  // ATENCAO — NAO transforme isto de volta num `rmSync` sem guarda.
  //
  // Este bloco ja foi `rmSync(dirname(origem), { recursive: true, force: true })`
  // SEM conferir nada, e `origem` NAO e escolhido por nos: vem de
  // `item.filename`, decidido pelo Chrome. Quando o Chrome grava fora da
  // subpasta de staging — nome invalido no Windows, "perguntar onde salvar"
  // ligado, colisao de nome — `dirname(origem)` vira a **pasta de Downloads do
  // Dr. Cezar**, e a linha apagava ela inteira, recursivamente, devolvendo
  // sucesso. Achado por auditoria em 06/09/2026, antes de rodar em producao.
  //
  // Agora: so apaga se o caminho estiver comprovadamente dentro da pasta de
  // staging DESTA ponte, e so o diretorio-token. Sobrar lixo de staging e
  // incomparavelmente melhor que apagar arquivo do usuario.
  const pastaDoArquivo = dirname(origem);
  if (pastaDoArquivo.includes(MARCA_STAGING) && basename(dirname(pastaDoArquivo)) === MARCA_STAGING) {
    try {
      rmSync(pastaDoArquivo, { recursive: true, force: true });
    } catch {
      // best-effort: o arquivo ja chegou ao destino; lixo de staging nao
      // justifica falhar a tool.
    }
  }
  return destino;
}

export const TOOLS = [
  {
    name: 'browser_download_arm',
    description:
      'Arma o download nativo: o proximo arquivo que o Chrome baixar sozinho (clique em "Imprimir '
      + 'boletos" do PJe, um <a download>, um blob: gerado por JS) cai na pasta informada, sem '
      + 'dialogo de "Salvar como". Chame logo antes do clique que dispara o download. AVISO: a '
      + 'fila de armar e do PROCESSO INTEIRO do Chrome, nao so desta aba (limitacao medida da API '
      + 'chrome.downloads — DownloadItem nao tem tabId); o armar expira sozinho em 20s se nenhum '
      + 'download comecar. Depois do clique, use browser_download_wait.',
    inputSchema: {
      type: 'object',
      properties: {
        pasta: { type: 'string', description: 'Pasta de destino (caminho do Windows). Padrao: ~/.praxedes-bridge/downloads.' },
      },
    },
    action: 'cap_download_armar',
    build: (i) => {
      const pasta = i.pasta && i.pasta.trim() ? i.pasta : PASTA_PADRAO;
      mkdirSync(pasta, { recursive: true });
      return { params: { pasta } };
    },
    timeout: 15_000,
    // Sem `formatar`: o JSON cru de { pasta, metodo, token } e o que os testes
    // (a.json(...)) e o agente esperam — mesmo padrao de browser_wait_new_tab.
  },
  {
    name: 'browser_download_wait',
    description:
      'Espera o download armado por browser_download_arm terminar. O Chrome so grava dentro da '
      + 'PROPRIA pasta de Downloads dele (restricao da API, nao desta ponte); esta tool MOVE o '
      + 'arquivo de la para a pasta pedida no arm e confere no disco de verdade (tamanho em bytes) '
      + 'que ele chegou — nunca devolve sucesso sem o arquivo existir no destino final.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_ms: { type: 'number', description: 'Quanto esperar o download terminar. Padrao: 60000.' },
      },
    },
    action: 'cap_download_esperar',
    build: (i) => ({ params: { timeout_ms: i.timeout_ms } }),
    timeout: (i) => (i.timeout_ms ?? 60_000) + 15_000,
    formatar: (data) => {
      const pastaDestino = data?.pasta && String(data.pasta).trim() ? data.pasta : PASTA_PADRAO;

      // Desvio da janela "Salvar como" (23/09/2026): a extensao buscou o
      // arquivo ela mesma, conferiu o tamanho com o que o Chrome recebeu e
      // cancelou o download dele. Os bytes vem aqui; grava e rele o disco.
      if (data?.sem_janela && data?.base64) {
        mkdirSync(pastaDestino, { recursive: true });
        const nome = data.nome && String(data.nome).trim() ? basename(String(data.nome)) : 'arquivo-baixado';
        let destino = join(pastaDestino, nome);
        for (let i = 1; existsSync(destino); i += 1) {
          const ponto = nome.lastIndexOf('.');
          destino = join(pastaDestino, ponto > 0 ? `${nome.slice(0, ponto)} (${i})${nome.slice(ponto)}` : `${nome} (${i})`);
        }
        writeFileSync(destino, Buffer.from(data.base64, 'base64'));
        const st = statSync(destino);
        if (st.size !== data.bytes || st.size === 0) {
          try { unlinkSync(destino); } catch { /* best-effort */ }
          throw new Error(`gravei ${st.size} bytes em ${destino}, esperava ${data.bytes}: apagado, confira a mao.`);
        }
        return JSON.stringify({
          pasta: pastaDestino, nome: basename(destino), bytes: st.size, url: data.url ?? '', caminho: destino,
          sem_janela: data.via === 'resposta'
            ? 'baixado sem a janela "Salvar como": a ponte pegou o arquivo na resposta do site e o download '
              + 'do Chrome nem chegou a nascer (nada foi repetido)'
            : 'baixado sem a janela "Salvar como": a ponte buscou o mesmo arquivo pela aba, conferiu o '
              + 'tamanho com o que o Chrome recebeu e cancelou o download dele',
        }, null, 2);
      }

      const origem = data?.caminhoNavegador ?? '';

      if (!origem || !existsSync(origem)) {
        // A extensao disse "completo" mas o arquivo que ela apontou nao esta
        // la — falha alto em vez de fingir. Cenarios reais: Chrome marcou
        // como perigoso e nao gravou, usuario cancelou depois do "completo"
        // reportado, ou (bug) o caminho devolvido nao bate com o real.
        const recente = maisRecenteDe(pastaDestino);
        const dica = recente
          ? ` O arquivo mais recente em ${pastaDestino} e ${recente.caminho} (${(recente.st.size / 1024).toFixed(1)} KB) — confira se e este.`
          : '';
        throw new Error(
          `o Chrome reportou o download concluido em "${origem || '(vazio)'}" mas esse arquivo nao `
          + `existe no disco.${dica} Confira chrome://downloads (pode ter sido bloqueado como perigoso `
          + 'ou removido depois de completo).',
        );
      }

      const nomeFinal = data?.nome && String(data.nome).trim() ? data.nome : basename(origem);
      let destinoFinal;
      try {
        destinoFinal = moverParaDestino(origem, pastaDestino, nomeFinal);
      } catch (err) {
        throw new Error(`o Chrome baixou em ${origem} mas nao consegui mover para ${pastaDestino}: ${err.message}`);
      }

      if (!existsSync(destinoFinal)) {
        // Nao deveria ser alcancavel (moverParaDestino teria lancado antes),
        // mas "relei o disco" e a regra da casa — nunca confiar so no retorno
        // da propria funcao que escreveu.
        throw new Error(`mudei o arquivo para ${destinoFinal} mas ele nao esta la depois — confira a mao.`);
      }

      const st = statSync(destinoFinal);
      if (st.size === 0) {
        // Achado de auditoria (06/09/2026): um arquivo de 0 bytes voltava "ok"
        // porque a unica conferencia era existsSync (existir, nao ter conteudo).
        // Cenarios reais: o Chrome marcou "completo" mas a origem cortou antes
        // de mandar corpo nenhum, ou o servidor de origem respondeu 200 vazio.
        // Nunca sucesso — apaga o lixo de 0 bytes do destino pedido (o agente
        // nao deve encontrar um arquivo fantasma la) e falha alto.
        try { unlinkSync(destinoFinal); } catch { /* best-effort */ }
        throw new Error(
          `o Chrome marcou o download de "${data?.nome ?? nomeFinal}" como concluido, mas o arquivo `
          + `tinha 0 bytes — removido de ${destinoFinal} em vez de devolver sucesso. Confira a URL de `
          + `origem (${data?.url ?? '(sem url)'}) e chrome://downloads: geralmente e resposta vazia do `
          + 'servidor ou cancelamento depois do "completo" reportado.',
        );
      }
      return JSON.stringify({
        pasta: pastaDestino,
        nome: basename(destinoFinal),
        bytes: st.size,
        url: data?.url ?? '',
        caminho: destinoFinal,
      }, null, 2);
    },
  },
];
