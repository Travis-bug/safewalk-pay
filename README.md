# SafeWalk Shifts & Pay (private view)

A password-locked, view-only copy of my SafeWalk shifts and pay. The page content is encrypted; it only opens with the password.

`build/build.mjs` rebuilds `index.html` from an export of the app's data and locks it with [StatiCrypt](https://github.com/robinmoisson/staticrypt).

## Cheque Day (budget)

`budget/index.html` is a password-locked copy of the Cheque Day budget page (same password as the shifts page). It shows how each cheque splits across RBC ION Visa, KOHO and BMO Savings.

- `build/budget-expected.mjs` works out the expected take-home for the next cheques from the shifts export.
- `build/budget-build.mjs` rebuilds `budget/index.html` from an export of the budget app's data and locks it.
- `build/budget-sync.mjs` reads edits saved from the budget page (`budget-edits.json`, encrypted).
