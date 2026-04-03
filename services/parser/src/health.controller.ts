import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return {
      status: "ok",
      service: "parser",
      parserType: process.env.PARSER_TYPE || "all",
    };
  }
}

