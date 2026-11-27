import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { AppModule } from "./api/app.module.js"
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger"

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const swaggerConfig = new DocumentBuilder()
    .setTitle("D&D AI Master API")
    .setVersion("0.1.0")
    .build()
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup("swagger", app, swaggerDoc)
  await app.listen(process.env.PORT || 3000)
}

await bootstrap()
