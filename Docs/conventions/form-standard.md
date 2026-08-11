# Form Standard

> **Normative.** Every form added or substantially edited from phase 35 onward MUST follow this convention. It exists because of one sentence from the product owner:
>
> *"need a lot of manual input rather than drop-downs, no form validations on run-time and do not give exact errors, **same for the whole app**."*
>
> Three complaints, three rules. This document is the answer to all three, and it is deliberately app-wide rather than HR-only.

---

## 0. The three rules

| Rule | What it means | Decision |
|---|---|---|
| **A value from a known set is a select, never a text field.** | If the system already knows the valid values — a department, a leave type, a month — the user picks. Typing produces "Waiter", "waiter" and "Wtr" as three departments and no report that can group them. | D-35-01 |
| **Validation fires as the user works, not on submit.** | A form that accepts input for two minutes and then rejects the whole thing is the specific experience being complained about. | D-35-02 |
| **An error names the field, the rule and the fix.** | Not "An unexpected error occurred", not "Bad Request". A server field path is bound to the input it names. | D-35-03 |

---

## 1. The stack — do not introduce a second one

`react-hook-form` 7.80 + `zod` 4.4.3 + the hand-rolled `createZodResolver`. All three were already here and used by twenty-odd dialogs. **The stack was never the problem.** What was missing was two lines of configuration and a place to put server errors.

Import everything from one path:

```ts
import { useStandardForm, applyServerFieldErrors } from "@/lib/forms";
```

---

## 2. The worked example

This is not illustrative pseudocode — it is the shape `__tests__/lib/forms/standard-form.test.tsx` drives, and that test is what proves the behaviours below are real.

```tsx
const schema = z.object({
  employeeNo: z.string().min(3, "Employee number must be 3–12 characters")
                        .max(12, "Employee number must be 3–12 characters"),
  department: z.string().min(1, "Choose a department"),
});

function EmployeeForm() {
  const form = useStandardForm<z.infer<typeof schema>>({
    schema,
    defaultValues: { employeeNo: "", department: "" },
  });

  const mutation = useCreateEmployee({
    onError: (error) => applyServerFieldErrors(form, error),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
        <FormField
          control={form.control}
          name="employeeNo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Employee number</FormLabel>
              <FormHint>3–12 characters</FormHint>     {/* the rule, BEFORE it is broken */}
              <FormControl><Input {...field} /></FormControl>
              <FormMessage />                          {/* the error, after */}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department</FormLabel>
              <FormControl>
                <Select
                  options={departments}                {/* from a query — never hardcoded */}
                  placeholder="Choose a department"
                  isLoading={departmentsQuery.isPending}
                  error={departmentsQuery.isError}
                  onRetry={departmentsQuery.refetch}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormSubmitButton submitState={form.submitState}>Save</FormSubmitButton>
      </form>
    </Form>
  );
}
```

---

## 3. Why `onTouched`, not `onChange`

`useStandardForm` sets `mode: "onTouched"` and `reValidateMode: "onChange"`. **Not one `useForm` call in the codebase set `mode` before phase 35**, so every form used react-hook-form's default and validated only on submit.

- Pure `onChange` validates from the first keystroke: typing the "A" of a name shows *"Name is required"* and then clears it. That is a form arguing with someone who is in the middle of complying with it.
- `onTouched` waits for the first blur — the user gets to finish a thought before being corrected.
- `reValidateMode: "onChange"` then makes every keystroke *after* that blur live, so the error clears on the character that fixes it.

**Do not debounce a synchronous rule.** Zod rules are cheap; a delayed string-length message just feels broken. Reserve `use-debounced-value` (already in the codebase — do not add a third debounce primitive) for rules that hit the network, like a uniqueness check.

---

## 4. Server errors bind to fields

`ApiError.fieldErrors` has parsed the `{error:{details:[{field,issue}]}}` envelope since phase 3 and **nothing read it** — every `onError` collapsed to a toast. So the server could say *"employee number EMP-001 is already used"* and the user saw a red rectangle in the corner while the offending input still looked fine.

```ts
onError: (error) => applyServerFieldErrors(form, error)
```

- Each `fieldErrors` entry becomes a field error at the path it names. Dotted and indexed paths (`address.city`, `slabs.0.ratePct`) resolve.
- The **first offending field is focused**, so the user is taken to the problem.
- A path with no matching field is **surfaced as a form-level error naming the path**, never dropped. A message the server took the trouble to produce and the client silently discards is worse than no message, because nobody ever learns it exists.
- An error with **no** field path falls back to `formatUserFacingError` — unchanged behaviour.

Where the form's field name differs from the API's, translate:

```ts
// The API takes paisa; the form collects rupees.
applyServerFieldErrors(form, error, { basicSalaryPaisa: "salaryRupees" });
```

**The backend half is a real obligation.** If a foreseeable rejection has no field path, add one server-side — see `35-01-SUMMARY.md` for the fourteen HR codes and the exact `details[].field` value each emits.

---

## 5. Closed sets: `Select` and `Combobox`

`components/ui/` had no `select.tsx` at all. Each screen wrote its own `<select>` with a copy of the same class string; `MenuItemFormDialog` kept a module-level `selectClass` constant for it.

| Use | When |
|---|---|
| `<Select>` | The default. Native `<select>` — keyboard- and screen-reader-correct for free, works on touch with the platform picker, cannot get stuck open inside a scroll container. |
| `<Combobox>` | Only when the set is long enough that scanning is work (an employee list) or the user knows the name better than they recognise it. |

**Options are always a prop.** There is no built-in list and no default — that is what stops a hardcoded department list being smuggled into a shared component.

**An options list has three states, and a failed load is not "empty".** Pass `isLoading`, `error` and `onRetry`. An empty dropdown reads as *"there are none"*, which is a different and far more damaging statement than *"this did not load"*.

---

## 6. A disabled submit says why

`<FormSubmitButton submitState={form.submitState}>` is disabled exactly when the form is not submittable, and renders the reason as **text associated with the button via `aria-describedby`** — not a `title`. A title is invisible on touch, invisible to keyboard users who never hover, and inconsistently announced by screen readers; it is the standard way to record an explanation nobody receives.

`submitState` is derived from react-hook-form's own `formState`, so it cannot drift from what the resolver believes.

---

## 7. Adoption ledger

Honest status. This section is updated by each plan that converts a form; do not claim a conversion that has not happened.

| Form | Status | Plan |
|---|---|---|
| — the kit itself — | ✅ built, 17 tests | 35-04 |

**Not yet converted:** every other form in the app. That is deliberate — a rule that fails 25 files on day one gets disabled. Conversion is per-plan and per-screen, and the ESLint rule that enforces adoption for *new* forms arrives in 35-07 alongside the first non-HR conversion.

**Known duplication not yet removed:** `components/shared/catalog-item-combobox.tsx` and `components/shared/uom-select.tsx` each predate `Combobox` and carry their own popover-plus-cmdk assembly. Both are expressible with the shared primitive. They are not migrated yet because that changes purchasing and inventory screens, each with its own regression surface.

---

## 8. Checklist for a new form

- [ ] `useStandardForm`, not bare `useForm`
- [ ] Every closed-set field is a `<Select>` or `<Combobox>` with options from a query
- [ ] Every constrained field has a `<FormHint>` stating the rule
- [ ] `onError` calls `applyServerFieldErrors`
- [ ] Submit is a `<FormSubmitButton>` fed `form.submitState`
- [ ] The test types into the form and asserts the message — not that `mode === "onTouched"`

That last one matters most. **A form-validation change verified by reading its own configuration is not verified.**
