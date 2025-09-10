// /api/[...path].js
const app = require('../server');

module.exports = (req, res) => {
  // For any /api/* subpath, re-prefix /api so your Express routes match.
  req.url = '/api' + req.url;
  return app(req, res);
};
