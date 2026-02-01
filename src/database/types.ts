/**
 * Database types for multi-table DynamoDB operations.
 *
 * Provides type definitions for:
 * - Table configuration and registry
 * - Repository mapping per table
 * - Database operations (transaction, batch)
 */

import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Entity, EntityType, EntityPK, EntitySK } from "@/entity/types";
import type { QueryBuilder } from "@/query";
import type { ScanBuilder } from "@/scan";
import type { Repository } from "@/repository";
import type { Result } from "@/result";

/**
 * Table configuration.
 */
export interface TableConfig {
  /** DynamoDB table name */
  name: string;
  /** Partition key attribute name */
  partitionKey: string;
  /** Sort key attribute name (optional) */
  sortKey?: string;
  /** Type discriminator field name */
  typeField?: string;
}

/**
 * Table definition with typed entities.
 */
export interface Table<
  TName extends string = string,
  TConfig extends TableConfig = TableConfig,
  TEntities extends readonly Entity<any, any, any, any, any>[] = readonly Entity<
    any,
    any,
    any,
    any,
    any
  >[],
> {
  /** Table name */
  readonly name: TName;
  /** Table configuration */
  readonly config: TConfig;
  /** Registered entities for this table */
  readonly entities: TEntities;
  /** Entity lookup map */
  readonly entityMap: Map<string, Entity<any, any, any, any, any>>;
}

/**
 * Repository registry - maps entity names to Repository instances.
 */
export type TableRepositories<TEntities extends readonly Entity<any, any, any, any, any>[]> = {
  [K in TEntities[number] as K["name"]]: Repository<K>;
};

/**
 * Table access interface - provides repositories and query builders.
 * Repositories are directly accessible by entity name.
 */
export type TableAccess<TTable extends Table<any, any, any>> = TableRepositories<
  TTable["entities"]
> & {
  /** Table definition */
  readonly table: TTable;
};

/**
 * Table registry - maps table names to TableAccess.
 */
export type TableRegistry<TTables extends readonly Table<any, any, any>[]> = {
  [K in TTables[number] as K["name"]]: TableAccess<K>;
};

/**
 * Database instance with multi-table support.
 */
export interface Database<
  TTables extends readonly Table<any, any, any>[] = readonly Table<any, any, any>[],
> {
  /** DynamoDB client instance */
  readonly client: DynamoDBClient;
  /** Table registry with typed access */
  readonly tables: TableRegistry<TTables>;

  /**
   * Get a repository for a specific entity.
   * When tableName is not provided, searches all tables for the entity.
   *
   * @param entity - The entity definition
   * @returns Repository for the entity
   */
  getRepository<TEntity extends TTables[number]["entities"][number]>(
    entity: TEntity
  ): Repository<TEntity>;

  /**
   * Get a repository for a specific entity from a specific table.
   *
   * @param tableName - The table name
   * @param entity - The entity definition
   * @returns Repository for the entity
   */
  getRepository<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity
  ): Repository<TEntity>;

  /**
   * Create a transaction builder for cross-table transactions.
   */
  transaction(): TransactionBuilder<TTables>;

  /**
   * Create a batch builder for efficient bulk operations.
   */
  batch(): BatchBuilder<TTables>;
}

/**
 * Transaction operation types.
 */
export type TransactionOperation =
  | { type: "put"; table: string; entity: string; item: unknown; condition?: unknown }
  | {
      type: "update";
      table: string;
      entity: string;
      key: unknown;
      updates: unknown;
      condition?: unknown;
    }
  | { type: "delete"; table: string; entity: string; key: unknown; condition?: unknown }
  | { type: "conditionCheck"; table: string; entity: string; key: unknown; condition: unknown };

/**
 * Transaction builder for type-safe multi-item transactions.
 */
export interface TransactionBuilder<TTables extends readonly Table<any, any, any>[]> {
  /**
   * Add a put operation.
   */
  put<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity,
    item: EntityType<TEntity>,
    options?: { condition?: ConditionExpression<TEntity> }
  ): TransactionBuilder<TTables>;

  /**
   * Add an update operation.
   */
  update<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity,
    key: EntityPK<TEntity> & (EntitySK<TEntity> extends undefined ? {} : EntitySK<TEntity>),
    updates: (builder: UpdateBuilder<EntityType<TEntity>>) => UpdateBuilder<EntityType<TEntity>>,
    options?: { condition?: ConditionExpression<TEntity> }
  ): TransactionBuilder<TTables>;

  /**
   * Add a delete operation.
   */
  delete<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity,
    key: EntityPK<TEntity> & (EntitySK<TEntity> extends undefined ? {} : EntitySK<TEntity>),
    options?: { condition?: ConditionExpression<TEntity> }
  ): TransactionBuilder<TTables>;

  /**
   * Add a condition check.
   */
  condition<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity,
    key: EntityPK<TEntity> & (EntitySK<TEntity> extends undefined ? {} : EntitySK<TEntity>),
    condition: ConditionExpression<TEntity>
  ): TransactionBuilder<TTables>;

  /**
   * Execute the transaction.
   */
  execute(): Promise<Result<void, Error>>;
}

/**
 * Batch builder for efficient bulk operations.
 */
export interface BatchBuilder<TTables extends readonly Table<any, any, any>[]> {
  /**
   * Add put operations.
   */
  put<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity,
    items: EntityType<TEntity>[] | EntityType<TEntity>
  ): BatchBuilder<TTables>;

  /**
   * Add delete operations.
   */
  delete<TTable extends TTables[number], TEntity extends TTable["entities"][number]>(
    tableName: TTable["name"],
    entity: TEntity,
    keys: (EntityPK<TEntity> & (EntitySK<TEntity> extends undefined ? {} : EntitySK<TEntity>))[]
  ): BatchBuilder<TTables>;

  /**
   * Execute the batch.
   */
  execute(): Promise<Result<void, Error>>;
}

/**
 * Condition expression builder type.
 */
export type ConditionExpression<TEntity extends Entity<any, any, any, any, any>> = (
  builder: ConditionBuilder<EntityType<TEntity>>
) => ConditionBuilder<EntityType<TEntity>>;

/**
 * Update expression builder (placeholder - imported from update module).
 */
export interface UpdateBuilder<TData> {
  set<K extends keyof TData>(field: K, value: TData[K]): UpdateBuilder<TData>;
  increment<K extends keyof TData>(field: K, amount: number): UpdateBuilder<TData>;
  decrement<K extends keyof TData>(field: K, amount: number): UpdateBuilder<TData>;
  append<K extends keyof TData>(field: K, values: unknown[]): UpdateBuilder<TData>;
  remove<K extends keyof TData>(field: K): UpdateBuilder<TData>;
}

/**
 * Condition builder (placeholder - will be defined in conditions module).
 */
export interface ConditionBuilder<TData> {
  where<K extends keyof TData>(
    field: K,
    operator: "=" | "<>" | "<" | "<=" | ">" | ">=" | "begins_with" | "contains",
    value: TData[K]
  ): ConditionBuilder<TData>;
  and(): ConditionBuilder<TData>;
  or(): ConditionBuilder<TData>;
  not(): ConditionBuilder<TData>;
  exists<K extends keyof TData>(field: K): ConditionBuilder<TData>;
}
