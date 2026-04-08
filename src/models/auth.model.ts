export type OtpEntry = {
    code: string;
    expiresAt: number;
    attempts: number;
};

export type SendOtpResponse = {
    message: string;
};

export type RefreshTokenResponse = {
    token: string;
};
