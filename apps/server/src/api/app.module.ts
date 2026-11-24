import { HealthController } from "./health.controller.js"
import { HealthService } from "./health.service.js"
import { Module } from "@nestjs/common"

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
