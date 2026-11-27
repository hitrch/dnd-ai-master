import { test } from "node:test"
import assert from "node:assert/strict"
import { z } from "zod"
import { EchoBodySchema } from "@dnd/shared"
import { zodToOpenApiSchema } from "./zod-to-open-api-schema.js"

test("no JSON Schema $schema key (not part of OpenAPI 3.0)", () => {
  const schema = zodToOpenApiSchema(z.object({ name: z.string() }))
  assert.equal("$schema" in schema, false)
})

test("field with default is optional: the client may omit it", () => {
  const schema = zodToOpenApiSchema(
    z.object({ name: z.string(), description: z.string().default("none") }),
  )
  assert.deepEqual(schema.required, ["name"])
  assert.deepEqual(schema.properties?.description, { type: "string", default: "none" })
})

test("optional field is not required", () => {
  const schema = zodToOpenApiSchema(z.object({ name: z.string(), note: z.string().optional() }))
  assert.deepEqual(schema.required, ["name"])
})

test("stripping object does not forbid extra keys (the pipe drops them, not rejects)", () => {
  const schema = zodToOpenApiSchema(z.object({ name: z.string() }))
  assert.equal("additionalProperties" in schema, false)
})

test("strict object forbids extra keys", () => {
  const schema = zodToOpenApiSchema(z.object({ name: z.string() }).strict())
  assert.equal(schema.additionalProperties, false)
})

test("nullable uses the OpenAPI 3.0 form", () => {
  const schema = zodToOpenApiSchema(z.object({ note: z.string().nullable() }))
  assert.deepEqual(schema.properties?.note, { type: "string", nullable: true })
})

test("exclusive bounds use the OpenAPI 3.0 boolean form", () => {
  const schema = zodToOpenApiSchema(z.object({ n: z.number().gt(5).lt(10) }))
  assert.deepEqual(schema.properties?.n, {
    type: "number",
    minimum: 5,
    exclusiveMinimum: true,
    maximum: 10,
    exclusiveMaximum: true,
  })
})

test("transform is documented by its input type", () => {
  const schema = zodToOpenApiSchema(z.object({ count: z.string().transform(Number) }))
  assert.deepEqual(schema.properties?.count, { type: "string" })
})

test("constraints and enums are kept", () => {
  const schema = zodToOpenApiSchema(
    z.object({ name: z.string().min(1).max(50), kind: z.literal(["a", "b"]) }),
  )
  assert.deepEqual(schema.properties?.name, { type: "string", minLength: 1, maxLength: 50 })
  assert.deepEqual(schema.properties?.kind, { type: "string", enum: ["a", "b"] })
})

test("EchoBodySchema: full documented shape", () => {
  assert.deepEqual(zodToOpenApiSchema(EchoBodySchema), {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 50 },
      description: { type: "string", default: "No description provided" },
    },
    required: ["name"],
  })
})
