/**
 * Vitest global setup for testcontainers.
 *
 * This file starts the DynamoDB Local container before all tests
 * and stops it after all tests complete.
 */

import { startDynamoDBContainer, stopDynamoDBContainer } from "./helpers/testcontainers";

export async function setup() {
  console.log("🐳 Starting DynamoDB Local container...");
  await startDynamoDBContainer();
  console.log("✅ DynamoDB Local container started");
}

export async function teardown() {
  console.log("🛑 Stopping DynamoDB Local container...");
  await stopDynamoDBContainer();
  console.log("✅ DynamoDB Local container stopped");
}
