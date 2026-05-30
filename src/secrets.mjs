import { readFileSync } from 'node:fs';

import { AdapterError } from './adapter-error.mjs';

export function readSecretOption(envName, filePath) {
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch {
      throw new AdapterError(`Unable to read secret file for ${envName}.`, {
        status: 500,
        code: 'invalid_secret_file'
      });
    }
  }
  return process.env[envName];
}
