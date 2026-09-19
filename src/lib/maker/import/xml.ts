import { DesignImportError, IMPORT_LIMITS } from "@/lib/maker/import/types";

/**
 * Parser XML mínimo y CERRADO para SVG (0.5). Nunca construye un DOM ni
 * toca `innerHTML`/`DOMParser`: el SVG es contenido del usuario, y este
 * parser solo produce un árbol de datos (nombre/atributos/hijos/texto) sobre
 * el que después se leen únicamente geometría y estilo. No resuelve
 * entidades externas ni DTDs (una `<!ENTITY>` se rechaza: bomba de
 * expansión/XXE), no ejecuta nada.
 */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Texto directo concatenado (solo se usa para <style>). */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Quita el prefijo de namespace ("svg:rect" -> "rect"); "xlink:href" y "href" se unifican como "href". */
function localName(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

const ATTR_RE = /([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let nodeCount = 0;
  let i = 0;
  const n = source.length;

  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(source.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(source.slice(i, lt));

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (comentario sin cerrar).");
      i = end + 3;
    } else if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end < 0) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (CDATA sin cerrar).");
      stack[stack.length - 1].text += source.slice(lt + 9, end);
      i = end + 3;
    } else if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      if (end < 0) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (instrucción sin cerrar).");
      i = end + 2;
    } else if (source.startsWith("<!", lt)) {
      // DOCTYPE: se ignora, pero sin entidades declaradas.
      const bracket = source.indexOf("[", lt);
      const gt = source.indexOf(">", lt);
      let end = gt;
      if (bracket >= 0 && (gt < 0 || bracket < gt)) {
        const close = source.indexOf("]>", bracket);
        if (close < 0) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (DOCTYPE sin cerrar).");
        end = close + 1;
      }
      if (end < 0) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (declaración sin cerrar).");
      if (/<!ENTITY/i.test(source.slice(lt, end + 1))) {
        throw new DesignImportError("SVG_UNSAFE", "El SVG declara entidades XML, que no se admiten por seguridad.");
      }
      i = end + 1;
    } else if (source[lt + 1] === "/") {
      const gt = source.indexOf(">", lt);
      if (gt < 0) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (etiqueta sin cerrar).");
      const name = localName(source.slice(lt + 2, gt).trim());
      const top = stack[stack.length - 1];
      if (stack.length <= 1 || top.name !== name) {
        throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (etiquetas desbalanceadas).");
      }
      stack.pop();
      i = gt + 1;
    } else {
      // Etiqueta de apertura: buscar el ">" real respetando comillas.
      let j = lt + 1;
      let quote = "";
      while (j < n) {
        const c = source[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (etiqueta sin cerrar).");
      let inner = source.slice(lt + 1, j);
      const selfClosing = inner.endsWith("/");
      if (selfClosing) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(inner);
      if (!m) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (etiqueta vacía).");
      const attrs: Record<string, string> = {};
      ATTR_RE.lastIndex = 0;
      const attrSource = inner.slice(m[0].length);
      let am: RegExpExecArray | null;
      while ((am = ATTR_RE.exec(attrSource))) {
        attrs[localName(am[1])] = decodeEntities(am[2] ?? am[3] ?? "");
      }
      const node: XmlNode = { name: localName(m[1]), attrs, children: [], text: "" };
      if (++nodeCount > IMPORT_LIMITS.maxSvgNodes) {
        throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (demasiados elementos).");
      }
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) {
        if (stack.length > IMPORT_LIMITS.maxXmlDepth) {
          throw new DesignImportError("TOO_COMPLEX", "El SVG es demasiado complejo (anidamiento excesivo).");
        }
        stack.push(node);
      }
      i = j + 1;
    }
  }

  if (stack.length !== 1) throw new DesignImportError("SVG_INVALID", "El SVG está mal formado (falta cerrar etiquetas).");
  const svg = root.children.find((c) => c.name === "svg");
  if (!svg) throw new DesignImportError("SVG_INVALID", "El archivo no es un SVG válido (no se encontró el elemento <svg>).");
  return svg;
}
