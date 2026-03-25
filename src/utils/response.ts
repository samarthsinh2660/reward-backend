interface PaginatedData<T> {
    data: T[];
    pagination: {
        hasNext: boolean;
        nextCursor: number;
    };
}

function isPaginated<T>(value: unknown): value is PaginatedData<T> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'data' in value &&
        'pagination' in value
    );
}

export const successResponse = <T>(data: T, message: string) => {
    const base = {
        success: true,
        message,
        timestamp: new Date().toISOString(),
    };

    if (isPaginated(data)) {
        return { ...base, data: data.data, pagination: data.pagination };
    }

    return { ...base, data };
};

export const errorResponse = (message: string, statusCode: number = 500) => ({
    success: false,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
});
