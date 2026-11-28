import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import { Logger, ServiceUnavailableException } from "@nestjs/common"
import type { DataSource } from "typeorm"
import { HealthService } from "./health.service.js"
import { HealthController } from "./health.controller.js"

type QueryFn = (sql: string) => Promise<unknown>

function fakeDataSource(query: QueryFn): { dataSource: DataSource; calls: string[] } {
  const calls: string[] = []
  const dataSource = {
    query: (sql: string) => {
      calls.push(sql)
      return query(sql)
    },
  } as unknown as DataSource
  return { dataSource, calls }
}

const healthyQuery: QueryFn = async () => [{ "?column?": 1 }]
const refusedError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
  code: "ECONNREFUSED",
})
const refusedQuery: QueryFn = async () => {
  throw refusedError
}

// Silences and records HealthService logs; restored automatically after the test.
function mockLoggerError(t: TestContext) {
  return t.mock.method(Logger.prototype, "error", () => {})
}

test("HealthService: database answers -> up, one query sent", async (t) => {
  const loggerError = mockLoggerError(t)
  const { dataSource, calls } = fakeDataSource(healthyQuery)
  const service = new HealthService(dataSource)

  assert.deepEqual(await service.health(), { database: "up" })
  assert.equal(calls.length, 1)
  assert.equal(loggerError.mock.callCount(), 0)
})

test("HealthService: query fails -> down, does not throw, logs the cause", async (t) => {
  const loggerError = mockLoggerError(t)
  const { dataSource } = fakeDataSource(refusedQuery)
  const service = new HealthService(dataSource)

  assert.deepEqual(await service.health(), { database: "down" })
  assert.equal(loggerError.mock.callCount(), 1)
  assert.equal(loggerError.mock.calls[0]!.arguments[0], refusedError)
})

test("HealthService: checks the database on every call, not once", async (t) => {
  mockLoggerError(t)
  let isUp = true
  const { dataSource, calls } = fakeDataSource((sql) =>
    isUp ? healthyQuery(sql) : refusedQuery(sql),
  )
  const service = new HealthService(dataSource)

  assert.deepEqual(await service.health(), { database: "up" })
  isUp = false
  assert.deepEqual(await service.health(), { database: "down" })
  isUp = true
  assert.deepEqual(await service.health(), { database: "up" })
  assert.equal(calls.length, 3)
})

test("HealthController: database up -> ok body", async (t) => {
  mockLoggerError(t)
  const controller = new HealthController(
    new HealthService(fakeDataSource(healthyQuery).dataSource),
  )

  assert.deepEqual(await controller.getData(), { status: "ok", database: "up" })
})

test("HealthController: database down -> 503 with the same body shape", async (t) => {
  mockLoggerError(t)
  const controller = new HealthController(
    new HealthService(fakeDataSource(refusedQuery).dataSource),
  )

  await assert.rejects(controller.getData(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException, "expected ServiceUnavailableException")
    assert.equal(error.getStatus(), 503)
    assert.deepEqual(error.getResponse(), { status: "error", database: "down" })
    return true
  })
})
