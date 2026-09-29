/**
 * User data separation utilities
 * 
 * Separates user-specific data from Forem API data to ensure
 * user modifications are preserved during offer updates.
 */

export const USER_DATA_FIELDS = new Set([
  "favorite",
  "status",
  "notes",
  "tags",
  "priority",
  "statut_dates",
  "remarques",
  "suivi",
  "statuts",
  "favoris",
  "remarques",
  "priorites",
]);

export interface ForemData {
  [key: string]: unknown;
}

export interface UserData {
  favorite?: boolean;
  status?: string;
  notes?: string;
  tags?: string[];
  priority?: number;
  statut_dates?: Record<string, string>;
  remarques?: string;
  suivi?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OfferWithUserData {
  [key: string]: unknown;
}

/**
 * Separate user data from Forem data in an offer.
 * Returns (foremData, userData) tuple.
 */
export function separateUserData(offer: Record<string, unknown>): [Record<string, unknown>, Record<string, unknown>] {
  const foremData: Record<string, unknown> = {};
  const userData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(offer)) {
    if (USER_DATA_FIELDS.has(key)) {
      userData[key] = value;
    } else {
      foremData[key] = value;
    }
  }

  return [foremData, userData];
}

/**
 * Merge user data back into Forem data.
 */
export function mergeUserData(foremData: Record<string, unknown>, userData: Record<string, unknown>): Record<string, unknown> {
  return { ...foremData, ...userData };
}

/**
 * Update offer with new Forem data while preserving user data.
 */
export function preserveUserData(oldOffer: Record<string, unknown>, newForemData: Record<string, unknown>): Record<string, unknown> {
  const [, userData] = separateUserData(oldOffer);
  return { ...newForemData, ...userData };
}