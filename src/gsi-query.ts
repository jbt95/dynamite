/**
 * GSI Query Builder for type-safe Global Secondary Index queries.
 *
 * Provides a fluent API for querying entities via their GSI
 * with automatic key building and type-safe filters.
 */

import {
  DynamoDBClient,
  QueryCommand,
  QueryCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType, EntityGSIName, GSIKey } from "@/entity/types";
import type { Table } from "@/table";
import { unmarshalItem } from "@/schema";
import { buildKey } from "@/keys";
import { err, ok, Result } from "@/result";
import { fromAwsError, DynamoError, internalError } from "@/errors";
import { executeOperation } from "@/client";
import {
  ExpressionContext,
  createExpressionContext,
  addAttributeName,
  addAttributeValue,
} from "@/expressions";
import { Paths } from "@/types";

/**
 * GSI Query builder state.
 */
interface GSIQueryState {
  keyCondition: string;
  filter?: {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  };
  projection?: string[];
  limit?: number;
  exclusiveStartKey?: Record<string, AttributeValue>;
  scanIndexForward?: boolean;
  consistentRead?: boolean;
  context: ExpressionContext;
}

/**
 * GSI Query builder for querying via Global Secondary Index.
 */
export class GSIQueryBuilder<TEntity extends Entity<any, any, any, any, any>> {
  private state: GSIQueryState;
  private gsiConfig: GSIKey<any, any, any>;
  private gsiIndex: number;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly table: Table<any, any, any, any>,
    private readonly entity: TEntity,
    gsiName: EntityGSIName<TEntity>,
    partitionKeyValue: Record<string, unknown>
  ) {
    // Find GSI config
    const gsiIndex = entity.gsiKeys?.findIndex((gsi) => gsi.name === gsiName);
    if (gsiIndex === -1 || gsiIndex === undefined) {
      throw new Error(`GSI "${gsiName}" not found on entity "${entity.name}"`);
    }

    this.gsiIndex = gsiIndex;
    this.gsiConfig = entity.gsiKeys![gsiIndex];

    const context = createExpressionContext();

    // Build GSI partition key
    const pk = buildKey(this.gsiConfig.partitionKey, partitionKeyValue);
    const pkRef = addAttributeValue(context, pk);
    const pkName = addAttributeName(context, `GSI${gsiIndex + 1}PK`);
    const keyCondition = `${pkName} = ${pkRef}`;

    this.state = {
      keyCondition,
      context,
    };
  }

  /**
   * Add a sort key condition (equals).
   */
  sortKeyEquals(value: Record<string, unknown>): GSIQueryBuilder<TEntity> {
    if (!this.gsiConfig.sortKey) {
      throw new Error(`GSI "${this.gsiConfig.name}" does not have a sort key`);
    }

    const sk = buildKey(this.gsiConfig.sortKey, value);
    const skRef = addAttributeValue(this.state.context, sk);
    const skName = addAttributeName(this.state.context, `GSI${this.gsiIndex + 1}SK`);
    this.state.keyCondition += ` AND ${skName} = ${skRef}`;
    return this;
  }

  /**
   * Sort key begins with.
   */
  sortKeyBeginsWith(value: string): GSIQueryBuilder<TEntity> {
    if (!this.gsiConfig.sortKey) {
      throw new Error(`GSI "${this.gsiConfig.name}" does not have a sort key`);
    }

    const skRef = addAttributeValue(this.state.context, value);
    const skName = addAttributeName(this.state.context, `GSI${this.gsiIndex + 1}SK`);
    this.state.keyCondition += ` AND begins_with(${skName}, ${skRef})`;
    return this;
  }

  /**
   * Sort key between two values.
   */
  sortKeyBetween(start: string, end: string): GSIQueryBuilder<TEntity> {
    if (!this.gsiConfig.sortKey) {
      throw new Error(`GSI "${this.gsiConfig.name}" does not have a sort key`);
    }

    const startRef = addAttributeValue(this.state.context, start);
    const endRef = addAttributeValue(this.state.context, end);
    const skName = addAttributeName(this.state.context, `GSI${this.gsiIndex + 1}SK`);
    this.state.keyCondition += ` AND ${skName} BETWEEN ${startRef} AND ${endRef}`;
    return this;
  }

  /**
   * Sort key comparison operators.
   */
  sortKeyLessThan(value: string): GSIQueryBuilder<TEntity> {
    return this.sortKeyCompare("<", value);
  }

  sortKeyLessThanOrEqual(value: string): GSIQueryBuilder<TEntity> {
    return this.sortKeyCompare("<=", value);
  }

  sortKeyGreaterThan(value: string): GSIQueryBuilder<TEntity> {
    return this.sortKeyCompare(">", value);
  }

  sortKeyGreaterThanOrEqual(value: string): GSIQueryBuilder<TEntity> {
    return this.sortKeyCompare(">=", value);
  }

  private sortKeyCompare(operator: string, value: string): GSIQueryBuilder<TEntity> {
    if (!this.gsiConfig.sortKey) {
      throw new Error(`GSI "${this.gsiConfig.name}" does not have a sort key`);
    }

    const skRef = addAttributeValue(this.state.context, value);
    const skName = addAttributeName(this.state.context, `GSI${this.gsiIndex + 1}SK`);
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
  ): GSIQueryBuilder<TEntity> {
    // Build filter expression manually
    const fieldRef = addAttributeName(this.state.context, String(fieldPath));

    if (operator === "attribute_exists") {
      if (!this.state.filter) {
        this.state.filter = { expression: "", names: {}, values: {} };
      }
      const expr = `attribute_exists(${fieldRef})`;
      this.state.filter.expression = this.state.filter.expression
        ? `${this.state.filter.expression} AND ${expr}`
        : expr;
      Object.assign(this.state.filter.names, this.state.context.names);
    } else if (operator === "attribute_not_exists") {
      if (!this.state.filter) {
        this.state.filter = { expression: "", names: {}, values: {} };
      }
      const expr = `attribute_not_exists(${fieldRef})`;
      this.state.filter.expression = this.state.filter.expression
        ? `${this.state.filter.expression} AND ${expr}`
        : expr;
      Object.assign(this.state.filter.names, this.state.context.names);
    } else {
      const valueRef = addAttributeValue(this.state.context, value);

      if (!this.state.filter) {
        this.state.filter = { expression: "", names: {}, values: {} };
      }

      let expr: string;
      if (operator === "begins_with") {
        expr = `begins_with(${fieldRef}, ${valueRef})`;
      } else if (operator === "contains") {
        expr = `contains(${fieldRef}, ${valueRef})`;
      } else {
        expr = `${fieldRef} ${operator} ${valueRef}`;
      }

      this.state.filter.expression = this.state.filter.expression
        ? `${this.state.filter.expression} AND ${expr}`
        : expr;
      Object.assign(this.state.filter.names, this.state.context.names);
      Object.assign(this.state.filter.values, this.state.context.values);
    }

    return this;
  }

  /**
   * Select specific fields to return.
   */
  select(...fields: Paths<EntityType<TEntity>>[]): GSIQueryBuilder<TEntity> {
    this.state.projection = fields as string[];
    return this;
  }

  /**
   * Limit the number of items returned.
   */
  limit(count: number): GSIQueryBuilder<TEntity> {
    this.state.limit = count;
    return this;
  }

  /**
   * Set scan direction (default: forward).
   */
  scanIndexForward(forward: boolean): GSIQueryBuilder<TEntity> {
    this.state.scanIndexForward = forward;
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
      DynamoError
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
  async toArray(): Promise<Result<EntityType<TEntity>[], DynamoError>> {
    const items: EntityType<TEntity>[] = [];
    try {
      for await (const item of this.execute()) {
        items.push(item);
      }
      return ok(items);
    } catch (error) {
      return err(
        error instanceof Error ? internalError(error.message) : internalError(String(error))
      );
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

  private buildInput(): QueryCommandInput {
    // Convert values to DynamoDB AttributeValue format
    const expressionValues: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(this.state.context.values)) {
      expressionValues[key] = { S: String(value) };
    }

    const input: QueryCommandInput = {
      TableName: this.table.name,
      IndexName: this.gsiConfig.name,
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
