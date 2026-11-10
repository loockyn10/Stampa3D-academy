/**
 * Datos FICTICIOS de la cuenta de demostración de Mi Taller. Aprobados explícitamente; no representan ningún dato real de Stampa.
 * Los usan scripts/demo/seed-mi-taller.mjs (carga) y scripts/demo/record-mi-taller.mjs (grabación).
 */

export const DISPLAY_NAME = "Demo Universo";

export const printers = [
  { name: "Bambu Lab A1", watts: 95, maintenance: 80 },
  { name: "Bambu Lab P1S", watts: 120, maintenance: 100 },
];

export const filaments = [
  { name: "W3D PLA Naranja", type: "PLA", brand: "W3D", subtype: "", color: "Naranja", colorHex: "#ff780a", total: 1000, remaining: 900, price: 16000 },
  { name: "Bambu Lab PLA Basic Blanco", type: "PLA", brand: "Bambu Lab", subtype: "Basic", color: "Blanco", colorHex: "#f2f2f2", total: 1000, remaining: 1000, price: 22000 },
  { name: "W3D PETG Negro", type: "PETG", brand: "W3D", subtype: "", color: "Negro", colorHex: "#1a1a1a", total: 1000, remaining: 500, price: 18000 },
];

export const categories = ["Accesorios", "Oficina", "Hogar y deco"];

export const products = [
  { name: "Soporte para auriculares", category: "Accesorios", printer: "Bambu Lab A1", hours: 3, minutes: 40, material: "W3D PLA Naranja", grams: 85, baseCost: 1700, salePrice: 4200 },
  { name: "Organizador de escritorio", category: "Oficina", printer: "Bambu Lab P1S", hours: 6, minutes: 15, material: "Bambu Lab PLA Basic Blanco", grams: 120, baseCost: 3350, salePrice: 7500 },
  { name: "Maceta geométrica", category: "Hogar y deco", printer: "Bambu Lab A1", hours: 2, minutes: 50, material: "W3D PETG Negro", grams: 65, baseCost: 1450, salePrice: 3600 },
];

/** Registros de producción: descuentan filamento y suman unidades terminadas. */
export const production = [
  { product: "Soporte para auriculares", units: 5 },
  { product: "Organizador de escritorio", units: 3 },
  { product: "Maceta geométrica", units: 6 },
];
