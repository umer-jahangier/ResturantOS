import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterBar, type FilterBarFilter } from "@/components/ui/filter-bar";

/**
 * `FilterBar` — the contract from UI-SPEC §7.3 and D-38-04.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored (D-38-07)</h3>
 *
 * 1. Changed the prepended "no filter" entry to {@link Select}'s `placeholder` prop → "the
 *    no-filter entry is SELECTABLE" red (`disabled` present on the option). Restored. This is
 *    the defect the component exists to fix: a filter you cannot switch off.
 * 2. Made the chip render `filter.value` instead of the option's label → "a chip shows the
 *    label the user chose, never the raw id" red (`Category: cat-2`). Restored.
 * 3. Dropped the visible text from the chip's `aria-label`, leaving "clear this filter" →
 *    "chip's accessible name repeats its visible text" red. Restored (WCAG SC 2.5.3).
 * 4. Rendered "Clear all" unconditionally when `extraActiveCount > 0` with no `onClearAll`
 *    → "hides Clear rather than offering one that cannot clear everything" red. Restored.
 * 5. Pluralised unconditionally (`${n} filters active`) → "1 filter active" red on the
 *    singular case. Restored.
 * 6. Added `backdrop-blur-sm` to the strip → the zone assertion red on `operational` safety.
 *    Restored.
 */

const CATEGORIES: FilterBarFilter["options"] = [
  { value: "cat-1", label: "Dairy" },
  { value: "cat-2", label: "Dry goods" },
];

function makeFilter(over: Partial<FilterBarFilter> = {}): FilterBarFilter {
  return {
    id: "category",
    label: "Category",
    value: "",
    onChange: vi.fn(),
    options: CATEGORIES,
    ...over,
  };
}

describe("FilterBar — the strip (demo N2, UI-SPEC §7.3)", () => {
  it("names its region with the eyebrow title, rendered as an h2", () => {
    // PageHeader owns the page's one <h1> (it exists precisely because 60 files declared their
    // own). A filter strip is a section within that page, so it takes h2 and nothing lower.
    render(<FilterBar title="Stock levels" filters={[makeFilter()]} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Stock levels" });
    expect(heading.className).toContain("text-label");
    expect(screen.getByRole("region", { name: "Stock levels" })).toContainElement(heading);
  });

  it("still names the region when there is no title", () => {
    render(<FilterBar filters={[makeFilter()]} />);
    expect(screen.getByRole("region", { name: "Filters" })).toBeInTheDocument();
  });

  it("gives every filter a real, associated label — not an aria-label bolted on a bare select", () => {
    // inventory/stock:184 has no label at all; hr/attendance:94 has none on any of its three.
    render(<FilterBar filters={[makeFilter()]} />);
    const control = screen.getByLabelText("Category");
    expect(control.tagName).toBe("SELECT");
  });

  it("prepends a SELECTABLE no-filter option, defaulting to `All <label>`", () => {
    render(<FilterBar filters={[makeFilter()]} />);
    const control = screen.getByLabelText("Category") as HTMLSelectElement;
    const all = within(control).getByRole("option", { name: "All category" });
    expect((all as HTMLOptionElement).value).toBe("");
    // The whole point. Select's `placeholder` renders a DISABLED option so a required field
    // cannot read as answered; a filter needs the opposite — a way back to the full list.
    expect((all as HTMLOptionElement).disabled).toBe(false);
  });

  it("takes an explicit allLabel when `All category` is not the words the screen uses", () => {
    render(<FilterBar filters={[makeFilter({ allLabel: "All statuses" })]} />);
    expect(screen.getByRole("option", { name: "All statuses" })).toBeInTheDocument();
  });

  it("reports the chosen option value to the caller", async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={[makeFilter({ onChange })]} />);
    await userEvent.selectOptions(screen.getByLabelText("Category"), "cat-1");
    expect(onChange).toHaveBeenCalledWith("cat-1");
  });

  it("renders the search field with an accessible name inside a search landmark", () => {
    render(
      <FilterBar
        search={{ value: "", onChange: vi.fn(), label: "Search stock", placeholder: "Name or SKU…" }}
      />,
    );
    const box = screen.getByRole("searchbox", { name: "Search stock" });
    expect(box).toHaveAttribute("placeholder", "Name or SKU…");
    expect(screen.getByRole("search")).toContainElement(box);
  });

  it("renders the action slot and arbitrary child controls", () => {
    render(
      <FilterBar actions={<button type="button">New expense</button>}>
        <input aria-label="From date" type="date" />
      </FilterBar>,
    );
    expect(screen.getByRole("button", { name: "New expense" })).toBeInTheDocument();
    expect(screen.getByLabelText("From date")).toBeInTheDocument();
  });

  it("routes a failed options list to Select's retry, and does not dangle a label at nothing", async () => {
    // An empty dropdown says "there are none"; that is a different and more damaging statement
    // than "this did not load" (D-35-01). The label degrades to a span so it points at no id.
    const onRetry = vi.fn();
    const { container } = render(
      <FilterBar filters={[makeFilter({ error: true, onRetry })]} />,
    );
    expect(container.querySelector("label")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("FilterBar — the active-filter affordance (UI-SPEC §7.3, D-38-13)", () => {
  it("says nothing at all when nothing is filtering", () => {
    render(<FilterBar filters={[makeFilter()]} search={{ value: "", onChange: vi.fn(), label: "Search" }} />);
    expect(screen.queryByTestId("filter-bar-active-count")).toBeNull();
    expect(screen.queryByTestId("filter-bar-clear")).toBeNull();
  });

  it("counts one filter in the SINGULAR", () => {
    render(<FilterBar filters={[makeFilter({ value: "cat-1" })]} />);
    expect(screen.getByTestId("filter-bar-active-count")).toHaveTextContent("1 filter active");
  });

  it("counts the search as an active filter alongside the selects", () => {
    render(
      <FilterBar
        filters={[makeFilter({ value: "cat-1" })]}
        search={{ value: "flour", onChange: vi.fn(), label: "Search stock" }}
      />,
    );
    expect(screen.getByTestId("filter-bar-active-count")).toHaveTextContent("2 filters active");
  });

  it("ignores whitespace-only search text — a stray space is not a filter", () => {
    render(<FilterBar search={{ value: "   ", onChange: vi.fn(), label: "Search stock" }} />);
    expect(screen.queryByTestId("filter-bar-active-count")).toBeNull();
  });

  it("publishes the count on the element too, so a screenshot gate can read it", () => {
    const { container } = render(<FilterBar filters={[makeFilter({ value: "cat-1" })]} />);
    expect(container.querySelector('[data-slot="filter-bar"]')).toHaveAttribute(
      "data-active-filters",
      "1",
    );
  });

  it("shows the chosen option's LABEL in the chip, never the raw id", () => {
    render(<FilterBar filters={[makeFilter({ value: "cat-2" })]} />);
    expect(screen.getByText("Category: Dry goods")).toBeInTheDocument();
  });

  it("gives each chip an accessible name that REPEATS its visible text (SC 2.5.3)", () => {
    // A voice-control user says what they can see. "Remove filter" alone matches nothing.
    render(<FilterBar filters={[makeFilter({ value: "cat-2" })]} />);
    const chip = screen.getByRole("button", { name: /Category: Dry goods/ });
    expect(chip).toHaveAccessibleName("Category: Dry goods — clear this filter");
  });

  it("removes one filter from its own chip without touching the others", async () => {
    const onCategory = vi.fn();
    const onStatus = vi.fn();
    render(
      <FilterBar
        filters={[
          makeFilter({ value: "cat-2", onChange: onCategory }),
          makeFilter({
            id: "status",
            label: "Status",
            value: "OPEN",
            options: [{ value: "OPEN", label: "Open" }],
            onChange: onStatus,
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Category: Dry goods/ }));
    expect(onCategory).toHaveBeenCalledWith("");
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("clears every filter AND the search when the caller gives no onClearAll", async () => {
    const onCategory = vi.fn();
    const onSearch = vi.fn();
    render(
      <FilterBar
        filters={[makeFilter({ value: "cat-1", onChange: onCategory })]}
        search={{ value: "flour", onChange: onSearch, label: "Search stock" }}
      />,
    );
    await userEvent.click(screen.getByTestId("filter-bar-clear"));
    expect(onCategory).toHaveBeenCalledWith("");
    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("hands over to onClearAll when the caller resets its own state", async () => {
    const onClearAll = vi.fn();
    const onCategory = vi.fn();
    render(
      <FilterBar filters={[makeFilter({ value: "cat-1", onChange: onCategory })]} onClearAll={onClearAll} />,
    );
    await userEvent.click(screen.getByTestId("filter-bar-clear"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onCategory).not.toHaveBeenCalled();
  });

  it("counts filters it cannot see, when the caller declares them", () => {
    render(<FilterBar extraActiveCount={2} onClearAll={vi.fn()}>{null}</FilterBar>);
    expect(screen.getByTestId("filter-bar-active-count")).toHaveTextContent("2 filters active");
  });

  it("HIDES Clear rather than offering one that would leave hidden filters on", () => {
    // A "Clear all" that does not clear all teaches the user the list is unfiltered when it is
    // not — the same class of lie as rendering an empty state over a failed query.
    render(<FilterBar filters={[makeFilter({ value: "cat-1" })]} extraActiveCount={1} />);
    expect(screen.getByTestId("filter-bar-active-count")).toHaveTextContent("2 filters active");
    expect(screen.queryByTestId("filter-bar-clear")).toBeNull();
  });

  it("restores Clear once onClearAll can reach the hidden filters", () => {
    render(
      <FilterBar filters={[makeFilter({ value: "cat-1" })]} extraActiveCount={1} onClearAll={vi.fn()} />,
    );
    expect(screen.getByTestId("filter-bar-clear")).toBeInTheDocument();
  });

  it("is readable with no colour at all — the count and the chip both carry words", () => {
    // D-38-13: hue is never the only channel. Strip the tint and "2 filters active" plus
    // "Category: Dairy" still says exactly what is on.
    render(
      <FilterBar
        filters={[makeFilter({ value: "cat-1" })]}
        search={{ value: "flour", onChange: vi.fn(), label: "Search stock" }}
      />,
    );
    expect(screen.getByText("2 filters active")).toBeInTheDocument();
    expect(screen.getByText("Category: Dairy")).toBeInTheDocument();
    expect(screen.getByText("Search: flour")).toBeInTheDocument();
  });
});

describe("FilterBar — zone discipline (D-38-04) and the type contract (G1)", () => {
  function ownClassNames(container: HTMLElement): string[] {
    // Everything the FilterBar itself styles — excluding the shared Button/Input/Select, whose
    // class strings are their own files' contract (and their own baseline entries).
    return Array.from(container.querySelectorAll<HTMLElement>("*"))
      .filter((el) => el.closest('[data-slot="button"]') === null)
      .filter((el) => el.dataset.slot !== "input" && el.dataset.slot !== "select")
      .map((el) => el.className)
      .filter((c) => typeof c === "string" && c.length > 0);
  }

  it("carries no backdrop-filter, no entrance animation and no transform of any kind", () => {
    // A transform creates a containing block, and G6 measures containingBlockCreators: 0 on
    // app/pos/**. That is why the search icon is centred with inset-y-0 + flex rather than the
    // conventional top-1/2 -translate-y-1/2.
    const { container } = render(
      <FilterBar
        title="Stock levels"
        filters={[makeFilter({ value: "cat-1" })]}
        search={{ value: "flour", onChange: vi.fn(), label: "Search stock" }}
        actions={<span>action</span>}
      />,
    );
    for (const cls of ownClassNames(container)) {
      expect(cls).not.toMatch(/backdrop-(blur|filter|saturate)/);
      expect(cls).not.toMatch(/\banimate-/);
      expect(cls).not.toMatch(/\b-?(translate|scale|rotate|skew)-/);
      expect(cls).not.toMatch(/\bglass-surface\b/);
      expect(cls).not.toMatch(/\bvdl-lift\b/);
    }
  });

  it("uses the contract type roles and never Tailwind's stock scale", () => {
    const { container } = render(
      <FilterBar
        title="Stock levels"
        filters={[makeFilter({ value: "cat-1" })]}
        search={{ value: "flour", onChange: vi.fn(), label: "Search stock" }}
      />,
    );
    for (const cls of ownClassNames(container)) {
      expect(cls).not.toMatch(/\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/);
      expect(cls).not.toMatch(/\brounded(?![-\w])/);
    }
    expect(screen.getByTestId("filter-bar-active-count").className).toContain("text-small");
    expect(screen.getByRole("heading", { level: 2 }).className).toContain("text-label");
  });

  it("drops its own surface in the `bare` variant so it can sit inside someone else's card", () => {
    const { container } = render(<FilterBar variant="bare" title="Top customers" />);
    const root = container.querySelector('[data-slot="filter-bar"]') as HTMLElement;
    expect(root.className).not.toMatch(/\bbg-card\b/);
    expect(root.className).not.toMatch(/\brounded-xl\b/);
    expect(container.querySelector('[data-slot="filter-bar-strip"]')?.className).toContain("px-0");
  });

  it("keeps the demo's 16px/20px header-strip rhythm in the card variant", () => {
    const { container } = render(<FilterBar title="Stock levels" />);
    const strip = container.querySelector('[data-slot="filter-bar-strip"]') as HTMLElement;
    expect(strip.className).toContain("px-5");
    expect(strip.className).toContain("py-4");
  });
});
