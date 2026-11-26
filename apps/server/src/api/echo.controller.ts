import { Body, Controller, Post } from "@nestjs/common"
import { ZodValidationPipe } from "./zod-validation.pipe.js"
import { EchoBodySchema, type EchoBody } from "@dnd/shared"

@Controller("echo")
export class EchoController {
  @Post()
  echo(@Body(new ZodValidationPipe(EchoBodySchema)) body: EchoBody): EchoBody {
    return body
  }
}
