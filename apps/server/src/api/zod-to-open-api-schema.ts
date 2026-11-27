import type { SchemaObject } from "@nestjs/swagger"
import { z } from "zod"

export function zodToOpenApiSchema(schema: z.ZodType): SchemaObject {
  // The cast is safe: with target "openapi-3.0" Zod emits an OpenAPI 3.0 Schema Object,
  // which is what Swagger's SchemaObject describes. io "input" documents what the client sends.
  return z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" }) as SchemaObject
}
