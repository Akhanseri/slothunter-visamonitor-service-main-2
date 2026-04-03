import { IsString, IsNumber, IsOptional } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class BookVisaGroupDto {
  @ApiProperty({
    description: "ID visa group для записи",
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
    description: "Дата записи (в формате YYYY-MM-DD)",
    example: "2025-12-15",
    required: true,
  })
  @IsString()
  date: string;

  @ApiProperty({
    description: "Время записи (HH:mm)",
    example: "09:00",
    required: false,
  })
  @IsOptional()
  @IsString()
  time?: string;
}
