/**
 * Collection query builder for multi-entity queries.
 *
 * Enables querying multiple entity types in a single DynamoDB query
 * by partition key, then automatically unmarshalling each entity
 * into its correct type.
 */

import {
  DynamoDBClient,
  QueryCommand,
  QueryCommandInput,
  AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType } from "@/entity/types";
import type { Table } from "@/table";
import { unmarshalItem } from "@/schema";
import { err, ok, Result } from "@/result";
import { fromAwsError, DynamoError } from "@/errors";
import { executeOperation } from "@/client";
import {
  ExpressionContext,
  createExpressionContext,
  addAttributeName,
  addAttributeValue,
} from "@/expressions";

/**
 * Collection query state.
 */
interface CollectionQueryState {
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
 * Collection query builder for fetching multiple entity types.
 */
export class CollectionQueryBuilder<TEntities extends readonly Entity<any, any, any, any, any>[]> {
  private state: CollectionQueryState;
  private entityMap: Map<string, Entity<any, any, any, any, any>>;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly table: Table<any, any, any, any>,
    private readonly entities: TEntities,
    partitionKeyValue: string
  ) {
    const context = createExpressionContext();
    const pkRef = addAttributeValue(context, partitionKeyValue);
    const pkName = addAttributeName(context, this.table.partitionKey);
    const keyCondition = `${pkName} = ${pkRef}`;

    this.state = {
      keyCondition,
      context,
    };

    // Build entity lookup map
    this.entityMap = new Map(entities.map((e) => [e.name, e]));
  }

  /**
   * Add a sort key begins_with condition.
   */
  sortKeyBeginsWith(prefix: string): CollectionQueryBuilder<TEntities> {
    const skRef = addAttributeValue(this.state.context, prefix);
    const skName = addAttributeName(this.state.context, this.table.sortKey!);
    this.state.keyCondition += ` AND begins_with(${skName}, ${skRef})`;
    return this;
  }

  /**
   * Add a sort key between condition.
   */
  sortKeyBetween(start: string, end: string): CollectionQueryBuilder<TEntities> {
    const startRef = addAttributeValue(this.state.context, start);
    const endRef = addAttributeValue(this.state.context, end);
    const skName = addAttributeName(this.state.context, this.table.sortKey!);
    this.state.keyCondition += ` AND ${skName} BETWEEN ${startRef} AND ${endRef}`;
    return this;
  }

  /**
   * Limit the number of items returned.
   */
  limit(count: number): CollectionQueryBuilder<TEntities> {
    this.state.limit = count;
    return this;
  }

  /**
   * Set scan direction (default: forward).
   */
  scanIndexForward(forward: boolean): CollectionQueryBuilder<TEntities> {
    this.state.scanIndexForward = forward;
    return this;
  }

  /**
   * Use consistent read.
   */
  consistentRead(consistent: boolean): CollectionQueryBuilder<TEntities> {
    this.state.consistentRead = consistent;
    return this;
  }

  /**
   * Execute query and return typed results grouped by entity.
   */
  async execute(): Promise<
    Result<
      {
        [K in TEntities[number] as K["name"]]: EntityType<K>[];
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

    // Initialize result object with empty arrays for each entity
    const groupedResults = {} as {
      [K in TEntities[number] as K["name"]]: EntityType<K>[];
    };

    for (const entity of this.entities) {
      (groupedResults as Record<string, EntityType<typeof entity>[]>)[entity.name] = [];
    }

    // Process and group items by entity type
    for (const item of result.value.Items || []) {
      const typeField = this.table.typeField || "_type";
      const entityName = item[typeField]?.S;

      if (!entityName) {
        continue; // Skip items without type field
      }

      const entity = this.entityMap.get(entityName);
      if (!entity) {
        continue; // Skip unknown entity types
      }

      const unmarshalled = unmarshalItem(entity.schema, item);
      if (unmarshalled.isErr()) {
        return err(unmarshalled.error);
      }

      (groupedResults as Record<string, EntityType<typeof entity>[]>)[entityName].push(
        unmarshalled.value as EntityType<typeof entity>
      );
    }

    return ok(groupedResults);
  }

  /**
   * Execute query and return all items as a flat array with entity type info.
   */
  async toArray(): Promise<
    Result<
      Array<
        {
          [K in TEntities[number] as K["name"]]: {
            entity: K["name"];
            data: EntityType<K>;
          };
        }[TEntities[number]["name"]]
      >,
      DynamoError
    >
  > {
    const groupedResult = await this.execute();
    if (groupedResult.isErr()) {
      return err(groupedResult.error);
    }

    const flat: Array<{ entity: string; data: unknown }> = [];

    for (const [entityName, items] of Object.entries(groupedResult.value)) {
      for (const item of items as unknown[]) {
        flat.push({ entity: entityName, data: item });
      }
    }

    return ok(
      flat as ReturnType<typeof this.toArray> extends Promise<Result<infer R, any>> ? R : never
    );
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
