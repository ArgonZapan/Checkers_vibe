import { createProxyMiddleware } from 'http-proxy-middleware';

const C++_TARGET = 'http://localhost:8080';

export function setupProxy(app) {
  // Proxy all /api/* requests to C++ EXCEPT /api/ai/* and /api/selfplay/*
  app.use(
    '/api',
    createProxyMiddleware({
      target: C++_TARGET,
      changeOrigin: true,
      pathRewrite: { '^/api': '/api' },
      // Exclude AI and selfplay routes — handled by Node.js
      filter: (pathname) => {
        return !pathname.startsWith('/api/ai/') && !pathname.startsWith('/api/selfplay/');
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
          console.log(`[Proxy] → ${req.method} ${req.url} → ${C++_TARGET}`);
        }
      }
    })
  );
}
