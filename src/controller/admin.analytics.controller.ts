import { Result } from 'neverthrow';
import { RequestError } from '../utils/error.ts';
import {
    AdminAnalyticsDashboardView,
    AnalyticsListResponse,
    AnalyticsFilters,
    BrandDistributionRow,
    CompanyDistributionRow,
    DrilldownFilters,
    DrilldownRow,
    GeographyDistributionFilters,
    GeographyDistributionRow,
    ItemScanRow,
    ProductDistributionRow,
} from '../models/admin.analytics.model.ts';
import { AdminAnalyticsRepository } from '../repositories/admin.analytics.repository.ts';

export const getAdminAnalyticsDashboard = async (
    filters: AnalyticsFilters
): Promise<Result<AdminAnalyticsDashboardView, RequestError>> => {
    return AdminAnalyticsRepository.getDashboard(filters);
};

export const getCompanyDistribution = async (
    filters: AnalyticsFilters
): Promise<Result<AnalyticsListResponse<CompanyDistributionRow>, RequestError>> => {
    return AdminAnalyticsRepository.getCompanyDistribution(filters);
};

export const getBrandDistribution = async (
    filters: AnalyticsFilters
): Promise<Result<AnalyticsListResponse<BrandDistributionRow>, RequestError>> => {
    return AdminAnalyticsRepository.getBrandDistribution(filters);
};

export const getProductDistribution = async (
    filters: AnalyticsFilters
): Promise<Result<AnalyticsListResponse<ProductDistributionRow>, RequestError>> => {
    return AdminAnalyticsRepository.getProductDistribution(filters);
};

export const getGeographyDistribution = async (
    filters: GeographyDistributionFilters
): Promise<Result<AnalyticsListResponse<GeographyDistributionRow>, RequestError>> => {
    return AdminAnalyticsRepository.getGeographyDistribution(filters);
};

export const getItemScans = async (
    filters: AnalyticsFilters
): Promise<Result<AnalyticsListResponse<ItemScanRow>, RequestError>> => {
    return AdminAnalyticsRepository.getItemScans(filters);
};

export const getCompanyProducts = async (
    companyId: number,
    filters: DrilldownFilters
): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> => {
    return AdminAnalyticsRepository.getCompanyProducts(companyId, filters);
};

export const getBrandProducts = async (
    brandId: number,
    filters: DrilldownFilters
): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> => {
    return AdminAnalyticsRepository.getBrandProducts(brandId, filters);
};

export const getProductCompanies = async (
    productId: number,
    filters: DrilldownFilters
): Promise<Result<AnalyticsListResponse<DrilldownRow>, RequestError>> => {
    return AdminAnalyticsRepository.getProductCompanies(productId, filters);
};
