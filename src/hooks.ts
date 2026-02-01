/**
 * Hook system for intercepting and modifying operations.
 *
 * Provides lifecycle hooks for operations with support for
 * cancellation, validation, and side effects.
 */

/**
 * Hook phases.
 */
export type HookPhase =
  | "beforeTrack"
  | "afterTrack"
  | "beforeQuery"
  | "afterQuery"
  | "beforeWrite"
  | "afterWrite"
  | "beforeCommit"
  | "afterCommit"
  | "beforeRollback"
  | "afterRollback"
  | "onStreamEvent"
  | "onError";

/**
 * Operation types.
 */
export type OperationType =
  | "get"
  | "put"
  | "update"
  | "delete"
  | "query"
  | "scan"
  | "commit"
  | "rollback";

/**
 * Hook context.
 */
export interface HookContext {
  phase: HookPhase;
  operation: OperationType;
  entity?: string;
  table?: string;
  data?: unknown;
  params?: Record<string, unknown>;
  timing?: {
    startTime: number;
    endTime?: number;
  };
}

/**
 * Hook result (for before hooks).
 */
export interface HookResult {
  cancel?: boolean;
  reason?: string;
  modifiedData?: unknown;
}

/**
 * Hook function signature.
 */
export type HookFunction = (context: HookContext) => HookResult | void | Promise<HookResult | void>;

/**
 * Hook registry for managing hooks.
 */
export class HookRegistry {
  private hooks = new Map<HookPhase, HookFunction[]>();
  private globalHooks: HookFunction[] = [];
  private tableHooks = new Map<string, Map<HookPhase, HookFunction[]>>();
  private entityHooks = new Map<string, Map<HookPhase, HookFunction[]>>();

  /**
   * Register a global hook.
   */
  registerGlobal(phase: HookPhase, fn: HookFunction): void {
    if (phase.startsWith("before")) {
      this.globalHooks.push(fn);
    }
    if (!this.hooks.has(phase)) {
      this.hooks.set(phase, []);
    }
    this.hooks.get(phase)!.push(fn);
  }

  /**
   * Register a table-level hook.
   */
  registerTable(table: string, phase: HookPhase, fn: HookFunction): void {
    if (!this.tableHooks.has(table)) {
      this.tableHooks.set(table, new Map());
    }
    const tableHookMap = this.tableHooks.get(table)!;
    if (!tableHookMap.has(phase)) {
      tableHookMap.set(phase, []);
    }
    tableHookMap.get(phase)!.push(fn);
  }

  /**
   * Register an entity-level hook.
   */
  registerEntity(entity: string, phase: HookPhase, fn: HookFunction): void {
    if (!this.entityHooks.has(entity)) {
      this.entityHooks.set(entity, new Map());
    }
    const entityHookMap = this.entityHooks.get(entity)!;
    if (!entityHookMap.has(phase)) {
      entityHookMap.set(phase, []);
    }
    entityHookMap.get(phase)!.push(fn);
  }

  /**
   * Get hooks for a specific phase and context.
   */
  getHooks(phase: HookPhase, context: HookContext): HookFunction[] {
    const hooks: HookFunction[] = [];

    // Global hooks
    hooks.push(...(this.hooks.get(phase) || []));
    hooks.push(...this.globalHooks);

    // Table-level hooks
    if (context.table) {
      const tableHooks = this.tableHooks.get(context.table);
      if (tableHooks) {
        hooks.push(...(tableHooks.get(phase) || []));
      }
    }

    // Entity-level hooks
    if (context.entity) {
      const entityHooks = this.entityHooks.get(context.entity);
      if (entityHooks) {
        hooks.push(...(entityHooks.get(phase) || []));
      }
    }

    return hooks;
  }

  /**
   * Clear all hooks.
   */
  clear(): void {
    this.hooks.clear();
    this.globalHooks = [];
    this.tableHooks.clear();
    this.entityHooks.clear();
  }
}

/**
 * Run hooks for a given phase and context.
 */
export async function runHooks(
  registry: HookRegistry,
  context: HookContext
): Promise<Result<HookResult | void, Error>> {
  const hooks = registry.getHooks(context.phase, context);

  for (const hook of hooks) {
    try {
      const result = await hook(context);
      if (result && result.cancel) {
        return err(new Error(result.reason || "Operation cancelled by hook"));
      }
      if (result && result.modifiedData) {
        context.data = result.modifiedData;
      }
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return ok(undefined);
}

import { err, ok, Result } from "@/result";
