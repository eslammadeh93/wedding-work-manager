import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

type LoginAttemptState = { failures: number; level: number; lockedUntil: number };
const loginAttempts = new Map<string, LoginAttemptState>();

const getClientIp = (req: express.Request) => req.ip || req.socket.remoteAddress || 'unknown';
const lockMinutesFor = (level: number) => (level === 0 ? 1 : level === 1 ? 5 : 30);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '25mb' }));

  // Keep API failures JSON-shaped so frontend clients never try to parse an
  // HTML error page as JSON.
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ message: 'Invalid JSON request body.' });
    }
    next(error);
  });

  // Login throttling is server-side so a browser refresh cannot bypass it.
  app.post('/api/auth/attempt', (req, res) => {
    const action = req.body?.action as 'check' | 'failure' | 'success';
    if (!['check', 'failure', 'success'].includes(action)) {
      return res.status(400).json({ message: 'Invalid login attempt action.' });
    }

    const ip = getClientIp(req);
    const now = Date.now();
    const current = loginAttempts.get(ip) || { failures: 0, level: 0, lockedUntil: 0 };
    const failuresNeeded = current.level >= 2 ? 1 : 3;

    if (action === 'success') {
      loginAttempts.delete(ip);
      return res.json({ allowed: true });
    }

    if (current.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((current.lockedUntil - now) / 1000);
      return res.status(429).json({ allowed: false, retryAfterSeconds });
    }

    if (action === 'failure') {
      current.failures += 1;
      if (current.failures >= failuresNeeded) {
        const minutes = lockMinutesFor(current.level);
        const attemptNumber = current.failures;
        current.level += 1;
        current.failures = 0;
        current.lockedUntil = now + minutes * 60 * 1000;
        loginAttempts.set(ip, current);
        return res.status(429).json({
          allowed: false,
          retryAfterSeconds: minutes * 60,
          attemptNumber,
          maxAttempts: failuresNeeded,
        });
      }
      loginAttempts.set(ip, current);
    }

    return res.json({
      allowed: true,
      remainingAttempts: failuresNeeded - current.failures,
      attemptNumber: action === 'failure' ? current.failures : 0,
      maxAttempts: failuresNeeded,
      nextLockMinutes: lockMinutesFor(current.level),
    });
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // This must be registered before Vite/static SPA fallbacks. The only login
  // lock route is /api/auth/attempt; /attempt is intentionally not an API.
  app.all('/api/*', (req, res) => {
    res.status(404).json({ message: `API endpoint not found: ${req.method} ${req.path}` });
  });

  // Vite middleware in development mode
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
