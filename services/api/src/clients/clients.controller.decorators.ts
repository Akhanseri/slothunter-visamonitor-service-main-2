import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam, ApiQuery } from "@nestjs/swagger";

export const ApiCreateClient = () =>
  applyDecorators(
    ApiOperation({ summary: "Жаңа клиент қосу" }),
    ApiResponse({ status: 201, description: "Клиент сәтті қосылды" }),
    ApiResponse({ status: 400, description: "Қате деректер" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" })
  );

export const ApiGetAllClients = () =>
  applyDecorators(
    ApiOperation({ summary: "Барлық клиенттерді алу" }),
    ApiQuery({
      name: "page",
      required: false,
      type: Number,
      description: "Бет нөмірі",
    }),
    ApiQuery({
      name: "limit",
      required: false,
      type: Number,
      description: "Бір беттегі элементтер саны",
    }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании для фильтрации",
    }),
    ApiResponse({ status: 200, description: "Клиенттер тізімі" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" })
  );

export const ApiGetClient = () =>
  applyDecorators(
    ApiOperation({ summary: "Клиентті ID бойынша алу" }),
    ApiParam({ name: "id", type: Number, description: "Клиент ID" }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании",
    }),
    ApiResponse({ status: 200, description: "Клиент деректері" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" }),
    ApiResponse({ status: 404, description: "Клиент табылмады" })
  );

export const ApiUpdateClient = () =>
  applyDecorators(
    ApiOperation({ summary: "Клиент деректерін жаңарту" }),
    ApiParam({ name: "id", type: Number, description: "Клиент ID" }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании",
    }),
    ApiResponse({ status: 200, description: "Клиент сәтті жаңартылды" }),
    ApiResponse({ status: 400, description: "Қате деректер" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" }),
    ApiResponse({ status: 404, description: "Клиент табылмады" })
  );

export const ApiDeleteClient = () =>
  applyDecorators(
    ApiOperation({ summary: "Клиентті жою" }),
    ApiParam({ name: "id", type: Number, description: "Клиент ID" }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании",
    }),
    ApiResponse({ status: 200, description: "Клиент сәтті жойылды" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" }),
    ApiResponse({ status: 404, description: "Клиент табылмады" })
  );

export const ApiGetVisaGroups = () =>
  applyDecorators(
    ApiOperation({ summary: "Получить список visa groups клиента" }),
    ApiParam({ name: "id", type: Number, description: "Клиент ID" }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании",
    }),
    ApiResponse({ status: 200, description: "Список visa groups" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" }),
    ApiResponse({ status: 404, description: "Клиент табылмады" })
  );

export const ApiSetupVisaGroupMatching = () =>
  applyDecorators(
    ApiOperation({ summary: "Настроить автоматчинг для visa group" }),
    ApiParam({ name: "id", type: Number, description: "Клиент ID" }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании",
    }),
    ApiResponse({ status: 200, description: "Автоматчинг успешно настроен" }),
    ApiResponse({ status: 400, description: "Қате деректер" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" }),
    ApiResponse({ status: 404, description: "Клиент или visa group табылмады" })
  );

export const ApiBookVisaGroup = () =>
  applyDecorators(
    ApiOperation({ summary: "Записать visa group на слот" }),
    ApiParam({ name: "id", type: Number, description: "Клиент ID" }),
    ApiQuery({
      name: "companyEmail",
      required: false,
      type: String,
      description: "Email компании",
    }),
    ApiResponse({ status: 200, description: "Результат записи на слот" }),
    ApiResponse({ status: 400, description: "Қате деректер" }),
    ApiResponse({ status: 401, description: "Авторизация қажет" }),
    ApiResponse({ status: 404, description: "Клиент или visa group табылмады" })
  );
