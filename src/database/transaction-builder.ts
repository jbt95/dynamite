/**
 * Database-level transaction builder implementation.
 *
 * Provides a fluent, type-safe API for building and executing
 * multi-item transactions across tables and entities.
 */

import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType, EntityPK, EntitySK } from "@/entity/types";
import type { Table } from "./types";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { extractKeyFields } from "@/keys";
import { marshalItem } from "@/schema";
import { err, ok, Result } from "@/result";
import { fromAwsError, transactionCancelledError, DynamoError } from "@/errors";
import { executeOperation } from "@/client";

/**
 * Internal transaction operation representation.
 */
type TransactionOp =
  | {
      type: "put";
      table: string;
      item: Record<string, AttributeValue>;
      condition?: string;
    }
  | {
      type: "update";
      table: string;
      key: Record<string, AttributeValue>;
      updateExpression: string;
      expressionNames?: Record<string, string>;
      expressionValues?: Record<string, AttributeValue>;
      condition?: string;
    }
  | {
      type: "delete";
      table: string;
      key: Record<string, AttributeValue>;
      condition?: string;
    }
  | {
      type: "conditionCheck";
      table: string;
      key: Record<string, AttributeValue>;
      condition: string;
      expressionNames?: Record<string, string>;
      expressionValues?: Record<string, AttributeValue>;
    };

/**
 * Transaction builder for cross-table operations.
 */
export class DatabaseTransactionBuilder {
  private operations: TransactionOp[] = [];

  constructor(
    private readonly client: DynamoDBClient,
    private readonly tables: Map<string, Table<any, any, any>>
  ) {}

  /**
   * Add a put operation to the transaction.
   */
  put<TEntity extends Entity<any, any, any, any, any>>(
    tableName: string,
    entity: TEntity,
    item: EntityType<TEntity>,
    condition?: string
  ): this {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

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

    this.operations.push({
      type: "put",
      table: table.config.name,
      item: itemMap,
      condition,
    });

    return this;
  }

  /**
   * Add an update operation to the transaction.
   */
  update<TEntity extends Entity<any, any, any, any, any>>(
    tableName: string,
    entity: TEntity,
    key: TEntity["_pk"] & (TEntity["_sk"] extends undefined ? {} : { sk: TEntity["_sk"] }),
    updates: {
      set?: Partial<EntityType<TEntity>>;
      increment?: Record<string, number>;
      decrement?: Record<string, number>;
      append?: Record<string, unknown[]>;
      remove?: string[];
    },
    condition?: string
  ): this {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

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

    // Build update expression
    const setExpressions: string[] = [];
    const removeExpressions: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, AttributeValue> = {};
    let counter = 0;

    if (updates.set) {
      for (const [field, value] of Object.entries(updates.set)) {
        const nameRef = `#n${counter}`;
        const valueRef = `:v${counter}`;
        expressionNames[nameRef] = field;
        expressionValues[valueRef] = this.marshalValue(value);
        setExpressions.push(`${nameRef} = ${valueRef}`);
        counter++;
      }
    }

    if (updates.increment) {
      for (const [field, amount] of Object.entries(updates.increment)) {
        const nameRef = `#n${counter}`;
        const valueRef = `:v${counter}`;
        expressionNames[nameRef] = field;
        expressionValues[valueRef] = { N: String(amount) };
        setExpressions.push(`${nameRef} = ${nameRef} + ${valueRef}`);
        counter++;
      }
    }

    if (updates.decrement) {
      for (const [field, amount] of Object.entries(updates.decrement)) {
        const nameRef = `#n${counter}`;
        const valueRef = `:v${counter}`;
        expressionNames[nameRef] = field;
        expressionValues[valueRef] = { N: String(amount) };
        setExpressions.push(`${nameRef} = ${nameRef} - ${valueRef}`);
        counter++;
      }
    }

    if (updates.append) {
      for (const [field, values] of Object.entries(updates.append)) {
        const nameRef = `#n${counter}`;
        const valueRef = `:v${counter}`;
        expressionNames[nameRef] = field;
        expressionValues[valueRef] = { L: values.map((v) => this.marshalValue(v)) };
        setExpressions.push(`${nameRef} = list_append(${nameRef}, ${valueRef})`);
        counter++;
      }
    }

    if (updates.remove) {
      for (const field of updates.remove) {
        const nameRef = `#n${counter}`;
        expressionNames[nameRef] = field;
        removeExpressions.push(nameRef);
        counter++;
      }
    }

    const parts: string[] = [];
    if (setExpressions.length > 0) {
      parts.push(`SET ${setExpressions.join(", ")}`);
    }
    if (removeExpressions.length > 0) {
      parts.push(`REMOVE ${removeExpressions.join(", ")}`);
    }

    this.operations.push({
      type: "update",
      table: table.config.name,
      key: keyMap,
      updateExpression: parts.join(" "),
      expressionNames: Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      expressionValues: Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
      condition,
    });

    return this;
  }

  /**
   * Add a delete operation to the transaction.
   */
  delete<TEntity extends Entity<any, any, any, any, any>>(
    tableName: string,
    entity: TEntity,
    key: TEntity["_pk"] & (TEntity["_sk"] extends undefined ? {} : { sk: TEntity["_sk"] }),
    condition?: string
  ): this {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

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

    this.operations.push({
      type: "delete",
      table: table.config.name,
      key: keyMap,
      condition,
    });

    return this;
  }

  /**
   * Add a condition check to the transaction.
   */
  condition<TEntity extends Entity<any, any, any, any, any>>(
    tableName: string,
    entity: TEntity,
    key: TEntity["_pk"] & (TEntity["_sk"] extends undefined ? {} : { sk: TEntity["_sk"] }),
    condition: string
  ): this {
    const table = this.tables.get(tableName);
    if (!table) {
      throw new Error(`Table not found: ${tableName}`);
    }

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

    this.operations.push({
      type: "conditionCheck",
      table: table.config.name,
      key: keyMap,
      condition,
    });

    return this;
  }

  /**
   * Execute the transaction.
   */
  async execute(): Promise<Result<void, DynamoError>> {
    if (this.operations.length === 0) {
      return ok(undefined);
    }

    if (this.operations.length > 25) {
      return err(new Error("Transaction cannot exceed 25 items (DynamoDB limit)") as DynamoError);
    }

    const transactItems: TransactWriteItemsCommandInput["TransactItems"] = [];

    for (const op of this.operations) {
      switch (op.type) {
        case "put":
          transactItems.push({
            Put: {
              TableName: op.table,
              Item: op.item,
              ConditionExpression: op.condition,
            },
          });
          break;
        case "update":
          transactItems.push({
            Update: {
              TableName: op.table,
              Key: op.key,
              UpdateExpression: op.updateExpression,
              ExpressionAttributeNames: op.expressionNames,
              ExpressionAttributeValues: op.expressionValues,
              ConditionExpression: op.condition,
            },
          });
          break;
        case "delete":
          transactItems.push({
            Delete: {
              TableName: op.table,
              Key: op.key,
              ConditionExpression: op.condition,
            },
          });
          break;
        case "conditionCheck":
          transactItems.push({
            ConditionCheck: {
              TableName: op.table,
              Key: op.key,
              ConditionExpression: op.condition,
              ExpressionAttributeNames: op.expressionNames,
              ExpressionAttributeValues: op.expressionValues,
            },
          });
          break;
      }
    }

    const command = new TransactWriteItemsCommand({
      TransactItems: transactItems,
    });

    const result = await executeOperation(() => this.client.send(command));

    if (result.isErr()) {
      const error = fromAwsError(result.error);
      if (error.code === "TRANSACTION_CANCELLED") {
        return err(
          transactionCancelledError("Transaction was cancelled", {
            cancellationReasons: result.error,
          })
        );
      }
      return err(error);
    }

    return ok(undefined);
  }

  /**
   * Get the number of operations in the transaction.
   */
  get length(): number {
    return this.operations.length;
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
