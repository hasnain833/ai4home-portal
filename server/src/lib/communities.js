/** Community types are a label only — they do not change how a community behaves. */
export const COMMUNITY_TYPES = ["UNIT_HOMES", "SHARED_HOMES"];

export const COMMUNITY_TYPE_LABELS = {
  UNIT_HOMES: "Unit Homes",
  SHARED_HOMES: "Shared Homes",
};

/** A community is full at 50 homes. Hard limit, not a warning. */
export const MAX_HOMES_PER_COMMUNITY = 50;

export const isCommunityType = (value) => COMMUNITY_TYPES.includes(value);
