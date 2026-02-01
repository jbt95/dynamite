/**
 * Unit tests for error handling.
 */

import { describe, it, expect } from "vitest";
import {
  DynamoError,
  DynamoErrorCode,
  notFoundError,
  conditionFailedError,
  transactionCancelledError,
  validationError,
  throughputExceededError,
  internalError,
  fromAwsError,
} from "@/errors";

describe("DynamoError", () => {
  it("should create error with code and message", () => {
    const error = new DynamoError(DynamoErrorCode.NOT_FOUND, "Item not found");
    expect(error.code).toBe(DynamoErrorCode.NOT_FOUND);
    expect(error.message).toBe("Item not found");
    expect(error.name).toBe("DynamoError");
  });

  it("should attach metadata", () => {
    const error = new DynamoError(DynamoErrorCode.NOT_FOUND, "Item not found", {
      table: "test-table",
      key: "test-key",
    });
    expect(error.metadata).toEqual({ table: "test-table", key: "test-key" });
  });

  it("should chain metadata", () => {
    const error = new DynamoError(DynamoErrorCode.NOT_FOUND, "Item not found", {
      table: "test-table",
    });
    const withMore = error.withMetadata({ key: "test-key" });
    expect(withMore.metadata).toEqual({
      table: "test-table",
      key: "test-key",
    });
  });
});

describe("Error factories", () => {
  it("should create notFoundError", () => {
    const error = notFoundError("Item not found", { table: "test" });
    expect(error.code).toBe(DynamoErrorCode.NOT_FOUND);
    expect(error.message).toBe("Item not found");
    expect(error.metadata).toEqual({ table: "test" });
  });

  it("should create conditionFailedError", () => {
    const error = conditionFailedError();
    expect(error.code).toBe(DynamoErrorCode.CONDITION_FAILED);
  });

  it("should create transactionCancelledError", () => {
    const error = transactionCancelledError();
    expect(error.code).toBe(DynamoErrorCode.TRANSACTION_CANCELLED);
  });

  it("should create validationError", () => {
    const error = validationError("Invalid input");
    expect(error.code).toBe(DynamoErrorCode.VALIDATION_ERROR);
    expect(error.message).toBe("Invalid input");
  });

  it("should create throughputExceededError", () => {
    const error = throughputExceededError();
    expect(error.code).toBe(DynamoErrorCode.THROUGHPUT_EXCEEDED);
  });

  it("should create internalError", () => {
    const error = internalError("Something went wrong");
    expect(error.code).toBe(DynamoErrorCode.INTERNAL_ERROR);
    expect(error.message).toBe("Something went wrong");
  });
});

describe("fromAwsError", () => {
  it("should convert ResourceNotFoundException", () => {
    const awsError = new Error("Resource not found");
    awsError.name = "ResourceNotFoundException";
    const error = fromAwsError(awsError);
    expect(error.code).toBe(DynamoErrorCode.NOT_FOUND);
  });

  it("should convert ConditionalCheckFailedException", () => {
    const awsError = new Error("Condition failed");
    awsError.name = "ConditionalCheckFailedException";
    const error = fromAwsError(awsError);
    expect(error.code).toBe(DynamoErrorCode.CONDITION_FAILED);
  });

  it("should convert ProvisionedThroughputExceededException", () => {
    const awsError = new Error("Throughput exceeded");
    awsError.name = "ProvisionedThroughputExceededException";
    const error = fromAwsError(awsError);
    expect(error.code).toBe(DynamoErrorCode.THROUGHPUT_EXCEEDED);
  });

  it("should handle unknown errors as internal", () => {
    const awsError = new Error("Unknown error");
    awsError.name = "UnknownException";
    const error = fromAwsError(awsError);
    expect(error.code).toBe(DynamoErrorCode.INTERNAL_ERROR);
  });

  it("should handle non-Error values", () => {
    const error = fromAwsError("string error");
    expect(error.code).toBe(DynamoErrorCode.INTERNAL_ERROR);
  });
});
