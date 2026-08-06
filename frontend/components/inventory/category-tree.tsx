"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ItemCategory, ItemCategoryNode } from "@/lib/adapters/inventory.adapter";

const MAX_LEVEL = 3;

/** How many levels deep a node's own subtree goes (leaf = 1). Used to compute which "Move to…"
 * targets would push the moved subtree past the 3-level cap once reparented. */
function subtreeHeight(node: ItemCategoryNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}

function collectDescendantIds(node: ItemCategoryNode, acc: Set<string>): Set<string> {
  for (const child of node.children) {
    acc.add(child.category.id);
    collectDescendantIds(child, acc);
  }
  return acc;
}

function flattenNodes(nodes: ItemCategoryNode[]): ItemCategoryNode[] {
  const out: ItemCategoryNode[] = [];
  const walk = (list: ItemCategoryNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Valid "Move to…" targets: never the node itself, never one of its descendants (cycle
 * prevention), and never a target whose level plus the moved subtree's own height would push any
 * of the moved node's descendants past the 3-level cap (this also naturally excludes every
 * level-3 node, since a subtree's height is always at least 1). */
function getValidMoveTargets(allNodes: ItemCategoryNode[], node: ItemCategoryNode): ItemCategory[] {
  const descendantIds = collectDescendantIds(node, new Set<string>());
  const height = subtreeHeight(node);
  return allNodes
    .filter((n) => n.category.id !== node.category.id)
    .filter((n) => !descendantIds.has(n.category.id))
    .filter((n) => n.category.level + height <= MAX_LEVEL)
    .map((n) => n.category);
}

function GlChip({
  label,
  code,
  inherited,
}: {
  label: string;
  code?: string | null;
  inherited: boolean;
}) {
  if (!code) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {label}: {code}
      {inherited ? <span className="text-muted-foreground"> (inherited)</span> : null}
    </span>
  );
}

interface CategoryTreeRowProps {
  node: ItemCategoryNode;
  depth: number;
  allNodes: ItemCategoryNode[];
  onEdit: (category: ItemCategory) => void;
  onAddChild: (parent: ItemCategory) => void;
  onMove: (nodeId: string, targetId: string | null) => void;
  onArchive: (category: ItemCategory) => void;
  onRestore: (category: ItemCategory) => void;
  selectedId?: string | null;
}

function CategoryTreeRow({
  node,
  depth,
  allNodes,
  onEdit,
  onAddChild,
  onMove,
  onArchive,
  onRestore,
  selectedId,
}: CategoryTreeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const { category, children } = node;
  const hasChildren = children.length > 0;
  const isArchived = category.archivedAt != null;
  const isLevel3 = category.level >= MAX_LEVEL;
  const gl = category.resolvedGlAccounts;
  const moveTargets = useMemo(() => getValidMoveTargets(allNodes, node), [allNodes, node]);
  const ingredientLabel = `${category.ingredientCount} ingredient${category.ingredientCount === 1 ? "" : "s"}`;

  return (
    <div>
      <div
        role="treeitem"
        aria-level={depth}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={selectedId === category.id}
        className={cn(
          "flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm hover:bg-muted/50",
          selectedId === category.id && "bg-primary/10",
        )}
        style={{ paddingLeft: `${(depth - 1) * 20 + 8}px` }}
      >
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="touch-target shrink-0"
            aria-label={expanded ? `Collapse ${category.name}` : `Expand ${category.name}`}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}

        <span className="flex-1 truncate">{category.name}</span>

        <span className="shrink-0 text-xs text-muted-foreground">{ingredientLabel}</span>

        <div className="flex shrink-0 flex-wrap gap-1">
          {/* The chip shows the RESOLVED code (resolvedGlAccounts), never the category's own
              possibly-null default field — Poultry has no defaultInventoryAccountCode of its own
              but must still show the inherited "1310" it resolves to from Meat & Poultry. */}
          <GlChip
            label="Inventory"
            code={gl.inventoryAccountCode}
            inherited={gl.inventoryInherited}
          />
          <GlChip label="Cost" code={gl.costAccountCode} inherited={gl.costInherited} />
          <GlChip label="Waste" code={gl.wasteAccountCode} inherited={gl.wasteInherited} />
        </div>

        {isArchived ? <StatusBadge status="archived" label="Archived" /> : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="touch-target shrink-0"
              aria-label={`Actions for ${category.name}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(category)}>Edit</DropdownMenuItem>
            {!isLevel3 && !isArchived ? (
              <DropdownMenuItem onSelect={() => onAddChild(category)}>
                Add subcategory
              </DropdownMenuItem>
            ) : null}
            {!isArchived ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {category.parentId != null ? (
                    <DropdownMenuItem onSelect={() => onMove(category.id, null)}>
                      Make top-level
                    </DropdownMenuItem>
                  ) : null}
                  {category.parentId != null && moveTargets.length > 0 ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {moveTargets.map((target) => (
                    <DropdownMenuItem
                      key={target.id}
                      onSelect={() => onMove(category.id, target.id)}
                    >
                      {target.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {isArchived ? (
              <DropdownMenuItem onSelect={() => onRestore(category)}>Restore</DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={() => onArchive(category)}>
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {hasChildren && expanded ? (
        <div>
          {children.map((child) => (
            <CategoryTreeRow
              key={child.category.id}
              node={child}
              depth={depth + 1}
              allNodes={allNodes}
              onEdit={onEdit}
              onAddChild={onAddChild}
              onMove={onMove}
              onArchive={onArchive}
              onRestore={onRestore}
              selectedId={selectedId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface CategoryTreeProps {
  nodes: ItemCategoryNode[];
  onEdit: (category: ItemCategory) => void;
  onAddChild: (parent: ItemCategory) => void;
  onMove: (nodeId: string, targetId: string | null) => void;
  onArchive: (category: ItemCategory) => void;
  onRestore: (category: ItemCategory) => void;
  selectedId?: string | null;
}

/** INV-13: the recursive, max-3-level ingredient-category tree. No tree primitive exists in this
 * codebase — assembled from ghost buttons + a DropdownMenu per row (UI-SPEC Screen 1). */
export function CategoryTree({
  nodes,
  onEdit,
  onAddChild,
  onMove,
  onArchive,
  onRestore,
  selectedId,
}: CategoryTreeProps) {
  const allNodes = useMemo(() => flattenNodes(nodes), [nodes]);

  return (
    <div role="tree" aria-label="Ingredient categories" className="rounded-lg border">
      {nodes.map((node) => (
        <CategoryTreeRow
          key={node.category.id}
          node={node}
          depth={1}
          allNodes={allNodes}
          onEdit={onEdit}
          onAddChild={onAddChild}
          onMove={onMove}
          onArchive={onArchive}
          onRestore={onRestore}
          selectedId={selectedId}
        />
      ))}
    </div>
  );
}
