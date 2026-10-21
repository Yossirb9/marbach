/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

declare namespace App {
  interface Locals {
    /** the content of this request (set by src/middleware.ts for public pages and previews) */
    site?: import('./lib/data').SiteData;
    /** the signed-in admin user (set by src/middleware.ts on /admin and /api/admin) */
    user?: import('./lib/auth').SessionUser | null;
    cfContext: ExecutionContext;
  }
}
