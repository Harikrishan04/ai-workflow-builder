CREATE OR REPLACE FUNCTION org_quota_this_month(org_row organizations)
RETURNS TABLE(calls_used int, calls_allowed int, reset_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT
    quota_used,
    quota_limit,
    quota_reset_at
  FROM organizations
  WHERE id = org_row.id;
$$;
