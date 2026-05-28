import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { AdapterError, createSecondSiteClient, readSecretOption } from './second-site-client.mjs';
import { redactSensitiveDetails } from './redact-sensitive-details.mjs';

export function createApp(options = {}) {
  const client = options.client || createSecondSiteClient(options);
  const apiKey = readAdapterApiKey(options);

  async function handle(request) {
    try {
      if (request.method === 'OPTIONS') {
        return emptyResponse(204);
      }
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return jsonResponse({ ok: true });
      }
      if (url.pathname === '/v1/models' && request.method === 'GET') {
        return requireAuth(request, apiKey) || modelsResponse();
      }
      if (url.pathname === '/v1/images/generations' && request.method === 'POST') {
        return requireAuth(request, apiKey) || (await generateResponse(request, client));
      }
      if (url.pathname === '/v1/images/edits' && request.method === 'POST') {
        return requireAuth(request, apiKey) || unsupportedImageEndpoint('Image edits are not supported by this bridge.');
      }
      if (url.pathname === '/v1/images/variations' && request.method === 'POST') {
        return requireAuth(request, apiKey) || unsupportedImageEndpoint('Image variations are not supported by this bridge.');
      }
      return errorResponse(404, 'not_found', 'Endpoint not found.');
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  return { handle };
}

export function startServer(options = {}) {
  const port = readListenPort(options.port ?? process.env.PORT ?? 3099);
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
  const apiKey = readAdapterApiKey(options);
  if (isPublicHost(host) && !apiKey) {
    throw new Error('ADAPTER_API_KEY is required when binding to a public interface.');
  }
  const app = createApp({ ...options, apiKey });
  const server = createServer(async (req, res) => {
    const response = await app.handle(toRequest(req));
    await writeNodeResponse(res, response);
  });
  server.listen(port, host, () => {
    if (!options.silent) {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`gpt-image-bridge listening on http://${host}:${actualPort}`);
    }
  });
  return server;
}

function isPublicHost(host) {
  return ['0.0.0.0', '::', '::0'].includes(host);
}

function readListenPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer from 0 to 65535.');
  }
  return port;
}

function readAdapterApiKey(options) {
  return options.apiKey ?? readSecretOption('ADAPTER_API_KEY', process.env.ADAPTER_API_KEY_FILE) ?? '';
}

async function generateResponse(request, client) {
  const body = await readRequestJson(request);
  const streamRequested = body?.stream === true;
  const result = await client.generate(streamRequested ? { ...body, stream: false } : body);
  assertGenerationResult(result);
  if (streamRequested) {
    return imageStreamResponse(result);
  }
  return jsonResponse(result);
}

function assertGenerationResult(result) {
  if (!Array.isArray(result?.data) || result.data.length === 0) {
    throw new AdapterError('Second site generation response did not include image data.', {
      status: 502,
      code: 'invalid_second_site_generation_response'
    });
  }
  for (const [index, item] of result.data.entries()) {
    if (typeof item?.b64_json !== 'string' || !item.b64_json) {
      throw new AdapterError(`Second site generation response image ${index} is missing b64_json.`, {
        status: 502,
        code: 'invalid_second_site_generation_response'
      });
    }
  }
}

function imageStreamResponse(result) {
  const chunks = [];
  for (const item of Array.isArray(result?.data) ? result.data : []) {
    chunks.push({
      type: 'image_generation.completed',
      b64_json: item.b64_json,
      revised_prompt: item.revised_prompt,
      url: item.url
    });
  }
  if (result?.usage) {
    chunks.push({ type: 'usage', usage: result.usage });
  }
  chunks.push('[DONE]');
  return new Response(
    chunks
      .map((chunk) => (chunk === '[DONE]' ? 'data: [DONE]\n\n' : `event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`))
      .join(''),
    {
      status: 200,
      headers: {
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-origin': '*',
        'cache-control': 'no-cache',
        'content-type': 'text/event-stream'
      }
    }
  );
}

function modelsResponse() {
  return jsonResponse({
    object: 'list',
    data: [
      {
        id: 'gpt-image-2',
        object: 'model',
        created: 0,
        owned_by: 'second-site'
      }
    ]
  });
}

function unsupportedImageEndpoint(message) {
  return errorResponse(501, 'unsupported_image_endpoint', message);
}

function requireAuth(request, apiKey) {
  if (!apiKey) {
    return null;
  }
  const header = request.headers.get('authorization') || '';
  if (header === `Bearer ${apiKey}`) {
    return null;
  }
  return errorResponse(401, 'invalid_adapter_api_key', 'Invalid adapter API key.');
}

async function readRequestJson(request) {
  try {
    return await request.json();
  } catch {
    throw new AdapterError('Request body must be valid JSON.', {
      status: 400,
      code: 'invalid_json'
    });
  }
}

function toRequest(req) {
  const origin = `http://${req.headers.host || 'localhost'}`;
  return new Request(new URL(req.url || '/', origin), {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : req,
    duplex: 'half'
  });
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function toErrorResponse(error) {
  if (error instanceof AdapterError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }
  return errorResponse(500, 'internal_error', 'Internal adapter error.');
}

function errorResponse(status, code, message, details) {
  const error = { code, message, param: null, type: errorTypeForStatus(status) };
  if (details && process.env.ADAPTER_DEBUG_ERRORS === 'true') {
    error.details = redactSensitiveDetails(details);
  }
  return jsonResponse({ error }, { status });
}

function errorTypeForStatus(status) {
  if (status === 401 || status === 403) {
    return 'authentication_error';
  }
  if (status === 429) {
    return 'rate_limit_error';
  }
  if (status >= 400 && status < 500) {
    return 'invalid_request_error';
  }
  return 'api_error';
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*',
      'content-type': 'application/json'
    }
  });
}

function emptyResponse(status) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-origin': '*'
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
