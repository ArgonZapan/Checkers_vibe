import { createProxyMiddleware } from 'http-proxy-middleware';

const CPP_TARGET = 'http://localhost:8080';

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
          // Re-serialize body if express.json() already consumed it
          if (req.body && Object.keys(req.body).length > 0) {
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
