import { startClient, esperarExtensao } from './client.js';
const c = startClient('sonda-status');
try {
  await c.handshake();
  const ok = await esperarExtensao(c, Number(process.argv[2] ?? 20000));
  console.log('extensaoConectada:', ok);
} catch (err) {
  console.error('ERRO', err.message);
} finally { c.close(); }
