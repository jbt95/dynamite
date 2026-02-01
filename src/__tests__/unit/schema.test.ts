/**
 * Unit tests for schema definition and marshalling.
 */

import { describe, it, expect } from "vitest";
import { S, marshalItem, unmarshalItem } from "@/schema";

describe("Schema types", () => {
  it("should expose string schema", () => {
    expect(S.string._type).toBe("S");
  });

  it("should expose number schema", () => {
    expect(S.number._type).toBe("N");
  });

  it("should expose boolean schema", () => {
    expect(S.boolean._type).toBe("B");
  });

  it("should create list schema", () => {
    const schema = S.list(S.string);
    expect(schema._type).toBe("L");
    expect(schema.item._type).toBe("S");
  });

  it("should create map schema", () => {
    const schema = S.map({ name: S.string, age: S.number });
    expect(schema._type).toBe("M");
    expect(schema.shape.name._type).toBe("S");
    expect(schema.shape.age._type).toBe("N");
  });

  it("should create string set schema", () => {
    expect(S.set.string._type).toBe("Set");
    expect(S.set.string.item._type).toBe("S");
  });

  it("should create number set schema", () => {
    expect(S.set.number._type).toBe("Set");
    expect(S.set.number.item._type).toBe("N");
  });

  it("should create optional schema", () => {
    const schema = S.optional(S.string);
    expect(schema._type).toBe("Optional");
    expect(schema.inner._type).toBe("S");
  });

  it("should create default schema", () => {
    const schema = S.default(S.string, "default");
    expect(schema._type).toBe("Default");
    expect(schema.inner._type).toBe("S");
    expect(schema.defaultValue).toBe("default");
  });
});

describe("Marshalling", () => {
  describe("String", () => {
    it("should marshal string", () => {
      const result = marshalItem(S.string, "hello");
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.S).toBe("hello");
      }
    });

    it("should unmarshal string", () => {
      const result = unmarshalItem(S.map({ value: S.string }), {
        value: { S: "hello" },
      } as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect((result.value as any).value).toBe("hello");
      }
    });
  });

  describe("Number", () => {
    it("should marshal number", () => {
      const result = marshalItem(S.number, 42);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.N).toBe("42");
      }
    });

    it("should unmarshal number", () => {
      const result = unmarshalItem(S.map({ value: S.number }), {
        value: { N: "42" },
      } as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect((result.value as any).value).toBe(42);
      }
    });
  });

  describe("Boolean", () => {
    it("should marshal boolean as number", () => {
      const result = marshalItem(S.boolean, true);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.N).toBe("1");
      }
    });

    it("should unmarshal boolean from number", () => {
      const result = unmarshalItem(S.map({ value: S.boolean }), {
        value: { N: "1" },
      } as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect((result.value as any).value).toBe(true);
      }
    });
  });

  describe("List", () => {
    it("should marshal list", () => {
      const schema = S.list(S.string);
      const result = marshalItem(schema, ["a", "b", "c"]);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.L).toHaveLength(3);
        expect(result.value.L![0].S).toBe("a");
      }
    });

    it("should unmarshal list", () => {
      const schema = S.map({ value: S.list(S.string) });
      const result = unmarshalItem(schema, {
        value: { L: [{ S: "a" }, { S: "b" }] },
      } as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect((result.value as any).value).toEqual(["a", "b"]);
      }
    });
  });

  describe("Map", () => {
    it("should marshal map", () => {
      const schema = S.map({ name: S.string, age: S.number });
      const result = marshalItem(schema, { name: "John", age: 30 });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.M!.name.S).toBe("John");
        expect(result.value.M!.age.N).toBe("30");
      }
    });

    it("should unmarshal map", () => {
      const schema = S.map({ name: S.string, age: S.number });
      const result = unmarshalItem(schema, {
        name: { S: "John" },
        age: { N: "30" },
      } as any);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({ name: "John", age: 30 });
      }
    });
  });

  describe("Set", () => {
    it("should marshal string set", () => {
      const result = marshalItem(S.set.string, new Set(["a", "b"]));
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.SS).toContain("a");
        expect(result.value.SS).toContain("b");
      }
    });

    it("should marshal number set", () => {
      const result = marshalItem(S.set.number, new Set([1, 2]));
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.NS).toContain("1");
        expect(result.value.NS).toContain("2");
      }
    });
  });

  describe("Nested structures", () => {
    it("should marshal nested map", () => {
      const schema = S.map({
        user: S.map({
          name: S.string,
          profile: S.map({
            bio: S.string,
          }),
        }),
      });
      const value = {
        user: {
          name: "John",
          profile: {
            bio: "Developer",
          },
        },
      };
      const result = marshalItem(schema, value);
      expect(result.isOk()).toBe(true);
    });

    it("should marshal list of maps", () => {
      const schema = S.list(S.map({ id: S.string, value: S.number }));
      const value = [
        { id: "1", value: 10 },
        { id: "2", value: 20 },
      ];
      const result = marshalItem(schema, value);
      expect(result.isOk()).toBe(true);
    });
  });
});
