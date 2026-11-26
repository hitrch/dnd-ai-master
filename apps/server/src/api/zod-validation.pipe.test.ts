import { test } from "node:test"
import assert from "node:assert/strict"
import { BadRequestException } from "@nestjs/common"
import { z } from "zod"
import { ZodValidationPipe } from "./zod-validation.pipe.js"

const BodySchema = z.object({
  name: z.string().trim().min(1).max(10),
  tags: z.array(z.string()).default([]),
})

function catchError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  assert.fail("expected the call to throw")
}

function assertBadRequest(error: unknown): string {
  assert.ok(error instanceof BadRequestException, "expected BadRequestException")
  assert.equal(error.getStatus(), 400)
  const response = error.getResponse()
  assert.ok(typeof response === "object" && response !== null && "message" in response)
  assert.equal(typeof response.message, "string")
  return response.message as string
}

test("valid input: returns the parsed data", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  const result = pipe.transform({ name: "Arwen", tags: ["elf"] })

  assert.deepEqual(result, { name: "Arwen", tags: ["elf"] })
})

test("valid input: unknown keys are stripped", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  const result = pipe.transform({ name: "Arwen", tags: [], isAdmin: true })

  assert.deepEqual(result, { name: "Arwen", tags: [] })
})

test("valid input: defaults are filled in", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  const result = pipe.transform({ name: "Arwen" })

  assert.deepEqual(result, { name: "Arwen", tags: [] })
})

test("valid input: transforms are applied (output, not input)", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  const result = pipe.transform({ name: "  Arwen  " })

  assert.equal(result.name, "Arwen")
})

test("valid input: the input object is not mutated", () => {
  const pipe = new ZodValidationPipe(BodySchema)
  const input = { name: "Arwen", extra: 1 }

  pipe.transform(input)

  assert.deepEqual(input, { name: "Arwen", extra: 1 })
})

test("invalid input: missing field throws BadRequestException naming the field", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  const message = assertBadRequest(catchError(() => pipe.transform({ tags: [] })))

  assert.match(message, /name/)
})

test("invalid input: constraint violation throws BadRequestException", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  assertBadRequest(catchError(() => pipe.transform({ name: "" })))
  assertBadRequest(catchError(() => pipe.transform({ name: "a".repeat(11) })))
  assertBadRequest(catchError(() => pipe.transform({ name: "   " })))
})

test("invalid input: wrong type of a field throws BadRequestException", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  const message = assertBadRequest(catchError(() => pipe.transform({ name: "Arwen", tags: "elf" })))

  assert.match(message, /tags/)
})

test("invalid input: non-object bodies throw BadRequestException, not a generic error", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  for (const value of [undefined, null, "Arwen", 42, [], [{ name: "Arwen" }]]) {
    assertBadRequest(catchError(() => pipe.transform(value)))
  }
})

test("works with non-object schemas", () => {
  const pipe = new ZodValidationPipe(z.coerce.number().int())

  assert.equal(pipe.transform("7"), 7)
  assertBadRequest(catchError(() => pipe.transform("seven")))
})

test("each pipe uses its own schema", () => {
  const namePipe = new ZodValidationPipe(z.object({ name: z.string() }))
  const agePipe = new ZodValidationPipe(z.object({ age: z.number() }))

  assert.deepEqual(namePipe.transform({ name: "Arwen", age: 1 }), { name: "Arwen" })
  assert.deepEqual(agePipe.transform({ name: "Arwen", age: 1 }), { age: 1 })
  assertBadRequest(catchError(() => agePipe.transform({ name: "Arwen" })))
})

test("output type is inferred from the schema (checked by tsc)", () => {
  const pipe = new ZodValidationPipe(BodySchema)

  // Compiles only if transform returns z.output of the schema: tags is required after parsing.
  const result: { name: string; tags: string[] } = pipe.transform({ name: "Arwen" })

  assert.deepEqual(result.tags, [])
})
