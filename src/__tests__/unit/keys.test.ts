/**
 * Unit tests for key templates.
 */

import { describe, it, expect } from "vitest";
import { createKey, buildKey, parseKey, extractKeyFields } from "@/keys";
import { S } from "@/schema";

const attributes = {
  id: S.string,
  userId: S.string,
  orderId: S.string,
  total: S.number,
};

describe("createKey", () => {
  it("should create key template", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    expect(template.parts[0]).toEqual({ literal: "USER" });
    expect(template.parts[1]).toEqual({ attr: "id" });
  });
});

describe("buildKey", () => {
  it("should build simple key", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    const key = buildKey(template, { id: "123" });
    expect(key).toBe("USER#123");
  });

  it("should build key with multiple fields", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "ORDER" }, { attr: "userId" }, { attr: "orderId" }],
    });
    const key = buildKey(template, { userId: "user1", orderId: "order1" });
    expect(key).toBe("ORDER#user1#order1");
  });

  it("should build key with number field", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "ITEM" }, { attr: "total" }],
    });
    const key = buildKey(template, { total: 42 });
    expect(key).toBe("ITEM#42");
  });
});

describe("parseKey", () => {
  it("should parse simple key", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    const result = parseKey(template, "USER#123");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ id: "123" });
    }
  });

  it("should parse key with multiple fields", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "ORDER" }, { attr: "userId" }, { attr: "orderId" }],
    });
    const result = parseKey(template, "ORDER#user1#order1");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ userId: "user1", orderId: "order1" });
    }
  });

  it("should parse key with number field", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "ITEM" }, { attr: "total" }],
    });
    const result = parseKey(template, "ITEM#42");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ total: 42 });
    }
  });

  it("should error on invalid literal", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    const result = parseKey(template, "ORDER#123");
    expect(result.isErr()).toBe(true);
  });

  it("should error on wrong part count", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    const result = parseKey(template, "USER#123#456");
    expect(result.isErr()).toBe(true);
  });
});

describe("extractKeyFields", () => {
  it("should extract key fields", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    const result = extractKeyFields(template, { id: "123", name: "John" } as any);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ id: "123" });
    }
  });

  it("should error on missing field", () => {
    const template = createKey(attributes, {
      parts: [{ literal: "USER" }, { attr: "id" }],
    });
    const result = extractKeyFields(template, { name: "John" } as any);
    expect(result.isErr()).toBe(true);
  });
});
