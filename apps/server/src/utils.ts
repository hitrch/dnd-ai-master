import {ToolArgsSchemas} from "@dnd/shared";
import type {ToolName} from "@dnd/shared";

export function isArrayNotEmpty<T>(arr: T[]): arr is [T, ...T[]] {
  return arr.length > 0
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}


export function isTool(name: string): name is ToolName {
  return Object.hasOwn(ToolArgsSchemas, name);
}
