import { Injectable, Logger } from "@nestjs/common"
import { DataSource } from "typeorm"

export type DBHealthResponse = {
  database: "up" | "down"
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)

  constructor(private readonly dataSource: DataSource) {}

  async health(): Promise<DBHealthResponse> {
    try {
      await this.dataSource.query("SELECT 1")
      return { database: "up" }
    } catch (e) {
      this.logger.error(e)
      return { database: "down" }
    }
  }
}
