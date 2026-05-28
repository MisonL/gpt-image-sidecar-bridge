export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', 'application/json']]),
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

export function fakeClient(overrides = {}) {
  return {
    async generate() {
      return { created: 1, data: [] };
    },
    ...overrides
  };
}

export function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
