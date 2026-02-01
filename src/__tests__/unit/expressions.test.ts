/**
 * Unit tests for expression building.
 */

import { describe, it, expect } from "vitest";
import {
  createExpressionContext,
  addAttributeName,
  addAttributeValue,
  buildComparison,
  buildLogical,
} from "@/expressions";

describe("ExpressionContext", () => {
  it("should create context", () => {
    const context = createExpressionContext();
    expect(context.names).toEqual({});
    expect(context.values).toEqual({});
  });

  it("should add attribute names", () => {
    const context = createExpressionContext();
    const name1 = addAttributeName(context, "field1");
    const name2 = addAttributeName(context, "field2");
    expect(context.names[name1]).toBe("field1");
    expect(context.names[name2]).toBe("field2");
    expect(name1).not.toBe(name2);
  });

  it("should add attribute values", () => {
    const context = createExpressionContext();
    const val1 = addAttributeValue(context, "value1");
    const val2 = addAttributeValue(context, 42);
    expect(context.values[val1]).toBe("value1");
    expect(context.values[val2]).toBe(42);
  });
});

describe("buildComparison", () => {
  it("should build equality comparison", () => {
    const context = createExpressionContext();
    const expr = buildComparison(context, "name", "=", "John");
    expect(expr).toContain("=");
    expect(expr).toContain("#attr");
    expect(expr).toContain(":val");
    expect(Object.values(context.names)).toContain("name");
    expect(Object.values(context.values)).toContain("John");
  });

  it("should build attribute_exists", () => {
    const context = createExpressionContext();
    const expr = buildComparison(context, "email", "attribute_exists");
    expect(expr).toContain("attribute_exists");
  });

  it("should build BETWEEN", () => {
    const context = createExpressionContext();
    const expr = buildComparison(context, "age", "BETWEEN", [18, 65]);
    expect(expr).toContain("BETWEEN");
  });
});

describe("buildLogical", () => {
  it("should build AND expression", () => {
    const expr = buildLogical("AND", "expr1", "expr2", "expr3");
    expect(expr).toContain("AND");
    expect(expr).toContain("expr1");
    expect(expr).toContain("expr2");
  });

  it("should build OR expression", () => {
    const expr = buildLogical("OR", "expr1", "expr2");
    expect(expr).toContain("OR");
  });

  it("should build NOT expression", () => {
    const expr = buildLogical("NOT", "expr1");
    expect(expr).toContain("NOT");
    expect(expr).toContain("expr1");
  });
});
