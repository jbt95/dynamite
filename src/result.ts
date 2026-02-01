/**
 * Result monad for explicit error handling.
 *
 * A Result represents either a success (Ok) or failure (Err) value.
 * This eliminates the need for null/undefined returns and provides
 * type-safe error handling.
 *
 * @example
 * ```ts
 * const result = ok(42);
 * const doubled = result.map(x => x * 2);
 * ```
 */

/**
 * Result type representing either success (Ok) or failure (Err).
 */
export type Result<T, E> = Ok<T> | Err<E>;

export const Result = {} as const;

/**
 * Success variant of Result.
 */
export class Ok<T> {
  readonly _tag = "Ok" as const;
  readonly value: T;

  constructor(value: T) {
    this.value = value;
  }

  /**
   * Transform the success value.
   */
  map<U>(fn: (value: T) => U): Ok<U> {
    return ok(fn(this.value));
  }

  /**
   * Chain Results together.
   */
  flatMap<U, E>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  /**
   * Transform the error value (no-op for Ok).
   */
  mapErr<F>(_fn: (error: never) => F): Ok<T> {
    return this;
  }

  /**
   * Pattern match on Result.
   */
  match<U>(onOk: (value: T) => U, _onErr: (error: never) => U): U {
    return onOk(this.value);
  }

  /**
   * Unwrap the value, throwing if Result is Err.
   */
  unwrap(): T {
    return this.value;
  }

  /**
   * Unwrap the value or return default.
   */
  unwrapOr(_default: T): T {
    return this.value;
  }

  /**
   * Unwrap the value or compute default.
   */
  unwrapOrElse(_fn: (error: never) => T): T {
    return this.value;
  }

  /**
   * Type guard to check if Result is Ok.
   */
  isOk(): this is Ok<T> {
    return true;
  }

  /**
   * Type guard to check if Result is Err.
   */
  isErr(): this is Err<never> {
    return false;
  }
}

/**
 * Error variant of Result.
 */
export class Err<E> {
  readonly _tag = "Err" as const;
  readonly error: E;

  constructor(error: E) {
    this.error = error;
  }

  /**
   * Transform the success value (no-op for Err).
   */
  map<U>(_fn: (value: never) => U): Err<E> {
    return this;
  }

  /**
   * Chain Results together (no-op for Err).
   */
  flatMap<U, F>(_fn: (value: never) => Result<U, F>): Result<U, F> {
    return this as unknown as Err<F>;
  }

  /**
   * Transform the error value.
   */
  mapErr<F>(fn: (error: E) => F): Err<F> {
    return err(fn(this.error));
  }

  /**
   * Pattern match on Result.
   */
  match<U>(_onOk: (value: never) => U, onErr: (error: E) => U): U {
    return onErr(this.error);
  }

  /**
   * Unwrap the value, throwing if Result is Err.
   */
  unwrap(): never {
    throw new Error(`Attempted to unwrap Err: ${this.error}`);
  }

  /**
   * Unwrap the value or return default.
   */
  unwrapOr<T>(defaultValue: T): T {
    return defaultValue;
  }

  /**
   * Unwrap the value or compute default.
   */
  unwrapOrElse<T>(fn: (error: E) => T): T {
    return fn(this.error);
  }

  /**
   * Type guard to check if Result is Ok.
   */
  isOk(): this is Ok<never> {
    return false;
  }

  /**
   * Type guard to check if Result is Err.
   */
  isErr(): this is Err<E> {
    return true;
  }
}

/**
 * Create an Ok Result.
 */
export function ok<T>(value: T): Ok<T> {
  return new Ok(value);
}

/**
 * Create an Err Result.
 */
export function err<E>(error: E): Err<E> {
  return new Err(error);
}

/**
 * Type guard to check if Result is Ok.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.isOk();
}

/**
 * Type guard to check if Result is Err.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.isErr();
}

/**
 * Wrap an async operation in a Result.
 * Catches errors and converts them to Err.
 *
 * @example
 * ```ts
 * const result = await tryCatch(async () => {
 *   return await someAsyncOperation();
 * });
 * ```
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>>;
export async function tryCatch<T>(fn: () => T): Promise<Result<T, Error>>;
export async function tryCatch<T>(fn: () => Promise<T> | T): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Combine an array of Results into a Result of array.
 * Returns the first error encountered, or Ok with all values.
 *
 * @example
 * ```ts
 * const results = [ok(1), ok(2), ok(3)];
 * const combined = collect(results); // Ok([1, 2, 3])
 * ```
 */
export function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (result.isErr()) {
      return result as unknown as Err<E>;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Map over an array and collect Results.
 * Short-circuits on first error.
 *
 * @example
 * ```ts
 * const numbers = [1, 2, 3];
 * const results = traverse(numbers, n => ok(n * 2)); // Ok([2, 4, 6])
 * ```
 */
export function traverse<T, U, E>(items: T[], fn: (item: T) => Result<U, E>): Result<U[], E> {
  return collect(items.map(fn));
}
