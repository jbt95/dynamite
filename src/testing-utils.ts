/**
 * Testing utilities for DynamoDB operations.
 *
 * Provides in-memory DynamoDB mock, entity factories,
 * seed data helpers, and cleanup utilities.
 */

import type { Entity, EntityType } from "@/entity";
import type { Table } from "@/table";
import { marshalItem } from "@/schema";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { extractKeyFields } from "@/keys";

/**
 * In-memory table store.
 */
export interface InMemoryTable {
  name: string;
  items: Map<string, Record<string, AttributeValue>>;
}

/**
 * Create an in-memory table store.
 */
export function createInMemoryTable(name: string): InMemoryTable {
  return {
    name,
    items: new Map(),
  };
}

/**
 * Mock DynamoDB client configuration.
 */
export interface MockClientConfig {
  tables: InMemoryTable[];
}

/**
 * Create a mock DynamoDB client.
 *
 * Note: This is a simplified mock. For full testing, use DynamoDB Local.
 */
export function createMockClient(config: MockClientConfig): DynamoDBClient {
  // This is a placeholder - a real implementation would intercept
  // DynamoDB commands and route them to the in-memory store
  return new DynamoDBClient({
    region: "us-east-1",
    endpoint: "http://localhost:8000",
  });
}

/**
 * Seed an entity into an in-memory table.
 */
export function seedEntity(
  table: InMemoryTable,
  entity: Entity<any, any, any, any>,
  data: Record<string, unknown>,
  partitionKeyField: string = "PK",
  typeField: string = "_type"
): void {
  const marshalled = marshalItem(entity.schema as any, data as any);
  if (marshalled.isErr()) {
    throw marshalled.error;
  }

  const item = marshalled.value.M!;
  const pkFields = extractKeyFields(entity.partitionKey, data as any);
  if (pkFields.isErr()) {
    throw pkFields.error;
  }
  const pk = buildPartitionKey(entity, pkFields.value as any);
  item[partitionKeyField] = { S: pk };
  item[typeField] = { S: entity.name };

  if (entity.sortKey) {
    const skFields = extractKeyFields(entity.sortKey, data as any);
    if (skFields.isOk()) {
      const skResult = buildSortKey(entity, skFields.value as any);
      if (skResult.isOk()) {
        item["SK"] = { S: skResult.value };
      }
    }
  }

  const key = `${pk}${entity.sortKey ? `#${item["SK"]?.S}` : ""}`;
  table.items.set(key, item);
}

/**
 * Clear all items from an in-memory table.
 */
export function clearTable(table: InMemoryTable): void {
  table.items.clear();
}

/**
 * Get all items from an in-memory table.
 */
export function getAllItems(table: InMemoryTable): Record<string, AttributeValue>[] {
  return Array.from(table.items.values());
}

/**
 * Get an item by key from an in-memory table.
 */
export function getItem(
  table: InMemoryTable,
  key: string
): Record<string, AttributeValue> | undefined {
  return table.items.get(key);
}
