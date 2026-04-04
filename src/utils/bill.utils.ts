import { BillPlatform } from '../models/bill.model.ts';

export function toPlatform(raw: string | null | undefined): BillPlatform {
    return (raw ?? 'unknown').toLowerCase().trim() || 'unknown';
}
