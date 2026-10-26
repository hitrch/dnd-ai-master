import {ToolName, ToolArgsSchemas} from "@dnd/shared";

export function isArrayNotEmpty<T>(arr: T[]): arr is [T, ...T[]] {
  return arr.length > 0
}

export function isTool(name: string): name is ToolName {
  return Object.hasOwn(ToolArgsSchemas, name);
}
