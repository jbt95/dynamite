/**
 * Entity type definitions with full type inference support.
 *
 * Entities are the core data model in dynamite, representing
 * typed objects that can be stored and retrieved from DynamoDB.
 */

import type { SchemaDef, AttributeShape, InferShape } from "@/schema";
import type { KeyDefinition, KeyTemplate, KeyType } from "@/keys";

/**
 * Entity attributes shape - record of schema definitions.
 */
export type EntityAttributes = AttributeShape;

/**
 * Infer TypeScript data type from entity attributes.
 */
export type EntityData<TAttributes extends EntityAttributes> = InferShape<TAttributes>;

/**
 * GSI (Global Secondary Index) key definition.
 */
export interface GSIKey<
  TAttributes extends EntityAttributes = EntityAttributes,
  TPk extends KeyDefinition<keyof TAttributes & string> = KeyDefinition<keyof TAttributes & string>,
  TSk extends KeyDefinition<keyof TAttributes & string> | undefined = undefined,
  TPkData = any,
  TSkData = any,
> {
  readonly name: string;
  readonly partitionKey: KeyTemplate<TAttributes, TPk, TPkData>;
  readonly sortKey?: KeyTemplate<TAttributes, KeyDefinition<keyof TAttributes & string>, TSkData>;
  readonly projection: "ALL" | "KEYS_ONLY" | "INCLUDE";
  readonly nonKeyAttributes?: string[];
}

/**
 * Entity definition with full type parameters.
 *
 * @template TName - Entity name (string literal)
 * @template TAttributes - Schema definition object
 * @template TData - Inferred TypeScript data type
 * @template TPkData - Partition key input type
 * @template TSkData - Sort key input type
 */
export interface Entity<
  TName extends string = string,
  TAttributes extends EntityAttributes = EntityAttributes,
  TData = EntityData<TAttributes>,
  TPkData = any,
  TSkData = any,
> {
  // Core properties
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

  // Phantom type properties for type inference (not actual runtime values)
  /** @internal Phantom type for data shape inference */
  readonly _data: TData;
  /** @internal Phantom type for partition key inference */
  readonly _pk: TPkData;
  /** @internal Phantom type for sort key inference */
  readonly _sk?: TSkData;
}

/**
 * Extract the TypeScript data type from an entity.
 *
 * @example
 * const User = entity("User", { id: S.string() }).build();
 * type UserType = EntityType<typeof User>; // { id: string }
 */
export type EntityType<T extends Entity<any, any, any, any, any>> = T["_data"];

/**
 * Extract the partition key input type from an entity.
 *
 * @example
 * type UserPK = EntityPK<typeof User>; // { id: string }
 */
export type EntityPK<T extends Entity<any, any, any, any, any>> = T["_pk"];

/**
 * Extract the sort key input type from an entity.
 * Returns undefined if entity has no sort key.
 *
 * @example
 * type UserSK = EntitySK<typeof User>; // { orderId: string } | undefined
 */
export type EntitySK<T extends Entity<any, any, any, any, any>> = T["_sk"];

/**
 * Configuration for adding a GSI to an entity.
 */
export interface GSIConfig<TAttributes extends EntityAttributes> {
  readonly pk: KeyDefinition<keyof TAttributes & string>;
  readonly sk?: KeyDefinition<keyof TAttributes & string>;
  readonly projection: "ALL" | "KEYS_ONLY" | "INCLUDE";
  readonly nonKeyAttributes?: string[];
}

/**
 * Extract GSI key types from entity.
 */
export type EntityGSIs<T extends Entity<any, any, any, any, any>> =
  T["gsiKeys"] extends readonly GSIKey<any, any, any>[] ? T["gsiKeys"] : never;
