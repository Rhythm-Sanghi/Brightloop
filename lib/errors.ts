import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'INVALID_TRANSITION'
  | 'PLAN_RULE_BLOCKED'
  | 'PLAN_UNAVAILABLE'
  | 'QUOTATION_EXPIRED'
  | 'MIN_QUANTITY_NOT_MET'
  | 'REQUEST_ALREADY_PENDING'
  | 'DUPLICATE_INVOICE_PERIOD'
  | 'INVOICE_NOT_CONFIRMED'
  | 'INVOICE_NOT_CANCELLABLE'
  | 'OVERPAYMENT'
  | 'TOKEN_INVALID_OR_EXPIRED'
  | 'DATA_INCONSISTENT'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export function mapError(error: unknown): { status: number; response: ErrorResponse } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      response: error.toResponse(),
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      response: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { issues: error.issues },
        },
      },
    };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return {
        status: 409,
        response: {
          error: {
            code: 'CONFLICT',
            message: 'A unique constraint violation occurred.',
            details: { target: error.meta?.target },
          },
        },
      };
    }
    if (error.code === 'P2025') {
      return {
        status: 404,
        response: {
          error: {
            code: 'NOT_FOUND',
            message: 'Record not found.',
            details: {},
          },
        },
      };
    }
    if (error.code === 'P2034') {
      return {
        status: 409,
        response: {
          error: {
            code: 'CONFLICT',
            message: 'Transaction conflict occurred.',
            details: {},
          },
        },
      };
    }
  }

  console.error('Unhandled server error:', error);
  return {
    status: 500,
    response: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred.',
        details: {},
      },
    },
  };
}
