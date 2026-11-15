// Lalamove delivery fee estimator for Metro Manila and provinces.
// Distance tiers, vehicle types, and instant booking payload builder.

export type LalamoveVehicle = 'motorcycle' | 'sedan' | 'mpv' | 'l300';
export type LalamoveZone = 'metro' | 'rizal' | 'nearby_province' | 'far_province';

export interface LalamoveZoneMeta {
  label: string;
  description: string;
  distanceKm: { min: number; max: number };
}

export const LALAMOVE_ZONES: Record<LalamoveZone, LalamoveZoneMeta> = {
  metro: { label: 'Metro Manila', description: '0–20 km from Makati', distanceKm: { min: 0, max: 20 } },
  rizal: { label: 'Rizal Province', description: '20–35 km from Makati', distanceKm: { min: 20, max: 35 } },
  nearby_province: { label: 'Nearby Provinces (Laguna, Cavite, Bulacan)', description: '35–60 km from Makati', distanceKm: { min: 35, max: 60 } },
  far_province: { label: 'Far Provinces (Quezon, Nueva Ecija)', description: '60+ km from Makati', distanceKm: { min: 60, max: 500 } },
};

export interface LalamoveVehicleMeta {
  label: string;
  description: string;
  baseFeePhp: number;
  perKmPhp: number;
  maxWeightKg: number;
  maxVolumeMcm: number; // cubic meters
}

export const LALAMOVE_VEHICLES: Record<LalamoveVehicle, LalamoveVehicleMeta> = {
  motorcycle: {
    label: 'Motorcycle / Bicycle',
    description: 'Light, fast, documents and small packages',
    baseFeePhp: 50,
    perKmPhp: 8,
    maxWeightKg: 5,
    maxVolumeMcm: 0.05,
  },
  sedan: {
    label: 'Sedan',
    description: 'Small to medium orders, up to 3 boxes',
    baseFeePhp: 150,
    perKmPhp: 12,
    maxWeightKg: 100,
    maxVolumeMcm: 2,
  },
  mpv: {
    label: 'MPV / van',
    description: 'Medium orders, 5–10 boxes, mixed items',
    baseFeePhp: 250,
    perKmPhp: 15,
    maxWeightKg: 300,
    maxVolumeMcm: 5,
  },
  l300: {
    label: 'L300 / Light Truck',
    description: 'Large orders, bulk garments, full vehicle rental',
    baseFeePhp: 400,
    perKmPhp: 18,
    maxWeightKg: 1000,
    maxVolumeMcm: 12,
  },
};

/**
 * Estimate Lalamove delivery fee based on distance and vehicle.
 * @param distanceKm Round-trip distance in km
 * @param vehicle Vehicle type
 * @returns Estimated fee in PHP, or null if invalid
 */
export function estimateLalaMoveFee(distanceKm: number, vehicle: LalamoveVehicle): number | null {
  const vehicleMeta = LALAMOVE_VEHICLES[vehicle];
  if (!vehicleMeta || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  return Math.ceil(vehicleMeta.baseFeePhp + vehicleMeta.perKmPhp * distanceKm);
}

/**
 * Infer zone from distance (for UI/UX clarity).
 * @param distanceKm Distance in km
 * @returns Zone label
 */
export function inferZoneFromDistance(distanceKm: number): LalamoveZone | null {
  if (distanceKm >= 0 && distanceKm <= 20) return 'metro';
  if (distanceKm > 20 && distanceKm <= 35) return 'rizal';
  if (distanceKm > 35 && distanceKm <= 60) return 'nearby_province';
  if (distanceKm > 60) return 'far_province';
  return null;
}

/**
 * Build a Lalamove booking payload ready for the dispatch API.
 */
export interface LalamoveBookingPayload {
  pickup_address: string;
  delivery_address: string;
  contact_name: string;
  contact_phone: string;
  package_description: string;
  vehicle_type: LalamoveVehicle;
  special_instructions?: string;
}

export function buildLalamovePayload(
  pickupAddress: string,
  deliveryAddress: string,
  contactName: string,
  contactPhone: string,
  packageDesc: string,
  vehicle: LalamoveVehicle,
  notes?: string
): LalamoveBookingPayload {
  return {
    pickup_address: pickupAddress.trim(),
    delivery_address: deliveryAddress.trim(),
    contact_name: contactName.trim(),
    contact_phone: contactPhone.trim(),
    package_description: packageDesc.trim(),
    vehicle_type: vehicle,
    special_instructions: notes?.trim() || undefined,
  };
}
