/**
 * Schema definition and type inference system.
 *
 * Provides type-safe schema definitions with automatic TypeScript
 * type inference and marshalling to/from DynamoDB AttributeValue format.
 */

import { err, ok, Result } from "@/result";
import { validationError, DynamoError } from "@/errors";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";

/**
 * Base schema type definition.
 */
export type SchemaDef =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | BinarySchema
  | ListSchema<SchemaDef>
  | MapSchema<Record<string, SchemaDef>>
  | SetSchema<StringSchema | NumberSchema>
  | OptionalSchema<SchemaDef>
  | DefaultSchema<SchemaDef, unknown>;

export type AttributeSchema = SchemaDef;

export type AttributeShape = Record<string, SchemaDef>;

export type SchemaMap = Record<string, SchemaDef>;

export type ShallowSchemaMap<T extends SchemaMap> = {
  [K in keyof T]: T[K];
};

/**
 * String schema type.
 */
export interface StringSchema {
  readonly _type: "S";
}

/**
 * Number schema type.
 */
export interface NumberSchema {
  readonly _type: "N";
}

/**
 * Boolean schema type (stored as number in DynamoDB).
 */
export interface BooleanSchema {
  readonly _type: "B";
}

/**
 * Binary schema type.
 */
export interface BinarySchema {
  readonly _type: "Binary";
}

/**
 * List/Array schema type.
 */
export interface ListSchema<T extends SchemaDef> {
  readonly _type: "L";
  readonly item: T;
}

/**
 * Map/Object schema type.
 */
export interface MapSchema<T extends Record<string, SchemaDef>> {
  readonly _type: "M";
  readonly shape: T;
}

/**
 * Set schema type (String or Number sets).
 */
export interface SetSchema<T extends StringSchema | NumberSchema> {
  readonly _type: "Set";
  readonly item: T;
}

/**
 * Optional field schema.
 */
export interface OptionalSchema<T extends SchemaDef> {
  readonly _type: "Optional";
  readonly inner: T;
}

/**
 * Default value schema.
 */
export interface DefaultSchema<T extends SchemaDef, V> {
  readonly _type: "Default";
  readonly inner: T;
  readonly defaultValue: V;
}

/**
 * Schema namespace for builder-style definitions.
 */
const stringSchema: StringSchema = { _type: "S" };
const numberSchema: NumberSchema = { _type: "N" };
const booleanSchema: BooleanSchema = { _type: "B" };
const binarySchema: BinarySchema = { _type: "Binary" };
const stringSetSchema: SetSchema<StringSchema> = {
  _type: "Set",
  item: stringSchema,
};
const numberSetSchema: SetSchema<NumberSchema> = {
  _type: "Set",
  item: numberSchema,
};

export const S = {
  string: stringSchema,
  number: numberSchema,
  boolean: booleanSchema,
  binary: binarySchema,
  list: <T extends SchemaDef>(item: T): ListSchema<T> => ({
    _type: "L",
    item,
  }),
  map: <T extends Record<string, SchemaDef>>(shape: T): MapSchema<T> => ({
    _type: "M",
    shape,
  }),
  optional: <T extends SchemaDef>(inner: T): OptionalSchema<T> => ({
    _type: "Optional",
    inner,
  }),
  default: <T extends SchemaDef, V>(inner: T, defaultValue: V): DefaultSchema<T, V> => ({
    _type: "Default",
    inner,
    defaultValue,
  }),
  set: {
    string: stringSetSchema,
    number: numberSetSchema,
  },
} as const;

/**
 * Utility type to collapse complex object types for better IDE tooltips and TS performance.
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type InferShape<T extends Record<string, SchemaDef>> = Prettify<{
  [K in keyof T]: InferType<T[K]>;
}>;

/**
 * Type inference: Extract TypeScript type from schema definition.
 */
export type InferType<T extends SchemaDef> = T extends StringSchema
  ? string
  : T extends NumberSchema
    ? number
    : T extends BooleanSchema
      ? boolean
      : T extends BinarySchema
        ? Uint8Array
        : T extends ListSchema<infer U>
          ? InferType<U>[]
          : T extends MapSchema<infer U>
            ? InferShape<U>
            : T extends SetSchema<StringSchema>
              ? Set<string>
              : T extends SetSchema<NumberSchema>
                ? Set<number>
                : T extends OptionalSchema<infer U>
                  ? InferType<U> | undefined
                  : T extends DefaultSchema<infer U, infer V>
                    ? InferType<U> | V
                    : never;

/**
 * Marshal a value to DynamoDB AttributeValue format.
 *
 * Note: TypeScript may report "Type instantiation is excessively deep" for very complex
 * nested schemas. This is a TypeScript limitation, not a runtime issue. The function works
 * correctly at runtime using schema._type for dispatch.
 */
export function marshalItem(
  schema: SchemaDef,
  value: unknown
): Result<AttributeValue, DynamoError> {
  return marshalValue(schema, value);
}

/**
 * Unmarshal a DynamoDB item (Record<string, AttributeValue>) to TypeScript value.
 * This is a convenience function that wraps the item in an M AttributeValue.
 */
export function unmarshalItem(
  schema: SchemaDef,
  item: Record<string, AttributeValue>
): Result<unknown, DynamoError> {
  if (schema._type === "M") {
    const result = unmarshalValue(schema, { M: item } as AttributeValue);
    if (result.isErr()) {
      return err(result.error);
    }
    return ok(result.value);
  }
  return err(validationError("unmarshalItem expects a map schema for full items"));
}

function marshalValue(schema: SchemaDef, value: unknown): Result<AttributeValue, DynamoError> {
  // Implementation uses schema._type for runtime dispatch, avoiding deep type recursion
  switch (schema._type) {
    case "S": {
      if (typeof value !== "string") {
        return err(validationError(`Expected string, got ${typeof value}`, { value }));
      }
      return ok({ S: value });
    }

    case "N": {
      if (typeof value !== "number") {
        return err(validationError(`Expected number, got ${typeof value}`, { value }));
      }
      return ok({ N: String(value) });
    }

    case "B": {
      if (typeof value !== "boolean") {
        return err(validationError(`Expected boolean, got ${typeof value}`, { value }));
      }
      // DynamoDB stores booleans as numbers (0 or 1)
      return ok({ N: value ? "1" : "0" });
    }

    case "Binary": {
      if (!(value instanceof Uint8Array)) {
        return err(validationError(`Expected Uint8Array, got ${typeof value}`, { value }));
      }
      return ok({ B: Buffer.from(value) });
    }

    case "L": {
      if (!Array.isArray(value)) {
        return err(validationError(`Expected array, got ${typeof value}`, { value }));
      }
      const items: AttributeValue[] = [];
      for (const item of value) {
        const marshalled = marshalValue(schema.item, item);
        if (marshalled.isErr()) {
          return marshalled;
        }
        items.push(marshalled.value);
      }
      return ok({ L: items });
    }

    case "M": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return err(validationError(`Expected object, got ${typeof value}`, { value }));
      }
      const map: Record<string, AttributeValue> = {};
      for (const [key, fieldSchema] of Object.entries(schema.shape)) {
        const fieldValue = (value as Record<string, unknown>)[key];
        if (fieldValue === undefined) {
          continue;
        }
        const marshalled = marshalValue(fieldSchema, fieldValue);
        if (marshalled.isErr()) {
          return marshalled;
        }
        map[key] = marshalled.value;
      }
      return ok({ M: map });
    }

    case "Set": {
      if (!(value instanceof Set)) {
        return err(validationError(`Expected Set, got ${typeof value}`, { value }));
      }
      if (schema.item._type === "S") {
        const strings: string[] = [];
        for (const item of value) {
          if (typeof item !== "string") {
            return err(validationError(`Expected string in set, got ${typeof item}`));
          }
          strings.push(item);
        }
        return ok({ SS: strings });
      } else {
        const numbers: string[] = [];
        for (const item of value) {
          if (typeof item !== "number") {
            return err(validationError(`Expected number in set, got ${typeof item}`));
          }
          numbers.push(String(item));
        }
        return ok({ NS: numbers });
      }
    }

    case "Optional": {
      if (value === undefined) {
        return err(validationError("Cannot marshal undefined for Optional"));
      }
      return marshalValue(schema.inner, value);
    }

    case "Default": {
      if (value === undefined) {
        return err(validationError("Cannot marshal undefined for Default"));
      }
      return marshalValue(schema.inner, value);
    }

    default: {
      const _exhaustive: never = schema;
      return err(validationError(`Unknown schema type: ${(_exhaustive as SchemaDef)._type}`));
    }
  }
}

function unmarshalValue(schema: SchemaDef, av: AttributeValue): Result<unknown, DynamoError> {
  switch (schema._type) {
    case "S": {
      if (!av.S) {
        return err(validationError("Expected S attribute", { av }));
      }
      return ok(av.S);
    }

    case "N": {
      if (!av.N) {
        return err(validationError("Expected N attribute", { av }));
      }
      const num = Number(av.N);
      if (isNaN(num)) {
        return err(validationError(`Invalid number: ${av.N}`));
      }
      return ok(num);
    }

    case "B": {
      if (!av.N) {
        return err(validationError("Expected N attribute for boolean", { av }));
      }
      // DynamoDB stores booleans as numbers (0 or 1)
      return ok(av.N === "1");
    }

    case "Binary": {
      if (!av.B) {
        return err(validationError("Expected B attribute", { av }));
      }
      return ok(new Uint8Array(av.B));
    }

    case "L": {
      if (!av.L) {
        return err(validationError("Expected L attribute", { av }));
      }
      const items: unknown[] = [];
      for (const item of av.L) {
        const unmarshalled = unmarshalValue(schema.item, item);
        if (unmarshalled.isErr()) {
          return unmarshalled;
        }
        items.push(unmarshalled.value);
      }
      return ok(items);
    }

    case "M": {
      if (!av.M) {
        return err(validationError("Expected M attribute", { av }));
      }
      const obj: Record<string, unknown> = {};
      for (const [key, fieldSchema] of Object.entries(schema.shape)) {
        const fieldAv = av.M[key];
        if (fieldAv === undefined) {
          continue;
        }
        const unmarshalled = unmarshalValue(fieldSchema, fieldAv);
        if (unmarshalled.isErr()) {
          return unmarshalled;
        }
        obj[key] = unmarshalled.value;
      }
      return ok(obj);
    }

    case "Set": {
      if (schema.item._type === "S") {
        if (!av.SS) {
          return err(validationError("Expected SS attribute", { av }));
        }
        return ok(new Set(av.SS));
      } else {
        if (!av.NS) {
          return err(validationError("Expected NS attribute", { av }));
        }
        const numbers = new Set<number>();
        for (const n of av.NS) {
          const num = Number(n);
          if (isNaN(num)) {
            return err(validationError(`Invalid number in set: ${n}`));
          }
          numbers.add(num);
        }
        return ok(numbers);
      }
    }

    case "Optional": {
      // Optional fields may be missing, return undefined
      if (!av.M && !av.S && !av.N && !av.L && !av.B && !av.SS && !av.NS) {
        return ok(undefined);
      }
      return unmarshalValue(schema.inner, av);
    }

    case "Default": {
      // If value is missing, return default
      if (!av.M && !av.S && !av.N && !av.L && !av.B && !av.SS && !av.NS) {
        return ok(schema.defaultValue);
      }
      return unmarshalValue(schema.inner, av);
    }

    default: {
      const _exhaustive: never = schema;
      return err(validationError(`Unknown schema type: ${(_exhaustive as SchemaDef)._type}`));
    }
  }
}
