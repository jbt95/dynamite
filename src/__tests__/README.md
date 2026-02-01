# Test Suite

This directory contains comprehensive tests for the DynamoDB TypeScript library.

## Test Structure

- **Unit Tests** (`unit/`): Test individual modules in isolation
- **Integration Tests** (`integration/`): Test interactions between modules with a real DynamoDB instance
- **E2E Tests** (`e2e/`): Test complete workflows end-to-end

## Running Tests

### All Tests

```bash
bun test
```

### Unit Tests Only

```bash
bun run test:unit
```

### Integration Tests Only

```bash
bun run test:integration
```

### E2E Tests Only

```bash
bun run test:e2e
```

## Setting Up DynamoDB Local

Integration and E2E tests require a running DynamoDB instance. Use DynamoDB Local:

### Using Docker Compose

```bash
docker-compose -f docker-compose.test.yml up -d
```

### Manual Setup

```bash
docker run -p 8000:8000 amazon/dynamodb-local
```

### Environment Variables

Set the following environment variable to point tests to DynamoDB Local:

```bash
export DYNAMODB_ENDPOINT=http://localhost:8000
```

Or for AWS:

```bash
export AWS_REGION=us-east-1
```

## Test Coverage

### Unit Tests

- ✅ Result monad (ok, err, map, flatMap, etc.)
- ✅ Error handling (DynamoError, error factories)
- ✅ Schema definition and marshalling
- ✅ Key templates (build, parse, extract)
- ✅ Entity definition
- ✅ Table registry
- ✅ Update expressions
- ✅ Filter builder
- ✅ Expression building
- ✅ Hooks system

### Integration Tests

- ✅ Repository CRUD operations
- ✅ Query operations
- ✅ Update operations
- ✅ Delete operations
- ✅ Existence checks

### E2E Tests

- ✅ Unit of Work pattern
- ✅ Change tracking
- ✅ Commit and rollback
- ✅ Transactions
- ✅ Multi-item operations

## Writing New Tests

### Unit Test Example

```typescript
import { describe, it, expect } from "vitest";
import { ok } from "@/result";

describe("MyModule", () => {
  it("should do something", () => {
    const result = ok(42);
    expect(result.isOk()).toBe(true);
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, Repository } from "@/index";

describe.skipIf(!process.env.DYNAMODB_ENDPOINT)("Integration", () => {
  let repo: Repository<typeof MyEntity>;

  beforeAll(() => {
    const client = createClient({
      endpoint: process.env.DYNAMODB_ENDPOINT,
    });
    repo = new Repository(client, table, MyEntity);
  });

  it("should work with real DynamoDB", async () => {
    // Test implementation
  });
});
```

## Test Helpers

### Test Entities

Use `test-entities.ts` for common test entities (User, Order, etc.).

### DynamoDB Helpers

Use `dynamodb.ts` for DynamoDB Local setup and teardown.

## Notes

- Integration and E2E tests are skipped if `DYNAMODB_ENDPOINT` or `AWS_REGION` is not set
- Tests use Vitest as the test runner
- All tests use the Result monad for error handling
- Test data is isolated per test to avoid conflicts
