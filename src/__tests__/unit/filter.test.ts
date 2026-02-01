/**
 * Unit tests for filter builder.
 */

import { describe, it, expect } from "vitest";
import { createFilterBuilder } from "@/filter";

describe("FilterBuilder", () => {
  it("should build simple filter", () => {
    const builder = createFilterBuilder();
    builder.where("name", "=", "John");
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.expression).toContain("=");
      expect(Object.values(result.value.names)).toContain("name");
    }
  });

  it("should build multiple conditions", () => {
    const builder = createFilterBuilder();
    builder.where("age", ">", 18).where("status", "=", "active");
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.expression).toContain("AND");
      expect(Object.values(result.value.names)).toContain("age");
      expect(Object.values(result.value.names)).toContain("status");
    }
  });

  it("should build attribute_exists condition", () => {
    const builder = createFilterBuilder();
    builder.where("email", "attribute_exists");
    const result = builder.build();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.expression).toContain("attribute_exists");
    }
  });

  it("should error on empty filter", () => {
    const builder = createFilterBuilder();
    const result = builder.build();
    expect(result.isErr()).toBe(true);
  });
});
