import http from 'node:http';

// A standalone protocol consumer and deny-by-default HTTP proxy for browser
// tests. Never forwards requests to a user's bridge or the public internet.
export async function startStandaloneBridge() {
  const jobs = [], received = [], blocked = [];
  let port;
  const config = { t: { p: ['https://flow.google.com/*'], o: 'https://flow.google.com/' },
    h: { d: 'labs.google', cn: 'fixture-session', u: 'https://labs.google/fx/api/auth/session', tf: ['access_token'], ti: 'https://oauth2.googleapis.com/tokeninfo', cu: '', co: 'https://labs.google', ap: [] },
    c: { m: 'grecaptcha', s: 'enterprise', da: 'submit', g: '___grecaptcha_cfg', k: 'clients', p: 'sitekey', q: 'script[src*="enterprise.js"]' } };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    const send = (status, body) => { res.writeHead(status, headers); res.end(status === 204 ? undefined : JSON.stringify(body)); };
    if (url.hostname !== '127.0.0.1' || url.port !== String(port)) {
      blocked.push(url.origin); send(403, { error: 'Outside isolated fixture' }); return;
    }
    if (req.method === 'OPTIONS') { send(204); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = null;
    try { if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { send(400, { error: 'Invalid JSON' }); return; }
    received.push({ path: url.pathname, method: req.method, headers: req.headers, body });
    if (url.pathname === '/bridge/secret') { send(200, { secret: 'fixture-bridge-key' }); return; }
    if (url.pathname === '/captcha/health') { send(200, { status: 'ok', service: 'veo-bridge', port }); return; }
    if (req.headers['x-bridge-key'] !== 'fixture-bridge-key') { send(403, { error: 'forbidden' }); return; }
    if (url.pathname === '/api/v1/config/init') { send(200, { payload: Buffer.from(JSON.stringify(config)).toString('base64'), v: 'fixture-v1' }); return; }
    if (url.pathname === '/captcha/request') { const job = jobs.shift(); send(job ? 200 : 204, job); return; }
    if (url.pathname === '/refresh/pending') { send(200, { requests: [] }); return; }
    if (url.pathname === '/token') { send(200, { access_token: '' }); return; }
    if (req.method === 'POST') { send(200, { ok: true }); return; }
    send(404, { error: 'not found' });
  });
  server.on('connect', (req, socket) => { blocked.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  return { port, jobs, received, blocked,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}
