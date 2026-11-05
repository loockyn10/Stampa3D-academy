import type { MetadataRoute } from "next";
import { publishedLegalDocuments } from "@/lib/legal/registry";
import { PUBLIC_INDEXABLE_PATHS, siteOrigin } from "@/lib/seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const paths = [...PUBLIC_INDEXABLE_PATHS, ...publishedLegalDocuments().map((doc) => doc.path)];
  return paths.map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: path === "/landing" ? "weekly" : "monthly",
    priority: path === "/landing" ? 1 : 0.5,
  }));
}
