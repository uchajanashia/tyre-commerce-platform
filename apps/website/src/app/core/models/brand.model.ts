/** Brand — spec 04-data-model.md. */

export interface Brand {
  id: string;
  name: string;
  country: string;
  logoUrl: string;
  story?: string;
  /** Optional: the real catalog's budget brands carry no tier — components tolerate its absence. */
  tier?: 'flagship' | 'performance' | 'value';
}
