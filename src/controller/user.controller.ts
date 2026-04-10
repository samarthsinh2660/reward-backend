import { err, ok, Result } from 'neverthrow';
import { UserRepository } from '../repositories/user.repository.ts';
import { CashbackTransactionRepository } from '../repositories/cashback_transaction.repository.ts';
import { RequestError } from '../utils/error.ts';
import { UserProfileSummaryView, toUserProfileSummaryView } from '../models/user.model.ts';
import { CashbackTransaction } from '../models/cashback_transaction.model.ts';

export const getMyProfileSummary = async (
    userId: number
): Promise<Result<UserProfileSummaryView, RequestError>> => {
    const userResult = await UserRepository.findById(userId);
    if (userResult.isErr()) return err(userResult.error);

    const summaryResult = await UserRepository.getProfileSummaryStats(userId);
    if (summaryResult.isErr()) return err(summaryResult.error);

    return ok(toUserProfileSummaryView(userResult.value, summaryResult.value));
};

export type WalletSummaryView = {
    wallet_balance:      number;
    coin_balance:        number;
    monthly_earned:      number;
    recent_transactions: {
        id:          number;
        bill_id:     number | null;
        amount:      number;
        type:        string;
        description: string | null;
        created_at:  string;
    }[];
    chart_data: { date: string; earned: number }[];
};

export const getWalletSummary = async (
    userId: number
): Promise<Result<WalletSummaryView, RequestError>> => {
    const [userR, txR, dailyR, monthlyR] = await Promise.all([
        UserRepository.findById(userId),
        CashbackTransactionRepository.getByUserId(userId, 20),
        CashbackTransactionRepository.getDailyEarnings(userId, 30),
        CashbackTransactionRepository.getMonthlyTotal(userId),
    ]);

    if (userR.isErr())    return err(userR.error);
    if (txR.isErr())      return err(txR.error);
    if (dailyR.isErr())   return err(dailyR.error);
    if (monthlyR.isErr()) return err(monthlyR.error);

    const user = userR.value;

    return ok({
        wallet_balance:      Number(user.wallet_balance),
        coin_balance:        Number(user.coin_balance),
        monthly_earned:      monthlyR.value,
        recent_transactions: txR.value.map((t: CashbackTransaction) => ({
            id:          t.id,
            bill_id:     t.bill_id,
            amount:      Number(t.amount),
            type:        t.type,
            description: t.description,
            created_at:  t.created_at instanceof Date
                         ? t.created_at.toISOString()
                         : String(t.created_at),
        })),
        chart_data: dailyR.value,
    });
};
