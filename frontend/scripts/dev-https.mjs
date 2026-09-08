/**
 * Starts the Vite dev server over HTTPS and prints the LAN addresses.
 *
 * The browser only grants camera access in a secure context. localhost counts as
 * one, so `npm run dev` is enough on the workstation — but a phone or tablet
 * reaching the machine by IP does not, which is why the field-capture demo needs
 * this script. The certificate is self-signed, so each device shows a warning
 * once ("Advanced" → "Proceed"); after that the camera prompt appears normally.
 */
import { createServer } from 'vite';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

process.env.HTTPS = 'true';

const server = await createServer({
  mode: 'development',
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
});
await server.listen();

const port = server.config.server.port ?? 5173;
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
  .map((iface) => `https://${iface.address}:${port}`);

console.log('\n  LM-Inspect AI — HTTPS dev server (camera enabled on mobile devices)\n');
console.log(`  Local:    https://localhost:${port}`);
addresses.forEach((address) => console.log(`  Network:  ${address}`));
console.log('\n  The certificate is self-signed — accept the browser warning once per device.\n');
