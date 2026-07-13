import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RevisionBadge, RevisionCountChip } from "@/components/pos/revision-chip";

describe("RevisionBadge", () => {
  it("renders no pill for Rev 1 (default treatment, reduces visual noise)", () => {
    const { container } = render(<RevisionBadge revisionNo={1} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a "REV 2" pill for Rev 2', () => {
    render(<RevisionBadge revisionNo={2} />);
    expect(screen.getByText("REV 2")).toBeInTheDocument();
  });

  it('renders a "REV 5" pill for Rev 5, with an accessible label', () => {
    render(<RevisionBadge revisionNo={5} />);
    const pill = screen.getByText("REV 5");
    expect(pill).toHaveAttribute("aria-label", "Revision 5");
  });

  it("uses the accent token, not the pipeline-stage or success/warning/destructive hues", () => {
    render(<RevisionBadge revisionNo={3} />);
    const pill = screen.getByText("REV 3");
    expect(pill.className).toContain("bg-accent");
    expect(pill.className).not.toMatch(/\b(success|warning|destructive|info)\b/);
  });
});

describe("RevisionCountChip", () => {
  it("renders nothing when there are no revisions", () => {
    const { container } = render(<RevisionCountChip revisions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a "2 revisions" chip, collapsed by default', () => {
    render(
      <RevisionCountChip
        revisions={[
          { revisionNo: 1, firedAt: "2026-07-11T10:00:00Z", itemCount: 2 },
          { revisionNo: 2, firedAt: "2026-07-11T10:15:00Z", itemCount: 1 },
        ]}
      />,
    );
    expect(screen.getByText("2 revisions")).toBeInTheDocument();
    expect(screen.queryByTestId("revision-log")).not.toBeInTheDocument();
  });

  it('uses singular "1 revision" for a single entry', () => {
    render(
      <RevisionCountChip revisions={[{ revisionNo: 1, firedAt: null, itemCount: 3 }]} />,
    );
    expect(screen.getByText("1 revision")).toBeInTheDocument();
  });

  it("expands to the revision log on click", async () => {
    const user = userEvent.setup();
    render(
      <RevisionCountChip
        revisions={[
          { revisionNo: 1, firedAt: "2026-07-11T10:00:00Z", itemCount: 2 },
          { revisionNo: 2, firedAt: "2026-07-11T10:15:00Z", itemCount: 1 },
        ]}
      />,
    );

    const trigger = screen.getByLabelText("2 revisions");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const log = screen.getByTestId("revision-log");
    expect(log).toHaveTextContent("Rev 1 ·");
    expect(log).toHaveTextContent("2 items");
    expect(log).toHaveTextContent("Rev 2 ·");
    expect(log).toHaveTextContent("1 item");
  });
});
