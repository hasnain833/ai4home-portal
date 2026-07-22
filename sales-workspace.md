## 🏢 Additional Client Requests (beyond the SRS)

- [ ] 🔴 **Literal payment / invoice gating.** Upload invoice, "clear invoices to
      proceed", auto-share invoice, welcome email after first invoice paid. The
      document-verification gate shipped instead (env-only super-admin login,
      `/admin` UI, welcome email on approval, gated by `Company.verificationStatus` —
      no Invoice/Payment model) — decide with the client whether real invoicing is
      still required.

---
## ❓ Needs a client decision (outside current SRS)

- [ ] 🔴 **Per-company AI/LLM API key from the frontend** _(contradicts SRS)._ A
      note asked to _"send the Claude/other API key in the env to the frontend so
      every company puts their own."_ The SRS specifies the **opposite**: `SW-AGT-002`
      wants a **shared platform** LLM service (`Claude, configurable` = platform swaps
      providers, not per-tenant BYO key), and `NFR-S-003` requires provider keys to
      live in a secrets manager, **never exposed** — shipping a key to the browser
      would violate it. If per-tenant AI billing/keys are genuinely wanted, it must be
      stored and used **server-side only**, and needs explicit client sign-off first.

---

