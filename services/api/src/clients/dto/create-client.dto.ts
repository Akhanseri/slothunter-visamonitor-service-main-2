import {
  IsEmail,
  IsString,
  MinLength,
  IsBoolean,
  IsOptional,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateClientDto {
  @ApiProperty({
    description: "Клиенттің email мекенжайы",
    example: "client@example.com",
    required: true,
  })
  @IsEmail({}, { message: "Дұрыс email енгізіңіз" })
  email: string;

  @ApiProperty({
    description: "Клиенттің паролі (кемінде 6 таңба)",
    example: "password123",
    minLength: 6,
    required: true,
  })
  @IsString({ message: "Пароль міндетті" })
  @MinLength(6, { message: "Пароль кемінде 6 таңба болуы керек" })
  password: string;

  @ApiProperty({
    description: "Резидент ли клиент",
    example: false,
    required: true,
  })
  @IsBoolean()
  isResident: boolean;

  @ApiProperty({
    description: "Email компании для доступа к данным",
    example: "company@example.com",
    required: false,
  })
  @IsOptional()
  @IsEmail({}, { message: "Дұрыс company email енгізіңіз" })
  companyEmail?: string;
}
