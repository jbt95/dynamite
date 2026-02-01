/**
 * Unit tests for table definition using the new API.
 */

import { describe, it, expect } from "vitest";
import { resolveEntity, getEntity } from "@/table";
import { createDatabase } from "@/index";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ModernUser, ModernOrder } from "@/__tests__/helpers/test-entities";
import type { Table } from "@/table";

describe("createDatabase (New API)", () => {
  const mockClient = {} as DynamoDBClient;

  it("should create database with single table", () => {
    const db = createDatabase({ client: mockClient })
      .table("main", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
        typeField: "_type",
      })
      .entities([ModernUser, ModernOrder])
      .build();

    expect(db.client).toBe(mockClient);
    expect(db.tables.main).toBeDefined();
    expect(db.tables.main.table.name).toBe("main");
    expect(db.tables.main.table.config.name).toBe("test-table");
    // Repositories are now directly accessible (no .repos layer)
    expect(db.tables.main.ModernUser).toBeDefined();
    expect(db.tables.main.ModernOrder).toBeDefined();
  });

  it("should create database with multiple tables", () => {
    const db = createDatabase({ client: mockClient })
      .table("users", {
        name: "users-table",
        partitionKey: "PK",
      })
      .entities([ModernUser])
      .table("orders", {
        name: "orders-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([ModernOrder])
      .build();

    expect(db.tables.users).toBeDefined();
    expect(db.tables.orders).toBeDefined();
    expect(db.tables.users.ModernUser).toBeDefined();
    expect(db.tables.orders.ModernOrder).toBeDefined();
  });

  it("should provide repository with query method", () => {
    const db = createDatabase({ client: mockClient })
      .table("main", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([ModernUser, ModernOrder])
      .build();

    // Direct access without .repos
    const userRepo = db.tables.main.ModernUser;
    const query = userRepo.query({ id: "123" });

    expect(query).toBeDefined();
    expect(typeof query.toArray).toBe("function");
    expect(typeof query.where).toBe("function");
    expect(typeof query.select).toBe("function");
  });

  it("should provide repository with scan method", () => {
    const db = createDatabase({ client: mockClient })
      .table("main", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([ModernUser])
      .build();

    // Direct access without .repos
    const userRepo = db.tables.main.ModernUser;
    const scan = userRepo.scan();

    expect(scan).toBeDefined();
    expect(typeof scan.toArray).toBe("function");
    expect(typeof scan.where).toBe("function");
  });

  it("should support sort key operations on entities with sort keys", () => {
    const db = createDatabase({ client: mockClient })
      .table("main", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([ModernOrder])
      .build();

    // Direct access without .repos
    const orderRepo = db.tables.main.ModernOrder;
    const query = orderRepo.query({ userId: "user-123" }).sortKeyBeginsWith("ORDER#2024");

    expect(query).toBeDefined();
  });

  it("should provide getRepository method for direct entity access", () => {
    const db = createDatabase({ client: mockClient })
      .table("main", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
      })
      .entities([ModernUser, ModernOrder])
      .build();

    // Single argument version
    const userRepo = db.getRepository(ModernUser);
    expect(userRepo).toBeDefined();
    expect(typeof userRepo.get).toBe("function");
    expect(typeof userRepo.query).toBe("function");

    // Two argument version
    const userRepo2 = db.getRepository("main", ModernUser);
    expect(userRepo2).toBeDefined();
  });
});

describe("resolveEntity", () => {
  it("should resolve entity by type", () => {
    // Create a mock table for testing
    const mockTable = {
      name: "test",
      partitionKey: "PK",
      sortKey: "SK",
      typeField: "_type",
      entities: [ModernUser, ModernOrder],
      entityMap: new Map<string, any>([
        ["ModernUser", ModernUser],
        ["ModernOrder", ModernOrder],
      ]),
    } as Table<any, any, any, any>;

    const result = resolveEntity(mockTable, "ModernUser");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.name).toBe("ModernUser");
    }
  });

  it("should error on unknown entity type", () => {
    const mockTable = {
      name: "test",
      partitionKey: "PK",
      typeField: "_type",
      entities: [ModernUser],
      entityMap: new Map<string, any>([["ModernUser", ModernUser]]),
    } as Table<any, any, any, any>;

    const result = resolveEntity(mockTable, "Unknown");
    expect(result.isErr()).toBe(true);
  });
});

describe("getEntity", () => {
  it("should get entity by name", () => {
    const mockTable = {
      name: "test",
      partitionKey: "PK",
      typeField: "_type",
      entities: [ModernUser, ModernOrder],
      entityMap: new Map<string, any>([
        ["ModernUser", ModernUser],
        ["ModernOrder", ModernOrder],
      ]),
    } as Table<any, any, any, any>;

    const result = getEntity(mockTable, "ModernUser");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.name).toBe("ModernUser");
    }
  });

  it("should error on non-existent entity", () => {
    const mockTable = {
      name: "test",
      partitionKey: "PK",
      typeField: "_type",
      entities: [ModernUser],
      entityMap: new Map<string, any>([["ModernUser", ModernUser]]),
    } as Table<any, any, any, any>;

    const result = getEntity(mockTable, "NonExistent");
    expect(result.isErr()).toBe(true);
  });
});
