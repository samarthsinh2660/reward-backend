export type OtpEntry = {
    code:      string;
    expiresAt: number;
    attempts:  number;
};

// Pending email-change request stored server-side until OTP is verified
export type EmailChangeEntry = {
    newEmail:  string;
    code:      string;
    expiresAt: number;
};

export type SendOtpResponse = {
    message: string;
};

export type RefreshTokenResponse = {
    token: string;
};
