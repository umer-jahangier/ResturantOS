# Cloud topology and employee sync — what the remaining plans cover, and four things they do not

**Written 2026-08-12, after the user stated the deployment shape:** *"the app will be running on cloud
somewhere else while the users will be accessing it from their browser, so make sure to keep these
context in mind for external devices like attendance terminals to sync employees ids and attendance
with our app"*

This document answers one question: **do plans 25-06, 25-07, 25-09 … 25-13 as written deliver that?**
Checked by reading the plans, not by assuming. Answer: **mostly yes, and four real gaps.**

## The topology is already right, and this is the good news

RestaurantOS runs in a cloud datacentre; the terminal sits on a restaurant LAN behind NAT. ADMS/iClock
is the correct protocol for exactly this shape: **the terminal dials out**. No inbound firewall rule,
no port forward, no VPN, nothing installed at the restaurant. What 25-08 built works over the internet
unchanged — the credential seam, the source-address bound and the observed-address recording are all
transport-agnostic.

Two things already in place because of that plan, confirmed against the code:

- **CIDR is supported.** `DeviceCredentialPolicy.addressAllowed` parses entries as networks, so an ISP
  block (`203.0.113.0/24`) is allowable where a static IP is not available. Asserted by
  `DeviceCredentialPolicyIT.aCidrRangeMatchesAnAddressInsideIt`.
- **The observed refusal address is recorded**, with `last_refused_at` beside it, so "when did the
  address last change" is answerable. Proven live: a refusal from `203.0.113.55` wrote that address to
  the device row.

## What the remaining plans DO cover

| Requirement | Plan | Evidence |
|---|---|---|
| Durable per-device command queue (offline device still gets what it missed) | **25-07** Task 2 | "a durable command queue with a closed command set" |
| Closed command set, no free text | **25-07** Task 2 | *"the protocol's own command set includes running an arbitrary shell command on the terminal's operating system"* — stronger than asked for, and correctly reasoned |
| `DATA UPDATE USERINFO` enrolment over `getrequest` | **25-07** Task 3 | "returns the data-update form carrying that reference and that employee's display name"; it also notes real firmware **rejects** the naive add-user form and accepts only data-update |
| Ack-driven state, incl. the failure code | **25-07** Task 3 | "Acknowledging it with the documented syntax-error code records that code and does not mark the enrolment successful" |
| Bounded retry — no infinite redelivery | **25-07** | "an unacknowledged command expires exactly once" |
| Clock-skew measurement and surfacing | **25-10** | drift derived from the two stored timestamps; both directions distinguished |
| Per-device timezone | **25-03**, **25-05** | both landed |

## The four gaps — these need amending before the plans are built to

### 1. `DATA DELETE USERINFO` for a leaver has no home, and 25-07's expiry policy is actively wrong for it

No plan mentions delete, leaver, or termination. 25-07's command set is described entirely around
enrolment.

Worse than an omission: 25-07 states **"an unacknowledged command expires exactly once"**. For an
enrolment that is correct — a joiner who was not enrolled shows up as a quarantined punch, which is
visible and fixable. **For a revocation it is the wrong policy in the dangerous direction**: an expired
`DELETE USERINFO` means a terminated employee is still enrolled on the terminal and can still clock in,
and nothing anywhere says so. Expiry and revocation need different rules — a revocation should retry
until acknowledged and escalate if it cannot be, because the failure mode is payroll fraud rather than
an inconvenience.

### 2. No roster reconciliation

25-10's single use of "reconciliation" is about *timestamps*, not the employee roster. Nothing compares
the cloud's roster against the device's. A terminal that is factory-reset, swapped under warranty, or
replaced after a failure **silently knows nobody** — every punch quarantines, and the first signal is a
month-end pile of unattributed punches. In a cloud deployment the platform never sees the device except
through its own polls, so a periodic `DATA QUERY USERINFO` comparison is the only way this is
detectable.

### 3. Nothing sets the device clock

25-10 *measures* skew; no plan *corrects* it. On a LAN a terminal often has an NTP path; behind a
domestic NAT it frequently does not, and its clock is the only clock the protocol has. A device an hour
out produces payroll an hour wrong, with every late-arrival calculation downstream corrupted. The ADMS
response can carry device time, and 25-07 already owns the handshake block — this belongs there.

**It should set time and still surface a large skew rather than silently correcting it**: a terminal
whose clock drifts hours per week is failing hardware, and quietly fixing it every poll hides the fact
that it needs replacing before it starts losing punches.

### 4. Enrolment is stated as if it were a browser action

A fingerprint template is captured **at the terminal**, by a person putting a finger on a sensor. It
cannot be enrolled from a browser. The honest flow is:

> create the employee in the cloud → the terminal learns the PIN via `DATA UPDATE USERINFO` → **someone
> walks to the device and enrols the finger** → the template syncs back

25-07 and 25-12 both use "enrolment" without distinguishing the PIN half (automatable, cloud-driven)
from the biometric half (physical, manual, at the device). 25-12 builds a mapping screen; if it implies
an admin can enrol a finger from it, that is a promise the hardware cannot keep. The plans should say
which half they mean, every time.

## Recommendation

Amend **25-07** to cover the revocation command with a retry-until-acknowledged policy distinct from
enrolment expiry, and to set device time in the handshake. Amend **25-10** or add a plan for roster
reconciliation. Amend **25-07** and **25-12** to name the PIN half and the biometric half separately.

None of this changes 25-05, which is complete. None of it invalidates 25-08, which is what made any of
it reachable.
