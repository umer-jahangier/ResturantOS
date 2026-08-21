// Layer-2 adapters: raw API shapes → domain models (S6).

import type { ApiModifierGroup, ApiModifierOption } from "@/lib/api-client/schemas/modifier.schema";
import type { ModifierGroup, ModifierOption } from "@/lib/models/modifier.model";

export function adaptModifierOption(raw: ApiModifierOption): ModifierOption {
  return {
    id: raw.id,
    groupId: raw.groupId,
    name: raw.name,
    priceDeltaPaisa: raw.priceDeltaPaisa,
    sortOrder: raw.sortOrder,
    active: raw.active,
  };
}

export function adaptModifierGroup(raw: ApiModifierGroup): ModifierGroup {
  return {
    id: raw.id,
    menuItemId: raw.menuItemId,
    name: raw.name,
    required: raw.required,
    minSelect: raw.minSelect,
    maxSelect: raw.maxSelect,
    sortOrder: raw.sortOrder,
    active: raw.active,
    optionCount: raw.optionCount,
    options: raw.options.map(adaptModifierOption),
  };
}
