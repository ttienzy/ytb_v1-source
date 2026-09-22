import { logActivity } from '../background/runtime/log.js';

export function registerKeepalive() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'veoflow-keepalive') return;
    logActivity('info', 'Keep-alive port connected');
    port.onMessage.addListener(() => { });
    port.onDisconnect.addListener(() => logActivity('info', 'Keep-alive port disconnected'));
  });
}
