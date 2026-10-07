/**
 * Recarrega a extensao no Chrome depois de um build, sem clique nenhum.
 *
 *   npm run build   (na raiz do projeto)
 *   node test/reload.js
 */
import { startClient, esperarExtensao, sleep } from './client.js';

const client = startClient('reload');
try {
  await client.handshake();
  // O backoff da extensao chega a 30s, entao esperar pouco da falso negativo.
  if (!(await esperarExtensao(client, 75_000))) {
    console.error('extensao nao esta conectada — nada a recarregar');
    process.exitCode = 1;
  } else {
    await client.tool('bridge_reload_extension');
    console.log('recarregando...');
    await sleep(3000);
    const voltou = await esperarExtensao(client, 60_000);
    console.log(voltou ? 'extensao de volta com o build novo' : 'extensao nao voltou a tempo');
    if (!voltou) process.exitCode = 1;
  }
} finally {
  client.close();
}
