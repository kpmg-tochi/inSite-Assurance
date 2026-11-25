# Next steps

Work agreed with the owner but not started. Each file is self-contained: what, why, where in the code, the tests it needs.

| File | What |
| :--- | :--- |
| [seed_replacement_plan.md](seed_replacement_plan.md) | Delete the first (lender-era) tenant and replace the whole seed and its tests with data that matches what UBEC will run through the platform. |
| [resident_supervisor_web_login.md](resident_supervisor_web_login.md) | Done (R7b, 2026-11-25). Refuse web sign-in for mobile-only roles (Resident Supervisor). |
| [role_catalogue_migration_plan.md](role_catalogue_migration_plan.md) | Full role catalogue migration (final roles into `DEFAULT_TENANT_ROLES`, role-code renames, CoC signatories, one login per role), deferred until the client's full role list is known after the demo; runs with the seed replacement. |
| [client_demo_follow_ups.md](client_demo_follow_ups.md) | Everything the overnight client demo build shortcut, mocked or left out (in-depth rename, role migration, seed replacement, E2/E4, contractor replacement, …), with pointers into `client_demo_updates/implementation_plan.md`. |
| [irl_follow_ups.md](irl_follow_ups.md) | IRL items deferred until after the demo: sign-in policy (MFA, short-lived sessions, password reset), SMTP email engine, and the other gaps from the IRL coverage review. |
