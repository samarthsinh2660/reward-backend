export type Paginated<T> = {
    data: T[];
    pagination: {
        hasNext: boolean;
        nextCursor: number;
    };
};
