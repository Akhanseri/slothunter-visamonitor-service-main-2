import { IsString, IsNumber, IsOptional, IsBoolean } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class SetupVisaGroupMatchingDto {
  @ApiProperty({
    description: "ID visa group из списка visaGroups клиента",
    example: 1,
    required: true,
  })
  @IsNumber()
  visaGroupId: number;

  @ApiProperty({
    description: "Қала (astana или almaty)",
    example: "astana",
    required: true,
  })
  @IsString()
  city: string;

  @ApiProperty({
    description: "Басталу күні (в формате ISO 8601 или dd.mm)",
    example: "15.12",
    required: true,
  })
  @IsString()
  slotStartDate: string;

  @ApiProperty({
    description: "Аяқталу күні (в формате ISO 8601 или dd.mm)",
    example: "25.12",
    required: true,
  })
  @IsString()
  slotEndDate: string;

  @ApiProperty({
    description: "Күту күндері (delay days)",
    example: 5,
    required: false,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  delayDays?: number;

  @ApiProperty({
    description: "Автоматическая запись при мэтчинге",
    example: false,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAutoBookEnabled?: boolean;

  @ApiProperty({
    description: "Количество участников",
    example: 2,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  applicantsCount?: number;
}
