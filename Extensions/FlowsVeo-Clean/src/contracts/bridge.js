// Documentation/build identity only; never added to legacy HTTP requests.
export const BRIDGE_PROTOCOL = 'flowsveo-legacy-http/1';

export const BRIDGE_ROUTES = Object.freeze({
  secret: '/bridge/secret',
  config: '/api/v1/config/init',
  nextJob: '/captcha/request',
  captchaResult: '/captcha/response',
  health: '/captcha/health',
  busy: '/captcha/busy',
  credentials: '/credentials/push',
  flowResult: '/flow/response',
  imageResult: '/flow/image-response',
  uploadResult: '/flow/video-upload-response',
  projectCreated: '/flow/project-created',
  projectSwitched: '/flow/project-switched',
  heartbeat: '/ext/heartbeat',
  voiceCookies: '/voice/cookies',
  pendingRefresh: '/refresh/pending',
  token: '/token',
});

/**
 * @typedef {Object} BridgeJob
 * @property {string} request_id Correlation ID; must be echoed unchanged.
 * @property {string} [action] Existing action or CAPTCHA action string.
 * @property {string} [project_id]
 * @property {Object} [flow_request]
 * @property {Object} [image_request]
 * @property {boolean} [flow_recovery]
 *
 * @typedef {Object} FlowResultEnvelope
 * @property {string} request_id
 * @property {Object|null} result
 * @property {string|null} error
 */
