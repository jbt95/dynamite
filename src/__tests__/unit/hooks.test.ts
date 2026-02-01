/**
 * Unit tests for hook system.
 */

import { describe, it, expect } from "vitest";
import { HookRegistry, runHooks } from "@/hooks";
import { ok } from "@/result";

describe("HookRegistry", () => {
  it("should register global hook", () => {
    const registry = new HookRegistry();
    const fn = () => {};
    registry.registerGlobal("beforeWrite", fn);
    const hooks = registry.getHooks("beforeWrite", {
      phase: "beforeWrite",
      operation: "put",
    });
    expect(hooks.length).toBeGreaterThan(0);
  });

  it("should register table-level hook", () => {
    const registry = new HookRegistry();
    const fn = () => {};
    registry.registerTable("test-table", "beforeWrite", fn);
    const hooks = registry.getHooks("beforeWrite", {
      phase: "beforeWrite",
      operation: "put",
      table: "test-table",
    });
    expect(hooks.length).toBeGreaterThan(0);
  });

  it("should register entity-level hook", () => {
    const registry = new HookRegistry();
    const fn = () => {};
    registry.registerEntity("User", "beforeWrite", fn);
    const hooks = registry.getHooks("beforeWrite", {
      phase: "beforeWrite",
      operation: "put",
      entity: "User",
    });
    expect(hooks.length).toBeGreaterThan(0);
  });

  it("should clear all hooks", () => {
    const registry = new HookRegistry();
    registry.registerGlobal("beforeWrite", () => {});
    registry.clear();
    const hooks = registry.getHooks("beforeWrite", {
      phase: "beforeWrite",
      operation: "put",
    });
    expect(hooks.length).toBe(0);
  });
});

describe("runHooks", () => {
  it("should run hooks successfully", async () => {
    const registry = new HookRegistry();
    registry.registerGlobal("beforeWrite", () => {});
    const result = await runHooks(registry, {
      phase: "beforeWrite",
      operation: "put",
    });
    expect(result.isOk()).toBe(true);
  });

  it("should cancel on hook cancellation", async () => {
    const registry = new HookRegistry();
    registry.registerGlobal("beforeWrite", () => ({
      cancel: true,
      reason: "Test cancellation",
    }));
    const result = await runHooks(registry, {
      phase: "beforeWrite",
      operation: "put",
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain("Test cancellation");
    }
  });
});
