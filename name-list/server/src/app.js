import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { namesRouter } from './routes/names.js';

export const app = express();

app.disable('x-powered-by');

// The React dev server normally proxies /api, so CORS is not needed there.
// It stays configured for direct browser calls (e.g. curl, another frontend).
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10kb' }));

// Liveness + readiness in one endpoint: the API is only "ok" once Mongo is up.
app.get('/health', (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'ok' : 'degraded',
    database: dbReady ? 'connected' : 'disconnected',
    uptime: Math.round(process.uptime()),
  });
});

app.use('/api/names', namesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'route not found' });
});

// Central error handler: never leak stack traces to clients.
app.use((err, _req, res, _next) => {
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
    return res.status(400).json({ error: message });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'invalid identifier' });
  }

  const status = err.status ?? 500;
  if (status >= 500) console.error(err);

  res.status(status).json({
    error: err.expose ? err.message : 'internal server error',
  });
});
