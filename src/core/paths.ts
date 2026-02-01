/**
 * Path utilities for deep object manipulation and type-safe field access.
 *
 * Provides TypeScript types for:
 * - Paths<T>: All possible dot-notation paths in an object
 * - PathValue<T, P>: The type at a specific path
 * - DeepPaths<T>: Advanced paths including array indices
 */

/**
 * Get all possible dot-notation paths for an object type.
 * Includes support for nested objects and arrays.
 *
 * @example
 * type User = { name: string; profile: { age: number; tags: string[] } };
 * type UserPaths = Paths<User>; // "name" | "profile" | "profile.age" | "profile.tags"
 */
export type Paths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends Array<infer U>
        ? K | `${K}[${number}]` | `${K}[${number}].${Paths<U>}`
        : T[K] extends object
          ? K | `${K}.${Paths<T[K]>}`
          : K;
    }[keyof T & string]
  : never;

/**
 * Get the value type at a specific path in an object.
 *
 * @example
 * type User = { profile: { age: number } };
 * type AgeType = PathValue<User, "profile.age">; // number
 */
export type PathValue<T, P extends string> = P extends keyof T
  ? T[P]
  : P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? PathValue<T[K], Rest>
      : never
    : P extends `${infer K}[${number}]`
      ? K extends keyof T
        ? T[K] extends Array<infer U>
          ? U
          : never
        : never
      : never;

/**
 * Get all leaf paths (paths that point to primitive values, not objects).
 *
 * @example
 * type User = { name: string; profile: { age: number } };
 * type LeafPaths = LeafPaths<User>; // "name" | "profile.age"
 */
export type LeafPaths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? T[K] extends Array<infer U>
          ? U extends object
            ? `${K}[${number}].${LeafPaths<U>}`
            : `${K}[${number}]`
          : `${K}.${LeafPaths<T[K]>}`
        : K;
    }[keyof T & string]
  : never;

/**
 * Check if a type is a primitive (not an object or array).
 */
export type IsPrimitive<T> = T extends object ? (T extends Array<any> ? false : false) : true;

/**
 * Make all properties in T required (deep version).
 */
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object
    ? T[P] extends Array<infer U>
      ? Array<DeepRequired<U>>
      : DeepRequired<T[P]>
    : T[P];
};

/**
 * Make all properties in T optional (deep version).
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? T[P] extends Array<infer U>
      ? Array<DeepPartial<U>>
      : DeepPartial<T[P]>
    : T[P];
};

/**
 * Utility type to collapse complex object types for better IDE tooltips.
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
