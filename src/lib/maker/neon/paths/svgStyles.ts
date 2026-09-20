import { DesignImportError } from "@/lib/maker/import/types";
import type { XmlNode } from "@/lib/maker/import/xml";

/**
 * Resolución de estilos SVG para Neon LED: atributos de presentación, `style=""`
 * y hojas `<style>` con selectores comunes, con la cascada real (importancia >
 * origen > especificidad > orden). La herencia de propiedades (fill, stroke...) la
 * resuelve el recorrido del árbol en svgToNeonPaths.ts.
 *
 * Selectores soportados: `tag`, `*`, `.clase` (varias), `#id` y sus combinaciones
 * (`tag.clase`, `.a.b`), con combinadores descendiente (`svg path`, `.a .b`) e hijo
 * (`g > path`), y listas con coma. NO soportados (la regla se ignora, nunca se
 * interpreta a medias): pseudo-clases/elementos, selectores de atributo, hermanos
 * (`+`, `~`), `@media` condicionado (sus reglas se aplican siempre), variables CSS
 * (`var(--x)` cuenta como "hay valor visible").
 */

export const STYLE_PROPS = [
  "fill", "stroke", "opacity", "fill-opacity", "stroke-opacity", "display", "visibility",
  "clip-path", "mask", "filter", "font-size", "font-family", "text-anchor", "color",
] as const;
const STYLE_PROP_SET = new Set<string>(STYLE_PROPS);

interface Decl {
  prop: string;
  value: string;
  important: boolean;
}

interface Compound {
  tag: string | null;
  classes: string[];
  id: string | null;
}

interface Rule {
  compounds: Compound[];
  /** combinators[i] une compounds[i] con compounds[i+1]. */
  combinators: (" " | ">")[];
  specificity: number;
  order: number;
  decls: Decl[];
}

export function parseDeclarations(css: string): Decl[] {
  const out: Decl[] = [];
  for (const raw of css.split(";")) {
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const prop = raw.slice(0, i).trim().toLowerCase();
    let value = raw.slice(i + 1).trim();
    const important = /!\s*important\s*$/i.test(value);
    value = value.replace(/!\s*important\s*$/i, "").trim();
    if (prop && STYLE_PROP_SET.has(prop)) out.push({ prop, value, important });
  }
  return out;
}

function parseCompound(text: string): Compound | null {
  if (!/^(?:[a-zA-Z][\w-]*|\*)?(?:\.[\w-]+)*(?:#[\w-]+)?(?:\.[\w-]+)*$/.test(text) || text === "") return null;
  const tag = /^([a-zA-Z][\w-]*)/.exec(text)?.[1] ?? null;
  const classes = [...text.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const id = /#([\w-]+)/.exec(text)?.[1] ?? null;
  return { tag, classes, id };
}

function parseSelector(selector: string): Pick<Rule, "compounds" | "combinators" | "specificity"> | null {
  const tokens = selector.trim().replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean);
  const compounds: Compound[] = [];
  const combinators: (" " | ">")[] = [];
  let pending: " " | ">" = " ";
  for (const tok of tokens) {
    if (tok === ">") {
      pending = ">";
      continue;
    }
    const c = parseCompound(tok);
    if (!c) return null;
    if (compounds.length > 0) combinators.push(pending);
    compounds.push(c);
    pending = " ";
  }
  if (compounds.length === 0) return null;
  let ids = 0, classes = 0, tags = 0;
  for (const c of compounds) {
    if (c.id) ids++;
    classes += c.classes.length;
    if (c.tag) tags++;
  }
  return { compounds, combinators, specificity: ids * 10000 + classes * 100 + tags };
}

/** Reglas de todas las hojas <style> del árbol. `@import` se rechaza (recurso externo). */
export function collectRules(root: XmlNode): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  const visit = (node: XmlNode) => {
    if (node.name === "style") {
      if (/@import/i.test(node.text)) throw new DesignImportError("SVG_UNSAFE", "El SVG importa hojas de estilo externas, que no se admiten por seguridad.");
      const css = node.text.replace(/\/\*[\s\S]*?\*\//g, "");
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        const selectorText = m[1].trim();
        if (selectorText.startsWith("@")) continue;
        const decls = parseDeclarations(m[2]);
        if (decls.length === 0) continue;
        for (const sel of selectorText.split(",")) {
          const parsed = parseSelector(sel);
          if (parsed) rules.push({ ...parsed, order: order++, decls });
        }
      }
    }
    for (const c of node.children) visit(c);
  };
  visit(root);
  return rules;
}

function compoundMatches(c: Compound, node: XmlNode): boolean {
  if (c.tag && c.tag !== node.name) return false;
  if (c.id && node.attrs.id !== c.id) return false;
  if (c.classes.length > 0) {
    const have = (node.attrs.class ?? "").split(/\s+/);
    if (!c.classes.every((k) => have.includes(k))) return false;
  }
  return true;
}

/** `ancestors`: del más lejano (raíz) al padre directo. */
function ruleMatches(rule: Rule, node: XmlNode, ancestors: XmlNode[]): boolean {
  const last = rule.compounds.length - 1;
  if (!compoundMatches(rule.compounds[last], node)) return false;
  const matchFrom = (idx: number, ancIdx: number): boolean => {
    // idx: compuesto a satisfacer; ancIdx: ancestro más cercano aún disponible (hasta 0).
    if (idx < 0) return true;
    const comb = rule.combinators[idx]; // une compounds[idx] con compounds[idx+1]
    if (comb === ">") {
      return ancIdx >= 0 && compoundMatches(rule.compounds[idx], ancestors[ancIdx]) && matchFrom(idx - 1, ancIdx - 1);
    }
    for (let a = ancIdx; a >= 0; a--) {
      if (compoundMatches(rule.compounds[idx], ancestors[a]) && matchFrom(idx - 1, a - 1)) return true;
    }
    return false;
  };
  return matchFrom(last - 1, ancestors.length - 1);
}

interface Candidate extends Decl {
  tier: number;
  specificity: number;
  order: number;
}

/**
 * Valores especificados (cascada) de las propiedades de estilo de un nodo:
 * atributos de presentación < reglas CSS (por especificidad y orden) < `style=""`,
 * con `!important` por encima de todo. No aplica herencia.
 */
export function cascadeStyle(node: XmlNode, ancestors: XmlNode[], rules: Rule[]): Record<string, string> {
  const cands: Candidate[] = [];
  for (const p of STYLE_PROPS) {
    if (node.attrs[p] !== undefined) cands.push({ prop: p, value: node.attrs[p].trim(), important: false, tier: 0, specificity: 0, order: 0 });
  }
  for (const r of rules) {
    if (!ruleMatches(r, node, ancestors)) continue;
    for (const d of r.decls) cands.push({ ...d, tier: 1, specificity: r.specificity, order: r.order });
  }
  if (node.attrs.style) {
    for (const d of parseDeclarations(node.attrs.style)) cands.push({ ...d, tier: 2, specificity: 0, order: 0 });
  }
  cands.sort(
    (a, b) =>
      Number(a.important) - Number(b.important) || a.tier - b.tier || a.specificity - b.specificity || a.order - b.order,
  );
  const out: Record<string, string> = {};
  for (const c of cands) out[c.prop] = c.value;
  return out;
}

/** "none", "transparent" o un color con alfa 0 (rgba(...,0), #rgba/#rrggbbaa con alfa 00). */
export function isNoPaint(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "none" || v === "transparent") return true;
  const fn = /^(?:rgba|hsla)\(([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length >= 4) return parseFloat(parts[3]) === 0;
  }
  if (/^#[0-9a-f]{4}$/.test(v)) return v[4] === "0";
  if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(7) === "00";
  return false;
}

/** Longitud CSS -> unidades de usuario (px). Soporta px, pt, em/rem (16 px) y números; porcentajes/otros -> fallback. */
export function parseFontSize(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const m = /^\s*([-+]?(?:\d*\.\d+|\d+\.?))(px|pt|em|rem|)\s*$/i.exec(value);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  if (!(n > 0)) return fallback;
  const unit = m[2].toLowerCase();
  return unit === "pt" ? n * (96 / 72) : unit === "em" || unit === "rem" ? n * 16 : n;
}
