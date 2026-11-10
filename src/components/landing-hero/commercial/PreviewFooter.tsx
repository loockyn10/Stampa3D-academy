import Link from "next/link";
import { Layers } from "lucide-react";
import { loadPublicCommunityLinks } from "@/lib/community/public";
import { footerLegalLinks } from "@/lib/legal/registry";
import { footerContent } from "./commercial-content";
import styles from "./Commercial.module.css";

/**
 * Footer de la vista previa. Los enlaces de comunidad son los reales (administrados en /admin/redes-canales; solo llegan los de nivel
 * público) y los legales salen del registro legal: un documento sin texto aprobado se muestra como «pendiente» y no enlaza.
 */
export async function PreviewFooter() {
  const { links } = await loadPublicCommunityLinks();
  const community = links.filter((link) => link.url !== null);
  const legal = footerLegalLinks();

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Link href="/landing-preview" className={styles.footerLogo} aria-label={`${footerContent.brand} — inicio`}>
            <span>
              <Layers aria-hidden="true" size={18} />
            </span>
            {footerContent.brand}
          </Link>
          <p>{footerContent.tagline}</p>
        </div>

        <nav aria-label={footerContent.toolsHeading} className={styles.footerCol}>
          <h2>{footerContent.toolsHeading}</h2>
          <ul>
            {footerContent.tools.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.footerCol}>
          <h2>{footerContent.communityHeading}</h2>
          {community.length > 0 ? (
            <ul>
              {community.map((link) => (
                <li key={link.id}>
                  <a href={link.url ?? undefined} target="_blank" rel="noopener noreferrer">
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.footerMuted}>{footerContent.communityEmpty}</p>
          )}
        </div>

        <div className={styles.footerCol}>
          <h2>{footerContent.legalHeading}</h2>
          <ul>
            {legal.map((link) => (
              <li key={link.label}>
                {link.href ? (
                  <Link href={link.href}>{link.label}</Link>
                ) : (
                  <span className={styles.footerPending}>
                    {link.label} <em>{footerContent.legalPending}</em>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className={styles.footerBottom}>
        <p>{footerContent.previewNote}</p>
        <p>© {new Date().getFullYear()} Universo Stampa</p>
      </div>
    </footer>
  );
}
