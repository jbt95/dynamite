/**
 * Table definition and entity registry for single-table design.
 *
 * Tables contain multiple entities discriminated by a type field.
 */

import type { Entity } from "@/entity";
import { err, ok, Result } from "@/result";
import { validationError } from "@/errors";

/**
 * Table definition.
 */
export interface Table<
  TName extends string = string,
  TPk extends string = string,
  TTypeField extends string = string,
  TEntities extends readonly Entity<any, any, any, any>[] = Entity<any, any, any, any>[],
> {
  readonly name: TName;
  readonly partitionKey: TPk;
  readonly sortKey?: string;
  readonly typeField: TTypeField;
  readonly entities: TEntities;
  readonly entityMap: Map<string, Entity<any, any, any, any>>;
}

/**
 * Resolve entity type from type field value.
 */
export function resolveEntity<T extends Table<any, any, any, any>>(
  table: T,
  typeValue: string
): Result<Entity<any, any, any, any>, Error> {
  const entity = table.entityMap.get(typeValue);
  if (!entity) {
    return err(
      validationError(`Unknown entity type: ${typeValue}`, {
        table: table.name,
        typeValue,
      })
    );
  }
  return ok(entity);
}

/**
 * Get entity by name.
 */
export function getEntity<T extends Table<any, any, any, any>>(
  table: T,
  entityName: string
): Result<Entity<any, any, any, any>, Error> {
  const entity = table.entityMap.get(entityName);
  if (!entity) {
    return err(
      validationError(`Entity not found: ${entityName}`, {
        table: table.name,
        entityName,
      })
    );
  }
  return ok(entity);
}
