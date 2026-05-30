import { AdapterError } from './adapter-error.mjs';
import { createFirstSiteClient } from './first-site-client.mjs';
import { createSecondSiteClient } from './second-site-client.mjs';

export function createUpstreamClient(options = {}) {
  const provider = readProvider(options.provider ?? process.env.GPT_IMAGE_BRIDGE_PROVIDER ?? 'second-site');
  if (provider === 'first-site') {
    return createFirstSiteClient(options.firstSite || options);
  }
  return createSecondSiteClient(options.secondSite || options);
}

function readProvider(value) {
  if (value === 'first-site' || value === 'second-site') return value;
  throw new AdapterError('GPT_IMAGE_BRIDGE_PROVIDER must be first-site or second-site.', {
    status: 500,
    code: 'invalid_upstream_provider'
  });
}
