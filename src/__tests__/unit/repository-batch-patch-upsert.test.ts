/**
 * Tests for repository batch operations, patch, upsert, and database builders
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createDatabase, entity, S, isOk, isErr } from "@/index";
import { Repository } from "@/repository";
import { getContainerClient, startDynamoDBContainer } from "@/__tests__/helpers/testcontainers";
import { setupTestTable, clearTestTable } from "@/__tests__/helpers/dynamodb";

// Simple test entities without required complex fields
const TestUser = entity("TestUser", {
  id: S.string,
  email: S.string,
  name: S.string,
  age: S.number,
})
  .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
  .build();

const TestOrder = entity("TestOrder", {
  userId: S.string,
  orderId: S.string,
  total: S.number,
  status: S.string,
})
  .partitionKey({ parts: [{ literal: "ORDER" }, { attr: "userId" }] })
  .sortKey({ parts: [{ literal: "ORDER" }, { attr: "orderId" }] })
  .build();

// Test database setup
const testTableName = "TestTable";

describe("New Features Integration Tests", () => {
  let client: NonNullable<ReturnType<typeof getContainerClient>>;
  let userRepo: Repository<typeof TestUser>;
  let orderRepo: Repository<typeof TestOrder>;

  beforeAll(async () => {
    let c = getContainerClient();
    if (!c) {
      c = await startDynamoDBContainer();
    }
    client = c!;
    await setupTestTable(client, testTableName);

    const db = createDatabase({ client })
      .table("main", {
        name: testTableName,
        partitionKey: "PK",
        sortKey: "SK",
        typeField: "_type",
      })
      .entities([TestUser, TestOrder])
      .build();

    userRepo = db.tables.main.TestUser;
    orderRepo = db.tables.main.TestOrder;
  });

  describe("Repository Batch Operations", () => {
    it("should batch get multiple items", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      // First, put some test items
      await db.tables.main.TestUser.put({
        id: "batch1",
        email: "batch1@test.com",
        name: "Batch User 1",
        age: 25,
      });

      await db.tables.main.TestUser.put({
        id: "batch2",
        email: "batch2@test.com",
        name: "Batch User 2",
        age: 30,
      });

      // Batch get them
      const result = await db.tables.main.TestUser.batchGet([
        { pk: { id: "batch1" } },
        { pk: { id: "batch2" } },
      ]);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.id).toBe("batch1");
        expect(result.value[1]?.id).toBe("batch2");
      }
    });

    it("should batch put multiple items", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      const items = [
        { id: "batchput1", email: "bp1@test.com", name: "BP1", age: 20 },
        { id: "batchput2", email: "bp2@test.com", name: "BP2", age: 25 },
        { id: "batchput3", email: "bp3@test.com", name: "BP3", age: 30 },
      ];

      const result = await db.tables.main.TestUser.batchPut(items);

      expect(isOk(result)).toBe(true);

      // Verify items were created
      const getResult = await db.tables.main.TestUser.get({ id: "batchput1" });
      expect(isOk(getResult)).toBe(true);
    });

    it("should batch delete multiple items", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      // Create items first
      await db.tables.main.TestUser.batchPut([
        { id: "del1", email: "del1@test.com", name: "Del1", age: 20 },
        { id: "del2", email: "del2@test.com", name: "Del2", age: 25 },
      ]);

      // Delete them
      const result = await db.tables.main.TestUser.batchDelete([
        { pk: { id: "del1" } },
        { pk: { id: "del2" } },
      ]);

      expect(isOk(result)).toBe(true);

      // Verify deletion
      const getResult = await db.tables.main.TestUser.get({ id: "del1" });
      expect(isErr(getResult)).toBe(true);
    });
  });

  describe("Repository Patch Operations", () => {
    it("should patch an item with set operations", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      await db.tables.main.TestUser.put({
        id: "patch1",
        email: "patch@test.com",
        name: "Original Name",
        age: 25,
      });

      const result = await db.tables.main.TestUser.patch(
        { id: "patch1" },
        { set: { name: "Updated Name", age: 30 } }
      );

      expect(isOk(result)).toBe(true);

      // Verify update
      const getResult = await db.tables.main.TestUser.get({ id: "patch1" });
      if (isOk(getResult)) {
        expect(getResult.value.name).toBe("Updated Name");
        expect(getResult.value.age).toBe(30);
      }
    });

    it("should patch with increment operation", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      await db.tables.main.TestUser.put({
        id: "inc1",
        email: "inc@test.com",
        name: "Inc Test",
        age: 25,
      });

      const result = await db.tables.main.TestUser.patch({ id: "inc1" }, { increment: { age: 5 } });

      expect(isOk(result)).toBe(true);

      // Verify increment
      const getResult = await db.tables.main.TestUser.get({ id: "inc1" });
      if (isOk(getResult)) {
        expect(getResult.value.age).toBe(30);
      }
    });
  });

  describe("Repository Upsert Operations", () => {
    it("should upsert create a new item", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      const result = await db.tables.main.TestUser.upsert({
        id: "upsert1",
        email: "upsert@test.com",
        name: "Upsert Test",
        age: 25,
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.created).toBe(true);
      }
    });

    it("should upsert update an existing item", async () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      // Create first
      await db.tables.main.TestUser.put({
        id: "upsert2",
        email: "upsert2@test.com",
        name: "Original",
        age: 25,
      });

      // Upsert should update
      const result = await db.tables.main.TestUser.upsert({
        id: "upsert2",
        email: "upsert2@test.com",
        name: "Updated",
        age: 30,
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.created).toBe(false);
      }
    });
  });

  describe("Database Transaction Builder", () => {
    it("should create a transaction builder", () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      const transaction = db.transaction();
      expect(transaction).toBeDefined();
      expect(typeof transaction.put).toBe("function");
      expect(typeof transaction.execute).toBe("function");
    });
  });

  describe("Database Batch Builder", () => {
    it("should create a batch builder", () => {
      const db = createDatabase({ client })
        .table("main", {
          name: testTableName,
          partitionKey: "PK",
          sortKey: "SK",
          typeField: "_type",
        })
        .entities([TestUser])
        .build();

      const batch = db.batch();
      expect(batch).toBeDefined();
      expect(typeof batch.put).toBe("function");
      expect(typeof batch.execute).toBe("function");
    });
  });
});
