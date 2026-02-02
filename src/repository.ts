/**
 * Repository layer for entity CRUD operations.
 *
 * Provides type-safe access to DynamoDB operations with automatic
 * marshalling, key building, and error handling.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
  BatchGetItemCommand,
  BatchWriteItemCommand,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType } from "@/entity";
import type { Table } from "@/table";
import { marshalItem, unmarshalItem } from "@/schema";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { err, ok, Result } from "@/result";
import {
  DynamoError,
  notFoundError,
  conditionFailedError,
  fromAwsError,
  internalError,
  validationError,
} from "@/errors";
import { executeOperation } from "@/client";
import { QueryBuilder } from "@/query";
import { ScanBuilder } from "@/scan";
import { UpdateExpressionBuilder } from "@/update";
import { GSIQueryBuilder } from "@/gsi-query";
import { extractKeyFields } from "@/keys";

/**
 * Repository for a specific entity type.
 */
export class Repository<TEntity extends Entity<any, any, any, any, any>> {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly table: Table<any, any, any, any>,
    private readonly entity: TEntity
  ) {}

  /**
   * Retrieve a single item by key.
   * Returns NOT_FOUND error if item doesn't exist.
   */
  async get(
    key: TEntity["_pk"],
    sortKey?: TEntity["_sk"]
  ): Promise<Result<EntityType<TEntity>, DynamoError>> {
    const pk = buildPartitionKey(this.entity, key);
    const keyMap: Record<string, AttributeValue> = {
      [this.table.partitionKey]: { S: pk },
    };

    if (this.entity.sortKey && sortKey !== undefined) {
      const skResult = buildSortKey(this.entity, sortKey);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      keyMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey && !this.entity.sortKey) {
      // Table has sort key but entity doesn't - use default value
      keyMap[this.table.sortKey] = { S: this.entity.name };
    }

    const command = new GetItemCommand({
      TableName: this.table.name,
      Key: keyMap,
    });

    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      return err(fromAwsError(result.error));
    }

    if (!result.value.Item) {
      return err(notFoundError("Item not found", { table: this.table.name, key }));
    }

    const unmarshalled = unmarshalItem(this.entity.schema, result.value.Item);
    if (unmarshalled.isErr()) {
      return err(unmarshalled.error);
    }

    return ok(unmarshalled.value as EntityType<TEntity>);
  }

  /**
   * Create or replace an item.
   */
  async put(item: EntityType<TEntity>, condition?: string): Promise<Result<void, DynamoError>> {
    const pkFields = extractKeyFields(this.entity.partitionKey, item);
    if (pkFields.isErr()) {
      return err(fromAwsError(pkFields.error));
    }
    const pk = buildPartitionKey(this.entity, pkFields.value as TEntity["_pk"]);

    const marshalled = marshalItem(this.entity.schema, item);
    if (marshalled.isErr()) {
      return err(marshalled.error);
    }

    const itemMap = marshalled.value.M!;
    itemMap[this.table.partitionKey] = { S: pk };
    itemMap[this.table.typeField] = { S: this.entity.name };

    if (this.entity.sortKey) {
      const skFields = extractKeyFields(this.entity.sortKey, item);
      if (skFields.isErr()) {
        return err(fromAwsError(skFields.error));
      }
      const skResult = buildSortKey(this.entity, skFields.value as NonNullable<TEntity["_sk"]>);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      itemMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey) {
      // Table has sort key but entity doesn't - provide default value
      itemMap[this.table.sortKey] = { S: this.entity.name };
    }

    const command = new PutItemCommand({
      TableName: this.table.name,
      Item: itemMap,
      ConditionExpression: condition,
    });

    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      const error = fromAwsError(result.error);
      if (error.code === "CONDITION_FAILED") {
        return err(conditionFailedError("Put condition failed"));
      }
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Delete an item.
   */
  async delete(
    key: TEntity["_pk"],
    sortKey?: TEntity["_sk"],
    condition?: string
  ): Promise<Result<void, DynamoError>> {
    const pk = buildPartitionKey(this.entity, key);
    const keyMap: Record<string, AttributeValue> = {
      [this.table.partitionKey]: { S: pk },
    };

    if (this.entity.sortKey && sortKey !== undefined) {
      const skResult = buildSortKey(this.entity, sortKey);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      keyMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey && !this.entity.sortKey) {
      // Table has sort key but entity doesn't - use default value
      keyMap[this.table.sortKey] = { S: this.entity.name };
    }

    const command = new DeleteItemCommand({
      TableName: this.table.name,
      Key: keyMap,
      ConditionExpression: condition,
    });

    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      const error = fromAwsError(result.error);
      if (error.code === "CONDITION_FAILED") {
        return err(conditionFailedError("Delete condition failed"));
      }
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Check if an item exists without fetching it.
   */
  async exists(
    key: TEntity["_pk"],
    sortKey?: TEntity["_sk"]
  ): Promise<Result<boolean, DynamoError>> {
    const pk = buildPartitionKey(this.entity, key);
    const keyMap: Record<string, AttributeValue> = {
      [this.table.partitionKey]: { S: pk },
    };

    if (this.entity.sortKey && sortKey !== undefined) {
      const skResult = buildSortKey(this.entity, sortKey);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      keyMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey && !this.entity.sortKey) {
      // Table has sort key but entity doesn't - use default value
      keyMap[this.table.sortKey] = { S: this.entity.name };
    }

    const command = new GetItemCommand({
      TableName: this.table.name,
      Key: keyMap,
      ProjectionExpression: this.table.partitionKey,
    });

    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      return err(fromAwsError(result.error));
    }

    return ok(!!result.value.Item);
  }

  /**
   * Update an item with an update expression.
   */
  async update(
    key: TEntity["_pk"],
    updates: ReturnType<UpdateExpressionBuilder<EntityType<TEntity>>["unwrap"]>,
    sortKey?: TEntity["_sk"],
    condition?: string
  ): Promise<Result<void, DynamoError>> {
    const pk = buildPartitionKey(this.entity, key);
    const keyMap: Record<string, AttributeValue> = {
      [this.table.partitionKey]: { S: pk },
    };

    if (this.entity.sortKey && sortKey !== undefined) {
      const skResult = buildSortKey(this.entity, sortKey);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      keyMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey && !this.entity.sortKey) {
      // Table has sort key but entity doesn't - use default value
      keyMap[this.table.sortKey] = { S: this.entity.name };
    }

    const command = new UpdateItemCommand({
      TableName: this.table.name,
      Key: keyMap,
      UpdateExpression: updates.UpdateExpression,
      ExpressionAttributeNames: updates.ExpressionAttributeNames,
      ExpressionAttributeValues: updates.ExpressionAttributeValues,
      ConditionExpression: condition,
    });

    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      const error = fromAwsError(result.error);
      if (error.code === "CONDITION_FAILED") {
        return err(conditionFailedError("Update condition failed"));
      }
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Create a query builder for this entity.
   */
  query(partitionKey: TEntity["_pk"]): QueryBuilder<TEntity> {
    return new QueryBuilder(this.client, this.table, this.entity, partitionKey);
  }

  /**
   * Create a scan builder for this entity.
   */
  scan(): ScanBuilder<TEntity> {
    return new ScanBuilder(this.client, this.table, this.entity);
  }

  /**
   * Create a GSI query builder for this entity.
   */
  gsi(gsiName: string, partitionKeyValue: Record<string, unknown>): GSIQueryBuilder<TEntity> {
    return new GSIQueryBuilder(this.client, this.table, this.entity, gsiName, partitionKeyValue);
  }

  /**
   * Batch get multiple items by their keys.
   * Automatically chunks requests (max 100 items per batch) and handles unprocessed items.
   */
  async batchGet(
    keys: Array<{ pk: TEntity["_pk"]; sk?: TEntity["_sk"] }>
  ): Promise<Result<(EntityType<TEntity> | null)[], DynamoError>> {
    const results: (EntityType<TEntity> | null)[] = [];
    const CHUNK_SIZE = 100; // DynamoDB batch get limit

    // Process in chunks
    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunk = keys.slice(i, i + CHUNK_SIZE);
      const keysAndAttributes: Record<string, AttributeValue>[] = [];

      for (const key of chunk) {
        const pk = buildPartitionKey(this.entity, key.pk);
        const keyMap: Record<string, AttributeValue> = {
          [this.table.partitionKey]: { S: pk },
        };

        if (this.entity.sortKey && key.sk !== undefined) {
          const skResult = buildSortKey(this.entity, key.sk);
          if (skResult.isErr()) {
            return err(fromAwsError(skResult.error));
          }
          keyMap[this.table.sortKey!] = { S: skResult.value };
        } else if (this.table.sortKey && !this.entity.sortKey) {
          keyMap[this.table.sortKey] = { S: this.entity.name };
        }

        keysAndAttributes.push(keyMap);
      }

      const command = new BatchGetItemCommand({
        RequestItems: {
          [this.table.name]: {
            Keys: keysAndAttributes,
          },
        },
      });

      const result = await executeOperation(() => this.client.send(command));
      if (result.isErr()) {
        return err(fromAwsError(result.error));
      }

      // Process results
      const response = result.value;
      const items = response.Responses?.[this.table.name] || [];

      for (const item of items) {
        const unmarshalled = unmarshalItem(this.entity.schema, item);
        if (unmarshalled.isErr()) {
          return err(unmarshalled.error);
        }
        results.push(unmarshalled.value as EntityType<TEntity>);
      }

      // Handle unprocessed keys with exponential backoff
      let unprocessed = response.UnprocessedKeys?.[this.table.name]?.Keys;
      let retries = 0;
      const maxRetries = 5;

      while (unprocessed && unprocessed.length > 0 && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));

        const retryCommand = new BatchGetItemCommand({
          RequestItems: {
            [this.table.name]: {
              Keys: unprocessed,
            },
          },
        });

        const retryResult = await executeOperation(() => this.client.send(retryCommand));
        if (retryResult.isErr()) {
          return err(fromAwsError(retryResult.error));
        }

        const retryItems = retryResult.value.Responses?.[this.table.name] || [];
        for (const item of retryItems) {
          const unmarshalled = unmarshalItem(this.entity.schema, item);
          if (unmarshalled.isErr()) {
            return err(unmarshalled.error);
          }
          results.push(unmarshalled.value as EntityType<TEntity>);
        }

        unprocessed = retryResult.value.UnprocessedKeys?.[this.table.name]?.Keys;
        retries++;
      }
    }

    return ok(results);
  }

  /**
   * Batch put multiple items.
   * Automatically chunks requests (max 25 items per batch) and handles unprocessed items.
   */
  async batchPut(
    items: EntityType<TEntity>[],
    options?: {
      onProgress?: (processed: number, total: number) => void;
    }
  ): Promise<Result<void, DynamoError>> {
    const CHUNK_SIZE = 25; // DynamoDB batch write limit
    let processed = 0;

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const writeRequests: Array<{ PutRequest: { Item: Record<string, AttributeValue> } }> = [];

      for (const item of chunk) {
        const pkFields = extractKeyFields(this.entity.partitionKey, item);
        if (pkFields.isErr()) {
          return err(fromAwsError(pkFields.error));
        }
        const pk = buildPartitionKey(this.entity, pkFields.value as TEntity["_pk"]);

        const marshalled = marshalItem(this.entity.schema, item);
        if (marshalled.isErr()) {
          return err(marshalled.error);
        }

        const itemMap = marshalled.value.M!;
        itemMap[this.table.partitionKey] = { S: pk };
        itemMap[this.table.typeField] = { S: this.entity.name };

        if (this.entity.sortKey) {
          const skFields = extractKeyFields(this.entity.sortKey, item);
          if (skFields.isErr()) {
            return err(fromAwsError(skFields.error));
          }
          const skResult = buildSortKey(this.entity, skFields.value as NonNullable<TEntity["_sk"]>);
          if (skResult.isErr()) {
            return err(fromAwsError(skResult.error));
          }
          itemMap[this.table.sortKey!] = { S: skResult.value };
        } else if (this.table.sortKey) {
          itemMap[this.table.sortKey] = { S: this.entity.name };
        }

        writeRequests.push({ PutRequest: { Item: itemMap } });
      }

      const command = new BatchWriteItemCommand({
        RequestItems: {
          [this.table.name]: writeRequests,
        },
      });

      const result = await executeOperation(() => this.client.send(command));
      if (result.isErr()) {
        return err(fromAwsError(result.error));
      }

      // Handle unprocessed items with exponential backoff
      let unprocessed = result.value.UnprocessedItems?.[this.table.name];
      let retries = 0;
      const maxRetries = 5;

      while (unprocessed && unprocessed.length > 0 && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));

        const retryCommand = new BatchWriteItemCommand({
          RequestItems: {
            [this.table.name]: unprocessed,
          },
        });

        const retryResult = await executeOperation(() => this.client.send(retryCommand));
        if (retryResult.isErr()) {
          return err(fromAwsError(retryResult.error));
        }

        unprocessed = retryResult.value.UnprocessedItems?.[this.table.name];
        retries++;
      }

      if (unprocessed && unprocessed.length > 0) {
        return err(
          internalError(`Failed to process ${unprocessed.length} items after ${maxRetries} retries`)
        );
      }

      processed += chunk.length;
      if (options?.onProgress) {
        options.onProgress(processed, items.length);
      }
    }

    return ok(undefined);
  }

  /**
   * Batch delete multiple items by their keys.
   * Automatically chunks requests (max 25 items per batch) and handles unprocessed items.
   */
  async batchDelete(
    keys: Array<{ pk: TEntity["_pk"]; sk?: TEntity["_sk"] }>,
    options?: {
      onProgress?: (processed: number, total: number) => void;
    }
  ): Promise<Result<void, DynamoError>> {
    const CHUNK_SIZE = 25; // DynamoDB batch write limit
    let processed = 0;

    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunk = keys.slice(i, i + CHUNK_SIZE);
      const writeRequests: Array<{ DeleteRequest: { Key: Record<string, AttributeValue> } }> = [];

      for (const key of chunk) {
        const pk = buildPartitionKey(this.entity, key.pk);
        const keyMap: Record<string, AttributeValue> = {
          [this.table.partitionKey]: { S: pk },
        };

        if (this.entity.sortKey && key.sk !== undefined) {
          const skResult = buildSortKey(this.entity, key.sk);
          if (skResult.isErr()) {
            return err(fromAwsError(skResult.error));
          }
          keyMap[this.table.sortKey!] = { S: skResult.value };
        } else if (this.table.sortKey && !this.entity.sortKey) {
          keyMap[this.table.sortKey] = { S: this.entity.name };
        }

        writeRequests.push({ DeleteRequest: { Key: keyMap } });
      }

      const command = new BatchWriteItemCommand({
        RequestItems: {
          [this.table.name]: writeRequests,
        },
      });

      const result = await executeOperation(() => this.client.send(command));
      if (result.isErr()) {
        return err(fromAwsError(result.error));
      }

      // Handle unprocessed items with exponential backoff
      let unprocessed = result.value.UnprocessedItems?.[this.table.name];
      let retries = 0;
      const maxRetries = 5;

      while (unprocessed && unprocessed.length > 0 && retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));

        const retryCommand = new BatchWriteItemCommand({
          RequestItems: {
            [this.table.name]: unprocessed,
          },
        });

        const retryResult = await executeOperation(() => this.client.send(retryCommand));
        if (retryResult.isErr()) {
          return err(fromAwsError(retryResult.error));
        }

        unprocessed = retryResult.value.UnprocessedItems?.[this.table.name];
        retries++;
      }

      if (unprocessed && unprocessed.length > 0) {
        return err(
          internalError(`Failed to process ${unprocessed.length} items after ${maxRetries} retries`)
        );
      }

      processed += chunk.length;
      if (options?.onProgress) {
        options.onProgress(processed, keys.length);
      }
    }

    return ok(undefined);
  }

  /**
   * Partially update an item using high-level patch operations.
   * Supports set, increment, decrement, append, prepend, remove, add, delete operations.
   *
   * @example
   * ```typescript
   * await repo.patch(
   *   { id: "123" },
   *   {
   *     set: { name: "John", status: "active" },
   *     increment: { loginCount: 1 },
   *     append: { tags: ["premium"] },
   *     remove: ["tempField"]
   *   }
   * );
   * ```
   */
  async patch(
    key: TEntity["_pk"],
    operations: {
      set?: Partial<EntityType<TEntity>>;
      increment?: Record<string, number>;
      decrement?: Record<string, number>;
      append?: Record<string, unknown[]>;
      prepend?: Record<string, unknown[]>;
      remove?: string[];
      add?: Record<string, number | Set<string> | Set<number>>;
      delete?: Record<string, Set<string> | Set<number>>;
    },
    sortKey?: TEntity["_sk"],
    condition?: string
  ): Promise<Result<void, DynamoError>> {
    const pk = buildPartitionKey(this.entity, key);
    const keyMap: Record<string, AttributeValue> = {
      [this.table.partitionKey]: { S: pk },
    };

    if (this.entity.sortKey && sortKey !== undefined) {
      const skResult = buildSortKey(this.entity, sortKey);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      keyMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey && !this.entity.sortKey) {
      keyMap[this.table.sortKey] = { S: this.entity.name };
    }

    // Build update expression from operations
    const setExpressions: string[] = [];
    const removeExpressions: string[] = [];
    const addExpressions: string[] = [];
    const deleteExpressions: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, AttributeValue> = {};
    let valueCounter = 0;

    // Helper to generate unique placeholder
    const nextValue = () => `:v${valueCounter++}`;
    const nextName = (name: string) => {
      const placeholder = `#n${valueCounter++}`;
      expressionNames[placeholder] = name;
      return placeholder;
    };

    // SET operations
    if (operations.set) {
      for (const [field, value] of Object.entries(operations.set)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = this.marshalValue(value);
        setExpressions.push(`${nameRef} = ${valueRef}`);
      }
    }

    // INCREMENT operations
    if (operations.increment) {
      for (const [field, amount] of Object.entries(operations.increment)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = { N: String(amount) };
        setExpressions.push(`${nameRef} = ${nameRef} + ${valueRef}`);
      }
    }

    // DECREMENT operations
    if (operations.decrement) {
      for (const [field, amount] of Object.entries(operations.decrement)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = { N: String(amount) };
        setExpressions.push(`${nameRef} = ${nameRef} - ${valueRef}`);
      }
    }

    // APPEND operations
    if (operations.append) {
      for (const [field, values] of Object.entries(operations.append)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = { L: values.map((v) => this.marshalValue(v)) };
        setExpressions.push(`${nameRef} = list_append(${nameRef}, ${valueRef})`);
      }
    }

    // PREPEND operations
    if (operations.prepend) {
      for (const [field, values] of Object.entries(operations.prepend)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = { L: values.map((v) => this.marshalValue(v)) };
        setExpressions.push(`${nameRef} = list_append(${valueRef}, ${nameRef})`);
      }
    }

    // REMOVE operations
    if (operations.remove) {
      for (const field of operations.remove) {
        const nameRef = nextName(field);
        removeExpressions.push(nameRef);
      }
    }

    // ADD operations (for numbers or sets)
    if (operations.add) {
      for (const [field, value] of Object.entries(operations.add)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = this.marshalValue(value);
        addExpressions.push(`${nameRef} ${valueRef}`);
      }
    }

    // DELETE operations (for sets)
    if (operations.delete) {
      for (const [field, value] of Object.entries(operations.delete)) {
        const nameRef = nextName(field);
        const valueRef = nextValue();
        expressionValues[valueRef] = this.marshalValue(value);
        deleteExpressions.push(`${nameRef} ${valueRef}`);
      }
    }

    // Build final expression
    const parts: string[] = [];
    if (setExpressions.length > 0) {
      parts.push(`SET ${setExpressions.join(", ")}`);
    }
    if (removeExpressions.length > 0) {
      parts.push(`REMOVE ${removeExpressions.join(", ")}`);
    }
    if (addExpressions.length > 0) {
      parts.push(`ADD ${addExpressions.join(", ")}`);
    }
    if (deleteExpressions.length > 0) {
      parts.push(`DELETE ${deleteExpressions.join(", ")}`);
    }

    if (parts.length === 0) {
      return err(validationError("No patch operations provided"));
    }

    const command = new UpdateItemCommand({
      TableName: this.table.name,
      Key: keyMap,
      UpdateExpression: parts.join(" "),
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ConditionExpression: condition,
    });

    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      const error = fromAwsError(result.error);
      if (error.code === "CONDITION_FAILED") {
        return err(conditionFailedError("Patch condition failed"));
      }
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Upsert an item - creates if not exists, updates if exists.
   * Returns whether the item was created (true) or updated (false).
   *
   * @example
   * ```typescript
   * const result = await repo.upsert(userData);
   * if (result.isOk()) {
   *   console.log(result.value.created ? "Created" : "Updated");
   * }
   * ```
   */
  async upsert(
    item: EntityType<TEntity>,
    options?: {
      condition?: string;
      onCreate?: Partial<EntityType<TEntity>>;
    }
  ): Promise<Result<{ created: boolean }, DynamoError>> {
    const pkFields = extractKeyFields(this.entity.partitionKey, item);
    if (pkFields.isErr()) {
      return err(fromAwsError(pkFields.error));
    }
    const pk = buildPartitionKey(this.entity, pkFields.value as TEntity["_pk"]);

    // Check if item exists
    const keyMap: Record<string, AttributeValue> = {
      [this.table.partitionKey]: { S: pk },
    };

    if (this.entity.sortKey) {
      const skFields = extractKeyFields(this.entity.sortKey, item);
      if (skFields.isErr()) {
        return err(fromAwsError(skFields.error));
      }
      const skResult = buildSortKey(this.entity, skFields.value as NonNullable<TEntity["_sk"]>);
      if (skResult.isErr()) {
        return err(fromAwsError(skResult.error));
      }
      keyMap[this.table.sortKey!] = { S: skResult.value };
    } else if (this.table.sortKey) {
      keyMap[this.table.sortKey] = { S: this.entity.name };
    }

    const getCommand = new GetItemCommand({
      TableName: this.table.name,
      Key: keyMap,
      ProjectionExpression: this.table.partitionKey,
    });

    const existsResult = await executeOperation(() => this.client.send(getCommand));
    if (existsResult.isErr()) {
      return err(fromAwsError(existsResult.error));
    }

    const exists = !!existsResult.value.Item;

    // Merge item with onCreate defaults if creating
    let finalItem = item;
    if (!exists && options?.onCreate) {
      finalItem = { ...options.onCreate, ...item };
    }

    // Put the item
    const putResult = await this.put(finalItem, options?.condition);
    if (putResult.isErr()) {
      return err(putResult.error);
    }

    return ok({ created: !exists });
  }

  /**
   * Helper to marshal a value to DynamoDB AttributeValue format.
   */
  private marshalValue(value: unknown): AttributeValue {
    if (typeof value === "string") {
      return { S: value };
    } else if (typeof value === "number") {
      return { N: String(value) };
    } else if (typeof value === "boolean") {
      return { BOOL: value };
    } else if (value === null || value === undefined) {
      return { NULL: true };
    } else if (value instanceof Set) {
      const items = Array.from(value);
      if (items.length > 0 && typeof items[0] === "string") {
        return { SS: items as string[] };
      } else {
        return { NS: items.map(String) };
      }
    } else if (Array.isArray(value)) {
      return { L: value.map((v) => this.marshalValue(v)) };
    } else if (typeof value === "object") {
      const map: Record<string, AttributeValue> = {};
      for (const [k, v] of Object.entries(value)) {
        map[k] = this.marshalValue(v);
      }
      return { M: map };
    } else {
      return { S: String(value) };
    }
  }
}

// Note: extractKeyFields is imported from keys.ts
// This local function is not used
