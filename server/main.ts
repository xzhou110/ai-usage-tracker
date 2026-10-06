import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnectors } from './connectors/index.ts';
import { startServer } from './http.ts';
import { AppError } from './errors.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.AI_USAGE_TRACKER_ROOT ?? projectRoot);
const port = Number(process.env.PORT ?? process.argv[2] ?? 8175);

try {
  const app = await startServer({ root, port, connectors: createConnectors(root) });
  console.log(`AI Usage Tracker is ready at ${app.url}`);
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => { process.exitCode = 0; }, () => { console.error('AI Usage Tracker could not close every local resource cleanly.'); process.exitCode = 1; });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // Only the desktop parent can send this IPC message. No HTTP shutdown endpoint.
  process.on('message', message => { if (message === 'shutdown') { shutdown(); process.disconnect?.(); } });
  process.once('disconnect', shutdown);
} catch (error) {
  console.error(error instanceof AppError ? error.message : 'AI Usage Tracker could not start. Check the local setup and try again.');
  process.exitCode = 1;
}
