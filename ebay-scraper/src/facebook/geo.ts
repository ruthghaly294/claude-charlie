import { z } from "zod";
export const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type Coordinates = z.infer<typeof coordinatesSchema>;
export const eastBelfast = {
  name: "Ballyhackamore, East Belfast",
  latitude: 54.5948,
  longitude: -5.8901,
} as const;
export function distanceKm(
  origin: Coordinates,
  destination: Coordinates,
): number {
  const a = coordinatesSchema.parse(origin),
    b = coordinatesSchema.parse(destination);
  const radians = (value: number) => (value * Math.PI) / 180;
  const lat = radians(b.latitude - a.latitude),
    lon = radians(b.longitude - a.longitude);
  const haversine =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lon / 2) ** 2;
  return (
    6371 *
    2 *
    Math.atan2(
      Math.sqrt(Math.min(1, haversine)),
      Math.sqrt(Math.max(0, 1 - haversine)),
    )
  );
}
export function inRadius(
  origin: Coordinates,
  destination: Coordinates | null,
  radiusKm: number,
): boolean {
  z.number().finite().positive().max(500).parse(radiusKm);
  return destination !== null && distanceKm(origin, destination) <= radiusKm;
}
