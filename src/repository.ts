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
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType } from "@/entity";
import type { Table } from "@/table";
import { marshalItem, unmarshalItem } from "@/schema";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { err, ok, Result } from "@/result";
import { DynamoError, notFoundError, conditionFailedError, fromAwsError } from "@/errors";
import { executeOperation } from "@/client";
import { QueryBuilder } from "@/query";
import { ScanBuilder } from "@/scan";
import { UpdateExpressionBuilder } from "@/update";
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
}

// Note: extractKeyFields is imported from keys.ts
// This local function is not used
