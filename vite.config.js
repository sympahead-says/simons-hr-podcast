import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function rssProxyPlugin() {
  return {
    name: 'rss-proxy',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        const url = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!url) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; PodcastBot/1.0)',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            },
          });
          const text = await response.text();
          res.setHeader('Content-Type', 'text/xml; charset=utf-8');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(text);
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), rssProxyPlugin()],
})
