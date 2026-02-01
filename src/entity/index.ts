/**
 * Entity definition module.
 *
 * Exports:
 * - entity() function for simplified entity creation
 * - Helper functions for key building
 * - All entity-related types
 */

// Export types
export type {
  Entity,
  EntityAttributes,
  EntityData,
  EntityType,
  EntityPK,
  EntitySK,
  EntityGSIs,
  GSIKey,
  GSIConfig,
} from "./types";

// Export the simplified entity() function
export { entity } from "./builder";

// Export key building functions
export { buildPartitionKey, buildSortKey, buildGSIKey } from "@/entity";
