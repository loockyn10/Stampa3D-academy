import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { commercialCtas, comparison, pricing } from "./commercial-content";
import { formatMembershipPrice, type PublicMembershipPrice } from "./membership-price";
import { Reveal } from "./Reveal";
import styles from "./Commercial.module.css";

/** Cuenta gratuita vs. membresía Premium + precio real (o su estado provisional). Es un componente de servidor: sin JS de cliente. */
export function PlanComparison({ price }: { price: PublicMembershipPrice | null }) {
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
                  <td className={styles.tdFree} data-label="Gratis" data-included={row.free ? "true" : "false"}>
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
                  <td className={styles.tdPremium} data-label="Premium">
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
            <p className={styles.priceNote}>{pricing.note}</p>
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
