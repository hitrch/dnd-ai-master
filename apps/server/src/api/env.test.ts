import { test } from "node:test"
import assert from "node:assert/strict"
import { type Env, validate } from "./env.js"

const validRaw = {
  PORT: "3001",
  POSTGRES_HOST: "127.0.0.1",
  POSTGRES_PORT: "5432",
  POSTGRES_USER: "dnd",
  POSTGRES_PASSWORD: "secret",
  POSTGRES_DB: "dnd",
}

function without(key: keyof typeof validRaw): Record<string, string> {
  const copy: Record<string, string> = { ...validRaw }
  delete copy[key]
  return copy
}

function validationMessage(raw: unknown): string {
  try {
    validate(raw)
  } catch (error) {
    assert.ok(error instanceof Error, "expected an Error")
    return error.message
  }
  assert.fail("expected validate to throw")
}

test("valid env: strings are parsed, ports become numbers", () => {
  const env = validate(validRaw)

  assert.deepEqual(env, {
    PORT: 3001,
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: 5432,
    POSTGRES_USER: "dnd",
    POSTGRES_PASSWORD: "secret",
    POSTGRES_DB: "dnd",
  })
})

test("valid env: unrelated variables are dropped", () => {
  const env = validate({ ...validRaw, GROQ_API_KEY: "key", PATH: "C:\\Windows" })

  assert.equal("GROQ_API_KEY" in env, false)
  assert.equal("PATH" in env, false)
})

test("valid env: PORT defaults to 3000 when missing", () => {
  assert.equal(validate(without("PORT")).PORT, 3000)
})

test("valid env: the input object is not mutated", () => {
  const raw = { ...validRaw }

  validate(raw)

  assert.deepEqual(raw, validRaw)
})

test("valid env: port bounds 1 and 65535 are accepted", () => {
  for (const value of ["1", "65535"]) {
    const env = validate({ ...validRaw, PORT: value, POSTGRES_PORT: value })
    assert.equal(env.PORT, Number(value))
    assert.equal(env.POSTGRES_PORT, Number(value))
  }
})

test("invalid env: every required variable is reported by name when missing", () => {
  const required = [
    "POSTGRES_HOST",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
  ] as const

  for (const key of required) {
    const message = validationMessage(without(key))
    assert.match(message, /Invalid environment variables/)
    assert.ok(message.includes(key), `expected ${key} in: ${message}`)
  }
})

test("invalid env: empty strings are rejected", () => {
  const keys = [
    "POSTGRES_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
    "POSTGRES_PORT",
  ] as const

  for (const key of keys) {
    const message = validationMessage({ ...validRaw, [key]: "" })
    assert.ok(message.includes(key), `expected ${key} in: ${message}`)
  }
})

test("invalid env: an empty PORT is rejected, not replaced by the default", () => {
  assert.ok(validationMessage({ ...validRaw, PORT: "" }).includes("PORT"))
})

test("invalid env: ports that are not integers in 1..65535 are rejected", () => {
  for (const value of ["0", "-1", "65536", "12.5", "abc", " "]) {
    for (const key of ["PORT", "POSTGRES_PORT"] as const) {
      const message = validationMessage({ ...validRaw, [key]: value })
      assert.ok(message.includes(key), `expected ${key} for "${value}" in: ${message}`)
    }
  }
})

test("invalid env: all problems are reported at once", () => {
  const message = validationMessage({ PORT: "abc" })

  for (const key of ["PORT", "POSTGRES_HOST", "POSTGRES_PASSWORD"]) {
    assert.ok(message.includes(key), `expected ${key} in: ${message}`)
  }
})

test("invalid env: a non-object input is rejected", () => {
  for (const raw of [undefined, null, "PORT=3000", 42]) {
    assert.match(validationMessage(raw), /Invalid environment variables/)
  }
})

test("types: ports are numbers in Env", () => {
  const env: Env = validate(validRaw)
  const port: number = env.PORT
  const dbPort: number = env.POSTGRES_PORT
  // @ts-expect-error -- ports are not strings after validation
  const asString: string = env.POSTGRES_PORT

  assert.equal(typeof port, "number")
  assert.equal(typeof dbPort, "number")
  assert.equal(typeof asString, "number")
})
