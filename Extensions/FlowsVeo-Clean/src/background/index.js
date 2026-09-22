import { registerKeepalive } from '../platform/keepalive.js';
import { registerMessages } from '../platform/messages.js';
import { registerInstallEvent, registerStartupEvent } from '../platform/startup.js';
import { registerTabEvents, registerCookieEvents } from '../platform/tab-events.js';
import { createWatchdogAlarm, registerAlarmEvents } from './runtime/alarms.js';
import { startPolling } from './runtime/polling.js';

registerMessages();
registerTabEvents();
registerCookieEvents();
createWatchdogAlarm();
registerAlarmEvents();
registerKeepalive();
registerInstallEvent();
registerStartupEvent();
startPolling();
