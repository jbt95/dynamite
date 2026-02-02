/**
 * Database-level batch builder implementation.
 *
 * Provides a fluent, type-safe API for building and executing
 * batch write operations across tables and entities.
 */

import {
  DynamoDBClient,
  BatchWriteItemCommand,
  BatchWriteItemCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType } from "@/entity/types";
import type { Table } from "./types";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { extractKeyFields } from "@/keys";
import { marshalItem } from "@/schema";
import { err, ok, Result } from "@/result";
import { fromAwsError, DynamoError, internalError } from "@/errors";
import { executeOperation } from "@/client";

/**
 * Batch write request item.
 */
type BatchRequest =
  | { type: "put"; table: string; item: Record<string, AttributeValue> }
  | { type: "delete"; table: string; key: Record<string, AttributeValue> };

/**
 * Batch builder for cross-table batch write operations.
 */
export class DatabaseBatchBuilder {
  private requests: BatchRequest[] = [];

  constructor(
    private readonly client: DynamoDBClient,
    private readonly tables: Map<string, Table<any, any, any>>
  ) {}

  /**
   * Add put operations for one or more items.
   */
  put<TEntity extends Entity<any, any, any, any, any>>(
    tableName: string,
    entity: TEntity,
    items: EntityType<TEntity> | EntityType<TEntity>[]
  ): this {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

    const itemsArray = Array.isArray(items) ? items : [items];

    for (const item of itemsArray) {
      const pkFields = extractKeyFields(entity.partitionKey, item);
      if (pkFields.isErr()) {
        throw pkFields.error;
      }
      const pk = buildPartitionKey(entity, pkFields.value as TEntity["_pk"]);

      const marshalled = marshalItem(entity.schema, item);
      if (marshalled.isErr()) {
        throw marshalled.error;
      }

      const itemMap = marshalled.value.M!;
      itemMap[table.config.partitionKey] = { S: pk };
      itemMap[table.config.typeField || "_type"] = { S: entity.name };

      if (entity.sortKey) {
        const skFields = extractKeyFields(entity.sortKey, item);
        if (skFields.isErr()) {
          throw skFields.error;
        }
        const skResult = buildSortKey(entity, skFields.value as NonNullable<TEntity["_sk"]>);
        if (skResult.isErr()) {
          throw skResult.error;
        }
        itemMap[table.config.sortKey!] = { S: skResult.value };
      } else if (table.config.sortKey) {
        itemMap[table.config.sortKey] = { S: entity.name };
      }

      this.requests.push({
        type: "put",
        table: table.config.name,
        item: itemMap,
      });
    }

    return this;
  }

  /**
   * Add delete operations for one or more keys.
   */
  delete<TEntity extends Entity<any, any, any, any, any>>(
    tableName: string,
    entity: TEntity,
    keys: Array<TEntity["_pk"] & (TEntity["_sk"] extends undefined ? {} : { sk: TEntity["_sk"] })>
  ): this {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

    for (const key of keys) {
      const pk = buildPartitionKey(entity, key as TEntity["_pk"]);
      const keyMap: Record<string, AttributeValue> = {
        [table.config.partitionKey]: { S: pk },
      };

      if (entity.sortKey) {
        const skKey = (key as { sk: TEntity["_sk"] }).sk;
        const skResult = buildSortKey(entity, skKey);
        if (skResult.isErr()) {
          throw skResult.error;
        }
        keyMap[table.config.sortKey!] = { S: skResult.value };
      } else if (table.config.sortKey) {
        keyMap[table.config.sortKey] = { S: entity.name };
      }

      this.requests.push({
        type: "delete",
        table: table.config.name,
        key: keyMap,
      });
    }

    return this;
  }

  /**
   * Execute the batch operation.
   * Automatically chunks requests (max 25 per batch) and handles unprocessed items.
   */
  async execute(options?: {
    onProgress?: (processed: number, total: number) => void;
  }): Promise<Result<void, DynamoError>> {
    if (this.requests.length === 0) {
      return ok(undefined);
    }

    const CHUNK_SIZE = 25; // DynamoDB batch write limit
    let processed = 0;

    for (let i = 0; i < this.requests.length; i += CHUNK_SIZE) {
      const chunk = this.requests.slice(i, i + CHUNK_SIZE);
      const requestItems: BatchWriteItemCommandInput["RequestItems"] = {};

      for (const request of chunk) {
        if (!requestItems[request.table]) {
          requestItems[request.table] = [];
        }

        if (request.type === "put") {
          requestItems[request.table].push({ PutRequest: { Item: request.item } });
        } else {
          requestItems[request.table].push({ DeleteRequest: { Key: request.key } });
        }
      }

      const command = new BatchWriteItemCommand({ RequestItems: requestItems });
      const result = await executeOperation(() => this.client.send(command));

      if (result.isErr()) {
        return err(fromAwsError(result.error));
      }

      // Handle unprocessed items with exponential backoff
      let unprocessed = result.value.UnprocessedItems;
      let retries = 0;
      const maxRetries = 5;

      while (unprocessed && Object.keys(unprocessed).length > 0 && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));

        const retryCommand = new BatchWriteItemCommand({ RequestItems: unprocessed });
        const retryResult = await executeOperation(() => this.client.send(retryCommand));

        if (retryResult.isErr()) {
          return err(fromAwsError(retryResult.error));
        }

        unprocessed = retryResult.value.UnprocessedItems;
        retries++;
      }

      if (unprocessed && Object.keys(unprocessed).length > 0) {
        const unprocessedCount = Object.values(unprocessed).reduce(
          (sum, items) => sum + items.length,
          0
        );
        return err(
          internalError(`Failed to process ${unprocessedCount} items after ${maxRetries} retries`)
        );
      }

      processed += chunk.length;
      if (options?.onProgress) {
        options.onProgress(processed, this.requests.length);
      }
    }

    return ok(undefined);
  }

  /**
   * Get the number of requests in the batch.
   */
  get length(): number {
    return this.requests.length;
  }
}
