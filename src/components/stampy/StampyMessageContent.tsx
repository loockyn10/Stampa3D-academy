import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const INTERNAL_ROUTE_ROOTS = [
  "/academia",
  "/calculadora",
  "/canales",
  "/configuracion",
  "/cursos",
  "/libreria-stl",
  "/perfil",
  "/presupuestos",
  "/productos",
  "/redes",
  "/sorteos",
  "/stampy",
  "/stock",
  "/talleres",
] as const;

function isAllowedInternalHref(href: string | undefined): href is string {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return false;
  const pathname = href.split(/[?#]/, 1)[0];
  return INTERNAL_ROUTE_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

interface StampyMessageContentProps {
  content: string;
  role: "user" | "assistant";
}

export function StampyMessageContent({ content, role }: StampyMessageContentProps) {
  if (role === "user") {
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-5 text-white [overflow-wrap:anywhere]">
        {content}
      </p>
    );
  }

  return (
    <div className="min-w-0 max-w-full text-sm leading-6 text-gray-300 [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={[
          "p",
          "strong",
          "em",
          "ul",
          "ol",
          "li",
          "h1",
          "h2",
          "h3",
          "h4",
          "a",
          "code",
          "pre",
          "blockquote",
          "hr",
          "br",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "del",
        ]}
        unwrapDisallowed
        urlTransform={(url) => (isAllowedInternalHref(url) ? url : "")}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          h1: ({ children }) => <h3 className="mb-1.5 mt-3 text-[15px] font-semibold leading-5 text-white first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="mb-1.5 mt-3 text-[15px] font-semibold leading-5 text-white first:mt-0">{children}</h3>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-semibold leading-5 text-white first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-sm font-semibold leading-5 text-white first:mt-0">{children}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
          ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 pl-0 marker:text-stampa-orange">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 pl-0 marker:font-semibold marker:text-stampa-orange">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ href, children }) => isAllowedInternalHref(href) ? (
            <Link
              href={href}
              className="font-medium text-stampa-orange underline decoration-stampa-orange/40 underline-offset-2 transition-colors hover:text-orange-300"
            >
              {children}
            </Link>
          ) : <span>{children}</span>,
          code: ({ children }) => (
            <code className="break-words rounded bg-black/40 px-1 py-0.5 font-mono text-[0.85em] text-cyan-200">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 max-w-full overflow-x-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-stampa-orange/70 bg-stampa-orange/5 py-1 pl-3 text-gray-200">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-stampa-border" />,
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-stampa-border">
              <table className="w-full table-fixed border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="break-words border-b border-stampa-border bg-black/20 px-2 py-1.5 font-semibold text-gray-100">{children}</th>,
          td: ({ children }) => <td className="break-words border-b border-stampa-border/60 px-2 py-1.5 align-top last:border-b-0">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
