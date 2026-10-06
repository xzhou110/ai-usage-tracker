export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function storageError(): AppError {
  return new AppError(500, 'STORAGE_ERROR', 'Local data could not be safely read or saved. Existing files have been preserved.');
}

export function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}
