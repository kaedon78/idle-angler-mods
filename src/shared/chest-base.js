// @version      2026-11-25
// =====================================================================================================
// Shared by the Gear judge and Quicklinks: what a chest's value starts from
//
// A chest's coin and treasure start from your catch value, and the builds differ on how: the live game
// (v1.7.0) starts from your fish value (stats.fishValue, or else the water's base value), the balance test
// build (v1.7.1) multiplies the water's base value by it (loot.js rollChestContents). This reads which off
// the game's own chest roll once, with your stats: the random spread of its coin (0.7-1.3) held at its
// middle for that one call (Math.random put back after), in the water whose base value is highest, so the
// two ways can't agree. Nothing is opened or sent.
// =====================================================================================================
function chestBaseRule({ rollChestContents, RARITIES, CHEST_GOLD, ZONES, stats }) {
  const zone = ZONES.reduce((a, z) => (z.baseValue > a.baseValue ? z : a));
  const tier = RARITIES.length - 1; // the biggest coin, so its rounding doesn't matter
  const random = Math.random;
  let gold;
  Math.random = () => 0.5;
  try {
    gold = rollChestContents(zone, tier, stats).gold;
  } finally {
    Math.random = random;
  }
  const base = gold / (RARITIES[tier].valueMult * CHEST_GOLD * stats.valueMult * (stats.chestValueMult ?? 1));
  const multiplies = Math.abs(base - (stats.fishValue ?? 1) * zone.baseValue) < Math.abs(base - (stats.fishValue ?? zone.baseValue));
  return (s, z) => (multiplies ? (s.fishValue ?? 1) * z.baseValue : s.fishValue ?? z.baseValue);
}
