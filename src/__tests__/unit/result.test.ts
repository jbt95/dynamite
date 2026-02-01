/**
 * Unit tests for Result monad.
 */

import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, tryCatch, collect, traverse } from "@/result";

describe("Result", () => {
  describe("ok and err", () => {
    it("should create Ok result", () => {
      const result = ok(42);
      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
      expect(result.value).toBe(42);
    });

    it("should create Err result", () => {
      const error = new Error("test error");
      const result = err(error);
      expect(result.isOk()).toBe(false);
      expect(result.isErr()).toBe(true);
      expect(result.error).toBe(error);
    });
  });

  describe("map", () => {
    it("should map Ok value", () => {
      const result = ok(2).map((x) => x * 2);
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe(4);
    });

    it("should not map Err value", () => {
      const error = new Error("test");
      const result = err(error).map((x) => x * 2);
      expect(result.isErr()).toBe(true);
      expect(result.error).toBe(error);
    });
  });

  describe("flatMap", () => {
    it("should chain Ok results", () => {
      const result = ok(2).flatMap((x) => ok(x * 2));
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(4);
      }
    });

    it("should short-circuit on Err", () => {
      const error = new Error("test");
      const result = err(error).flatMap((x) => ok(x * 2));
      expect(result.isErr()).toBe(true);
    });

    it("should propagate Err from chain", () => {
      const error = new Error("test");
      const result = ok(2).flatMap(() => err(error));
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe("unwrap", () => {
    it("should unwrap Ok value", () => {
      const result = ok(42);
      if (result.isOk()) {
        expect(result.unwrap()).toBe(42);
      }
    });

    it("should throw on Err", () => {
      const result = err(new Error("test"));
      if (result.isErr()) {
        expect(() => result.unwrap()).toThrow();
      }
    });
  });

  describe("unwrapOr", () => {
    it("should return value for Ok", () => {
      const result = ok(42);
      expect(result.unwrapOr(0)).toBe(42);
    });

    it("should return default for Err", () => {
      const result = err(new Error("test"));
      if (result.isErr()) {
        expect(result.unwrapOr(0)).toBe(0);
      }
    });
  });

  describe("unwrapOrElse", () => {
    it("should return value for Ok", () => {
      const result = ok(42);
      expect(result.unwrapOrElse(() => 0)).toBe(42);
    });

    it("should compute default for Err", () => {
      const result = err(new Error("test"));
      if (result.isErr()) {
        expect(result.unwrapOrElse((e) => e.message.length)).toBe(4);
      }
    });
  });

  describe("match", () => {
    it("should match Ok", () => {
      const result = ok(42);
      const value = result.match(
        (v) => v * 2,
        () => 0
      );
      expect(value).toBe(84);
    });

    it("should match Err", () => {
      const result = err(new Error("test"));
      const value = result.match(
        () => 0,
        (e) => e.message.length
      );
      expect(value).toBe(4);
    });
  });

  describe("tryCatch", () => {
    it("should wrap successful async operation", async () => {
      const result = await tryCatch(async () => {
        return await Promise.resolve(42);
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(42);
      }
    });

    it("should wrap successful sync operation", async () => {
      const result = await tryCatch(() => 42);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(42);
      }
    });

    it("should catch errors", async () => {
      const result = await tryCatch(async () => {
        throw new Error("test error");
      });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe("test error");
      }
    });
  });

  describe("collect", () => {
    it("should collect all Ok results", () => {
      const results = [ok(1), ok(2), ok(3)];
      const collected = collect(results);
      expect(collected.isOk()).toBe(true);
      if (collected.isOk()) {
        expect(collected.value).toEqual([1, 2, 3]);
      }
    });

    it("should return first error", () => {
      const error = new Error("test");
      const results = [ok(1), err(error), ok(3)];
      const collected = collect(results);
      expect(collected.isErr()).toBe(true);
      if (collected.isErr()) {
        expect(collected.error).toBe(error);
      }
    });
  });

  describe("traverse", () => {
    it("should map and collect successfully", () => {
      const items = [1, 2, 3];
      const result = traverse(items, (n) => ok(n * 2));
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([2, 4, 6]);
      }
    });

    it("should short-circuit on error", () => {
      const items = [1, 2, 3];
      const result = traverse(items, (n) => (n === 2 ? err(new Error("test")) : ok(n * 2)));
      expect(result.isErr()).toBe(true);
    });
  });

  describe("type guards", () => {
    it("isOk should work", () => {
      const result = ok(42);
      if (isOk(result)) {
        expect(result.value).toBe(42);
      }
    });

    it("isErr should work", () => {
      const result = err(new Error("test"));
      if (isErr(result)) {
        expect(result.error).toBeInstanceOf(Error);
      }
    });
  });
});
