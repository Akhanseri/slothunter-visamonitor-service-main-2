export interface Location {
  id: string;
  name: string;
}

export interface AvailableDay {
  date: string;
  business_day: boolean;
}

export interface LocationAvailability {
  location: Location;
  days: AvailableDay[];
}

export interface VisaCheckResult {
  success: boolean;
  locations: LocationAvailability[];
  email: string;
  password: string;
  isResident?: boolean;
}

