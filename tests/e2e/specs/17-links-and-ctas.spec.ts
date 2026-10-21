import { test, expect, gotoSettled } from "../support/fixtures";

/**
 * Enlaces internos de las páginas públicas: ninguno debe apuntar a un 404/5xx ni ser un "#" muerto.
 * Los enlaces externos (redes) no se siguen: solo se verifica que usen https y rel seguro si abren pestaña nueva.
 */
const PAGES = ["/landing", "/calculadora", "/login", "/registro", "/explorar-modelos", "/recuperar-password"];

for (const path of PAGES) {
  test(`${path}: enlaces internos válidos y externos seguros`, async ({ page, request, baseURL }) => {
    await gotoSettled(page, path);
    const links = await page.$$eval("a[href]", (anchors) =>
      anchors.map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        text: (anchor.textContent ?? anchor.getAttribute("aria-label") ?? "").trim().slice(0, 40),
        target: anchor.getAttribute("target"),
        rel: anchor.getAttribute("rel") ?? "",
      })),
    );
    const dead = links.filter((link) => link.href === "#" || link.href === "" || link.href.startsWith("javascript:"));
    expect(dead, "enlaces muertos (#, vacíos o javascript:)").toEqual([]);

    const internal = [...new Set(links.filter((link) => link.href.startsWith("/")).map((link) => link.href))];
    const broken: string[] = [];
    for (const href of internal) {
      const response = await request.get(new URL(href, baseURL).toString(), { maxRedirects: 5 });
      if (response.status() >= 400) broken.push(`${href} → ${response.status()}`);
    }
    expect(broken, "enlaces internos rotos").toEqual([]);

    const unsafeExternal = links.filter(
      (link) => /^https?:/.test(link.href) && link.target === "_blank" && !/noopener|noreferrer/.test(link.rel),
    );
    expect(unsafeExternal.map((link) => link.href), "enlaces externos con target=_blank sin rel=noopener").toEqual([]);
    expect(links.filter((link) => /^http:\/\//.test(link.href)).map((link) => link.href), "enlaces externos sin https").toEqual([]);
  });
}

test("/landing: CTAs principales llevan a registro/login", async ({ page }) => {
  await gotoSettled(page, "/landing");
  const hrefs = await page.$$eval("a[href]", (anchors) => anchors.map((anchor) => anchor.getAttribute("href")));
  expect(hrefs.some((href) => href?.startsWith("/registro"))).toBe(true);
  expect(hrefs.some((href) => href?.startsWith("/login"))).toBe(true);
});
