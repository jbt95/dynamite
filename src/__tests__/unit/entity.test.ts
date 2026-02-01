/**
 * Unit tests for entity definition using the new API.
 */

import { describe, it, expect } from "vitest";
import { buildPartitionKey, buildSortKey } from "@/entity";
import { entity } from "@/index";
import { S } from "@/schema";
import { ModernUser, ModernOrder } from "@/__tests__/helpers/test-entities";

describe("entity() function", () => {
  it("should create entity without sort key", () => {
    expect(ModernUser.name).toBe("ModernUser");
    expect(ModernUser.partitionKey.parts[0]).toEqual({ literal: "USER" });
    expect(ModernUser.schema).toBeDefined();
    expect(ModernUser.attributes).toBeDefined();
    // Phantom type properties exist on the type but are undefined at runtime
    expect(ModernUser._data).toBeUndefined();
    expect(ModernUser._pk).toBeUndefined();
  });

  it("should create entity with sort key", () => {
    expect(ModernOrder.name).toBe("ModernOrder");
    expect(ModernOrder.partitionKey).toBeDefined();
    expect(ModernOrder.sortKey).toBeDefined();
    expect(ModernOrder.schema).toBeDefined();
    // Phantom type properties exist on the type but are undefined at runtime
    expect(ModernOrder._sk).toBeUndefined();
  });

  it("should support GSI configuration", () => {
    const Product = entity("Product", {
      id: S.string,
      category: S.string,
      name: S.string,
    })
      .partitionKey({ parts: [{ literal: "PRODUCT" }, { attr: "id" }] })
      .gsi("CategoryIndex", {
        pk: { parts: [{ attr: "category" }] },
        projection: "ALL",
      })
      .build();

    expect(Product.name).toBe("Product");
    expect(Product.gsiKeys).toHaveLength(1);
    expect(Product.gsiKeys?.[0].name).toBe("CategoryIndex");
  });

  it("should have phantom types for type inference", () => {
    const TestEntity = entity("Test", {
      id: S.string,
      value: S.number,
    })
      .partitionKey({ parts: [{ attr: "id" }] })
      .build();

    // Phantom types should exist (though undefined at runtime)
    expect(TestEntity._data).toBeUndefined();
    expect(TestEntity._pk).toBeUndefined();

    // But TypeScript knows their types at compile time
    type DataType = typeof TestEntity._data; // { id: string; value: number; }
    type PKType = typeof TestEntity._pk; // { id: string; }
  });

  it("should create entity with complex nested types", () => {
    const ComplexEntity = entity("Complex", {
      id: S.string,
      metadata: S.map({
        created: S.string,
        updated: S.string,
        tags: S.list(S.string),
      }),
      items: S.list(
        S.map({
          id: S.string,
          value: S.number,
        })
      ),
    })
      .partitionKey({ parts: [{ attr: "id" }] })
      .build();

    expect(ComplexEntity.name).toBe("Complex");
    expect(ComplexEntity.attributes.metadata).toBeDefined();
    expect(ComplexEntity.attributes.items).toBeDefined();
  });
});

describe("buildPartitionKey", () => {
  it("should build partition key from entity", () => {
    const key = buildPartitionKey(ModernUser, { id: "456" });
    expect(key).toBe("USER#456");
  });

  it("should build partition key with multiple fields", () => {
    const newEntity = entity("Test", {
      id: S.string,
      type: S.string,
    })
      .partitionKey({ parts: [{ literal: "TEST" }, { attr: "id" }, { attr: "type" }] })
      .build();

    const key = buildPartitionKey(newEntity, { id: "123", type: "A" });
    expect(key).toBe("TEST#123#A");
  });

  it("should build partition key with literal only", () => {
    const StaticEntity = entity("Static", {
      id: S.string,
    })
      .partitionKey({ parts: [{ literal: "STATIC" }] })
      .build();

    const key = buildPartitionKey(StaticEntity, { id: "123" });
    expect(key).toBe("STATIC");
  });
});

describe("buildSortKey", () => {
  it("should build sort key from entity", () => {
    const result = buildSortKey(ModernOrder, { orderId: "order2" });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain("order2");
    }
  });

  it("should error when entity has no sort key", () => {
    const result = buildSortKey(ModernUser, {} as any);
    expect(result.isErr()).toBe(true);
  });

  it("should build sort key with multiple fields", () => {
    const EntityWithCompositeSK = entity("Composite", {
      id: S.string,
      date: S.string,
      sequence: S.string,
    })
      .partitionKey({ parts: [{ attr: "id" }] })
      .sortKey({ parts: [{ attr: "date" }, { literal: "SEQ" }, { attr: "sequence" }] })
      .build();

    const result = buildSortKey(EntityWithCompositeSK, { date: "2024-01-01", sequence: "001" });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("2024-01-01#SEQ#001");
    }
  });
});

describe("entity type inference", () => {
  it("should infer correct data types from entity definition", () => {
    const TypedEntity = entity("Typed", {
      id: S.string,
      count: S.number,
      active: S.boolean,
      data: S.binary,
      tags: S.list(S.string),
      metadata: S.map({
        key: S.string,
        value: S.string,
      }),
      nullable: S.optional(S.string),
    })
      .partitionKey({ parts: [{ attr: "id" }] })
      .build();

    // Verify the entity has all the expected attributes
    expect(TypedEntity.attributes.id).toBeDefined();
    expect(TypedEntity.attributes.count).toBeDefined();
    expect(TypedEntity.attributes.active).toBeDefined();
    expect(TypedEntity.attributes.data).toBeDefined();
    expect(TypedEntity.attributes.tags).toBeDefined();
    expect(TypedEntity.attributes.metadata).toBeDefined();
    expect(TypedEntity.attributes.nullable).toBeDefined();
  });
});
