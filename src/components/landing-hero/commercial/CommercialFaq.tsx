import { Plus } from "lucide-react";
import { faq } from "./commercial-content";
import { Reveal } from "./Reveal";
import styles from "./Commercial.module.css";

/** Acordeón con <details>/<summary> nativos: accesible por teclado y lectores de pantalla sin JavaScript. */
export function CommercialFaq() {
  return (
    <section id="preguntas" className={`${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
      <div className={styles.inner}>
        <div className={styles.faqGrid}>
          <Reveal as="header" className={styles.faqHead}>
            <p className={styles.eyebrow}>{faq.eyebrow}</p>
            <h2 id="faq-title" className={styles.display}>
              {faq.title.map((line, index) => (
                <span key={line} className={index > 0 ? styles.accent : undefined}>
                  {line}
                </span>
              ))}
            </h2>
          </Reveal>
          <Reveal className={styles.faqList} delay={80}>
            {faq.items.map((item) => (
              <details key={item.question} name="preview-faq" className={styles.faqItem}>
                <summary>
                  <span>{item.question}</span>
                  <Plus aria-hidden="true" size={20} strokeWidth={1.8} />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
