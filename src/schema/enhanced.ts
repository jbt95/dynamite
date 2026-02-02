/**
 * Enhanced schema types with validators, transformers, and computed fields.
 */

import type { SchemaDef } from "./definitions";

/**
 * Validator function type.
 */
export type ValidatorFn<T> = (value: T) => boolean | string;

/**
 * Transformer function type.
 */
export type TransformerFn<T> = (value: T) => T;

/**
 * Default value function type.
 */
export type DefaultFn<T> = () => T;

/**
 * Computed field function type.
 */
export type ComputedFn<T, R> = (item: T) => R;

/**
 * Schema with validation.
 */
export interface ValidatedSchema<T extends SchemaDef, V> {
  readonly _type: "Validated";
  readonly inner: T;
  readonly validators: ValidatorFn<V>[];
}

/**
 * Schema with transformation.
 */
export interface TransformedSchema<T extends SchemaDef, V> {
  readonly _type: "Transformed";
  readonly inner: T;
  readonly transformers: TransformerFn<V>[];
}

/**
 * Schema with default function.
 */
export interface DefaultFnSchema<T extends SchemaDef, V> {
  readonly _type: "DefaultFn";
  readonly inner: T;
  readonly defaultFn: DefaultFn<V>;
}

/**
 * Schema with alias (attribute name mapping).
 */
export interface AliasedSchema<T extends SchemaDef> {
  readonly _type: "Aliased";
  readonly inner: T;
  readonly alias: string;
}

/**
 * Enhanced schema type including new variants.
 */
export type EnhancedSchemaDef =
  | SchemaDef
  | ValidatedSchema<any, any>
  | TransformedSchema<any, any>
  | DefaultFnSchema<any, any>
  | AliasedSchema<any>;

/**
 * Schema builder with validation and transformation support.
 */
export class SchemaBuilder<T extends SchemaDef, V> {
  constructor(
    private readonly schema: T,
    private readonly validators: ValidatorFn<V>[] = [],
    private readonly transformers: TransformerFn<V>[] = [],
    private readonly alias?: string,
    private readonly defaultFn?: DefaultFn<V>
  ) {}

  /**
   * Add a validator function.
   */
  validate(validator: ValidatorFn<V>): SchemaBuilder<T, V> {
    return new SchemaBuilder(
      this.schema,
      [...this.validators, validator],
      this.transformers,
      this.alias,
      this.defaultFn
    );
  }

  /**
   * Add a transformer function.
   */
  transform(transformer: TransformerFn<V>): SchemaBuilder<T, V> {
    return new SchemaBuilder(
      this.schema,
      this.validators,
      [...this.transformers, transformer],
      this.alias,
      this.defaultFn
    );
  }

  /**
   * Transform to lowercase (for strings).
   */
  toLowerCase(): SchemaBuilder<T, V> {
    return this.transform((v) => (typeof v === "string" ? v.toLowerCase() : v) as V);
  }

  /**
   * Transform to uppercase (for strings).
   */
  toUpperCase(): SchemaBuilder<T, V> {
    return this.transform((v) => (typeof v === "string" ? v.toUpperCase() : v) as V);
  }

  /**
   * Trim whitespace (for strings).
   */
  trim(): SchemaBuilder<T, V> {
    return this.transform((v) => (typeof v === "string" ? v.trim() : v) as V);
  }

  /**
   * Set a default value function.
   */
  withDefault(fn: DefaultFn<V>): SchemaBuilder<T, V> {
    return new SchemaBuilder(this.schema, this.validators, this.transformers, this.alias, fn);
  }

  /**
   * Set an alias for the attribute name.
   */
  withAlias(name: string): SchemaBuilder<T, V> {
    return new SchemaBuilder(this.schema, this.validators, this.transformers, name, this.defaultFn);
  }

  /**
   * Build the final schema definition.
   */
  build(): EnhancedSchemaDef {
    let result: EnhancedSchemaDef = this.schema;

    if (this.validators.length > 0) {
      result = {
        _type: "Validated",
        inner: result,
        validators: this.validators,
      } as ValidatedSchema<any, any>;
    }

    if (this.transformers.length > 0) {
      result = {
        _type: "Transformed",
        inner: result,
        transformers: this.transformers,
      } as TransformedSchema<any, any>;
    }

    if (this.defaultFn) {
      result = {
        _type: "DefaultFn",
        inner: result,
        defaultFn: this.defaultFn,
      } as unknown as DefaultFnSchema<any, any>;
    }

    if (this.alias) {
      result = {
        _type: "Aliased",
        inner: result,
        alias: this.alias,
      } as unknown as AliasedSchema<any>;
    }

    return result;
  }
}

/**
 * Create a schema builder for adding validators and transformers.
 */
export function schema<T extends SchemaDef, V>(baseSchema: T): SchemaBuilder<T, V> {
  return new SchemaBuilder(baseSchema);
}
