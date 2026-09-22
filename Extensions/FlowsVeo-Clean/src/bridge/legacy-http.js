import { BRIDGE_ROUTES } from '../contracts/bridge.js';

/** Current wire protocol, also usable by a standalone project adapter. */
export const legacyHttp = {
  request(operation, options, port) {
    const route = BRIDGE_ROUTES[operation];
    if (!route) throw new Error(`Unknown bridge operation: ${operation}`);
    return fetch(`http://127.0.0.1:${port}${route}`, options);
  },
};
