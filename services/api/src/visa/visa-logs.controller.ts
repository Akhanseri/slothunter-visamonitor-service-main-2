import { Controller, Get, Query, Param } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { VisaLog } from "@visa-monitor/shared";

@ApiTags("Виза логтары")
@Controller("visa-logs")
export class VisaLogsController {
  constructor(
    @InjectRepository(VisaLog)
    private readonly visaLogRepository: Repository<VisaLog>
  ) {}

  @Get()
  @ApiOperation({ summary: "Барлық виза логтарын алу" })
  @ApiQuery({
    name: "page",
    type: Number,
    required: false,
    description: "Бет нөмірі (бастапқы: 1)",
  })
  @ApiQuery({
    name: "limit",
    type: Number,
    required: false,
    description: "Элементтер саны (бастапқы: 50)",
  })
  @ApiQuery({
    name: "parserEmail",
    type: String,
    required: false,
    description: "Email парсера для фильтрации",
  })
  @ApiQuery({
    name: "isResident",
    type: Boolean,
    required: false,
    description: "Резидент/не-резидент",
  })
  @ApiQuery({
    name: "city",
    type: String,
    required: false,
    description: "Город для фильтрации",
  })
  @ApiResponse({
    status: 200,
    description: "Виза логтары",
    schema: {
      properties: {
        data: {
          type: "array",
          items: {
            properties: {
              id: { type: "number" },
              parserEmail: { type: "string" },
              isResident: { type: "boolean" },
              city: { type: "string" },
              appointmentDate: { type: "string", format: "date" },
              availableTimes: { type: "array", items: { type: "string" } },
              checkedAt: { type: "string", format: "date-time" },
            },
          },
        },
        total: { type: "number" },
        page: { type: "number" },
        limit: { type: "number" },
      },
    },
  })
  async findAll(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 50,
    @Query("parserEmail") parserEmail?: string,
    @Query("isResident") isResident?: boolean,
    @Query("city") city?: string
  ) {
    const skip = (page - 1) * limit;

    const queryBuilder = this.visaLogRepository
      .createQueryBuilder("log")
      .orderBy("log.checkedAt", "DESC");

    if (parserEmail) {
      queryBuilder.andWhere("log.parserEmail = :parserEmail", { parserEmail });
    }

    if (isResident !== undefined) {
      queryBuilder.andWhere("log.isResident = :isResident", { isResident });
    }

    if (city) {
      queryBuilder.andWhere("log.city = :city", { city });
    }

    const [data, total] = await queryBuilder
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
    };
  }

  @Get("parser/:email")
  @ApiOperation({ summary: "Парсер email бойынша логтарды алу" })
  @ApiResponse({ status: 200, description: "Парсер логтары" })
  async findByParser(
    @Param("email") email: string,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 100
  ) {
    const skip = (page - 1) * limit;

    const [data, total] = await this.visaLogRepository.findAndCount({
      where: { parserEmail: email },
      order: { checkedAt: "DESC" },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  @Get("recent")
  @ApiOperation({ summary: "Соңғы парсинг логтары" })
  @ApiResponse({ status: 200, description: "Соңғы логтар" })
  async findRecent(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 50
  ) {
    const skip = (page - 1) * limit;

    const [data, total] = await this.visaLogRepository.findAndCount({
      order: { checkedAt: "DESC" },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }
}
