export function getFilamentLabel(filament: { filament_type?: string | null, brand?: string | null, name?: string | null } | null | undefined): string {
  if (!filament) return "Sin filamento";
  
  return [
    filament.filament_type,
    filament.brand,
    filament.name,
  ]
    .filter(Boolean)
    .join(" ");
}
