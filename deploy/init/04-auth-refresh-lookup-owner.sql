-- auth_lookup_refresh_tenant must run as postgres so SECURITY DEFINER bypasses FORCE RLS
-- on refresh_sessions (lookup happens before app.current_tenant_id is set).
DO $$
BEGIN
  IF to_regprocedure('public.auth_lookup_refresh_tenant(text)') IS NOT NULL THEN
    ALTER FUNCTION public.auth_lookup_refresh_tenant(TEXT) OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.auth_lookup_refresh_tenant(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.auth_lookup_refresh_tenant(TEXT) TO auth_user;
  END IF;
END $$;
