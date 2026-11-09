import express from "express";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

const payPalSources = "https://*.paypal.com https://*.paypalobjects.com https://*.venmo.com";

function policy(nonce) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' ${payPalSources}`,
    `connect-src 'self' ${payPalSources}`,
    `frame-src 'self' https://cdn.foxpost.hu ${payPalSources}`,
    `style-src 'self' 'unsafe-inline' ${payPalSources}`,
    "img-src 'self' https: data:",
    "font-src 'self' data:",
  ].join("; ");
}

export function mountStorefront(app, directory, mode) {
  if (!["enforce", "report-only"].includes(mode)) {
    throw new Error("STOREFRONT_CSP_MODE must be enforce or report-only.");
  }
  const template = readFileSync(join(directory, "index.html"), "utf8");
  const header = mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  app.get("*", (req, res, next) => {
    const requestedPath = req.params[0];
    if (requestedPath !== "/index.html" && (extname(requestedPath) || !req.accepts("html"))) return next();

    const nonce = randomBytes(18).toString("base64");
    res.set({ [header]: policy(nonce), "Cache-Control": "no-store" });
    res.type("html").send(template.replace("<head>", `<head><meta name="csp-nonce" nonce="${nonce}">`));
  });
  app.use(express.static(directory, {
    index: false,
    redirect: false,
    setHeaders(res, file) {
      if (extname(file).toLowerCase() === ".html") res.setHeader(header, "default-src 'none'; frame-ancestors 'none'");
    },
  }));
}
