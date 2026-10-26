import 'dotenv/config';
import { app } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';

const PORT = Number(process.env.PORT) || 5000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('[api] MONGO_URI is not set — refusing to start');
  process.exit(1);
}

let server;

async function start() {
  await connectDB(MONGO_URI);

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[api] listening on http://0.0.0.0:${PORT}`);
  });
}

// Close the HTTP listener before the DB connection so in-flight requests can
// finish. Docker sends SIGTERM on `compose down` / redeploy.
async function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  try {
    await disconnectDB();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});
