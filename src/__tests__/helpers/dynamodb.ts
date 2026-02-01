/**
 * DynamoDB Local helper for integration tests.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  CreateTableCommand,
  DescribeTableCommand,
  ScanCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { createClient } from "@/client";

/**
 * Create a test DynamoDB client pointing to local instance.
 */
export function createTestClient(): DynamoDBClient {
  return createClient({
    endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:8000",
    region: "us-east-1",
  });
}

/**
 * Create test table if it doesn't exist.
 */
export async function setupTestTable(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    const command = new CreateTableCommand({
      TableName: tableName,
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    });

    await client.send(command);

    // Wait for table to be active
    await waitForTableActive(client, tableName);
  } catch (error: any) {
    // Table might already exist, which is fine
    if (error.name !== "ResourceInUseException") {
      throw error;
    }
  }
}

/**
 * Wait for table to be active.
 */
async function waitForTableActive(
  client: DynamoDBClient,
  tableName: string,
  maxAttempts = 10
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const command = new DescribeTableCommand({ TableName: tableName });
      const response = await client.send(command);
      if (response.Table?.TableStatus === "ACTIVE") {
        return;
      }
    } catch (error) {
      // Table not yet available
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Table ${tableName} did not become active in time`);
}

/**
 * Clean up test table.
 */
export async function cleanupTestTable(client: DynamoDBClient, tableName: string): Promise<void> {
  // In a real scenario, you might want to delete the table
  // For now, we'll just leave it for reuse
}

/**
 * Clear all items from test table.
 */
export async function clearTestTable(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    // Scan all items
    const scanCommand = new ScanCommand({
      TableName: tableName,
      ProjectionExpression: "PK, SK",
    });
    const result = await client.send(scanCommand);

    if (!result.Items || result.Items.length === 0) {
      return;
    }

    // Batch delete all items (max 25 per batch)
    const batches = [];
    for (let i = 0; i < result.Items.length; i += 25) {
      const batch = result.Items.slice(i, i + 25).map((item) => ({
        DeleteRequest: {
          Key: {
            PK: item.PK,
            SK: item.SK,
          },
        },
      }));
      batches.push(batch);
    }

    // Execute batch deletes
    for (const batch of batches) {
      const batchCommand = new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: batch,
        },
      });
      await client.send(batchCommand);
    }
  } catch (error) {
    // Table might not exist, which is fine
    if ((error as any).name !== "ResourceNotFoundException") {
      throw error;
    }
  }
}
