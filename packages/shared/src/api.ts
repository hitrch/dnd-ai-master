import { z } from "zod"

export const EchoBodySchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().default("No description provided"),
})
export type EchoBody = z.infer<typeof EchoBodySchema>
