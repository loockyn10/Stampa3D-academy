import type { Page } from "@playwright/test";

export interface UiAudit {
  viewportWidth: number;
  /** px que el documento excede el viewport en horizontal (0 = ok). */
  overflow: number;
  overflowOffenders: string[];
  /** Controles interactivos visibles parcial o totalmente fuera del viewport horizontal. */
  offscreenControls: string[];
  /** Botones/inputs visibles con área táctil menor a 24x24 px (WCAG 2.5.8). */
  tinyTargets: string[];
  /** Inputs de texto con font-size < 16px (provocan zoom automático en iOS Safari). */
  smallFontInputs: string[];
}

/** Auditoría objetiva de layout en la página actual. No modifica el DOM. */
export async function auditLayout(page: Page): Promise<UiAudit> {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const describe = (el: Element) => {
      const html = el as HTMLElement;
      const label = (html.getAttribute("aria-label") || html.innerText || html.getAttribute("placeholder") || html.getAttribute("name") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 30);
      return `${el.tagName.toLowerCase()}${html.id ? `#${html.id}` : ""}${label ? `“${label}”` : ""}`;
    };
    const isVisible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
    };
    const insideScrollX = (el: Element) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if ((overflowX === "auto" || overflowX === "scroll") && parent.scrollWidth > parent.clientWidth) return true;
      }
      return false;
    };

    const doc = document.documentElement;
    const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - viewportWidth;
    const overflowOffenders: string[] = [];
    if (overflow > 1) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (!isVisible(el) || getComputedStyle(el).position === "fixed" || insideScrollX(el)) continue;
        if ((el as HTMLElement).getBoundingClientRect().right > viewportWidth + 1) {
          overflowOffenders.push(describe(el));
          if (overflowOffenders.length >= 8) break;
        }
      }
    }

    const controls = Array.from(document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]"));
    const offscreenControls: string[] = [];
    const tinyTargets: string[] = [];
    const smallFontInputs: string[] = [];
    for (const el of controls) {
      if (!isVisible(el)) continue;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (!insideScrollX(el) && (rect.right > viewportWidth + 1 || rect.left < -1)) offscreenControls.push(describe(el));
      const isInlineLink = el.tagName === "A" && !!el.closest("p, li, span") && getComputedStyle(el).display === "inline";
      if (!isInlineLink && (rect.width < 24 || rect.height < 24)) tinyTargets.push(`${describe(el)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        const type = (el as HTMLInputElement).type;
        if (!["checkbox", "radio", "range", "file", "button", "submit", "color"].includes(type)) {
          if (parseFloat(getComputedStyle(el).fontSize) < 16) smallFontInputs.push(describe(el));
        }
      }
    }
    return { viewportWidth, overflow, overflowOffenders, offscreenControls, tinyTargets, smallFontInputs };
  });
}
