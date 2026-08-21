import { del, get, post, put } from "@/lib/api-client/request";
import {
  apiModifierGroupSchema,
  apiModifierOptionSchema,
  createModifierGroupInputSchema,
  createModifierInputSchema,
  updateModifierGroupInputSchema,
  updateModifierInputSchema,
  type CreateModifierGroupInput,
  type CreateModifierInput,
  type UpdateModifierGroupInput,
  type UpdateModifierInput,
} from "@/lib/api-client/schemas/modifier.schema";
import { adaptModifierGroup, adaptModifierOption } from "@/lib/adapters/modifier.adapter";
import type { ModifierGroup, ModifierOption } from "@/lib/models/modifier.model";
import { z } from "zod";

/**
 * Layer-2 repository for the modifier catalogue (S6).
 *
 * <h3>Two reads, on purpose</h3>
 *
 * `listAll()` is the TILL's read: every active group in the tenant, options attached, fetched ONCE
 * beside the menu. The alternative — a fetch per tap — puts a network round trip between the
 * cashier's finger and the configure dialog and makes an offline terminal unable to configure a
 * dish at all. `listForItemAdmin()` is the manage screen's read and includes retired rows, which a
 * till must never see.
 *
 * <h3>Every write sends every field</h3>
 *
 * PUT is a REPLACE. `updateModifierGroupInputSchema` requires `sortOrder` and `active` for the same
 * reason the menu-item and tax-class updates require theirs: wipe-by-omission has happened in this
 * codebase before.
 */
export const ModifierRepository = {
  /** The till's one read — every ACTIVE group in the tenant, with its active options. */
  async listAll(): Promise<ModifierGroup[]> {
    const raw = await get<unknown>("/api/v1/pos/menu/modifier-groups");
    return z.array(apiModifierGroupSchema).parse(raw).map(adaptModifierGroup);
  },

  /** Manage-screen read for one dish — includes retired groups and retired options. */
  async listForItemAdmin(menuItemId: string): Promise<ModifierGroup[]> {
    const raw = await get<unknown>(
      `/api/v1/pos/menu/items/${encodeURIComponent(menuItemId)}/modifier-groups/admin`,
    );
    return z.array(apiModifierGroupSchema).parse(raw).map(adaptModifierGroup);
  },

  async createGroup(menuItemId: string, input: CreateModifierGroupInput): Promise<ModifierGroup> {
    const body = createModifierGroupInputSchema.parse(input);
    const raw = await post<typeof body, unknown>(
      `/api/v1/pos/menu/items/${encodeURIComponent(menuItemId)}/modifier-groups`,
      body,
    );
    return adaptModifierGroup(apiModifierGroupSchema.parse(raw));
  },

  async updateGroup(groupId: string, input: UpdateModifierGroupInput): Promise<ModifierGroup> {
    const body = updateModifierGroupInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/menu/modifier-groups/${encodeURIComponent(groupId)}`,
      body,
    );
    return adaptModifierGroup(apiModifierGroupSchema.parse(raw));
  },

  async removeGroup(groupId: string): Promise<void> {
    await del<void>(`/api/v1/pos/menu/modifier-groups/${encodeURIComponent(groupId)}`);
  },

  async createOption(groupId: string, input: CreateModifierInput): Promise<ModifierOption> {
    const body = createModifierInputSchema.parse(input);
    const raw = await post<typeof body, unknown>(
      `/api/v1/pos/menu/modifier-groups/${encodeURIComponent(groupId)}/modifiers`,
      body,
    );
    return adaptModifierOption(apiModifierOptionSchema.parse(raw));
  },

  async updateOption(modifierId: string, input: UpdateModifierInput): Promise<ModifierOption> {
    const body = updateModifierInputSchema.parse(input);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/menu/modifiers/${encodeURIComponent(modifierId)}`,
      body,
    );
    return adaptModifierOption(apiModifierOptionSchema.parse(raw));
  },

  /**
   * Refused with `MODIFIER_GROUP_UNSATISFIABLE` when removing this option would leave its group
   * asking for more than it holds — a dialog with no exit, which takes the dish off the till.
   */
  async removeOption(modifierId: string): Promise<void> {
    await del<void>(`/api/v1/pos/menu/modifiers/${encodeURIComponent(modifierId)}`);
  },
};
