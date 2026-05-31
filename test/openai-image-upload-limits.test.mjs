import test from 'node:test';
import assert from 'node:assert/strict';

import { validateTotalImageUploadSize } from '../src/openai-image-upload-limits.mjs';

test('rejects non-array image upload inputs explicitly', () => {
  assert.throws(
    () => validateTotalImageUploadSize(undefined, null),
    (error) => error instanceof TypeError && error.message === 'images must be an array.'
  );
});
