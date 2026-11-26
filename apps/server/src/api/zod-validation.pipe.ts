import { BadRequestException, type PipeTransform } from "@nestjs/common"
import { z } from "zod"

export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const safeParseResult = this.schema.safeParse(value)
    if (safeParseResult.success) return safeParseResult.data
    throw new BadRequestException(`Validation failed: ${z.prettifyError(safeParseResult.error)}`)
  }
}
