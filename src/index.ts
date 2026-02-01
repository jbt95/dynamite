/**
 * Dynamite - Type-safe DynamoDB Library
 *
 * A type-safe, developer-friendly DynamoDB library with first-class support
 * for single-table design, multi-table operations, transactions, and more.
 *
 * @example
 * ```typescript
 * import { createDatabase, entity, S } from "dynamite";
 *
 * const User = entity("User", {
 *   id: S.string,
 *   email: S.string,
 *   name: S.string,
 * }).partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
 *   .build();
 *
 * const db = createDatabase({ client })
 *   .table("main", { name: "my-table", partitionKey: "PK" })
 *   .entities([User])
 *   .build();
 *
 * const user = await db.tables.main.User.get({ id: "123" });
 * ```
 */

// Result monad and error handling
export { Result, Ok, Err, ok, err, isOk, isErr, tryCatch, collect, traverse } from "@/result";

export {
  DynamoError,
  DynamoErrorCode,
  notFoundError,
  conditionFailedError,
  transactionCancelledError,
  validationError,
  throughputExceededError,
  internalError,
  fromAwsError,
} from "@/errors";

// Schema definition and type inference
export {
  S,
  marshalItem,
  unmarshalItem,
  type SchemaDef,
  type InferType,
  type InferShape,
  type AttributeShape,
} from "@/schema";

// Key templates
export {
  createKey,
  buildKey,
  parseKey,
  extractKeyFields,
  type KeyTemplate,
  type KeyDefinition,
  type KeyPart,
  type KeyPartAttr,
  type KeyPartLiteral,
} from "@/keys";

// Entity definition
export {
  buildPartitionKey,
  buildSortKey,
  buildGSIKey,
  type Entity,
  type EntityType,
  type GSIKey,
  type EntityAttributes,
} from "@/entity";

// Table definition
export { resolveEntity, getEntity, type Table } from "@/table";

// Client
export { createClient, executeOperation, type ClientConfig } from "@/client";

// Repository
export { Repository } from "@/repository";

// Query builder
export { QueryBuilder } from "@/query";

// Scan builder
export { ScanBuilder } from "@/scan";

// Update expressions
export { UpdateExpressionBuilder } from "@/update";

// Transactions
export { TransactionBuilder, TransactionManager, type TransactionOperation } from "@/transaction";

// Unit of Work
export { UnitOfWork, type EntityState } from "@/unit-of-work";

// Hooks
export {
  HookRegistry,
  runHooks,
  type HookPhase,
  type HookContext,
  type HookResult,
  type HookFunction,
  type OperationType,
} from "@/hooks";

// Testing utilities
export {
  createInMemoryTable,
  createMockClient,
  seedEntity,
  clearTable,
  getAllItems,
  getItem,
  type InMemoryTable,
  type MockClientConfig,
} from "@/testing-utils";

// Expression utilities (internal, but exported for advanced use)
export {
  createExpressionContext,
  addAttributeName,
  addAttributeValue,
  buildComparison,
  buildLogical,
  type ExpressionContext,
  type ComparisonOperator,
  type LogicalOperator,
} from "@/expressions";

// Filter builder (internal, but exported for advanced use)
export { FilterBuilder, createFilterBuilder } from "@/filter";

// ============================================
// NEW API - Database with multi-table support
// ============================================

// New simplified entity() function
export { entity } from "@/entity/builder";

// New entity types
export type { EntityPK, EntitySK, EntityGSIs } from "@/entity/types";

// Database builder and types
export { createDatabase, DatabaseBuilder } from "@/database/builder";

export type {
  Database,
  TableConfig,
  TableAccess,
  TableRepositories,
  TableRegistry,
  BatchBuilder,
} from "@/database/types";

// Note: Table and TransactionBuilder types are exported from legacy modules
// The new Database API uses different type definitions for these

// Core path utilities
export type { Paths, PathValue, LeafPaths, Prettify } from "@/core/paths";
