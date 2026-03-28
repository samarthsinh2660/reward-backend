import { Paginated } from '../types/pagination.ts';

function isPaginated<T>(data: unknown): data is Paginated<T> {
    return (
        typeof data === 'object' &&
        data !== null &&
        'data' in data &&
        'pagination' in data
    );
}

export function successResponse<T>(data: T | Paginated<T>, message?: string) {
    if (isPaginated(data)) {
        return {
            success: true,
            message: message ?? 'Operation successful',
            data: data.data,
            pagination: data.pagination,
            timestamp: new Date().toISOString(),
        };
    }
    return {
        success: true,
        message: message ?? 'Operation successful',
        data,
        timestamp: new Date().toISOString(),
    };
}

export function errorResponse(message: string, code: number = 10000) {
    return {
        success: false,
        error: { code, message },
        timestamp: new Date().toISOString(),
    };
}
