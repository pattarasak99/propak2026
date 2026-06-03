const https = require('https');
const http  = require('http');

const GS_URL = 'https://script.google.com/a/macros/medpac.co.th/s/AKfycbyG6mxpMCByIt8OKtxENjvU1HttN7UjjuXBak5-jyn2hwqnCZILaFGpIzsk4kFHJ2_h/exec';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type':                 'application/json',
};

module.exports = async function(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    let url  = GS_URL;
    let body = null;
    if (req.method === 'POST') {
      body = await readBody(req);
    } else {
      const qs = new URLSearchParams(req.query || {}).toString();
      if (qs) url += '?' + qs;
    }
    const data = await request(req.method, url, body, 0);
    try {
      return res.status(200).json(JSON.parse(data));
    } catch(e) {
      return res.status(200).send(data);
    }
  } catch(err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end',  () => resolve(body));
    req.on('error', reject);
  });
}

function request(method, url, body, depth) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  const lib    = url.startsWith('https') ? https : http;
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (url.startsWith('https') ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   method,
      headers:  {
        'Content-Type': 'application/json',
        'User-Agent':   'Vercel-Function/1.0',
        'Accept':       'application/json, text/plain, */*',
      },
    };
    if (body && method === 'POST') opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(opts, response => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        const nextMethod = response.statusCode === 303 ? 'GET' : method;
        const nextBody   = response.statusCode === 303 ? null  : body;
        const nextUrl    = response.headers.location.startsWith('http')
          ? response.headers.location
          : parsed.protocol + '//' + parsed.host + response.headers.location;
        resolve(request(nextMethod, nextUrl, nextBody, depth + 1));
        return;
      }
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end',  () => resolve(data));
    });
    req.on('error', reject);
    if (body && method === 'POST') req.write(body);
    req.end();
  });
}
