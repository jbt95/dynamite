/**
 * Unit tests for update expressions.
 */

import { describe, it, expect } from "vitest";
import { UpdateExpressionBuilder } from "@/update";
import { S } from "@/schema";

describe("UpdateExpressionBuilder", () => {
  it("should build SET expression", () => {
    const schema = S.map({ name: S.string, age: S.number });
    const builder = new UpdateExpressionBuilder(schema);
    builder.set("name", "John");
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.UpdateExpression).toContain("SET");
      expect(result.value.UpdateExpression).toContain("#attr");
    }
  });

  it("should build REMOVE expression", () => {
    const schema = S.map({ name: S.string, age: S.number });
    const builder = new UpdateExpressionBuilder(schema);
    builder.remove("age");
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.UpdateExpression).toContain("REMOVE");
    }
  });

  it("should build multiple SET operations", () => {
    const schema = S.map({ name: S.string, age: S.number });
    const builder = new UpdateExpressionBuilder(schema);
    builder.set("name", "John").set("age", 30);
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.UpdateExpression).toContain("#attr");
      expect(Object.values(result.value.ExpressionAttributeNames)).toContain("name");
    }
  });

  it("should build increment operation", () => {
    const schema = S.map({ count: S.number });
    const builder = new UpdateExpressionBuilder(schema);
    builder.increment("count", 5);
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.UpdateExpression).toContain("+");
    }
  });

  it("should error on empty expression", () => {
    const schema = S.map({ name: S.string });
    const builder = new UpdateExpressionBuilder(schema);
    const result = builder.build();
    expect(result.isErr()).toBe(true);
  });
});
