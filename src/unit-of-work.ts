/**
 * Unit of Work pattern for change tracking and compensating transactions.
 *
 * Tracks entity changes, detects modifications, and provides
 * rollback capability through compensating transactions.
 */

import type { Entity, EntityType } from "@/entity";
import type { Table } from "@/table";
import { marshalItem } from "@/schema";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { err, ok, Result } from "@/result";
import { fromAwsError, DynamoError } from "@/errors";
import { TransactionManager, TransactionBuilder } from "@/transaction";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { extractKeyFields } from "@/keys";

/**
 * Entity state in the unit of work.
 */
export type EntityState = "clean" | "new" | "modified" | "deleted";

/**
 * Tracked entity with state and snapshot.
 */
interface TrackedEntity<T extends Entity<any, any, any, any>> {
  entity: T;
  current: EntityType<T>;
  snapshot: EntityType<T>;
  state: EntityState;
  identity: string;
}

/**
 * Compensating action to undo a committed change.
 */
interface CompensatingAction {
  type: "put" | "delete";
  table: string;
  item?: Record<string, AttributeValue>;
  key?: Record<string, AttributeValue>;
}

/**
 * Unit of Work for tracking and committing entity changes.
 */
export class UnitOfWork {
  private tracked = new Map<string, TrackedEntity<Entity<any, any, any, any>>>();
  private compensatingActions: CompensatingAction[] = [];

  constructor(
    private readonly table: Table<any, any, any, any>,
    private readonly transactionManager: TransactionManager
  ) {}

  /**
   * Begin tracking an existing entity.
   */
  track<T extends Entity<any, any, any, any>>(
    entity: T,
    data: EntityType<T>
  ): Result<EntityType<T>, Error> {
    const identity = this.getIdentity(entity, data);
    const existing = this.tracked.get(identity);

    if (existing) {
      // Update existing tracked entity
      existing.current = data;
      existing.state = this.detectState(existing as any);
      return ok(existing.current as EntityType<T>);
    }

    // Create new tracked entity
    const tracked: TrackedEntity<T> = {
      entity: entity,
      current: data,
      snapshot: this.deepClone(data),
      state: "clean",
      identity,
    };

    this.tracked.set(identity, tracked as any);
    return ok(data);
  }

  /**
   * Register a new entity for insert.
   */
  markNew<T extends Entity<any, any, any, any>>(
    entity: T,
    data: EntityType<T>
  ): Result<EntityType<T>, Error> {
    const identity = this.getIdentity(entity, data);
    const existing = this.tracked.get(identity);

    if (existing) {
      if (existing.state === "deleted") {
        // Resurrect deleted entity
        existing.current = data;
        existing.snapshot = this.deepClone(data);
        existing.state = "modified";
        return ok(existing.current as EntityType<T>);
      }
      return err(new Error(`Entity already tracked: ${identity}`));
    }

    const tracked: TrackedEntity<T> = {
      entity: entity,
      current: data,
      snapshot: this.deepClone(data),
      state: "new",
      identity,
    };

    this.tracked.set(identity, tracked as any);
    return ok(data);
  }

  /**
   * Mark an entity for deletion.
   */
  markDeleted<T extends Entity<any, any, any, any>>(
    entity: T,
    key: T["_pk"] extends infer U ? U : never
  ): Result<void, Error> {
    const identity = this.getIdentity(entity, key as any);
    const existing = this.tracked.get(identity);

    if (existing) {
      if (existing.state === "new") {
        // Remove new entity entirely
        this.tracked.delete(identity);
        return ok(undefined);
      }
      existing.state = "deleted";
      return ok(undefined);
    }

    // Track as deleted (entity not previously tracked)
    // Store the key data in current so computeChangeSet can build the delete key
    const tracked: TrackedEntity<T> = {
      entity: entity,
      current: key as EntityType<T>,
      snapshot: key as EntityType<T>,
      state: "deleted",
      identity,
    };

    this.tracked.set(identity, tracked as any);
    return ok(undefined);
  }

  /**
   * Stop tracking an entity.
   */
  detach(identity: string): void {
    this.tracked.delete(identity);
  }

  /**
   * Clear all tracking.
   */
  clear(): void {
    this.tracked.clear();
    this.compensatingActions = [];
  }

  /**
   * Commit all changes as a transaction.
   */
  async commit(): Promise<Result<void, DynamoError>> {
    // Update state for all tracked entities before computing changes
    for (const tracked of this.tracked.values()) {
      if (tracked.state === "clean") {
        tracked.state = this.detectState(tracked);
      }
    }

    const changes = this.computeChangeSet();
    if (changes.length === 0) {
      return ok(undefined);
    }

    // Build compensating actions before commit
    this.buildCompensatingActions(changes);

    // Execute transaction
    const builder = new TransactionBuilder();
    for (const change of changes) {
      switch (change.type) {
        case "put":
          builder.put(this.table.name, change.item);
          break;
        case "delete":
          builder.delete(this.table.name, change.key);
          break;
      }
    }

    const transaction = builder.build();

    // Handle batching if needed
    if (transaction.TransactItems && transaction.TransactItems.length > 25) {
      return err(
        fromAwsError(
          new Error(
            `Transaction exceeds 25 items (${transaction.TransactItems.length}). Use batch operations or split into multiple transactions.`
          )
        )
      );
    }

    const result = await this.transactionManager.execute(transaction);
    if (result.isErr()) {
      return err(fromAwsError(result.error));
    }

    // Update tracking state on success
    for (const tracked of this.tracked.values()) {
      if (tracked.state === "new" || tracked.state === "modified") {
        tracked.snapshot = this.deepClone(tracked.current);
        tracked.state = "clean";
      } else if (tracked.state === "deleted") {
        this.tracked.delete(tracked.identity);
      }
    }

    this.compensatingActions = [];
    return ok(undefined);
  }

  /**
   * Rollback changes (pre-commit: reset state, post-commit: execute compensating transaction).
   */
  async rollback(): Promise<Result<void, DynamoError>> {
    // Pre-commit rollback: reset in-memory state
    for (const tracked of this.tracked.values()) {
      if (tracked.state === "modified" || tracked.state === "new") {
        tracked.current = this.deepClone(tracked.snapshot);
        tracked.state = tracked.state === "new" ? "new" : "clean";
      } else if (tracked.state === "deleted") {
        // Restore deleted entity
        tracked.state = "clean";
      }
    }

    // Post-commit rollback: execute compensating transaction if actions exist
    if (this.compensatingActions.length > 0) {
      const builder = new TransactionBuilder();
      for (const action of this.compensatingActions) {
        if (action.type === "put" && action.item) {
          builder.put(action.table, action.item);
        } else if (action.type === "delete" && action.key) {
          builder.delete(action.table, action.key);
        }
      }

      const transaction = builder.build();
      const result = await this.transactionManager.execute(transaction);
      if (result.isErr()) {
        return err(fromAwsError(result.error));
      }
    }

    this.compensatingActions = [];
    return ok(undefined);
  }

  /**
   * Get entity identity string.
   */
  private getIdentity<T extends Entity<any, any, any, any>>(
    entity: T,
    data: Partial<EntityType<T>>
  ): string {
    const pkFields = extractKeyFields(entity.partitionKey, data as any);
    if (pkFields.isErr()) {
      throw pkFields.error;
    }
    const pk = buildPartitionKey(entity, pkFields.value as any);
    if (entity.sortKey) {
      const skFields = extractKeyFields(entity.sortKey, data as any);
      if (skFields.isOk()) {
        const skResult = buildSortKey(entity, skFields.value as any);
        if (skResult.isOk()) {
          return `${entity.name}#${pk}#${skResult.value}`;
        }
      }
    }
    return `${entity.name}#${pk}`;
  }

  /**
   * Detect entity state based on changes.
   */
  private detectState<T extends Entity<any, any, any, any>>(
    tracked: TrackedEntity<T>
  ): EntityState {
    if (tracked.state === "deleted") {
      return "deleted";
    }
    if (tracked.state === "new") {
      return "new";
    }
    // Check if modified
    if (!this.deepEqual(tracked.current, tracked.snapshot)) {
      return "modified";
    }
    return "clean";
  }

  /**
   * Compute change set from tracked entities.
   */
  private computeChangeSet(): Array<
    | { type: "put"; item: Record<string, AttributeValue> }
    | { type: "delete"; key: Record<string, AttributeValue> }
  > {
    const changes: Array<
      | { type: "put"; item: Record<string, AttributeValue> }
      | { type: "delete"; key: Record<string, AttributeValue> }
    > = [];

    for (const tracked of this.tracked.values()) {
      if (tracked.state === "new" || tracked.state === "modified") {
        const marshalled = marshalItem(tracked.entity.schema, tracked.current);
        if (marshalled.isOk()) {
          const item = marshalled.value.M!;
          const pkFields = extractKeyFields(
            tracked.entity.partitionKey,
            tracked.current as Record<string, unknown>
          );
          if (pkFields.isOk()) {
            item[this.table.partitionKey] = {
              S: buildPartitionKey(tracked.entity as any, pkFields.value as any),
            };
            if (tracked.entity.sortKey) {
              const skFields = extractKeyFields(
                tracked.entity.sortKey,
                tracked.current as Record<string, unknown>
              );
              if (skFields.isOk()) {
                const skResult = buildSortKey(tracked.entity as any, skFields.value as any);
                if (skResult.isOk()) {
                  item[this.table.sortKey!] = { S: skResult.value };
                }
              }
            } else if (this.table.sortKey) {
              // Table has sort key but entity doesn't - use default value
              item[this.table.sortKey] = { S: tracked.entity.name };
            }
            changes.push({ type: "put", item });
          }
        }
      } else if (tracked.state === "deleted") {
        const pkFields = extractKeyFields(
          tracked.entity.partitionKey,
          tracked.current as Record<string, unknown>
        );
        if (pkFields.isOk()) {
          const key: Record<string, AttributeValue> = {
            [this.table.partitionKey]: {
              S: buildPartitionKey(tracked.entity as any, pkFields.value as any),
            },
          };
          if (tracked.entity.sortKey && tracked.current) {
            const skFields = extractKeyFields(
              tracked.entity.sortKey,
              tracked.current as Record<string, unknown>
            );
            if (skFields.isOk()) {
              const skResult = buildSortKey(tracked.entity as any, skFields.value as any);
              if (skResult.isOk()) {
                key[this.table.sortKey!] = { S: skResult.value };
              }
            }
          } else if (this.table.sortKey) {
            // Table has sort key but entity doesn't - use default value
            key[this.table.sortKey] = { S: tracked.entity.name };
          }
          changes.push({ type: "delete", key });
        }
      }
    }

    return changes;
  }

  /**
   * Build compensating actions for rollback.
   */
  private buildCompensatingActions(
    changes: Array<
      | { type: "put"; item: Record<string, AttributeValue> }
      | { type: "delete"; key: Record<string, AttributeValue> }
    >
  ): void {
    this.compensatingActions = [];

    for (const tracked of this.tracked.values()) {
      if (tracked.state === "new") {
        // Compensate: delete the new item
        const pkFields = extractKeyFields(
          tracked.entity.partitionKey,
          tracked.current as Record<string, unknown>
        );
        if (pkFields.isOk()) {
          const key: Record<string, AttributeValue> = {
            [this.table.partitionKey]: {
              S: buildPartitionKey(tracked.entity as any, pkFields.value as any),
            },
            [this.table.typeField]: { S: tracked.entity.name },
          };
          if (tracked.entity.sortKey) {
            const skFields = extractKeyFields(
              tracked.entity.sortKey,
              tracked.current as Record<string, unknown>
            );
            if (skFields.isOk()) {
              const skResult = buildSortKey(tracked.entity as any, skFields.value as any);
              if (skResult.isOk()) {
                key[this.table.sortKey!] = { S: skResult.value };
              }
            }
          }
          this.compensatingActions.push({ type: "delete", table: this.table.name, key });
        }
      } else if (tracked.state === "modified") {
        // Compensate: restore original item
        const marshalled = marshalItem(tracked.entity.schema, tracked.snapshot);
        if (marshalled.isOk()) {
          const item = marshalled.value.M!;
          const pkFields = extractKeyFields(
            tracked.entity.partitionKey,
            tracked.snapshot as Record<string, unknown>
          );
          if (pkFields.isOk()) {
            item[this.table.partitionKey] = {
              S: buildPartitionKey(tracked.entity as any, pkFields.value as any),
            };
            if (tracked.entity.sortKey) {
              const skFields = extractKeyFields(
                tracked.entity.sortKey,
                tracked.snapshot as Record<string, unknown>
              );
              if (skFields.isOk()) {
                const skResult = buildSortKey(tracked.entity as any, skFields.value as any);
                if (skResult.isOk()) {
                  item[this.table.sortKey!] = { S: skResult.value };
                }
              }
            } else if (this.table.sortKey) {
              // Table has sort key but entity doesn't - use default value
              item[this.table.sortKey] = { S: tracked.entity.name };
            }
            this.compensatingActions.push({ type: "put", table: this.table.name, item });
          }
        }
      } else if (tracked.state === "deleted") {
        // Compensate: restore deleted item
        const marshalled = marshalItem(tracked.entity.schema, tracked.snapshot);
        if (marshalled.isOk()) {
          const item = marshalled.value.M!;
          const pkFields = extractKeyFields(
            tracked.entity.partitionKey,
            tracked.snapshot as Record<string, unknown>
          );
          if (pkFields.isOk()) {
            item[this.table.partitionKey] = {
              S: buildPartitionKey(tracked.entity as any, pkFields.value as any),
            };
            item[this.table.typeField] = { S: tracked.entity.name };
            if (tracked.entity.sortKey) {
              const skFields = extractKeyFields(
                tracked.entity.sortKey,
                tracked.snapshot as Record<string, unknown>
              );
              if (skFields.isOk()) {
                const skResult = buildSortKey(tracked.entity as any, skFields.value as any);
                if (skResult.isOk()) {
                  item[this.table.sortKey!] = { S: skResult.value };
                }
              }
            }
            this.compensatingActions.push({ type: "put", table: this.table.name, item });
          }
        }
      }
    }
  }

  /**
   * Deep clone an object.
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Deep equality check.
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

// Helper function - use imported extractKeyFields
