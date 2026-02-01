/**
 * Entity builder for creating typed entity definitions.
 *
 * Provides:
 * - entity() function for simplified entity creation
 * - Fluent API for defining attributes, keys, and GSIs
 * - Full TypeScript type inference
 *
 * @example
 * ```typescript
 * const User = entity("User", {
 *   id: S.string(),
 *   email: S.string(),
 *   name: S.string(),
 * })
 *   .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
 *   .gsi("EmailIndex", { pk: { parts: [{ attr: "email" }] }, projection: "ALL" })
 *   .build();
 * ```
 */

import type { SchemaDef, InferShape } from "@/schema";
import type { KeyDefinition, KeyTemplate, InferKeyInput } from "@/keys";
import { createKey } from "@/keys";
import type { Entity, EntityAttributes, GSIKey, GSIConfig } from "./types";

/**
 * Helper type to extract key data type from a key definition.
 */
type ExtractKeyData<
  TAttributes extends EntityAttributes,
  TKey extends KeyDefinition<keyof TAttributes & string>,
> = InferKeyInput<TAttributes, TKey>;

/**
 * Create a new entity definition.
 *
 * @param name - Entity name (used as type discriminator)
 * @param attributes - Schema definition for entity attributes
 * @returns EntityBuilder for configuring keys and GSIs
 *
 * @example
 * ```typescript
 * const User = entity("User", {
 *   id: S.string(),
 *   email: S.string(),
 *   name: S.string(),
 *   age: S.number(),
 * })
 *   .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
 *   .build();
 * ```
 */
export function entity<TName extends string, TAttributes extends EntityAttributes>(
  name: TName,
  attributes: TAttributes
): EntityBuilder<TName, TAttributes, never, never, readonly []> {
  return new EntityBuilder(name, attributes, undefined, undefined, []);
}

/**
 * Entity builder class with fluent API.
 */
class EntityBuilder<
  TName extends string,
  TAttributes extends EntityAttributes,
  TPk extends KeyDefinition<keyof TAttributes & string> | never,
  TSk extends KeyDefinition<keyof TAttributes & string> | never,
  TGSIs extends readonly GSIKey<TAttributes, any, any>[],
> {
  constructor(
    private readonly name: TName,
    private readonly attributes: TAttributes,
    private readonly pkTemplate?: KeyTemplate<TAttributes, any, any>,
    private readonly skTemplate?: KeyTemplate<TAttributes, any, any>,
    private readonly gsiKeys: readonly GSIKey<TAttributes, any, any>[] = []
  ) {}

  /**
   * Set the partition key template.
   *
   * @param key - Key definition with literal and attribute parts
   * @returns EntityBuilder with partition key configured
   *
   * @example
   * ```typescript
   * entity("User", { id: S.string() })
   *   .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
   *   .build();
   * ```
   */
  partitionKey<T extends KeyDefinition<keyof TAttributes & string>>(
    key: T
  ): EntityBuilder<TName, TAttributes, T, TSk, TGSIs> {
    return new EntityBuilder(
      this.name,
      this.attributes,
      createKey(this.attributes, key),
      this.skTemplate,
      this.gsiKeys
    );
  }

  /**
   * Set the sort key template.
   *
   * @param key - Key definition with literal and attribute parts
   * @returns EntityBuilder with sort key configured
   *
   * @example
   * ```typescript
   * entity("Order", { userId: S.string(), orderId: S.string() })
   *   .partitionKey({ parts: [{ literal: "ORDER" }, { attr: "userId" }] })
   *   .sortKey({ parts: [{ literal: "ORDER" }, { attr: "orderId" }] })
   *   .build();
   * ```
   */
  sortKey<T extends KeyDefinition<keyof TAttributes & string>>(
    key: T
  ): EntityBuilder<TName, TAttributes, TPk, T, TGSIs> {
    return new EntityBuilder(
      this.name,
      this.attributes,
      this.pkTemplate,
      createKey(this.attributes, key),
      this.gsiKeys
    );
  }

  /**
   * Add a Global Secondary Index (GSI).
   *
   * @param name - GSI name
   * @param config - GSI configuration (pk, sk, projection)
   * @returns EntityBuilder with GSI added
   *
   * @example
   * ```typescript
   * entity("User", { id: S.string(), email: S.string() })
   *   .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
   *   .gsi("EmailIndex", {
   *     pk: { parts: [{ attr: "email" }] },
   *     projection: "ALL"
   *   })
   *   .build();
   * ```
   */
  gsi<TGsiName extends string, TConfig extends GSIConfig<TAttributes>>(
    name: TGsiName,
    config: TConfig
  ): EntityBuilder<
    TName,
    TAttributes,
    TPk,
    TSk,
    readonly [...TGSIs, GSIKey<TAttributes, TConfig["pk"], TConfig["sk"]>]
  > {
    const gsiKey: GSIKey<TAttributes, TConfig["pk"], TConfig["sk"]> = {
      name,
      partitionKey: createKey(this.attributes, config.pk),
      sortKey: config.sk ? createKey(this.attributes, config.sk) : undefined,
      projection: config.projection,
      nonKeyAttributes: config.nonKeyAttributes,
    };

    return new EntityBuilder(this.name, this.attributes, this.pkTemplate, this.skTemplate, [
      ...this.gsiKeys,
      gsiKey,
    ] as unknown as readonly [...TGSIs, GSIKey<TAttributes, TConfig["pk"], TConfig["sk"]>]);
  }

  /**
   * Build the entity definition.
   *
   * @returns Entity with full type inference
   * @throws Error if partition key is not defined
   *
   * @example
   * ```typescript
   * const User = entity("User", { id: S.string() })
   *   .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
   *   .build();
   *
   * type UserType = EntityType<typeof User>; // { id: string }
   * ```
   */
  build(): Entity<
    TName,
    TAttributes,
    InferShape<TAttributes>,
    TPk extends KeyDefinition<string> ? ExtractKeyData<TAttributes, TPk> : never,
    TSk extends KeyDefinition<string> ? ExtractKeyData<TAttributes, TSk> : never
  > {
    if (!this.pkTemplate) {
      throw new Error(`Entity ${this.name} must define a partition key`);
    }

    const schema: SchemaDef = {
      _type: "M",
      shape: this.attributes,
    };

    // Calculate key types
    type PKType = TPk extends KeyDefinition<string> ? ExtractKeyData<TAttributes, TPk> : never;
    type SKType = TSk extends KeyDefinition<string> ? ExtractKeyData<TAttributes, TSk> : never;

    return {
      name: this.name,
      schema,
      partitionKey: this.pkTemplate,
      sortKey: this.skTemplate,
      gsiKeys: this.gsiKeys,
      attributes: this.attributes,
      // Phantom types for inference - these are runtime undefined but typed for compile-time
      _data: undefined as unknown as InferShape<TAttributes>,
      _pk: undefined as unknown as PKType,
      _sk: undefined as unknown as SKType | undefined,
    } as unknown as Entity<TName, TAttributes, InferShape<TAttributes>, PKType, SKType>;
  }
}
