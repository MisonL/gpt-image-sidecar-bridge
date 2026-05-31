import { Buffer } from 'node:buffer';

export function firstSiteFetch(url, options, calls) {
  calls.push({ url, options });
  if (url.endsWith('/api/auth/sign-in/email')) {
    return jsonResponse(200, { token: 'session-token' }, {
      'set-cookie': '__Secure-better-auth.session_token=session-token; Path=/; HttpOnly; Secure'
    });
  }
  if (url.endsWith('/api/images/generate')) {
    return textResponse(200, firstSiteGenerationStream(), 'text/event-stream');
  }
  if (url.endsWith('/api/images/edit')) {
    return textResponse(200, firstSiteEditStream(), 'text/event-stream');
  }
  if (url.endsWith('/api/storage/generated.png')) {
    return imageResponse('image-bytes');
  }
  throw new Error(`unexpected url: ${url}`);
}

export function firstSiteGenerationStream(imageUrl) {
  return [
    'data: {"type":"partial_image","b64_json":"preview"}\n\n',
    `data: ${JSON.stringify({ type: 'completed', ...firstSiteImageBody(imageUrl) })}\n\n`,
    'data: [DONE]\n\n'
  ].join('');
}

export function firstSiteEditStream(imageUrl) {
  return [
    'data: {"type":"partial_image","b64_json":"preview"}\n\n',
    `data: ${JSON.stringify({ type: 'completed', ...firstSiteImageBody(imageUrl) })}\n\n`,
    'data: {"type":"done"}\n\n'
  ].join('');
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

export function textResponse(status, body, contentType) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType }
  });
}

function firstSiteImageBody(imageUrl = '/api/storage/generated.png') {
  return {
    generationId: 'generation-1',
    imageUrl,
    imageOutputs: [
      {
        generationId: 'generation-1',
        imageUrl,
        revisedPrompt: 'revised prompt'
      }
    ]
  };
}

export function imageResponse(body) {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });
}
