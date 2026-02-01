/**
 * Entity definition for single-table design.
 *
 * Entities are discriminated by name and have associated schemas,
 * partition keys, and optional sort keys and GSI keys.
 */

import type { AttributeShape, InferShape, SchemaDef } from "@/schema";
import type { KeyDefinition, KeyTemplate, KeyType } from "@/keys";
import { buildKey, createKey } from "@/keys";
import { err, ok, Result } from "@/result";

export type EntityAttributes = AttributeShape;

export type EntityData<TAttributes extends EntityAttributes> = InferShape<TAttributes>;

export type EntityKeyInput<
  TAttributes extends EntityAttributes,
  TKey extends KeyDefinition,
> = KeyType<KeyTemplate<TAttributes, TKey, any>>;

export interface GSIKey<
  TAttributes extends EntityAttributes = EntityAttributes,
  TPk extends KeyDefinition<keyof TAttributes & string> = KeyDefinition<keyof TAttributes & string>,
  TSk extends KeyDefinition<keyof TAttributes & string> | undefined = undefined,
> {
  readonly name: string;
  readonly partitionKey: KeyTemplate<TAttributes, TPk, any>;
  readonly sortKey?: KeyTemplate<TAttributes, KeyDefinition<keyof TAttributes & string>, any>;
  readonly projection: "ALL" | "KEYS_ONLY" | "INCLUDE";
  readonly nonKeyAttributes?: string[];
}

export interface Entity<
  TName extends string = string,
  TAttributes extends EntityAttributes = EntityAttributes,
  TData = EntityData<TAttributes>,
  TPkData = any,
  TSkData = any,
> {
  readonly name: TName;
  readonly schema: SchemaDef;
  readonly partitionKey: KeyTemplate<
    TAttributes,
    KeyDefinition<keyof TAttributes & string>,
    TPkData
  >;
  readonly sortKey?: KeyTemplate<TAttributes, KeyDefinition<keyof TAttributes & string>, TSkData>;
  readonly gsiKeys?: GSIKey<TAttributes, any, any>[];
  readonly attributes: TAttributes;
  /** @internal Phantom type for data shape inference */
  readonly _data: TData;
  /** @internal Phantom type for partition key inference */
  readonly _pk: TPkData;
  /** @internal Phantom type for sort key inference */
  readonly _sk?: TSkData;
}

export type EntityType<T extends Entity<any, any, any, any, any>> = NonNullable<T["_data"]>;

export interface GSIConfig<TAttributes extends EntityAttributes> {
  readonly pk: KeyDefinition<keyof TAttributes & string>;
  readonly sk?: KeyDefinition<keyof TAttributes & string>;
  readonly projection: "ALL" | "KEYS_ONLY" | "INCLUDE";
  readonly nonKeyAttributes?: string[];
}

/**
 * Build partition key for an entity.
 */
export function buildPartitionKey<T extends Entity<any, any, any, any, any>>(
  entity: T,
  values: T["_pk"] extends infer U ? U : never
): string {
  return buildKey(entity.partitionKey, values as any);
}

/**
 * Build sort key for an entity (if defined).
 */
export function buildSortKey<T extends Entity<any, any, any, any, any>>(
  entity: T,
  values: T["_sk"] extends infer U ? U : never
): Result<string, Error> {
  if (!entity.sortKey) {
    return err(new Error(`Entity ${entity.name} does not have a sort key`));
  }
  return ok(buildKey(entity.sortKey, values as any));
}

/**
 * Build GSI key for an entity.
 */
export function buildGSIKey(
  entity: Entity<string, EntityAttributes, EntityData<EntityAttributes>>,
  gsiName: string,
  pkValues: Record<string, unknown>,
  skValues?: Record<string, unknown>
): Result<{ pk: string; sk?: string }, Error> {
  if (!entity.gsiKeys) {
    return err(new Error(`Entity ${entity.name} does not have GSI keys`));
  }
  const gsi = entity.gsiKeys.find((k) => k.name === gsiName);
  if (!gsi) {
    return err(new Error(`GSI ${gsiName} not found for entity ${entity.name}`));
  }
  const pk = buildKey(gsi.partitionKey, pkValues as never);
  if (gsi.sortKey && skValues) {
    const sk = buildKey(gsi.sortKey, skValues as never);
    return ok({ pk, sk });
  }
  return ok({ pk });
}
