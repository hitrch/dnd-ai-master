import { HealthController } from "./health.controller.js"
import { HealthService } from "./health.service.js"
import { Module } from "@nestjs/common"
import { EchoController } from "./echo.controller.js"

@Module({
  controllers: [HealthController, EchoController],
  providers: [HealthService],
})
export class AppModule {}
