import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "./api/app.module.js"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"
import { ConfigService } from "@nestjs/config"
import type { Env } from "./api/env.js"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const swaggerConfig = new DocumentBuilder()
    .setTitle("D&D AI Master API")
    .setVersion("0.1.0")
    .build()
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup("swagger", app, swaggerDoc)
  const configService: ConfigService<Env, true> = app.get(ConfigService)
  const port = configService.get("PORT", { infer: true })
  await app.listen(port)
}

await bootstrap()
