import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW, siteOrigin } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
