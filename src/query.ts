/**
 * Query builder for DynamoDB queries.
 *
 * Provides a fluent, type-safe API for building and executing queries
 * with support for key conditions, filters, projections, and pagination.
 */

import {
  DynamoDBClient,
  QueryCommand,
  QueryCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType } from "@/entity";
import type { Table } from "@/table";
import { unmarshalItem } from "@/schema";
import { buildPartitionKey } from "@/entity";
import { err, ok, Result } from "@/result";
import { fromAwsError } from "@/errors";
import { executeOperation } from "@/client";
import { createFilterBuilder } from "@/filter";
import {
  ExpressionContext,
  createExpressionContext,
  addAttributeName,
  addAttributeValue,
} from "@/expressions";
import { buildSortKey } from "@/entity";
import { Paths } from "@/types";

/**
 * Query builder state.
 */
interface QueryState {
  keyCondition: string;
  filter?: {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  };
  projection?: string[];
  indexName?: string;
  limit?: number;
  exclusiveStartKey?: Record<string, AttributeValue>;
  scanIndexForward?: boolean;
  consistentRead?: boolean;
  context: ExpressionContext;
}

/**
 * Query builder for a specific entity.
 */
export class QueryBuilder<TEntity extends Entity<any, any, any, any, any>> {
  private state: QueryState;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly table: Table<any, any, any, any>,
    private readonly entity: TEntity,
    partitionKey: TEntity["_pk"]
  ) {
    const context = createExpressionContext();
    const pk = buildPartitionKey(entity, partitionKey);
    const pkRef = addAttributeValue(context, pk);
    const pkName = addAttributeName(context, this.table.partitionKey);
    const keyCondition = `${pkName} = ${pkRef}`;

    this.state = {
      keyCondition,
      context,
    };
  }

  /**
   * Add a sort key condition.
   */
  sortKeyEquals(value: NonNullable<TEntity["_sk"]>): QueryBuilder<TEntity> {
    if (!this.entity.sortKey) {
      throw new Error(`Entity ${this.entity.name} does not have a sort key`);
    }
    const skRef = addAttributeValue(this.state.context, buildSortKey(this.entity, value).unwrap());
    const skName = addAttributeName(this.state.context, this.table.sortKey!);
    this.state.keyCondition += ` AND ${skName} = ${skRef}`;
    return this;
  }

  /**
   * Sort key begins with.
   */
  sortKeyBeginsWith(value: string): QueryBuilder<TEntity> {
    if (!this.entity.sortKey) {
      throw new Error(`Entity ${this.entity.name} does not have a sort key`);
    }
    const skRef = addAttributeValue(this.state.context, value);
    const skName = addAttributeName(this.state.context, this.table.sortKey!);
    this.state.keyCondition += ` AND begins_with(${skName}, ${skRef})`;
    return this;
  }

  /**
   * Sort key between two values.
   */
  sortKeyBetween(start: string, end: string): QueryBuilder<TEntity> {
    if (!this.entity.sortKey) {
      throw new Error(`Entity ${this.entity.name} does not have a sort key`);
    }
    const startRef = addAttributeValue(this.state.context, start);
    const endRef = addAttributeValue(this.state.context, end);
    const skName = addAttributeName(this.state.context, this.table.sortKey!);
    this.state.keyCondition += ` AND ${skName} BETWEEN ${startRef} AND ${endRef}`;
    return this;
  }

  /**
   * Sort key comparison operators.
   */
  sortKeyLessThan(value: string): QueryBuilder<TEntity> {
    return this.sortKeyCompare("<", value);
  }

  sortKeyLessThanOrEqual(value: string): QueryBuilder<TEntity> {
    return this.sortKeyCompare("<=", value);
  }

  sortKeyGreaterThan(value: string): QueryBuilder<TEntity> {
    return this.sortKeyCompare(">", value);
  }

  sortKeyGreaterThanOrEqual(value: string): QueryBuilder<TEntity> {
    return this.sortKeyCompare(">=", value);
  }

  private sortKeyCompare(operator: string, value: string): QueryBuilder<TEntity> {
    if (!this.entity.sortKey) {
      throw new Error(`Entity ${this.entity.name} does not have a sort key`);
    }
    const skRef = addAttributeValue(this.state.context, value);
    const skName = addAttributeName(this.state.context, this.table.sortKey!);
    this.state.keyCondition += ` AND ${skName} ${operator} ${skRef}`;
    return this;
  }

  /**
   * Add a filter expression.
   */
  where(
    fieldPath: Paths<EntityType<TEntity>>,
    operator:
      | "="
      | "<>"
      | "<"
      | "<="
      | ">"
      | ">="
      | "begins_with"
      | "contains"
      | "attribute_exists"
      | "attribute_not_exists",
    value?: unknown
  ): QueryBuilder<TEntity> {
    const filterBuilder = createFilterBuilder<EntityType<TEntity>>(this.state.context);
    filterBuilder.where(fieldPath, operator, value);
    const filterResult = filterBuilder.build();
    if (filterResult.isErr()) {
      throw filterResult.error;
    }
    this.state.filter = filterResult.value;
    // Merge contexts
    Object.assign(this.state.context.names, filterResult.value.names);
    Object.assign(this.state.context.values, filterResult.value.values);
    return this;
  }

  /**
   * Select specific fields to return.
   */
  select(...fields: Paths<EntityType<TEntity>>[]): QueryBuilder<TEntity> {
    this.state.projection = fields as string[];
    return this;
  }

  /**
   * Query on a GSI.
   */
  usingIndex(indexName: string): QueryBuilder<TEntity> {
    this.state.indexName = indexName;
    return this;
  }

  /**
   * Limit the number of items returned.
   */
  limit(count: number): QueryBuilder<TEntity> {
    this.state.limit = count;
    return this;
  }

  /**
   * Set pagination token.
   */
  exclusiveStartKey(key: Record<string, AttributeValue>): QueryBuilder<TEntity> {
    this.state.exclusiveStartKey = key;
    return this;
  }

  /**
   * Set scan direction (default: forward).
   */
  scanIndexForward(forward: boolean): QueryBuilder<TEntity> {
    this.state.scanIndexForward = forward;
    return this;
  }

  /**
   * Use consistent read.
   */
  consistentRead(consistent: boolean): QueryBuilder<TEntity> {
    this.state.consistentRead = consistent;
    return this;
  }

  /**
   * Execute query and return first page.
   */
  async page(): Promise<
    Result<
      {
        items: EntityType<TEntity>[];
        lastEvaluatedKey?: Record<string, AttributeValue>;
      },
      Error
    >
  > {
    const input = this.buildInput();
    const command = new QueryCommand(input);
    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      return err(fromAwsError(result.error));
    }

    const items: EntityType<TEntity>[] = [];
    for (const item of result.value.Items || []) {
      const unmarshalled = unmarshalItem(this.entity.schema, item);
      if (unmarshalled.isErr()) {
        return err(unmarshalled.error);
      }
      items.push(unmarshalled.value as EntityType<TEntity>);
    }

    return ok({
      items,
      lastEvaluatedKey: result.value.LastEvaluatedKey,
    });
  }

  /**
   * Execute query and return all items (auto-pagination).
   */
  async *execute(): AsyncGenerator<EntityType<TEntity>, void, unknown> {
    let lastKey: Record<string, AttributeValue> | undefined = undefined;
    do {
      if (lastKey) {
        this.state.exclusiveStartKey = lastKey;
      }
      const pageResult = await this.page();
      if (pageResult.isErr()) {
        throw pageResult.error;
      }
      for (const item of pageResult.value.items) {
        yield item;
      }
      lastKey = pageResult.value.lastEvaluatedKey;
    } while (lastKey);
  }

  /**
   * Execute query and collect all items to array.
   */
  async toArray(): Promise<Result<EntityType<TEntity>[], Error>> {
    const items: EntityType<TEntity>[] = [];
    try {
      for await (const item of this.execute()) {
        items.push(item);
      }
      return ok(items);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get first item or error if not found.
   */
  async first(): Promise<Result<EntityType<TEntity>, Error>> {
    this.state.limit = 1;
    const pageResult = await this.page();
    if (pageResult.isErr()) {
      return err(pageResult.error);
    }
    if (pageResult.value.items.length === 0) {
      return err(new Error("No items found"));
    }
    return ok(pageResult.value.items[0]);
  }

  /**
   * Get first item or null.
   */
  async firstOrNull(): Promise<Result<EntityType<TEntity> | null, Error>> {
    this.state.limit = 1;
    const pageResult = await this.page();
    if (pageResult.isErr()) {
      return err(pageResult.error);
    }
    return ok(pageResult.value.items[0] || null);
  }

  /**
   * Get count only.
   */
  async count(): Promise<Result<number, Error>> {
    const input = this.buildInput();
    input.Select = "COUNT";
    const command = new QueryCommand(input);
    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      return err(fromAwsError(result.error));
    }
    return ok(result.value.Count || 0);
  }

  private buildInput(): QueryCommandInput {
    // Convert values to DynamoDB AttributeValue format
    const expressionValues: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(this.state.context.values)) {
      expressionValues[key] = { S: String(value) };
    }

    const input: QueryCommandInput = {
      TableName: this.table.name,
      KeyConditionExpression: this.state.keyCondition,
      ExpressionAttributeNames: this.state.context.names,
      ExpressionAttributeValues: expressionValues,
    };

    if (this.state.filter) {
      input.FilterExpression = this.state.filter.expression;
      Object.assign(input.ExpressionAttributeNames!, this.state.filter.names);
      // Convert filter values to AttributeValue format
      for (const [key, value] of Object.entries(this.state.filter.values)) {
        (input.ExpressionAttributeValues as Record<string, AttributeValue>)[key] = {
          S: String(value),
        };
      }
    }

    if (this.state.projection) {
      input.ProjectionExpression = this.state.projection
        .map((field) => this.state.context.names[field] || field)
        .join(", ");
    }

    if (this.state.indexName) {
      input.IndexName = this.state.indexName;
    }

    if (this.state.limit) {
      input.Limit = this.state.limit;
    }

    if (this.state.exclusiveStartKey) {
      input.ExclusiveStartKey = this.state.exclusiveStartKey;
    }

    if (this.state.scanIndexForward !== undefined) {
      input.ScanIndexForward = this.state.scanIndexForward;
    }

    if (this.state.consistentRead !== undefined) {
      input.ConsistentRead = this.state.consistentRead;
    }

    return input;
  }
}
