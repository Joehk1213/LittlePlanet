'use strict';

function buildProductListQuery(supabase, filters) {
  let query = supabase.from('products').select('*', { count: 'exact' });

  if (filters.requestedIds) {
    query = query.in('id', filters.requestedIds);
  } else if (filters.search !== undefined) {
    query = query.or(`name.ilike.*${filters.search}*,description.ilike.*${filters.search}*`);
  }
  if (filters.category) {
    query = query.eq('category', filters.category.trim());
  }
  if (filters.status) {
    query = query.eq('status', filters.status.trim());
  }
  if (filters.sort) {
    const [sortColumn, ascending] = filters.sort;
    query = query.order(sortColumn, { ascending });
  }

  return query;
}

module.exports = { buildProductListQuery };
