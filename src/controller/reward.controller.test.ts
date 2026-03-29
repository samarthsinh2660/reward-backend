import { describe, it, expect } from '@jest/globals';
import { drawReward } from './reward.controller.ts';
import { RewardConfig } from '../models/reward_config.model.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTier(
    overrides: Partial<RewardConfig> & { tier_name: string; reward_min: number; reward_max: number; weight: number }
): RewardConfig {
    return {
        id:         overrides.id         ?? 1,
        tier_name:  overrides.tier_name  as any,
        reward_min: overrides.reward_min,
        reward_max: overrides.reward_max,
        weight:     overrides.weight,
        is_active:  overrides.is_active  ?? 1,
        created_at: new Date(),
        updated_at: new Date(),
        constructor: { name: 'RowDataPacket' },
    } as unknown as RewardConfig;
}

const DEFAULT_TIERS: RewardConfig[] = [
    makeTier({ id: 1, tier_name: 'base',    reward_min: 2,  reward_max: 10,  weight: 70 }),
    makeTier({ id: 2, tier_name: 'medium',  reward_min: 11, reward_max: 30,  weight: 20 }),
    makeTier({ id: 3, tier_name: 'high',    reward_min: 31, reward_max: 60,  weight: 8  }),
    makeTier({ id: 4, tier_name: 'jackpot', reward_min: 61, reward_max: 80,  weight: 2  }),
];

// ── Core draw tests ───────────────────────────────────────────────────────────

describe('drawReward', () => {

    it('throws when no tiers are provided', () => {
        expect(() => drawReward([], 0, 15)).toThrow();
    });

    it('returns an amount within the winning tier range', () => {
        for (let i = 0; i < 50; i++) {
            const draw = drawReward(DEFAULT_TIERS, 0, 15);
            const tier = DEFAULT_TIERS.find(t => t.tier_name === draw.tier_name)!;
            expect(draw.amount).toBeGreaterThanOrEqual(tier.reward_min);
            expect(draw.amount).toBeLessThanOrEqual(tier.reward_max);
        }
    });

    it('rounds amounts to 2 decimal places', () => {
        for (let i = 0; i < 20; i++) {
            const draw = drawReward(DEFAULT_TIERS, 0, 15);
            expect(draw.amount).toBe(Math.round(draw.amount * 100) / 100);
            expect(draw.decoys[0]).toBe(Math.round(draw.decoys[0] * 100) / 100);
            expect(draw.decoys[1]).toBe(Math.round(draw.decoys[1] * 100) / 100);
        }
    });

    it('always returns exactly 2 decoys', () => {
        for (let i = 0; i < 20; i++) {
            const draw = drawReward(DEFAULT_TIERS, 0, 15);
            expect(draw.decoys).toHaveLength(2);
        }
    });

    it('decoys are positive amounts', () => {
        for (let i = 0; i < 20; i++) {
            const draw = drawReward(DEFAULT_TIERS, 0, 15);
            expect(draw.decoys[0]).toBeGreaterThan(0);
            expect(draw.decoys[1]).toBeGreaterThan(0);
        }
    });

    // ── Pity system ────────────────────────────────────────────────────────────

    it('does not trigger pity when counter < cap', () => {
        // Run many times — pity should not trigger
        for (let i = 0; i < 30; i++) {
            const draw = drawReward(DEFAULT_TIERS, 14, 15);
            expect(draw.pity_triggered).toBe(false);
        }
    });

    it('triggers pity when counter equals cap', () => {
        const draw = drawReward(DEFAULT_TIERS, 15, 15);
        expect(draw.pity_triggered).toBe(true);
    });

    it('triggers pity when counter exceeds cap', () => {
        const draw = drawReward(DEFAULT_TIERS, 20, 15);
        expect(draw.pity_triggered).toBe(true);
    });

    it('pity draw lands on high or jackpot tier', () => {
        for (let i = 0; i < 30; i++) {
            const draw = drawReward(DEFAULT_TIERS, 15, 15);
            expect(['high', 'jackpot']).toContain(draw.tier_name);
        }
    });

    it('pity draw amount is within high/jackpot range', () => {
        for (let i = 0; i < 30; i++) {
            const draw = drawReward(DEFAULT_TIERS, 15, 15);
            expect(draw.amount).toBeGreaterThanOrEqual(31);  // high tier minimum
            expect(draw.amount).toBeLessThanOrEqual(80);     // jackpot tier maximum
        }
    });

    it('falls back to all tiers when no high/jackpot configured', () => {
        const tiers = [
            makeTier({ id: 1, tier_name: 'base',   reward_min: 2,  reward_max: 10, weight: 70 }),
            makeTier({ id: 2, tier_name: 'medium', reward_min: 11, reward_max: 30, weight: 30 }),
        ];
        // Pity triggers but no high/jackpot → should still draw, not throw
        const draw = drawReward(tiers, 15, 15);
        expect(draw.pity_triggered).toBe(true);
        expect(draw.amount).toBeGreaterThan(0);
    });

    // ── Single tier ────────────────────────────────────────────────────────────

    it('works correctly with a single tier', () => {
        const tiers = [makeTier({ id: 1, tier_name: 'base', reward_min: 5, reward_max: 20, weight: 100 })];
        const draw = drawReward(tiers, 0, 10);
        expect(draw.tier_name).toBe('base');
        expect(draw.amount).toBeGreaterThanOrEqual(5);
        expect(draw.amount).toBeLessThanOrEqual(20);
        expect(draw.decoys).toHaveLength(2);
    });

    // ── Weight distribution (statistical) ─────────────────────────────────────

    it('base tier wins roughly 70% of the time over many draws', () => {
        const N = 1000;
        let baseCount = 0;
        for (let i = 0; i < N; i++) {
            const draw = drawReward(DEFAULT_TIERS, 0, 15);
            if (draw.tier_name === 'base') baseCount++;
        }
        const ratio = baseCount / N;
        // With 70% weight, expect 60–80% in 1000 draws (3-sigma range)
        expect(ratio).toBeGreaterThan(0.60);
        expect(ratio).toBeLessThan(0.80);
    });

    it('jackpot tier wins roughly 2% of the time over many draws', () => {
        const N = 2000;
        let jackpotCount = 0;
        for (let i = 0; i < N; i++) {
            const draw = drawReward(DEFAULT_TIERS, 0, 15);
            if (draw.tier_name === 'jackpot') jackpotCount++;
        }
        const ratio = jackpotCount / N;
        // With 2% weight, expect 0.5–4% in 2000 draws
        expect(ratio).toBeGreaterThan(0.005);
        expect(ratio).toBeLessThan(0.04);
    });
});
