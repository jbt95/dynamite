/**
 * Filter expression builder for queries and scans.
 *
 * Provides a fluent, type-safe API for building filter expressions.
 */

import {
  ExpressionContext,
  createExpressionContext,
  buildComparison,
  buildLogical,
  ComparisonOperator,
  LogicalOperator,
} from "@/expressions";
import { err, ok, Result } from "@/result";
import { validationError } from "@/errors";
import { Paths } from "@/types";

/**
 * Filter expression builder.
 */
export class FilterBuilder<T extends Record<string, unknown> = Record<string, unknown>> {
  private expressions: string[] = [];

  constructor(private readonly context: ExpressionContext) {}

  /**
   * Add a comparison condition.
   */
  where(
    fieldPath: Paths<T>,
    operator: ComparisonOperator,
    value?: unknown | [unknown, unknown]
  ): FilterBuilder<T> {
    try {
      const expr = buildComparison(this.context, fieldPath as string, operator, value);
      this.expressions.push(expr);
      return this;
    } catch (error) {
      throw error instanceof Error ? error : new Error(`Failed to build filter: ${String(error)}`);
    }
  }

  /**
   * Add an AND condition.
   */
  and(
    fieldPath: Paths<T>,
    operator: ComparisonOperator,
    value?: unknown | [unknown, unknown]
  ): FilterBuilder<T> {
    return this.where(fieldPath, operator, value);
  }

  /**
   * Add an OR condition.
   */
  or(
    fieldPath: Paths<T>,
    operator: ComparisonOperator,
    value?: unknown | [unknown, unknown]
  ): FilterBuilder<T> {
    try {
      const expr = buildComparison(this.context, fieldPath as string, operator, value);
      // Combine last expression with new one using OR
      if (this.expressions.length > 0) {
        const lastExpr = this.expressions.pop()!;
        this.expressions.push(buildLogical("OR", lastExpr, expr));
      } else {
        this.expressions.push(expr);
      }
      return this;
    } catch (error) {
      throw error instanceof Error ? error : new Error(`Failed to build filter: ${String(error)}`);
    }
  }

  /**
   * Negate the last condition.
   */
  not(): FilterBuilder<T> {
    if (this.expressions.length === 0) {
      throw new Error("Cannot negate empty filter");
    }
    const lastExpr = this.expressions.pop()!;
    this.expressions.push(buildLogical("NOT", lastExpr));
    return this;
  }

  /**
   * Build the filter expression string.
   */
  build(): Result<
    {
      expression: string;
      names: Record<string, string>;
      values: Record<string, unknown>;
    },
    Error
  > {
    if (this.expressions.length === 0) {
      return err(validationError("Filter expression cannot be empty"));
    }

    const expression =
      this.expressions.length === 1
        ? this.expressions[0]
        : buildLogical("AND", ...this.expressions);

    return ok({
      expression,
      names: this.context.names,
      values: this.context.values,
    });
  }
}

/**
 * Create a new filter builder.
 */
export function createFilterBuilder<T extends Record<string, unknown> = Record<string, unknown>>(
  context?: ExpressionContext
): FilterBuilder<T> {
  return new FilterBuilder<T>(context || createExpressionContext());
}
