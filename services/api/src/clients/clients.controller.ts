import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ClientsService } from "./clients.service";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";
import { SetupVisaGroupMatchingDto } from "./dto/setup-visa-group-matching.dto";
import { BookVisaGroupDto } from "./dto/book-visa-group.dto";
import {
  ApiCreateClient,
  ApiGetAllClients,
  ApiGetClient,
  ApiUpdateClient,
  ApiDeleteClient,
  ApiGetVisaGroups,
  ApiSetupVisaGroupMatching,
  ApiBookVisaGroup,
} from "./clients.controller.decorators";

@ApiTags("Клиенттер")
@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @ApiCreateClient()
  create(@Body() createClientDto: CreateClientDto) {
    return this.clientsService.create(createClientDto);
  }

  @Get()
  @ApiGetAllClients()
  findAll(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("companyEmail") companyEmail?: string
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.clientsService.findPaginated(pageNum, limitNum, companyEmail);
  }

  @Get(":id")
  @ApiGetClient()
  findOne(
    @Param("id", ParseIntPipe) id: number,
    @Query("companyEmail") companyEmail?: string
  ) {
    return this.clientsService.findOne(id, companyEmail);
  }

  @Patch(":id")
  @ApiUpdateClient()
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() updateClientDto: UpdateClientDto,
    @Query("companyEmail") companyEmail?: string
  ) {
    return this.clientsService.update(id, updateClientDto, companyEmail);
  }

  @Delete(":id")
  @ApiDeleteClient()
  remove(
    @Param("id", ParseIntPipe) id: number,
    @Query("companyEmail") companyEmail?: string
  ) {
    return this.clientsService.remove(id, companyEmail);
  }

  @Get(":id/visa-groups")
  @ApiGetVisaGroups()
  getVisaGroups(
    @Param("id", ParseIntPipe) id: number,
    @Query("companyEmail") companyEmail?: string
  ) {
    return this.clientsService.getVisaGroupsByClient(id, companyEmail);
  }

  @Post(":id/visa-groups/setup-matching")
  @ApiSetupVisaGroupMatching()
  setupVisaGroupMatching(
    @Param("id", ParseIntPipe) id: number,
    @Body() setupDto: SetupVisaGroupMatchingDto,
    @Query("companyEmail") companyEmail?: string
  ) {
    return this.clientsService.setupVisaGroupMatching(
      id,
      setupDto.visaGroupId,
      {
        city: setupDto.city,
        slotStartDate: setupDto.slotStartDate,
        slotEndDate: setupDto.slotEndDate,
        delayDays: setupDto.delayDays ?? 0,
        isAutoBookEnabled: setupDto.isAutoBookEnabled,
        applicantsCount: setupDto.applicantsCount,
      },
      companyEmail
    );
  }

  @Post(":id/visa-groups/book")
  @ApiBookVisaGroup()
  bookVisaGroup(
    @Param("id", ParseIntPipe) id: number,
    @Body() bookDto: BookVisaGroupDto,
    @Query("companyEmail") companyEmail?: string
  ) {
    return this.clientsService.bookVisaGroupAppointment(
      id,
      bookDto.visaGroupId,
      {
        city: bookDto.city,
        date: bookDto.date,
        time: bookDto.time,
      },
      companyEmail
    );
  }

  @Post("reindex")
  reindexQueue(@Query("type") type?: "resident" | "non-resident" | "all") {
    return this.clientsService.reindexClients(type || "all");
  }

  @Post("manual")
  createManual(
    @Body()
    manualDto: {
      email: string;
      password: string;
      isResident: boolean;
      companyEmail?: string;
      groups: Array<{ status: string; schedulePath: string }>;
    }
  ) {
    return this.clientsService.createManual(manualDto);
  }
}
