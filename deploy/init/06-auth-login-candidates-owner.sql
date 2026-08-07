-- auth_lookup_login_candidates must run as postgres so SECURITY DEFINER bypasses FORCE RLS on
-- `users` (the email-first login looks a credential up before any tenant is known — that is the
-- whole point of it). Owned by auth_user, which is NOSUPERUSER NOBYPASSRLS, the function returns
-- ZERO ROWS and every unified login is refused as "invalid credentials", silently.
--
-- Same shape and same reason as 04-auth-refresh-lookup-owner.sql. Like that file, this one is a
-- no-op on a database where Liquibase has not run yet, which is why
-- deploy/scripts/verify-security-definer-owners.sh — which runs AFTER migrations — is the control
-- that actually closes the gap. This exists so a from-scratch provision is correct too.
DO $$
BEGIN
  IF to_regprocedure('public.auth_lookup_login_candidates(text)') IS NOT NULL THEN
    ALTER FUNCTION public.auth_lookup_login_candidates(TEXT) OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.auth_lookup_login_candidates(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.auth_lookup_login_candidates(TEXT) TO auth_user;
  END IF;
END $$;
