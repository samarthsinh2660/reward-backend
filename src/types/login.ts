export type LoginResponse<T> = T & {
    token: string;
    refresh_token: string;
};
