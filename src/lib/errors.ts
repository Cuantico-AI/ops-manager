export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, code = 'EXTERNAL_SERVICE_ERROR') {
    super(message, code, 502);
    this.name = 'ExternalServiceError';
  }
}

export class ApprovalNotImplementedError extends AppError {
  constructor() {
    super(
      'approval gates not implemented until Phase 4',
      'APPROVAL_NOT_IMPLEMENTED',
      501,
    );
    this.name = 'ApprovalNotImplementedError';
  }
}
