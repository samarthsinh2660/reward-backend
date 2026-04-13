import { BillRepository } from '../repositories/bill.repository.ts';
import { AdminAnalyticsRepository } from '../repositories/admin.analytics.repository.ts';
import { BillExtractedData } from './bill-processor.service.ts';
import {
    extractPackSize,
    inferRegion,
    inferUnitType,
    normalizeBrandName,
    normalizeProductName,
    normalizeWhitespace,
    parseJsonObject,
    toNumber,
} from '../utils/admin.analytics.utils.ts';
import { createLogger } from '../utils/logger.ts';
import { SyncedBillItem } from '../models/admin.analytics.model.ts';

const logger = createLogger('@admin.analytics-sync.service');

function toIsoDate(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

export async function syncBillAnalyticsSnapshot(billId: number): Promise<void> {
    const billResult = await BillRepository.findById(billId);
    if (billResult.isErr()) {
        logger.error(`Failed to load bill ${billId} for analytics sync`, billResult.error);
        return;
    }

    const bill = billResult.value;
    if (!bill?.extracted_data) return;

    const extracted = parseJsonObject<BillExtractedData>(bill.extracted_data);
    if (!extracted) {
        logger.warn(`Skipping analytics sync for bill ${billId}: extracted_data could not be parsed`);
        return;
    }

    const companyResult = await AdminAnalyticsRepository.upsertCompany({
        platform: bill.platform,
        merchant_name: extracted.merchant_name,
    });
    if (companyResult.isErr()) {
        logger.error(`Failed to upsert analytics company for bill ${billId}`, companyResult.error);
        return;
    }

    const snapshotResult = await AdminAnalyticsRepository.updateBillAnalyticsSnapshot(billId, {
        company_id: companyResult.value,
        merchant_name: extracted.merchant_name,
        region: inferRegion(extracted.delivery_state, extracted.delivery_city),
        state: extracted.delivery_state,
        city: extracted.delivery_city,
        area: extracted.delivery_area ?? null,
        postal_code: extracted.delivery_pincode,
    });
    if (snapshotResult.isErr()) {
        logger.error(`Failed to update analytics bill snapshot for bill ${billId}`, snapshotResult.error);
        return;
    }

    const brandCache = new Map<string, number | null>();
    const productCache = new Map<string, number | null>();
    const syncedItems: SyncedBillItem[] = [];

    for (const item of extracted.items ?? []) {
        const rawName = normalizeWhitespace(item.name ?? '');
        if (!rawName) continue;

        const normalizedBrand = normalizeBrandName(item.brand);
        let brandId: number | null = null;
        if (normalizedBrand) {
            if (brandCache.has(normalizedBrand)) {
                brandId = brandCache.get(normalizedBrand) ?? null;
            } else {
                const brandResult = await AdminAnalyticsRepository.upsertBrand(normalizedBrand);
                if (brandResult.isErr()) {
                    logger.error(`Failed to upsert brand "${normalizedBrand}" for bill ${billId}`, brandResult.error);
                    continue;
                }
                brandId = brandResult.value;
                brandCache.set(normalizedBrand, brandId);
            }
        }

        const normalizedName = normalizeProductName(rawName);
        const productCacheKey = `${brandId ?? 'na'}:${normalizedName}`;
        let productId: number | null = null;
        if (productCache.has(productCacheKey)) {
            productId = productCache.get(productCacheKey) ?? null;
        } else {
            const productResult = await AdminAnalyticsRepository.upsertProduct({
                raw_name: rawName,
                normalized_name: normalizedName,
                brand_id: brandId,
                brand_name: normalizedBrand,
                category_l1: item.category ?? null,
                category_l2: null,
                unit_type: inferUnitType(rawName, item.quantity),
                pack_size: extractPackSize(rawName),
            });
            if (productResult.isErr()) {
                logger.error(`Failed to upsert product "${rawName}" for bill ${billId}`, productResult.error);
                continue;
            }
            productId = productResult.value;
            productCache.set(productCacheKey, productId);
        }

        syncedItems.push({
            company_id: companyResult.value,
            brand_id: brandId,
            product_id: productId,
            product_name_raw: rawName,
            product_name_normalized: normalizedName || null,
            category_l1: item.category ?? null,
            category_l2: null,
            quantity: item.quantity ?? null,
            unit_type: inferUnitType(rawName, item.quantity),
            unit_price: item.unit_price ?? null,
            line_amount: item.total_price ?? (item.unit_price && item.quantity ? toNumber(item.unit_price) * toNumber(item.quantity) : 0),
            currency_code: extracted.currency ?? 'INR',
            city: extracted.delivery_city ?? null,
            area: extracted.delivery_area ?? null,
            bill_date: extracted.order_date ?? toIsoDate(bill.bill_date),
        });
    }

    const replaceResult = await AdminAnalyticsRepository.replaceBillItems(billId, syncedItems);
    if (replaceResult.isErr()) {
        logger.error(`Failed to replace analytics bill items for bill ${billId}`, replaceResult.error);
    }
}
