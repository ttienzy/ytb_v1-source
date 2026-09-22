import { logActivity } from '../background/runtime/log.js';
import { startPolling } from '../background/runtime/polling.js';

export function registerInstallEvent() {
  chrome.runtime.onInstalled.addListener(() => {
    logActivity('info', 'Extension installed — starting polling');
    startPolling();
  });
}

export function registerStartupEvent() {
  chrome.runtime.onStartup.addListener(() => {
    logActivity('info', 'Browser started — starting polling');
    startPolling();
  });
}
