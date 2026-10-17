/** Local authorization only. Does not provision users, read tokens or contact Shopify. */
import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";

export interface MappingReviewer { issuer: string; subject: string }
export class WorkflowError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
export function reviewerAllowed(subject: string, configuredSubjects: string): boolean {
  return configuredSubjects.split(",").map(s => s.trim()).filter(Boolean).includes(subject);
}
export function reviewerSession(req: Request) {
  const configured = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
  if (!configured) return { configured, authenticated: false, authorized: false, subject: null, issuer: null,
    message: "Reviewer sign-in is not configured. No mapping writes or exports are authorized." };
  const auth = getAuth(req);
  const subject = auth.userId ?? null;
  const issuer = typeof auth.sessionClaims?.iss === "string" ? auth.sessionClaims.iss : null;
  const authorized = Boolean(subject && issuer && reviewerAllowed(subject, process.env.MAPPING_REVIEWER_SUBJECTS ?? ""));
  return { configured, authenticated: Boolean(subject && issuer), authorized, subject, issuer,
    message: authorized ? "Authenticated mapping reviewer." : subject
      ? "Signed in, but not an authorized reviewer. Owner must configure this environment's reviewer allowlist."
      : "Sign in to review mappings and prepare private exports." };
}
export function allowedReviewOrigin(origin: string | undefined, configured: string): boolean {
  if (!origin) return false;
  return configured.split(",").map(s => s.trim()).filter(Boolean).includes(origin);
}
export function requireMappingReviewer(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  const session = reviewerSession(req);
  if (!session.authenticated) { res.status(401).json({ code: "REVIEWER_SIGN_IN_REQUIRED", error: session.message }); return; }
  if (!session.authorized) { res.status(403).json({ code: "REVIEWER_PERMISSION_REQUIRED", error: session.message }); return; }
  if (!["GET", "HEAD"].includes(req.method)) {
    const developmentOrigin = process.env.NODE_ENV === "development" && process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "";
    const origins = process.env.MAPPING_AUTHORIZED_ORIGINS ?? developmentOrigin;
    if (!allowedReviewOrigin(req.get("origin"), origins)) {
      res.status(403).json({ code: "REVIEW_ORIGIN_NOT_ALLOWED", error: "This request origin is not authorized." }); return;
    }
  }
  res.locals.mappingReviewer = { issuer: session.issuer!, subject: session.subject! } satisfies MappingReviewer;
  next();
}
export function workflowError(res: Response, error: unknown) {
  if (error instanceof WorkflowError) { res.status(error.status).json({ code: error.code, error: error.code }); return; }
  // Never return SQL, connection strings, credential-bearing errors or request bodies.
  res.status(503).json({ code: "WORKFLOW_UNAVAILABLE", error: "Operation unavailable. No automatic write retry was attempted." });
}
