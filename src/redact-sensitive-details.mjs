const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'cookie',
  'email',
  'password',
  'refreshtoken',
  'secret',
  'setcookie',
  'token'
]);

export function redactSensitiveDetails(value) {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveDetails(item));
  if (typeof value === 'string') return redactSensitiveString(value);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? '[redacted]' : redactSensitiveDetails(item);
  }
  return output;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function redactSensitiveString(value) {
  return value
    .replace(/(Bearer\s+)[^\s"',;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|email|password|token)=)[^&\s"',;]+/gi, '$1[redacted]');
}
