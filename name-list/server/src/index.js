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

// In Kubernetes, MongoDB and the API pods start concurrently. A bounded retry
// avoids CrashLoopBackOff while the database finishes its first boot.
const CONNECT_ATTEMPTS = 10;
const CONNECT_RETRY_MS = 3000;

async function connectWithRetry() {
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await connectDB(MONGO_URI);
      return;
    } catch (err) {
      if (attempt === CONNECT_ATTEMPTS) throw err;

      console.warn(
        `[db] connection attempt ${attempt}/${CONNECT_ATTEMPTS} failed: ` +
          `${err.message} — retrying in ${CONNECT_RETRY_MS / 1000}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
    }
  }
}

async function start() {
  await connectWithRetry();

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
