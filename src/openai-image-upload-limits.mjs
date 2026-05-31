import { AdapterError } from './adapter-error.mjs';

const MAX_IMAGE_FILE_BYTES = 0x1900000;
const MAX_IMAGE_UPLOAD_BYTES = 0x4b00000;

export function validateImageUploadSize(file, field) {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new AdapterError(`${field} file is too large.`, {
      status: 413,
      code: `invalid_${field}_too_large`
    });
  }
}

export function validateTotalImageUploadSize(images, mask) {
  if (!Array.isArray(images)) {
    throw new TypeError('images must be an array.');
  }
  const total = [...images, mask].filter(Boolean).reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_IMAGE_UPLOAD_BYTES) {
    throw new AdapterError('image upload is too large.', {
      status: 413,
      code: 'invalid_image_upload_too_large'
    });
  }
}
