export class AdapterError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AdapterError';
    this.status = options.status ?? 500;
    this.code = options.code ?? 'adapter_error';
    this.details = options.details;
  }
}
