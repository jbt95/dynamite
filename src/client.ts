/**
 * DynamoDB client wrapper and configuration.
 *
 * Provides a type-safe interface to DynamoDB operations with
 * support for local development and connection pooling.
 */

import { DynamoDBClient, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { err, ok, Result } from "@/result";
import { internalError } from "@/errors";

/**
 * Client configuration options.
 */
export interface ClientConfig {
  /** AWS region */
  region?: string;
  /** Custom endpoint URL (for local development) */
  endpoint?: string;
  /** AWS credentials */
  credentials?: DynamoDBClientConfig["credentials"];
  /** Max connections for HTTP keep-alive */
  maxConnections?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}

/**
 * Create a DynamoDB client with sensible defaults.
 *
 * @example
 * ```ts
 * const client = createClient({
 *   region: "us-east-1",
 *   endpoint: "http://localhost:8000" // for DynamoDB Local
 * });
 * ```
 */
export function createClient(config: ClientConfig = {}): DynamoDBClient {
  const clientConfig: DynamoDBClientConfig = {
    region: config.region || process.env.AWS_REGION || "us-east-1",
    endpoint: config.endpoint || detectLocalEndpoint(),
    credentials: config.credentials,
    maxAttempts: 3,
    requestHandler: {
      requestTimeout: config.connectionTimeout || 30000,
      httpsAgent: {
        keepAlive: true,
        maxSockets: config.maxConnections || 50,
      },
    },
  };
  return new DynamoDBClient(clientConfig);
}

/**
 * Detect DynamoDB Local endpoint from environment.
 */
function detectLocalEndpoint(): string | undefined {
  // Check common DynamoDB Local environment variables
  if (process.env.DYNAMODB_ENDPOINT) {
    return process.env.DYNAMODB_ENDPOINT;
  }
  if (process.env.AWS_ENDPOINT_URL) {
    return process.env.AWS_ENDPOINT_URL;
  }
  // Default DynamoDB Local endpoint
  if (process.env.DYNAMODB_LOCAL === "true" || process.env.DYNAMODB_LOCAL === "1") {
    return "http://localhost:8000";
  }
  return undefined;
}

/**
 * Execute a DynamoDB operation and wrap result in Result.
 */
export async function executeOperation<T>(operation: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    const result = await operation();
    return ok(result);
  } catch (error) {
    return err(
      internalError("DynamoDB operation failed", {
        cause: error instanceof Error ? error : new Error(String(error)),
      })
    );
  }
}
