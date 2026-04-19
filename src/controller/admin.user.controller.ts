import { err, ok, Result } from 'neverthrow';
import { ERRORS, RequestError } from '../utils/error.ts';
import { UserRepository } from '../repositories/user.repository.ts';
import { AdminUserRow } from '../models/user.model.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('@admin.user.controller');

export type AdminUserListResponse = {
    data: AdminUserRow[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
};

export const listAdminUsers = async (
    page: number,
    limit: number,
    filter: 'all' | 'active' | 'blocked'
): Promise<Result<AdminUserListResponse, RequestError>> => {
    const result = await UserRepository.getAdminUsers(page, limit, filter);
    if (result.isErr()) return err(result.error);

    const { users, total } = result.value;
    return ok({
        data: users,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    });
};

export const toggleUserStatus = async (
    id: number,
    isActive: boolean
): Promise<Result<{ id: number; is_active: boolean }, RequestError>> => {
    const result = await UserRepository.setUserActive(id, isActive);
    if (result.isErr()) return err(result.error);

    logger.info(`Admin ${isActive ? 'unblocked' : 'blocked'} user ${id}`);
    return ok({ id, is_active: isActive });
};
