import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Sprint 2: the historical landing is no longer public (its code stays in src/app/landing-old).
      {
        source: "/landing-old",
        destination: "/landing",
        permanent: true,
      },
      {
        source: "/configuracion",
        has: [{ type: "query", key: "tab", value: "taller" }],
        destination: "/mi-taller/impresoras",
        permanent: false,
      },
      {
        source: "/configuracion/taller",
        destination: "/mi-taller/impresoras",
        permanent: false,
      },
      {
        source: "/stock",
        has: [{ type: "query", key: "tab", value: "filamentos" }],
        destination: "/mi-taller/filamentos",
        permanent: false,
      },
      {
        source: "/stock",
        has: [{ type: "query", key: "tab", value: "productos" }],
        destination: "/mi-taller/inventario",
        permanent: false,
      },
      {
        source: "/stock",
        missing: [{ type: "query", key: "tab" }],
        destination: "/mi-taller/inventario",
        permanent: false,
      },
      {
        source: "/productos",
        destination: "/mi-taller/productos",
        permanent: false,
      },
      {
        source: "/mi-negocio/inventario",
        destination: "/mi-negocio/catalogo",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
