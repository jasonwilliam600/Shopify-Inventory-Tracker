---
name: Isolated mapping SQL review
description: Boundaries and non-obvious pitfalls for reviewing mapping SQL outside the application database.
---

Validate mapping proposals only in an explicitly isolated disposable PostgreSQL
cluster when the merchant requests pre-approval testing. Preserve the exact
original SQL and identify revised proposals separately.

**Why:** The merchant requires exact SQL testing before granting application
database migration approval; a successful disposable test is not that approval.

**How to apply:** Use explicit local socket/database/user connection arguments,
no inherited application database credentials, and shut down the test cluster.
Unicode SKU normalization needs a UTF-8 test database: `initdb --no-locale` alone
may default to SQL_ASCII. SQL generated through JavaScript text substitution must
preserve literal dollar quoting and dollar-anchored regexes; use a replacement
callback instead of replacement-string interpolation.
