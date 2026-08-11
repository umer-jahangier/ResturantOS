import { describe, expect, it } from "vitest";

import { changedFieldsOnly } from "@/components/settings/branch-settings-form";
import type { BranchSettings } from "@/lib/models/tenant-settings.model";

const BRANCH: BranchSettings = {
  id: "b1",
  name: "Floating Terrace HQ",
  isHq: true,
  isActive: true,
  address: null,
  phone: null,
  email: null,
  timezone: "Asia/Karachi",
  openedOn: null,
  fbrStrn: null,
  ntn: null,
};

const FORM = {
  name: "Floating Terrace HQ",
  address: "",
  phone: "",
  email: "",
  timezone: "Asia/Karachi",
  openedOn: "",
};

/**
 * `PUT /api/v1/branches/{id}` is a PATCH in disguise: `BranchService.update` applies each field
 * only when it is non-null, so a key that is absent means "leave it alone". Sending a full snapshot
 * would turn every field the user never touched into a write — which is how a colleague's
 * concurrent edit gets silently reverted by someone who only changed the phone number.
 */
describe("branch settings send only what changed", () => {
  it("sends nothing when nothing was edited", () => {
    expect(changedFieldsOnly(FORM, BRANCH)).toEqual({});
  });

  it("sends the one field that moved and no others", () => {
    expect(changedFieldsOnly({ ...FORM, phone: "+92 21 111 2222" }, BRANCH)).toEqual({
      phone: "+92 21 111 2222",
    });
  });

  it("treats a null stored value and an empty input as the same, so a blank field is not a write", () => {
    // `address` is null on the server and "" in the form. Without the null→"" normalisation in
    // `defaultsFor`, every save would write `address: ""` over a value nobody touched.
    expect(changedFieldsOnly(FORM, { ...BRANCH, address: null })).toEqual({});
  });

  it("does send an empty string when the user genuinely cleared a stored value", () => {
    expect(changedFieldsOnly(FORM, { ...BRANCH, phone: "+92 300 0000000" })).toEqual({ phone: "" });
  });

  it("never offers the read-only tax fields, whatever the form contains", () => {
    const patch = changedFieldsOnly({ ...FORM, name: "Rooftop" }, BRANCH);
    // `UpdateBranchRequest` has no field for either, so a body carrying them is a request that
    // believes it can set them.
    expect(patch).not.toHaveProperty("fbrStrn");
    expect(patch).not.toHaveProperty("ntn");
  });
});
