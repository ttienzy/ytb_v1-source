export const DEFAULT_BRIDGE_PORT = 60526;

export const POLL_INTERVAL_MS = 2500;

export const FAIL_THRESHOLD = 5;

export const TOKENS_PER_SESSION = 8;

export const HEARTBEAT_MS = 30_000;

export const WATCHDOG_MINUTES = 0.4;

export const ACTIVITY_LOG_MAX = 50;

export const DEFAULT_HARVEST_CFG = {
  t: {
    p: ['https://labs.google/*', 'https://flow.google.com/*'],
    o: 'https://flow.google.com/',
  },
  h: {
    d: 'labs.google',
    cn: '__Secure-next-auth.session-token',
    u: 'https://labs.google/fx/api/auth/session',
    tf: ['access_token'],
    ti: 'https://oauth2.googleapis.com/tokeninfo',
    cu: 'https://aisandbox-pa.googleapis.com/v1/credits',
    co: 'https://labs.google',
    ap: [],  // cookie name prefixes giữ lại khi xóa tracking cookies
  },
  c: {
    m: 'grecaptcha',
    s: 'enterprise',
    da: 'submit',
    g: '___grecaptcha_cfg',
    k: 'clients',
    p: 'sitekey',
    q: 'script[src*="enterprise.js"]',
  },
};

export const GOOGLE_VOICE_COOKIES = [
  'SAPISID', '__Secure-1PAPISID', 'SID', 'HSID', 'SSID',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS',
];

export const CANDIDATE_PORTS = [60526, 56526, 46526, 36526];
