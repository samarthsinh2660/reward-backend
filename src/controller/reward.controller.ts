/**
 * Reward engine — pure functions only, no DB calls.
 * All inputs come from repositories; this module computes only.
 * 100% unit testable without mocking.
 */

import { RewardConfig, RewardDraw, RewardTierName } from '../models/reward_config.model.ts';

/**
 * Weighted random draw with pity system.
 *
 * Algorithm:
 *   1. If pityCounter >= pityCap → force draw from 'high' or 'jackpot' tiers only.
 *   2. Weighted random: sum all weights, pick random in [1, total], walk tiers.
 *   3. Pick a random amount within the winning tier's [reward_min, reward_max].
 *   4. Compute 2 decoy amounts from tiers higher than the winner (for chest UI).
 *
 * @param activeTiers  Active reward tiers from DB, any order.
 * @param pityCounter  User's current pity_counter.
 * @param pityCap      Admin-configured pity cap.
 */
export function drawReward(
    activeTiers: RewardConfig[],
    pityCounter: number,
    pityCap: number
): RewardDraw {
    if (activeTiers.length === 0) {
        throw new Error('No active reward tiers configured');
    }

    // Sort ascending by reward_min so index order = tier rank
    const sorted = [...activeTiers].sort((a, b) => a.reward_min - b.reward_min);

    // ── Pity check ─────────────────────────────────────────────────────────────
    const pityTriggered = pityCounter >= pityCap;
    const bonusTiers: RewardTierName[] = ['high', 'jackpot'];
    const eligible = pityTriggered
        ? sorted.filter(t => bonusTiers.includes(t.tier_name))
        : sorted;

    // Fall back to all tiers if pity triggers but no high/jackpot configured
    const tiersForDraw = eligible.length > 0 ? eligible : sorted;

    // ── Weighted draw ──────────────────────────────────────────────────────────
    const totalWeight = tiersForDraw.reduce((sum, t) => sum + t.weight, 0);
    let roll = Math.floor(Math.random() * totalWeight) + 1;

    let winningTier = tiersForDraw[tiersForDraw.length - 1]; // default: heaviest
    for (const tier of tiersForDraw) {
        roll -= tier.weight;
        if (roll <= 0) {
            winningTier = tier;
            break;
        }
    }

    const amount = _round(_randomBetween(winningTier.reward_min, winningTier.reward_max));

    // ── Decoys (for chest UI — never credited) ─────────────────────────────────
    const winningIdx = sorted.findIndex(t => t.id === winningTier.id);
    // Decoys come from tiers strictly above the winner (at minimum same tier)
    const higherTiers = sorted.slice(winningIdx + 1);
    const decoyPool = higherTiers.length >= 2
        ? higherTiers
        : higherTiers.length === 1
            ? [...higherTiers, ...sorted.slice(-1)]
            : sorted.slice(-2);   // if winner is highest, reuse top tier

    const decoys: [number, number] = [
        _round(_randomBetween(decoyPool[0].reward_min, decoyPool[0].reward_max)),
        _round(_randomBetween(
            decoyPool[Math.min(1, decoyPool.length - 1)].reward_min,
            decoyPool[Math.min(1, decoyPool.length - 1)].reward_max
        )),
    ];

    return {
        amount,
        tier_name: winningTier.tier_name,
        pity_triggered: pityTriggered,
        decoys,
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _randomBetween(min: number, max: number): number {
    // mysql2 returns DECIMAL columns as strings — coerce to number defensively
    const lo = Number(min);
    const hi = Number(max);
    return lo + Math.random() * (hi - lo);
}

function _round(value: number): number {
    return Math.round(value * 100) / 100;
}
