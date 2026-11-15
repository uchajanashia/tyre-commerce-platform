/** Shape of the build-time environment config. Kept in its own file so the
 *  development/production variants can both import it WITHOUT a circular
 *  reference through Angular's fileReplacements swap. */
export interface AppEnvironment {
  /** Base URL of the authoritative read API. */
  apiBaseUrl: string;
  /** Public checkout remains closed until the bank integration is verified. */
  checkoutEnabled: boolean;
}
