import { CommercialFaq } from "./CommercialFaq";
import { FinalCta } from "./FinalCta";
import { loadPublicMembershipPrice } from "./load-membership-price";
import { PlanComparison } from "./PlanComparison";
import { PreviewFooter } from "./PreviewFooter";
import { ValueJourney } from "./ValueJourney";
import styles from "./Commercial.module.css";

/**
 * Secciones comerciales que siguen a la exploración de herramientas: propuesta de valor, gratis vs. Premium (con el precio real),
 * preguntas frecuentes, cierre y footer. Componente de servidor: lee el precio y los enlaces de comunidad al regenerar la página (ISR).
 */
export async function CommercialSections() {
  const price = await loadPublicMembershipPrice();
  return (
    <div className={styles.commercial}>
      <ValueJourney />
      <PlanComparison price={price} />
      <CommercialFaq />
      <FinalCta />
      <PreviewFooter />
    </div>
  );
}
