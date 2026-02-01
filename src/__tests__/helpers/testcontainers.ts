/**
 * Testcontainers setup for DynamoDB Local.
 *
 * This module provides a managed DynamoDB Local container for integration
 * and E2E tests using testcontainers.
 */

import { GenericContainer } from "testcontainers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

let container: any = null;
let client: DynamoDBClient | null = null;

/**
 * Start a DynamoDB Local container.
 *
 * @returns The DynamoDB client connected to the container
 */
export async function startDynamoDBContainer(): Promise<DynamoDBClient> {
  if (client) {
    return client;
  }

  container = await new GenericContainer("amazon/dynamodb-local:latest")
    .withExposedPorts(8000)
    .withCommand(["-jar", "DynamoDBLocal.jar", "-sharedDb"])
    .start();

  const port = container.getMappedPort(8000);
  const endpoint = `http://localhost:${port}`;

  // Store endpoint in environment variable for test files to access
  process.env.DYNAMODB_ENDPOINT = endpoint;

  client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: {
      accessKeyId: "test",
      secretAccessKey: "test",
    },
  });

  return client;
}

/**
 * Stop the DynamoDB Local container.
 */
export async function stopDynamoDBContainer(): Promise<void> {
  if (container) {
    await container.stop();
    container = null;
    client = null;
    delete process.env.DYNAMODB_ENDPOINT;
  }
}

/**
 * Get the current container client.
 * If not available, creates a new client from the environment variable.
 *
 * @returns The DynamoDB client or null if container not started
 */
export function getContainerClient(): DynamoDBClient | null {
  // Return existing client if available
  if (client) {
    return client;
  }

  // Create client from environment variable if available
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  if (endpoint) {
    client = new DynamoDBClient({
      endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    });
    return client;
  }

  return null;
}

/**
 * Check if the container is running.
 *
 * @returns True if container is running
 */
export function isContainerRunning(): boolean {
  return container !== null || process.env.DYNAMODB_ENDPOINT !== undefined;
}
