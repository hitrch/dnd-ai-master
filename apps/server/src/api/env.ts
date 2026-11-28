import { z } from "zod"

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().positive().max(65535),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
})
export type Env = z.infer<typeof EnvSchema>

export function validate(raw: unknown): Env {
  const output = EnvSchema.safeParse(raw)
  if (output.success) return output.data
  throw new Error(`Invalid environment variables: ${z.prettifyError(output.error)}`)
}
