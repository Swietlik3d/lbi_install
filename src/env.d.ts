/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Active site id, mirrored from process.env.SITE_ID at build time. */
  readonly SITE_ID?: string;
  /** Optional contact-form endpoint (Formspree / custom). */
  readonly PUBLIC_CONTACT_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
