/**
 * Key parts builder for partition and sort keys.
 */

import type { SchemaDef, InferType, Prettify } from "@/schema";
import { err, ok, Result } from "@/result";

export type KeyPartLiteral = {
  readonly literal: string;
};

export type KeyPartAttr<TAttr extends string> = {
  readonly attr: TAttr;
};

export type KeyPart<TAttr extends string = string> = KeyPartLiteral | KeyPartAttr<TAttr>;

export interface KeyDefinition<TAttr extends string = string> {
  readonly parts: readonly KeyPart<TAttr>[];
}

export interface KeyTemplate<
  TAttributes extends Record<string, SchemaDef> = Record<string, SchemaDef>,
  TKey extends KeyDefinition<keyof TAttributes & string> = KeyDefinition<
    keyof TAttributes & string
  >,
  TInferred = any,
> {
  readonly parts: TKey["parts"];
  readonly attributes: TAttributes;
  /** @internal */
  readonly _inferred?: TInferred;
}

export type InferKeyInput<
  TAttributes extends Record<string, SchemaDef>,
  TKey extends KeyDefinition<keyof TAttributes & string>,
> = Prettify<{
  [K in Extract<TKey["parts"][number], KeyPartAttr<keyof TAttributes & string>>["attr"]]: InferType<
    TAttributes[K]
  >;
}>;

export type KeyType<T extends KeyTemplate<any, any, any>> = NonNullable<T["_inferred"]>;

export function createKey<
  TAttributes extends Record<string, SchemaDef>,
  TKey extends KeyDefinition<keyof TAttributes & string>,
>(
  attributes: TAttributes,
  key: TKey
): KeyTemplate<TAttributes, TKey, InferKeyInput<TAttributes, TKey>> {
  return {
    parts: key.parts,
    attributes,
  } as KeyTemplate<TAttributes, TKey, InferKeyInput<TAttributes, TKey>>;
}

export function buildKey<T extends KeyTemplate<any, any, any>>(
  template: T,
  values: KeyType<T>
): string {
  const parts: string[] = [];
  for (const part of template.parts) {
    if ("literal" in part) {
      parts.push(part.literal);
      continue;
    }
    const value = (values as Record<string, unknown>)[part.attr];
    parts.push(String(value));
  }
  return parts.join("#");
}

export function parseKey<T extends KeyTemplate<any, any, any>>(
  template: T,
  key: string
): Result<KeyType<T>, Error> {
  const parts = key.split("#");
  const expectedParts = template.parts.length;
  if (parts.length !== expectedParts) {
    return err(
      new Error(`Key part count mismatch: expected ${expectedParts}, got ${parts.length}`)
    );
  }

  const result: Record<string, unknown> = {};
  for (let i = 0; i < template.parts.length; i++) {
    const part = template.parts[i];
    const value = parts[i];
    if ("literal" in part) {
      if (value !== part.literal) {
        return err(new Error(`Key literal mismatch: expected ${part.literal}, got ${value}`));
      }
      continue;
    }

    const schema = template.attributes[part.attr];
    if (!schema) {
      return err(new Error(`Unknown key attribute: ${part.attr}`));
    }

    if (schema._type === "N") {
      const num = Number(value);
      if (Number.isNaN(num)) {
        return err(new Error(`Invalid number in key: ${value}`));
      }
      result[part.attr] = num;
    } else {
      result[part.attr] = value;
    }
  }

  return ok(result as KeyType<T>);
}

export function extractKeyFields<T extends KeyTemplate<any, any, any>>(
  template: T,
  value: Partial<KeyType<T>>
): Result<KeyType<T>, Error> {
  const result: Record<string, unknown> = {};
  for (const part of template.parts) {
    if ("literal" in part) {
      continue;
    }
    const fieldValue = (value as Record<string, unknown>)[part.attr];
    if (fieldValue === undefined) {
      return err(new Error(`Missing required key field: ${part.attr}`));
    }
    result[part.attr] = fieldValue;
  }
  return ok(result as KeyType<T>);
}
