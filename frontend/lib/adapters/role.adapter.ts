import type {
  ApiPermissionEntry,
  ApiPermissionModule,
} from "@/lib/api-client/schemas/role.schema";
import type { PermissionEntry, PermissionModule } from "@/lib/models/role.model";

/**
 * Wire → domain for the permission catalogue (S3).
 *
 * <p>One job, as everywhere else in this layer: collapse `undefined` to `null`. The wire allows
 * `description` to be absent OR null, and a component that has to test both eventually tests one.
 */
export function adaptPermissionEntry(api: ApiPermissionEntry): PermissionEntry {
  return {
    code: api.code,
    module: api.module,
    description: api.description ?? null,
  };
}

/**
 * Module order and code order are the DATABASE's, preserved exactly.
 *
 * <p>Not re-sorted here. The server returns module-major, code-minor from one ordered query
 * specifically so two reads are diffable, and a client that re-sorts is a second opinion about the
 * ordering that will quietly disagree the day a module is renamed.
 */
export function adaptPermissionModule(api: ApiPermissionModule): PermissionModule {
  return {
    module: api.module,
    permissions: api.permissions.map(adaptPermissionEntry),
  };
}
