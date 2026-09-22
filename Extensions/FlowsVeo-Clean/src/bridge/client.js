import { runtime } from '../background/runtime/state.js';
import { legacyHttp } from './legacy-http.js';

// Deliberately forwards the caller's exact options: timeout, headers, method and
// response parsing remain owned by the existing flow. No implicit retry/auth.
export function bridgeRequest(operation, options, port = runtime.bridgePort) {
  return legacyHttp.request(operation, options, port);
}

export function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Bridge-Key': runtime.bridgeSecret || '',
    'X-Ext-FP': runtime.extFp || '',
    ...extra,
  };
}

export function setBridgePort(port) {
  const p = parseInt(port);
  if (!p || p < 1 || p > 65535) return false;
  runtime.bridgePort = p;
  runtime.bridgeUrl = `http://127.0.0.1:${runtime.bridgePort}`;
  return true;
}
