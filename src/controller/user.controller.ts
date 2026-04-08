import { err, ok, Result } from 'neverthrow';
import { UserRepository } from '../repositories/user.repository.ts';
import { RequestError } from '../utils/error.ts';
import { UserProfileSummaryView, toUserProfileSummaryView } from '../models/user.model.ts';

export const getMyProfileSummary = async (
    userId: number
): Promise<Result<UserProfileSummaryView, RequestError>> => {
    const userResult = await UserRepository.findById(userId);
    if (userResult.isErr()) return err(userResult.error);

    const summaryResult = await UserRepository.getProfileSummaryStats(userId);
    if (summaryResult.isErr()) return err(summaryResult.error);

    return ok(toUserProfileSummaryView(userResult.value, summaryResult.value));
};
