import { Body, Controller, Post } from "@nestjs/common"
import { ZodValidationPipe } from "./zod-validation.pipe.js"
import { EchoBodySchema, type EchoBody } from "@dnd/shared"
import { ApiBadRequestResponse, ApiBody, ApiCreatedResponse } from "@nestjs/swagger"
import { zodToOpenApiSchema } from "./zod-to-open-api-schema.js"

@Controller("echo")
export class EchoController {
  @Post()
  @ApiBody({ schema: zodToOpenApiSchema(EchoBodySchema) })
  @ApiBadRequestResponse({ description: "Request body failed validation" })
  @ApiCreatedResponse({ description: "Echoes the parsed body" })
  echo(@Body(new ZodValidationPipe(EchoBodySchema)) body: EchoBody): EchoBody {
    return body
  }
}
