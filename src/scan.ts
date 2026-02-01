/**
 * Scan builder for DynamoDB scans.
 *
 * Provides a fluent, type-safe API for building and executing scans
 * with support for filters, projections, parallel scans, and pagination.
 */

import {
  DynamoDBClient,
  ScanCommand,
  ScanCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType } from "@/entity";
import type { Table } from "@/table";
import { unmarshalItem } from "@/schema";
import { err, ok, Result } from "@/result";
import { fromAwsError } from "@/errors";
import { executeOperation } from "@/client";
import { FilterBuilder, createFilterBuilder } from "@/filter";
import { ExpressionContext, createExpressionContext } from "@/expressions";

/**
 * Scan builder state.
 */
interface ScanState {
  filter?: {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  };
  projection?: string[];
  indexName?: string;
  limit?: number;
  exclusiveStartKey?: Record<string, AttributeValue>;
  consistentRead?: boolean;
  segment?: number;
  totalSegments?: number;
  context: ExpressionContext;
}

/**
 * Scan builder for a specific entity.
 */
export class ScanBuilder<TEntity extends Entity<any, any, any, any, any>> {
  private state: ScanState;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly table: Table<any, any, any, any>,
    private readonly entity: TEntity
  ) {
    this.state = {
      context: createExpressionContext(),
    };
  }

  /**
   * Add a filter expression.
   */
  where(
    fieldPath: string,
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
  ): ScanBuilder<TEntity> {
    const filterBuilder = createFilterBuilder();
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
  select(...fields: string[]): ScanBuilder<TEntity> {
    this.state.projection = fields;
    return this;
  }

  /**
   * Scan on a GSI.
   */
  usingIndex(indexName: string): ScanBuilder<TEntity> {
    this.state.indexName = indexName;
    return this;
  }

  /**
   * Limit the number of items returned.
   */
  limit(count: number): ScanBuilder<TEntity> {
    this.state.limit = count;
    return this;
  }

  /**
   * Set pagination token.
   */
  exclusiveStartKey(key: Record<string, AttributeValue>): ScanBuilder<TEntity> {
    this.state.exclusiveStartKey = key;
    return this;
  }

  /**
   * Use consistent read.
   */
  consistentRead(consistent: boolean): ScanBuilder<TEntity> {
    this.state.consistentRead = consistent;
    return this;
  }

  /**
   * Configure parallel scan.
   */
  parallelScan(segment: number, totalSegments: number): ScanBuilder<TEntity> {
    this.state.segment = segment;
    this.state.totalSegments = totalSegments;
    return this;
  }

  /**
   * Execute scan and return first page.
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
    const command = new ScanCommand(input);
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
   * Execute scan and return all items (auto-pagination).
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
   * Execute scan and collect all items to array.
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
    const command = new ScanCommand(input);
    const result = await executeOperation(() => this.client.send(command));
    if (result.isErr()) {
      return err(fromAwsError(result.error));
    }
    return ok(result.value.Count || 0);
  }

  private buildInput(): ScanCommandInput {
    const input: ScanCommandInput = {
      TableName: this.table.name,
      ExpressionAttributeNames: this.state.context.names,
      ExpressionAttributeValues: this.state.context.values as Record<string, AttributeValue>,
    };

    if (this.state.filter) {
      input.FilterExpression = this.state.filter.expression;
      Object.assign(input.ExpressionAttributeNames!, this.state.filter.names);
      Object.assign(
        input.ExpressionAttributeValues!,
        this.state.filter.values as Record<string, AttributeValue>
      );
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

    if (this.state.consistentRead !== undefined) {
      input.ConsistentRead = this.state.consistentRead;
    }

    if (this.state.segment !== undefined && this.state.totalSegments !== undefined) {
      input.Segment = this.state.segment;
      input.TotalSegments = this.state.totalSegments;
    }

    return input;
  }
}
