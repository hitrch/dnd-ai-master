import { Controller, Get, ServiceUnavailableException } from "@nestjs/common"
import { type DBHealthResponse, HealthService } from "./health.service.js"

type HealthResponse = {
  status: "ok" | "error"
} & DBHealthResponse

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getData(): Promise<HealthResponse> {
    const healthResponse = await this.healthService.health()
    if (healthResponse.database === "down")
      throw new ServiceUnavailableException({
        status: "error",
        ...healthResponse,
      } satisfies HealthResponse)
    return { status: "ok", ...healthResponse }
  }
}
