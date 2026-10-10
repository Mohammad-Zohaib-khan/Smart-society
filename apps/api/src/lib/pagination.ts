import type { Model, FilterQuery, SortOrder } from 'mongoose';
import { pageQuery } from '@smart-society/shared';
import { parse } from './validate.js';

export function pageParams(query: unknown) {
  return parse(pageQuery, query);
}

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  query: unknown,
  sort: Record<string, SortOrder>,
) {
  const { page, pageSize } = pageParams(query);
  const [items, total] = await Promise.all([
    model
      .find(filter)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    model.countDocuments(filter),
  ]);
  return { items, page, pageSize, total };
}
