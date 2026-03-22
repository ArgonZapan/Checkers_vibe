import { createProxyMiddleware } from 'http-proxy-middleware';
import { CONFIG } from '../config.js';

const CPP_TARGET = CONFIG.server.cppBase;

export function setupProxy(app) {
  // Proxy all /api/* requests to C++ EXCEPT /api/ai/* and /api/selfplay/*
  app.use(
    '/api',
    createProxyMiddleware({
      target: CPP_TARGET,
      changeOrigin: true,
      pathRewrite: { '^': '/api' },
      // Exclude AI and selfplay routes — handled by Node.js
      // Note: Express strips the mount path, so we see /ai/* and /selfplay/* here
      filter: (pathname) => {
        return !pathname.startsWith('/ai/') && !pathname.startsWith('/selfplay/');
      },
      on: {
        error: (err, _req, res) => {
          console.error('[Proxy] C++ backend error:', err.message);
          if (res && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'C++ backend unavailable', detail: err.message }));
          }
        },
        proxyReq: (_proxyReq, req) => {
          console.log(`[Proxy] → ${req.method} ${req.url} → ${CPP_TARGET}`);
          // Re-serialize body only for methods with body (POST/PUT/PATCH)
          // and only if express.json() already parsed it
          const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
          if (hasBody && req.body && Object.keys(req.body).length > 0) {
            const bodyData = JSON.stringify(req.body);
            _proxyReq.setHeader('Content-Type', 'application/json');
            _proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            _proxyReq.write(bodyData);
          }
        }
      }
    })
  );
}
