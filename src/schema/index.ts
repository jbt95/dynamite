/**
 * Schema definition and type inference system.
 *
 * Provides type-safe schema definitions with automatic TypeScript
 * type inference and marshalling to/from DynamoDB AttributeValue format.
 *
 * @example
 * ```typescript
 * const UserSchema = {
 *   id: S.string,
 *   email: S.string,
 *   name: S.string,
 * };
 * ```
 */

// Export all types from definitions
export type {
  SchemaDef,
  AttributeSchema,
  AttributeShape,
  StringSchema,
  NumberSchema,
  BooleanSchema,
  BinarySchema,
  ListSchema,
  MapSchema,
  SetSchema,
  OptionalSchema,
  DefaultSchema,
  InferType,
  InferShape,
  Prettify,
} from "./definitions";

// Export schema constructors and functions
export { S, marshalItem, unmarshalItem } from "./definitions";
