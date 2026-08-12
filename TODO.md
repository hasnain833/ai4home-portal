# TODO — AI Keys, Messaging & Nurture

Updated 2026-08-12. Phases 2, 3 and 4 are done. Phase 1 is left.

**Run before deploying:** `npx prisma db push` — adds `Company.aiPlatformGrant` and the three
announcement count columns.

---

## Phase 1 — Stop reporting messages as sent when they were not

Every send gets one of three outcomes instead of two:

| Outcome | When | What happens |
|---|---|---|
| Sent | Provider accepted it | Counted as sent |
| Failed | Provider rejected it, or network error | Counted as failed, parked for retry, flow continues |
| Not configured | Tenant has no credentials | Counted as skipped with a reason, not parked, flow continues |

- [ ] SMS service returns "not configured" when credentials are missing, and "failed" when the
      provider rejects — no more fake deliveries
- [ ] Delete the simulated-send helper entirely
- [ ] Stop the mail service falling back to our Brevo account. Add a "may use platform sender"
      switch, on for only 4 places: tenant registration, verification docs, workspace-active
      mail, Salesforce sync alerts
- [ ] Update callers to record the new outcomes: nurture steps, announcement batches,
      automation SMS action
- [ ] Fix the sales-agent booking confirmation SMS to the customer — it currently has no
      configuration at all, so the customer never receives it *(see open question 2)*
- [x] Leave the superadmin SMS path alone — already correct, env credentials are only reachable
      through the "SYSTEM" marker

*Touches: SMS service, mail service, messaging service, nurture job, announcement job,
automation job, sales-agent controller. No migration.*

---

## Phase 3 — Show tenants what will and will not be delivered ✅ DONE

Decided: **disable with an explanation**, never hide.

- [x] `GET /api/messaging-settings/capabilities` — email yes/no, SMS yes/no, which provider.
      No secrets, so readable by any staff role
- [x] Shared `useMessagingCapabilities()` hook, on the existing query cache
- [x] Campaign step-type picker and announcement channel picker disable unavailable options
      with a "— not configured" label
- [x] Warning banner on both pages, linking to Settings → Messaging
- [x] "will not send" badge on existing campaign steps whose channel is unconfigured
- [x] Server-side enforcement:
  - [x] Announcements rejected on an unconfigured channel, before the audience is gathered
  - [x] Saving a campaign with unsendable steps warns, never blocks
  - [x] Enrolling into a campaign with unsendable steps warns
  - [x] Automation SMS action skips with "sms not configured"

*"Configured" is computed from the same config the senders use, so the UI can never claim a
channel works when a send would be skipped. While the check is loading both channels are
assumed available, so a slow request never flashes a false warning.*

---

## Phase 2 — Nurture agent freezing ✅ DONE

- [x] Move the enrollment lookup inside the job's checkpoint system
- [x] Replace the once-per-enrollment lock with a concurrency limit of 1, so a failed run can
      be restarted
- [x] Add a 15-minute sweep that restarts stalled enrollments
- [x] Guard the cosmetic "mark lead as nurturing" write
- [x] Load messaging credentials once per run in the automation job, not once per action
- [x] Add sent/failed/skipped columns and persist announcement totals
- [x] **Fixed a duplicate-send bug found during the work** — the job recorded the step it had
      just finished and resumed *at* that step, so any restart re-sent the last message. The
      position now means "step to run next"; reply attribution, the calendar view and the
      progress counter were corrected to match
- [x] **Nurture failures were never recorded** — the enrollment event carried no company id, so
      the failure handler discarded them all. Fixed
- [x] ~~Wrap the error-parking calls~~ — not needed, they already catch their own errors

*Credentials load inside the send step, not a checkpoint, so decrypted passwords never get
written into the job history. 20 tests pass.*

---

## Phase 4 — Tenant keys & admin-granted platform keys ✅ DONE

Tenant's own key wins; platform key only with an admin grant; no environment fallback.
Claude and OpenAI only — Groq removed.

- [x] Single resolver module answering "which AI key does this company use?", with a short cache
- [x] Both AI entry points require a company id — no optional argument left to forget
- [x] Delete the two copy-pasted provider blocks, plus three dead reads of encrypted keys
- [x] Store platform keys encrypted in the existing platform-settings table
- [x] Add `Company.aiPlatformGrant`, writable only by superadmin
- [x] Superadmin screen (Admin → AI Keys): set/rotate/remove keys, grant per tenant, audited
- [x] Tenant screen: Claude added, real "Platform key" option that's disabled without a grant
- [x] Add the OpenAI branch to the scheduling agent — it was Anthropic-only
- [x] Remove Groq entirely
- [x] Fix the "is AI available" check to reflect the resolved config
- [x] Remove `ANTHROPIC_API_KEY` from env, README and code

*13 tests cover the resolution order. Token counts are captured and logged per company but not
yet persisted (see open question 3).*

---

## Open questions

- [x] **1 — Phase 3:** disable with an explanation *(answered — built that way)*
- [ ] **2 — Phase 1:** the sales-agent booking confirmation SMS to the customer — send via the
      platform sender, or remove it?
- [ ] **3 — Phase 4:** persist per-tenant AI token usage so you can see cost, or is the log enough?
- [ ] **4 — Phase 4:** tenants who saved a Groq key still have that row. It's ignored now, so
      their AI is off until they enter a Claude/OpenAI key or you grant them one. Want a
      one-off cleanup?
