import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { commercialCtas, comparison, pricing } from "./commercial-content";
import { formatMembershipPrice, type PublicMembershipPrice } from "./membership-price";
import { Reveal } from "./Reveal";
import styles from "./Commercial.module.css";

/**
 * Premium + cuenta gratuita + precio real (o su estado provisional). Componente de servidor: sin JS de cliente.
 *
 * Una sola fuente de datos (`comparison.rows`), dos presentaciones que el CSS alterna por ancho:
 * - escritorio y tableta: tabla semántica Free/Premium y banda de precio (composición original);
 * - móvil (≤719px): dos bloques, Premium primero y protagonista (precio, beneficios y botón) y la cuenta gratuita como alternativa.
 * La presentación oculta usa `display: none`, así que los lectores de pantalla solo reciben una.
 */
export function PlanComparison({ price }: { price: PublicMembershipPrice | null }) {
  const featured = comparison.rows.filter((row) => row.featured);
  const freeRows = comparison.rows.filter((row) => row.free !== null);
  const missing = comparison.rows.filter((row) => row.free === null);

  return (
    <section id="planes" className={`${styles.section} ${styles.plans}`} aria-labelledby="plans-title">
      <div className={styles.inner}>
        <Reveal as="header" className={styles.sectionHead}>
          <p className={styles.eyebrow}>{comparison.eyebrow}</p>
          <h2 id="plans-title" className={styles.display}>
            {comparison.title.map((line, index) => (
              <span key={line} className={index > 0 ? styles.accent : undefined}>
                {line}
              </span>
            ))}
          </h2>
          <p className={styles.lead}>{comparison.lead}</p>
        </Reveal>

        {/* Móvil: Premium primero, la cuenta gratuita como alternativa. */}
        <div className={styles.mobilePlans}>
          <Reveal as="article" className={styles.planPremium} delay={60}>
            <p className={styles.planBadge}>{comparison.mobile.premiumBadge}</p>
            {price ? (
              <p className={`${styles.priceValue} ${styles.planPrice}`} data-state="real">
                <span>{formatMembershipPrice(price)}</span>
                <small>{pricing.unit}</small>
              </p>
            ) : (
              <p className={styles.priceProvisional} data-state="provisional">
                {pricing.provisional}
              </p>
            )}
            <Link href={commercialCtas.primary.href} className={`${styles.btnPrimary} ${styles.btnLarge} ${styles.planCta}`}>
              {commercialCtas.primary.label}
              <ArrowRight aria-hidden="true" size={20} />
            </Link>
            <p className={styles.planFlow}>{commercialCtas.flowNote}</p>

            <h3 className={styles.planListTitle}>{comparison.mobile.premiumLead}</h3>
            <ul className={styles.planList}>
              {featured.map((row) => (
                <li key={row.name}>
                  <Check aria-hidden="true" size={16} strokeWidth={2.6} />
                  <span>
                    <strong>{row.name}</strong>
                    {row.premium}
                  </span>
                </li>
              ))}
            </ul>

            <ul className={styles.planDetails}>
              {pricing.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </Reveal>

          <Reveal as="article" className={styles.planFree} delay={100}>
            <p className={styles.planFreeBadge}>{comparison.mobile.freeBadge}</p>
            <h3 className={styles.planFreeTitle}>{comparison.freeHeading}</h3>
            <p className={styles.planFreeIntro}>{comparison.mobile.freeIntro}</p>
            <ul className={styles.planFreeList}>
              {freeRows.map((row) => (
                <li key={row.name}>
                  <strong>{row.name}</strong>
                  {row.free}
                </li>
              ))}
            </ul>
            <p className={styles.planFreeMissing}>
              <span>{comparison.mobile.freeMissing}</span> {missing.map((row) => row.name).join(", ")}.
            </p>
            <div className={styles.planFreeActions}>
              <Link href={commercialCtas.secondary.href} className={styles.btnGhost}>
                {commercialCtas.secondary.label}
              </Link>
              <Link href={commercialCtas.free.href} className={styles.planFreeLink}>
                {commercialCtas.free.label}
              </Link>
            </div>
          </Reveal>
        </div>

        {/* Escritorio y tableta: composición original. */}
        <Reveal className={styles.tableWrap} delay={80}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>Qué incluye la cuenta gratuita y qué suma la membresía Premium</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.thTool}>
                  <span className={styles.srOnly}>Herramienta</span>
                </th>
                <th scope="col" className={styles.thFree}>
                  {comparison.freeHeading}
                </th>
                <th scope="col" className={styles.thPremium}>
                  {comparison.premiumHeading}
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.name}>
                  <th scope="row" className={styles.tdTool}>
                    {row.name}
                  </th>
                  <td className={styles.tdFree} data-included={row.free ? "true" : "false"}>
                    {row.free ? (
                      <>
                        <Check aria-hidden="true" size={16} strokeWidth={2.4} />
                        <span>{row.free}</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true" className={styles.dash} />
                        <span className={styles.srOnly}>{comparison.notIncluded}</span>
                      </>
                    )}
                  </td>
                  <td className={styles.tdPremium}>
                    <Check aria-hidden="true" size={16} strokeWidth={2.4} />
                    <span>{row.premium}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>

        <Reveal className={styles.priceBand} delay={60}>
          <div className={styles.priceMain}>
            <p className={styles.priceName}>{pricing.name}</p>
            {price ? (
              <p className={styles.priceValue} data-state="real">
                <span>{formatMembershipPrice(price)}</span>
                <small>{pricing.unit}</small>
              </p>
            ) : (
              <p className={styles.priceProvisional} data-state="provisional">
                {pricing.provisional}
              </p>
            )}
          </div>
          <div className={styles.priceSide}>
            <ul className={styles.priceDetails}>
              {pricing.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
            <p className={styles.priceNote}>{commercialCtas.flowNote}</p>
            <div className={styles.priceActions}>
              <Link href={commercialCtas.primary.href} className={styles.btnPrimary}>
                {commercialCtas.primary.label}
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <Link href={commercialCtas.secondary.href} className={styles.btnGhost}>
                {commercialCtas.secondary.label}
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
