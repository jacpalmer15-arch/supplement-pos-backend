// /api/index.js
const app = require('../server');

module.exports = (req, res) => {
  // index.js handles only /api (exact root). Make sure Express sees /api.
  if (!req.url.startsWith('/api')) {
    // Vercel calls this with req.url === '/' for /api root.
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return app(req, res);
};
