# Agent Instructions

**dynamite** - A type-safe DynamoDB library for TypeScript with first-class support for single-table design, multi-table operations, and full type inference.

## Quick Start

```bash
# Install dependencies
bun install

# Build
bun run build

# Run all tests
bun test

# Run specific test suites
bun run test:unit
bun run test:integration
bun run test:e2e

# Type check
bun run typecheck

# Format code
bun run format

# Check formatting
bun run format:check
```

## Architecture

```
src/
├── core/
│   └── paths.ts          # Path utilities (Paths<T>, PathValue, etc.)
├── entity/
│   ├── builder.ts        # New entity() API
│   ├── types.ts          # Entity type definitions
│   └── index.ts          # Legacy EntityBuilder
├── database/
│   ├── builder.ts        # createDatabase() API
│   └── types.ts          # Database types
├── schema/
│   ├── index.ts          # S schema definition API
│   └── definitions.ts    # Schema implementations
├── operations/
│   ├── query.ts          # QueryBuilder
│   ├── scan.ts           # ScanBuilder
│   ├── update.ts         # UpdateExpressionBuilder
│   └── repository.ts     # Repository class
├── table.ts              # Table definition (legacy)
├── keys.ts               # Key template utilities
├── result.ts             # Result monad (Ok/Err)
├── client.ts             # DynamoDB client wrapper
├── expressions.ts        # DynamoDB expression helpers
└── errors.ts             # Error types and helpers
```

### Module Relationships

1. **Schema** (`src/schema/`) - Single source of truth for type inference
2. **Entity** (`src/entity/`) - Defines typed data models with keys
3. **Database** (`src/database/`) - Multi-table registry with typed repositories
4. **Operations** - Build and execute DynamoDB operations
5. **Core** (`src/core/`) - Type utilities (Paths, PathValue)

## Key Patterns

### 1. Result Monad (Error Handling)

All operations return `Result<T, Error>` instead of throwing:

```typescript
import { ok, err, isOk, isErr } from "@/result";

const result = await repo.get({ id: "123" });

if (isOk(result)) {
  return result.value; // T
}

// Handle error
return result.error; // Error
```

- **Always** return `Result` from public APIs
- Use `tryCatch()` to wrap async operations
- Never throw in library code

### 2. Phantom Types for Type Inference

Entities use phantom types (`_data`, `_pk`, `_sk`) for compile-time type extraction:

```typescript
interface Entity {
  readonly _data: TData;      // Extract via EntityType<T>
  readonly _pk: TPkData;      // Extract via EntityPK<T>
  readonly _sk?: TSkData;     // Extract via EntitySK<T>
}
```

These are `undefined` at runtime but carry type information for TypeScript.

### 3. Builder Pattern

Use fluent builders for configuration:

```typescript
// Entity builder
const User = entity("User", { id: S.string })
  .partitionKey({ parts: [{ literal: "USER" }, { attr: "id" }] })
  .sortKey({ parts: [{ attr: "id" }] })
  .gsi("EmailIndex", { pk: { parts: [{ attr: "email" }] } })
  .build();

// Database builder
const db = createDatabase({ client })
  .table("main", { name: "my-table", partitionKey: "PK" })
  .entities([User, Order])
  .build();
```

### 4. Type-Safe Paths with `Paths<T>`

Deep dot-notation paths for type-safe field access:

```typescript
type User = { profile: { name: string; tags: string[] } };
type UserPaths = Paths<User>; // "profile" | "profile.name" | "profile.tags"
```

Used in:
- Query/scan `.where("field.path", operator, value)`
- Update `.set("field.path", value)`
- Projections `.select("field", "nested.path")`

## Common Tasks

### Add a New Entity

```typescript
// 1. Define in src/__tests__/helpers/test-entities.ts (for tests)
export const Product = entity("Product", {
  id: S.string,
  name: S.string,
  price: S.number,
  category: S.string,
})
  .partitionKey({ parts: [{ literal: "PRODUCT" }, { attr: "id" }] })
  .gsi("CategoryIndex", {
    pk: { parts: [{ attr: "category" }] },
    projection: "ALL",
  })
  .build();

// 2. Type inference works automatically
type ProductType = EntityType<typeof Product>;
type ProductPK = EntityPK<typeof Product>; // { id: string }
```

### Add a New Query Method

```typescript
// In src/query.ts or new file
export class QueryBuilder<T> {
  // Add new fluent method
  sortKeyBeginsWith(prefix: string): this {
    this.state.keyCondition += ` AND begins_with(#sk, :prefix)`;
    this.state.context.values[":prefix"] = prefix;
    return this;
  }

  // Add terminal operation
  async toArray(): Promise<Result<T[], DynamoError>> {
    const items: T[] = [];
    for await (const item of this.execute()) {
      items.push(item);
    }
    return ok(items);
  }
}
```

### Add a New Operation

1. Create builder class in `src/operations/` or root
2. Implement fluent API returning `this` for chaining
3. Implement terminal methods returning `Result<T, Error>`
4. Export from `src/index.ts`
5. Add tests in `src/__tests__/unit/`

Example pattern:

```typescript
export class NewOperationBuilder<T> {
  private state: OperationState;

  constructor(/* deps */) {
    this.state = { /* initial */ };
  }

  // Fluent config
  withOption(value: string): this {
    this.state.option = value;
    return this;
  }

  // Terminal - returns Result
  async execute(): Promise<Result<T, DynamoError>> {
    try {
      const result = await this.performOperation();
      return ok(result);
    } catch (error) {
      return err(fromAwsError(error));
    }
  }
}
```

### Testing Guidelines

**Unit tests** (`src/__tests__/unit/`):
- Test pure logic without DynamoDB
- Test type inference with `expectTypeOf` pattern
- Mock AWS SDK when needed

**Integration tests** (`src/__tests__/integration/`):
- Test with DynamoDB Local
- Start container: `docker-compose -f docker-compose.test.yml up -d`
- Set `DYNAMODB_ENDPOINT=http://localhost:8000`

**E2E tests** (`src/__tests__/e2e/`):
- Test full workflows
- Use test entities from `src/__tests__/helpers/test-entities.ts`

**Test naming**:
- `describe("ComponentName", () => {})`
- `it("should [expected behavior] when [condition]", () => {})`

## Code Standards

### TypeScript

- **No `any`** (except in generic constraints where unavoidable)
- Use explicit return types on all public APIs
- Prefer `readonly` arrays and properties
- Use type imports: `import type { Foo } from "..."`

### Formatting (Prettier)

- 100 character line width
- Semicolons required
- Double quotes
- 2-space indentation
- Trailing commas (ES5)

```bash
bun run format      # Fix formatting
bun run format:check # Check only
```

### Error Handling

```typescript
// Good - explicit error handling
public async get(key: EntityPK<T>): Promise<Result<EntityType<T>, DynamoError>> {
  try {
    const result = await this.client.send(new GetItemCommand(params));
    if (!result.Item) {
      return err(notFoundError(`Entity not found: ${key}`));
    }
    return ok(unmarshalItem(result.Item) as EntityType<T>);
  } catch (error) {
    return err(fromAwsError(error));
  }
}

// Bad - throwing or implicit returns
public async get(key: EntityPK<T>): Promise<EntityType<T>> {
  const result = await this.client.send(new GetItemCommand(params));
  return result.Item; // May be undefined!
}
```

### Control Flow

Prefer early returns:

```typescript
// Good
if (!isValid(key)) {
  return err(validationError("Invalid key"));
}
if (isCacheHit(key)) {
  return ok(cache.get(key));
}
return await fetchFromDb(key);

// Bad
if (isValid(key)) {
  if (isCacheHit(key)) {
    return ok(cache.get(key));
  } else {
    return await fetchFromDb(key);
  }
} else {
  return err(validationError("Invalid key"));
}
```

## Type System Deep Dive

### How `Paths<T>` Works

```typescript
type Paths<T> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends Array<infer U>
        ? K | `${K}[${number}]` | `${K}[${number}].${Paths<U>}`
        : T[K] extends object
        ? K | `${K}.${Paths<T[K]>}`
        : K;
    }[keyof T & string]
  : never;
```

Recursively builds dot-notation paths for any object type:
- `Paths<{a: {b: string}}>` → `"a" | "a.b"`
- `Paths<{items: {name: string}[]}>` → `"items" | "items[0]" | "items[0].name"`

### How `EntityType<T>` Extracts Data

```typescript
export type EntityType<T extends Entity<any, any, any, any, any>> = T["_data"];

const User = entity("User", { id: S.string }).build();
type UserType = EntityType<typeof User>; // { id: string }
```

The phantom `_data` property carries the inferred TypeScript type at compile time.

### Key Types

```typescript
// Partition key input type
export type EntityPK<T extends Entity<any, any, any, any, any>> = T["_pk"];

// Sort key input type (undefined if no SK)
export type EntitySK<T extends Entity<any, any, any, any, any>> = T["_sk"];

// GSI keys array
export type EntityGSIs<T extends Entity<any, any, any, any, any>> = T["gsiKeys"];
```

These extract key requirements from the entity definition for type-safe operations.

## Do / Don't

### Do
- ✓ Run `bun run typecheck` before committing
- ✓ Run `bun run format` to fix formatting
- ✓ Use `Result<T, Error>` for all operations that can fail
- ✓ Add return types to public functions
- ✓ Use `readonly` for immutable data
- ✓ Test both success and error paths
- ✓ Export types with `export type` when not needed at runtime

### Don't
- ✗ Use `any` (except in unavoidable generic constraints)
- ✗ Throw errors (return `Err` instead)
- ✗ Mutate parameters
- ✗ Skip tests for new features
- ✗ Commit without running typecheck and format
- ✗ Use `console.log` in library code (use proper logging or remove)

## References

- [README.md](./README.md) - Full documentation
- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) - Development roadmap
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines (if exists)
