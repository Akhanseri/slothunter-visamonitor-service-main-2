import { Injectable, Logger } from "@nestjs/common";

export interface Slot {
  date: string;
  city: string;
  time?: string;
  scheduleId?: string;
  locationId?: string;
}

export interface ClientWindow {
  startDate: Date;
  endDate: Date;
}

export interface MatchResult {
  matched: boolean;
  slot?: Slot;
}

@Injectable()
export class SlotMatcherService {
  private readonly logger = new Logger(SlotMatcherService.name);

  /**
   * Построить окно поиска для клиента
   */
  buildClientWindow(
    startDateStr: string,
    endDateStr: string,
    delayDays: number = 0
  ): ClientWindow | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let startDate = this._parseClientDate(startDateStr);
    if (!startDate) {
      // Если startDate не указан, используем today + delay
      startDate = new Date(today);
      startDate.setDate(startDate.getDate() + delayDays);
    } else {
      startDate.setHours(0, 0, 0, 0);
      // Ранее здесь принудительно применяли delay, теперь просто используем дату из запроса
    }
    startDate.setHours(0, 0, 0, 0);

    let endDate = this._parseClientDate(endDateStr);
    if (!endDate) {
      endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    endDate.setHours(23, 59, 59, 999);

    if (endDate < startDate) {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    if (startDate > endDate) {
      this.logger.warn(
        `Invalid client window: startDate ${startDate.toISOString()} > endDate ${endDate.toISOString()}`
      );
      return null;
    }

    this.logger.log(
      `📅 [WINDOW] Построено окно: ${startDate.toISOString().split("T")[0]} - ${endDate.toISOString().split("T")[0]} (из ${startDateStr} - ${endDateStr}, delay=${delayDays})`
    );

    return { startDate, endDate };
  }

  /**
   * Найти первый подходящий слот в отсортированном массиве
   */
  findFirstMatchingSlot(
    clientWindow: ClientWindow,
    slots: Slot[]
  ): MatchResult {
    if (!slots || slots.length === 0) {
      return { matched: false };
    }

    const sortedSlots = this._sortSlotsByDateTime(slots);
    return this._findFirstMatchingSlotInSorted(clientWindow, sortedSlots);
  }

  /**
   * Найти первый подходящий слот в уже отсортированном массиве
   */
  findFirstMatchingSlotPreSorted(
    clientWindow: ClientWindow,
    sortedSlots: Slot[]
  ): MatchResult {
    if (!sortedSlots || sortedSlots.length === 0) {
      return { matched: false };
    }

    return this._findFirstMatchingSlotInSorted(clientWindow, sortedSlots);
  }

  /**
   * Удалить дубликаты слотов (по city и date)
   */
  removeDuplicateSlots(slots: Slot[]): Slot[] {
    const seen = new Set<string>();
    const unique: Slot[] = [];

    for (const slot of slots) {
      const key = `${slot.city}|${slot.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(slot);
      }
    }

    return unique;
  }

  /**
   * Отсортировать слоты по дате и времени
   */
  sortSlotsByDateTime(slots: Slot[]): Slot[] {
    return this._sortSlotsByDateTime(slots);
  }

  /**
   * Парсить дату слота (YYYY-MM-DD) в Date объект
   */
  parseSlotDate(date: string): Date {
    return this._parseSlotDate(date);
  }

  // ============================================
  // Приватные вспомогательные методы
  // ============================================

  private _findFirstMatchingSlotInSorted(
    clientWindow: ClientWindow,
    sortedSlots: Slot[]
  ): MatchResult {
    if (sortedSlots.length === 0) {
      return { matched: false };
    }

    // Нормализуем даты окна (только дата, без времени)
    const startDateOnly = new Date(clientWindow.startDate);
    startDateOnly.setHours(0, 0, 0, 0);
    const endDateOnly = new Date(clientWindow.endDate);
    endDateOnly.setHours(0, 0, 0, 0);

    if (this.logger.debug) {
      this.logger.debug(
        `Поиск слота в окне: ${startDateOnly.toISOString().split("T")[0]} - ${endDateOnly.toISOString().split("T")[0]}, всего слотов: ${sortedSlots.length}`
      );
    }

    const lowerBoundIndex = this._binarySearchLowerBound(
      sortedSlots,
      startDateOnly
    );

    // Проверяем первые несколько слотов для отладки
    if (this.logger.debug && sortedSlots.length > 0) {
      const firstSlots = sortedSlots.slice(0, Math.min(5, sortedSlots.length));
      firstSlots.forEach((slot, idx) => {
        const slotDate = this._parseSlotDate(slot.date);
        const slotDateOnly = new Date(slotDate);
        slotDateOnly.setHours(0, 0, 0, 0);
        this.logger.debug(
          `Слот ${idx + 1}: ${slot.date} (${slotDateOnly.toISOString().split("T")[0]})`
        );
      });
    }

    for (let i = lowerBoundIndex; i < sortedSlots.length; i++) {
      const slot = sortedSlots[i];
      const slotDate = this._parseSlotDate(slot.date);

      // Нормализуем дату слота (только дата, без времени)
      const slotDateOnly = new Date(slotDate);
      slotDateOnly.setHours(0, 0, 0, 0);

      // Если слот после endDate, прекращаем поиск
      if (slotDateOnly > endDateOnly) {
        if (this.logger.debug && i === lowerBoundIndex) {
          this.logger.debug(
            `Первый слот ${slot.date} (${slotDateOnly.toISOString().split("T")[0]}) уже после endDate ${endDateOnly.toISOString().split("T")[0]}`
          );
        }
        break;
      }

      // Проверяем, попадает ли слот в окно (включая границы)
      if (slotDateOnly >= startDateOnly && slotDateOnly <= endDateOnly) {
        if (this.logger.debug) {
          this.logger.debug(
            `Найден подходящий слот: ${slot.date} (${slotDateOnly.toISOString().split("T")[0]}) в окне ${startDateOnly.toISOString().split("T")[0]} - ${endDateOnly.toISOString().split("T")[0]}`
          );
        }
        return { matched: true, slot };
      }
    }

    if (this.logger.debug) {
      this.logger.debug(
        `Не найдено подходящих слотов в окне ${startDateOnly.toISOString().split("T")[0]} - ${endDateOnly.toISOString().split("T")[0]}`
      );
    }

    return { matched: false };
  }

  private _sortSlotsByDateTime(slots: Slot[]): Slot[] {
    return [...slots].sort((a, b) => {
      const dateA = this._parseSlotDate(a.date);
      const dateB = this._parseSlotDate(b.date);
      const dateDiff = dateA.getTime() - dateB.getTime();

      if (dateDiff !== 0) return dateDiff;
      return 0;
    });
  }

  private _binarySearchLowerBound(slots: Slot[], targetDate: Date): number {
    let left = 0;
    let right = slots.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const midDate = this._parseSlotDate(slots[mid].date);

      if (midDate < targetDate) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  private _parseSlotDate(date: string): Date {
    const [year, month, day] = date.split("-").map((s) => parseInt(s, 10));
    const dateOnly = new Date(year, month - 1, day);
    dateOnly.setHours(0, 0, 0, 0);
    return dateOnly;
  }

  private _parseClientDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    try {
      // ISO формат: YYYY-MM-DD или с временем
      if (
        dateStr.includes("T") ||
        dateStr.includes("Z") ||
        dateStr.match(/^\d{4}-\d{2}-\d{2}/)
      ) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          date.setHours(0, 0, 0, 0);
          return date;
        }
      }

      // Формат DD.MM.YYYY или DD.MM (без года)
      const parts = dateStr.split(".").map((s) => parseInt(s.trim(), 10));

      if (parts.length === 3) {
        // DD.MM.YYYY
        const [day, month, year] = parts;
        if (isNaN(day) || isNaN(month) || isNaN(year)) {
          this.logger.warn(`Не удалось распарсить дату: ${dateStr}`);
          return null;
        }
        const date = new Date(year, month - 1, day);
        if (isNaN(date.getTime())) {
          this.logger.warn(`Невалидная дата: ${dateStr}`);
          return null;
        }
        date.setHours(0, 0, 0, 0);
        return date;
      } else if (parts.length === 2) {
        // DD.MM (без года - используем текущий/следующий год)
        const [day, month] = parts;
        if (isNaN(day) || isNaN(month)) {
          this.logger.warn(`Не удалось распарсить дату: ${dateStr}`);
          return null;
        }

        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;

        let year = currentYear;
        if (
          month < currentMonth ||
          (month === currentMonth && day < today.getDate())
        ) {
          year = currentYear + 1;
        }

        const date = new Date(year, month - 1, day);
        if (isNaN(date.getTime())) {
          this.logger.warn(`Невалидная дата: ${dateStr}`);
          return null;
        }
        date.setHours(0, 0, 0, 0);
        return date;
      }

      this.logger.warn(`Неизвестный формат даты: ${dateStr}`);
      return null;
    } catch (error) {
      this.logger.warn(`Ошибка парсинга даты ${dateStr}: ${error}`);
      return null;
    }
  }
}
