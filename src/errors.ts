/**
 * Domain-specific errors for DynamoDB operations.
 *
 * All errors include error codes for programmatic handling
 * and metadata for debugging.
 */

import { err, ok, Result } from "@/result";

/**
 * Error codes for DynamoDB operations.
 */
export enum DynamoErrorCode {
  /** Item not found in table */
  NOT_FOUND = "NOT_FOUND",
  /** Condition expression failed */
  CONDITION_FAILED = "CONDITION_FAILED",
  /** Transaction was cancelled */
  TRANSACTION_CANCELLED = "TRANSACTION_CANCELLED",
  /** Validation error (schema, type, etc.) */
  VALIDATION_ERROR = "VALIDATION_ERROR",
  /** Throughput exceeded (throttling) */
  THROUGHPUT_EXCEEDED = "THROUGHPUT_EXCEEDED",
  /** Internal error (unexpected) */
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/**
 * Metadata that can be attached to errors for debugging.
 */
export interface ErrorMetadata {
  [key: string]: unknown;
}

/**
 * Domain error for DynamoDB operations.
 */
export class DynamoError extends Error {
  readonly code: DynamoErrorCode;
  readonly metadata?: ErrorMetadata;

  constructor(code: DynamoErrorCode, message: string, metadata?: ErrorMetadata) {
    super(message);
    this.name = "DynamoError";
    this.code = code;
    this.metadata = metadata;
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DynamoError);
    }
  }

  /**
   * Create a new DynamoError with metadata.
   */
  withMetadata(metadata: ErrorMetadata): DynamoError {
    return new DynamoError(this.code, this.message, {
      ...this.metadata,
      ...metadata,
    });
  }
}

/**
 * Factory function to create a NOT_FOUND error.
 */
export function notFoundError(message = "Item not found", metadata?: ErrorMetadata): DynamoError {
  return new DynamoError(DynamoErrorCode.NOT_FOUND, message, metadata);
}

/**
 * Factory function to create a CONDITION_FAILED error.
 */
export function conditionFailedError(
  message = "Condition expression failed",
  metadata?: ErrorMetadata
): DynamoError {
  return new DynamoError(DynamoErrorCode.CONDITION_FAILED, message, metadata);
}

/**
 * Factory function to create a TRANSACTION_CANCELLED error.
 */
export function transactionCancelledError(
  message = "Transaction was cancelled",
  metadata?: ErrorMetadata
): DynamoError {
  return new DynamoError(DynamoErrorCode.TRANSACTION_CANCELLED, message, metadata);
}

/**
 * Factory function to create a VALIDATION_ERROR.
 */
export function validationError(
  message = "Validation error",
  metadata?: ErrorMetadata
): DynamoError {
  return new DynamoError(DynamoErrorCode.VALIDATION_ERROR, message, metadata);
}

/**
 * Factory function to create a THROUGHPUT_EXCEEDED error.
 */
export function throughputExceededError(
  message = "Throughput exceeded",
  metadata?: ErrorMetadata
): DynamoError {
  return new DynamoError(DynamoErrorCode.THROUGHPUT_EXCEEDED, message, metadata);
}

/**
 * Factory function to create an INTERNAL_ERROR.
 */
export function internalError(message = "Internal error", metadata?: ErrorMetadata): DynamoError {
  return new DynamoError(DynamoErrorCode.INTERNAL_ERROR, message, metadata);
}

/**
 * Convert an AWS SDK error to a DynamoError.
 */
export function fromAwsError(error: unknown): DynamoError {
  if (error instanceof DynamoError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message;
    const name = error.name;

    // Map AWS SDK error names to our error codes
    if (name === "ResourceNotFoundException") {
      return notFoundError(message);
    }
    if (name === "ConditionalCheckFailedException") {
      return conditionFailedError(message);
    }
    if (name === "TransactionCanceledException") {
      return transactionCancelledError(message);
    }
    if (name === "ValidationException") {
      return validationError(message);
    }
    if (name === "ProvisionedThroughputExceededException" || name === "RequestLimitExceeded") {
      return throughputExceededError(message);
    }

    // Default to internal error for unknown AWS errors
    return internalError(message, { originalError: name });
  }

  // Fallback for non-Error values
  return internalError(String(error));
}

/**
 * Helper to convert a value to a Result with DynamoError.
 */
export function toResult<T>(
  value: T | null | undefined,
  error: DynamoError
): Result<T, DynamoError> {
  if (value === null || value === undefined) {
    return err(error);
  }
  return ok(value);
}
