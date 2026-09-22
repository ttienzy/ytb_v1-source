import { ACTIVITY_LOG_MAX } from '../../config/defaults.js';
import { runtime } from './state.js';

export function logActivity(level, msg) {
  const entry = {
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    level: level || 'info',
    msg: String(msg).slice(0, 500),
  };
  runtime.activityLog.push(entry);
  if (runtime.activityLog.length > ACTIVITY_LOG_MAX) runtime.activityLog.shift();
  console.log(`[FlowsVeo][${level}] ${msg}`);
}
