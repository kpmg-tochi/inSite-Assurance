import React from "react";
import { APPLICATION_NAME } from "../config/appName";

/** The client's mark (UBEC rebrand). A tenant's own `brandingConfig.logoUrl` wins when it has one. */
export const DEFAULT_LOGO_URL = "/client/ubec-logo.png";
export const DEFAULT_FULL_LOGO_URL = "/client/ubec-logo-full.png";

export function BrandLogo({
  logoUrl,
  alt = APPLICATION_NAME,
  className = "h-8 w-8",
}: {
  logoUrl?: string | null;
  alt?: string;
  className?: string;
}) {
  return <img src={logoUrl || DEFAULT_LOGO_URL} alt={alt} className={`object-contain ${className}`} />;
}

/**
 * The short name of an organisation for tight spaces: the acronym in trailing brackets when there is
 * one ("Universal Basic Education Commission (UBEC)" → "UBEC"), else the name itself.
 */
export function shortOrganisationName(name: string | null | undefined): string {
  if (!name) return "";
  const m = /\(([^()]+)\)\s*$/.exec(name);
  return m ? m[1].trim() : name;
}
