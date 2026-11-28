import { HealthController } from "./health.controller.js"
import { HealthService } from "./health.service.js"
import { Module } from "@nestjs/common"
import { EchoController } from "./echo.controller.js"
import { ConfigModule, ConfigService } from "@nestjs/config"
import { type Env, validate } from "./env.js"
import { TypeOrmModule } from "@nestjs/typeorm"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: "postgres",
        host: config.get("POSTGRES_HOST", { infer: true }),
        port: config.get("POSTGRES_PORT", { infer: true }),
        username: config.get("POSTGRES_USER", { infer: true }),
        password: config.get("POSTGRES_PASSWORD", { infer: true }),
        database: config.get("POSTGRES_DB", { infer: true }),
        synchronize: false,
        entities: [],
      }),
    }),
  ],
  controllers: [HealthController, EchoController],
  providers: [HealthService],
})
export class AppModule {}
