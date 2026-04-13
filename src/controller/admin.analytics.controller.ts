import { Result } from 'neverthrow';
import { RequestError } from '../utils/error.ts';
import {
    AdminAnalyticsDashboardView,
    AnalyticsFilters,
    DrilldownFilters,
    GeographyDistributionFilters,
} from '../models/admin.analytics.model.ts';
import { AdminAnalyticsRepository } from '../repositories/admin.analytics.repository.ts';

export const getAdminAnalyticsDashboard = async (
    filters: AnalyticsFilters
): Promise<Result<AdminAnalyticsDashboardView, RequestError>> => {
    return AdminAnalyticsRepository.getDashboard(filters);
};

export const getCompanyDistribution = async (
    filters: AnalyticsFilters
) => {
    return AdminAnalyticsRepository.getCompanyDistribution(filters);
};

export const getBrandDistribution = async (
    filters: AnalyticsFilters
) => {
    return AdminAnalyticsRepository.getBrandDistribution(filters);
};

export const getProductDistribution = async (
    filters: AnalyticsFilters
) => {
    return AdminAnalyticsRepository.getProductDistribution(filters);
};

export const getGeographyDistribution = async (
    filters: GeographyDistributionFilters
) => {
    return AdminAnalyticsRepository.getGeographyDistribution(filters);
};

export const getItemScans = async (
    filters: AnalyticsFilters
) => {
    return AdminAnalyticsRepository.getItemScans(filters);
};

export const getCompanyProducts = async (
    companyId: number,
    filters: DrilldownFilters
) => {
    return AdminAnalyticsRepository.getCompanyProducts(companyId, filters);
};

export const getBrandProducts = async (
    brandId: number,
    filters: DrilldownFilters
) => {
    return AdminAnalyticsRepository.getBrandProducts(brandId, filters);
};

export const getProductCompanies = async (
    productId: number,
    filters: DrilldownFilters
) => {
    return AdminAnalyticsRepository.getProductCompanies(productId, filters);
};
