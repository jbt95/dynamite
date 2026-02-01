/**
 * End-to-end tests for Unit of Work pattern using testcontainers.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { Repository, UnitOfWork, TransactionManager, createDatabase, entity, S } from "@/index";
import type { Table } from "@/table";
import { getContainerClient, startDynamoDBContainer } from "@/__tests__/helpers/testcontainers";
import { setupTestTable } from "@/__tests__/helpers/dynamodb";

// Define test entity using the new API
const UOWUser = entity("UOWUser", {
  id: S.string,
  email: S.string,
  name: S.string,
  age: S.number,
  profile: S.map({
    bio: S.string,
    avatar: S.string,
  }),
  tags: S.list(S.string),
})
  .partitionKey({ parts: [{ literal: "UOWUSER" }, { attr: "id" }] })
  .build();

describe("Unit of Work E2E", () => {
  let userRepo: Repository<typeof UOWUser>;
  let uow: UnitOfWork;

  beforeAll(async () => {
    let client = getContainerClient();
    if (!client) {
      client = await startDynamoDBContainer();
    }

    // Create database with test table
    const db = createDatabase({ client })
      .table("test", {
        name: "test-table",
        partitionKey: "PK",
        sortKey: "SK",
        typeField: "_type",
      })
      .entities([UOWUser])
      .build();

    userRepo = db.tables.test.UOWUser;

    // Create a table object that matches what UnitOfWork expects
    // UnitOfWork expects the old Table interface with partitionKey, typeField directly
    const testTable: Table<any, any, any, any> = {
      name: "test-table",
      partitionKey: "PK",
      sortKey: "SK",
      typeField: "_type",
      entities: [UOWUser] as any,
      entityMap: new Map([["UOWUser", UOWUser]]),
    };

    const transactionManager = new TransactionManager(client);
    uow = new UnitOfWork(testTable, transactionManager);

    // Create the table first
    await setupTestTable(client, "test-table");
  }, 120000);

  it("should track and commit new entity", async () => {
    const user = {
      id: "uow-user-1",
      email: "uow1@example.com",
      name: "UOW User 1",
      age: 25,
      profile: {
        bio: "Bio",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    const trackResult = uow.markNew(UOWUser, user);
    expect(trackResult.isOk()).toBe(true);

    const commitResult = await uow.commit();
    if (commitResult.isErr()) {
      console.error("Commit failed:", commitResult.error);
      if (commitResult.error instanceof Error && "metadata" in commitResult.error) {
        console.error("Cause:", (commitResult.error as any).metadata?.cause?.message);
      }
    }
    expect(commitResult.isOk()).toBe(true);

    const getResult = await userRepo.get({ id: "uow-user-1" });
    expect(getResult.isOk()).toBe(true);
    if (getResult.isOk()) {
      expect(getResult.value.name).toBe(user.name);
    }
  });

  it("should track modifications and commit", async () => {
    const user = {
      id: "uow-user-2",
      email: "uow2@example.com",
      name: "UOW User 2",
      age: 25,
      profile: {
        bio: "Original",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    await userRepo.put(user);

    const getResult = await userRepo.get({ id: "uow-user-2" });
    expect(getResult.isOk()).toBe(true);
    if (getResult.isOk()) {
      const tracked = uow.track(UOWUser, getResult.value);
      expect(tracked.isOk()).toBe(true);

      if (tracked.isOk()) {
        tracked.value.name = "Updated Name";
        tracked.value.age = 30;

        const commitResult = await uow.commit();
        if (commitResult.isErr()) {
          console.error("Commit failed:", commitResult.error);
          if (commitResult.error instanceof Error && "metadata" in commitResult.error) {
            console.error("Cause:", (commitResult.error as any).metadata?.cause?.message);
          }
        }
        expect(commitResult.isOk()).toBe(true);

        const verifyResult = await userRepo.get({ id: "uow-user-2" });
        expect(verifyResult.isOk()).toBe(true);
        if (verifyResult.isOk()) {
          expect(verifyResult.value.name).toBe("Updated Name");
          expect(verifyResult.value.age).toBe(30);
        }
      }
    }
  });

  it("should track deletion and commit", async () => {
    const user = {
      id: "uow-user-3",
      email: "uow3@example.com",
      name: "UOW User 3",
      age: 25,
      profile: {
        bio: "Bio",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    await userRepo.put(user);

    const deleteResult = uow.markDeleted(UOWUser, { id: "uow-user-3" });
    expect(deleteResult.isOk()).toBe(true);

    const commitResult = await uow.commit();
    if (commitResult.isErr()) {
      console.error("Delete commit failed:", commitResult.error);
      if (commitResult.error instanceof Error && "metadata" in commitResult.error) {
        console.error("Cause:", (commitResult.error as any).metadata?.cause?.message);
      }
    }
    expect(commitResult.isOk()).toBe(true);

    const getResult = await userRepo.get({ id: "uow-user-3" });
    expect(getResult.isErr()).toBe(true);
  });

  it("should rollback pre-commit changes", async () => {
    const user = {
      id: "uow-user-4",
      email: "uow4@example.com",
      name: "UOW User 4",
      age: 25,
      profile: {
        bio: "Bio",
        avatar: "avatar.jpg",
      },
      tags: [],
    };

    await userRepo.put(user);

    const getResult = await userRepo.get({ id: "uow-user-4" });
    expect(getResult.isOk()).toBe(true);
    if (getResult.isOk()) {
      const tracked = uow.track(UOWUser, getResult.value);
      expect(tracked.isOk()).toBe(true);

      if (tracked.isOk()) {
        tracked.value.name = "Should be rolled back";

        const rollbackResult = await uow.rollback();
        expect(rollbackResult.isOk()).toBe(true);

        // Verify original value is restored
        const verifyResult = await userRepo.get({ id: "uow-user-4" });
        expect(verifyResult.isOk()).toBe(true);
        if (verifyResult.isOk()) {
          expect(verifyResult.value.name).toBe("UOW User 4");
        }
      }
    }
  });
});
