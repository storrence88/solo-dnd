import { createServer, type IncomingMessage } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { modelSetupFromEnv } from '../src/game/providers';
import { createApi, SaveStore } from './api';

// Your API key lives in .env next to package.json. It is read here and never sent to the browser.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: fine for a local model that needs no key.
}

const models = modelSetupFromEnv(process.env);
const api = createApi({ store: new SaveStore('saves'), model: models.client, provider: models.info });
const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
const port = Number(process.env.PORT ?? 5173);

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error('Request too large');
  }
  return raw ? JSON.parse(raw) : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return vite.middlewares(req, res);
  let result;
  try {
    result = await api(req.method ?? 'GET', url.pathname, await readJson(req));
  } catch {
    result = { status: 400, body: { error: 'Bad request' } };
  }
  res.writeHead(result.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result.body));
});

// Bound to this computer only: nobody else on your network can reach the game or spend your quota.
server.listen(port, '127.0.0.1', () => {
  console.log(`\n  Solo D&D running at http://localhost:${port}`);
  console.log(models.info.hasKey ? `  DM: ${models.info.dmModel} via ${models.info.provider}` : '  No API key found. Add ANTHROPIC_API_KEY or GROQ_API_KEY to a .env file (see README).');
});
