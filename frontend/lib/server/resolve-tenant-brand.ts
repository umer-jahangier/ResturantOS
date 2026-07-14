const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export async function resolveTenantBrand(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/tenants/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const payload = (await res.json()) as { data?: { name?: string } };
    return payload.data?.name?.trim() || null;
  } catch {
    return null;
  }
}
