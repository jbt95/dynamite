/**
 * Database builder for creating multi-table DynamoDB instances.
 *
 * Provides a fluent API for:
 * - Registering multiple tables
 * - Adding entities to tables
 * - Building typed repository registry
 *
 * @example
 * ```typescript
 * const db = createDatabase({ client })
 *   .table("main", {
 *     name: "my-app-table",
 *     partitionKey: "PK",
 *     sortKey: "SK",
 *     typeField: "_type"
 *   })
 *   .entities([User, Order])
 *   .table("analytics", {
 *     name: "my-app-analytics",
 *     partitionKey: "PK"
 *   })
 *   .entities([Event, Metric])
 *   .build();
 *
 * // Access repositories directly
 * const user = await db.tables.main.User.get({ id: "123" });
 * const orders = await db.tables.main.Order.query({ userId: "123" }).toArray();
 *
 * // Or use getRepository
 * const userRepo = db.getRepository(User);
 * const user2 = await userRepo.get({ id: "456" });
 * ```
 */

import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { Entity } from "@/entity/types";
import { Repository } from "@/repository";
import type { Table as LegacyTable } from "@/table";
import type {
  Database,
  Table,
  TableConfig,
  TableAccess,
  TableRepositories,
  TableRegistry,
} from "./types";

/**
 * Database builder - entry point for creating typed database instances.
 */
export class DatabaseBuilder<TTables extends readonly Table<any, any, any>[] = readonly []> {
  private tablesMap: Map<string, Table<any, any, any>> = new Map();

  constructor(private readonly client: DynamoDBClient) {}

  /**
   * Register a new table.
   *
   * @param name - Internal name for the table (used in code)
   * @param config - DynamoDB table configuration
   * @returns TableBuilder for adding entities
   *
   * @example
   * ```typescript
   * const db = createDatabase({ client })
   *   .table("main", { name: "my-table", partitionKey: "PK" })
   *   .entities([User, Order])
   *   .build();
   * ```
   */
  table<TName extends string>(
    name: TName,
    config: TableConfig
  ): TableBuilder<TName, TTables, [], this> {
    return new TableBuilder(name, config, this);
  }

  /**
   * @internal Add a table to the registry (called by TableBuilder).
   */
  _addTable<TName extends string, TEntities extends readonly Entity<any, any, any, any, any>[]>(
    name: TName,
    config: TableConfig,
    entities: TEntities
  ): DatabaseBuilder<[...TTables, Table<TName, TableConfig, TEntities>]> {
    const table: Table<TName, TableConfig, TEntities> = {
      name,
      config,
      entities,
      entityMap: new Map(entities.map((e) => [e.name, e])),
    };
    this.tablesMap.set(name, table);
    return this as unknown as DatabaseBuilder<[...TTables, Table<TName, TableConfig, TEntities>]>;
  }

  /**
   * Build the database instance with typed tables and repositories.
   *
   * @returns Database instance with full type inference
   */
  build(): Database<TTables> {
    // Build table registry with repositories
    const tables = {} as TableRegistry<TTables>;
    const allRepositories = new Map<string, Repository<Entity<any, any, any, any, any>>>();
    const entityTableMap = new Map<string, string>();

    for (const [name, table] of this.tablesMap) {
      // Build repositories for this table and store in a map
      const tableRepos: Record<string, Repository<Entity<any, any, any, any, any>>> = {};

      // Transform database Table to legacy Table format expected by Repository
      const legacyTable: LegacyTable<any, any, any, any> = {
        name: table.config.name,
        partitionKey: table.config.partitionKey,
        sortKey: table.config.sortKey,
        typeField: table.config.typeField || "_type",
        entities: table.entities,
        entityMap: table.entityMap,
      };

      for (const entity of table.entities) {
        const repo = new Repository(this.client, legacyTable, entity);
        tableRepos[entity.name] = repo;
        allRepositories.set(entity.name, repo);
        entityTableMap.set(entity.name, name);
      }

      // Create table access with repositories spread directly
      (tables as Record<string, TableAccess<Table<any, any, any>>>)[name] = {
        table: table as any,
        ...tableRepos,
      } as any;
    }

    return {
      client: this.client,
      tables: tables as TableRegistry<TTables>,
      getRepository: (
        tableOrEntity: string | Entity<any, any, any, any, any>,
        entity?: Entity<any, any, any, any, any>
      ) => {
        if (entity) {
          // Two-argument version: getRepository(tableName, entity)
          const tableName = tableOrEntity as string;
          const table = this.tablesMap.get(tableName);
          if (!table) {
            throw new Error(`Table not found: ${tableName}`);
          }
          const foundEntity = table.entities.find(
            (e: Entity<any, any, any, any, any>) => e.name === entity.name
          );
          if (!foundEntity) {
            throw new Error(`Entity ${entity.name} not found in table ${tableName}`);
          }
          return new Repository(this.client, table as any, foundEntity);
        } else {
          // One-argument version: getRepository(entity)
          const entityName = (tableOrEntity as Entity<any, any, any, any, any>).name;
          const repo = allRepositories.get(entityName);
          if (!repo) {
            throw new Error(`Entity not found: ${entityName}`);
          }
          return repo;
        }
      },
      transaction: () => {
        throw new Error("Transaction not yet implemented");
      },
      batch: () => {
        throw new Error("Batch not yet implemented");
      },
    };
  }
}

/**
 * Table builder for adding entities to a table.
 */
class TableBuilder<
  TName extends string,
  TAllTables extends readonly Table<any, any, any>[],
  TCurrentEntities extends readonly Entity<any, any, any, any, any>[],
  TDatabaseBuilder extends DatabaseBuilder<TAllTables>,
> {
  constructor(
    private readonly name: TName,
    private readonly config: TableConfig,
    private readonly dbBuilder: TDatabaseBuilder
  ) {}

  /**
   * Add entities to this table.
   *
   * @param entities - Array of entity definitions
   * @returns DatabaseBuilder for chaining more tables or building
   *
   * @example
   * ```typescript
   * const db = createDatabase({ client })
   *   .table("main", config)
   *   .entities([User, Order, Product])
   *   .table("analytics", analyticsConfig)
   *   .entities([Event])
   *   .build();
   * ```
   */
  entities<TNewEntities extends readonly Entity<any, any, any, any, any>[]>(
    entities: TNewEntities
  ): DatabaseBuilder<[...TAllTables, Table<TName, TableConfig, TNewEntities>]> {
    return this.dbBuilder._addTable(this.name, this.config, entities) as unknown as DatabaseBuilder<
      [...TAllTables, Table<TName, TableConfig, TNewEntities>]
    >;
  }
}

/**
 * Create a new database builder.
 *
 * @param config - Configuration with DynamoDB client
 * @returns DatabaseBuilder for fluent API
 *
 * @example
 * ```typescript
 * import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
 * import { createDatabase } from "dynamite";
 *
 * const client = new DynamoDBClient({ region: "us-east-1" });
 * const db = createDatabase({ client })
 *   .table("main", { name: "my-table", partitionKey: "PK" })
 *   .entities([User, Order])
 *   .build();
 * ```
 */
export function createDatabase(config: { client: DynamoDBClient }): DatabaseBuilder<[]> {
  return new DatabaseBuilder(config.client);
}

// Re-export types
export type {
  Database,
  Table,
  TableConfig,
  TableAccess,
  TableRepositories,
  TableRegistry,
  TransactionBuilder,
  BatchBuilder,
} from "./types";
