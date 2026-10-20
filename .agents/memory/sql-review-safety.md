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

Non-owner test roles may not read the `unix_socket_directories` setting. Do not
grant broad settings access merely to let an isolation helper run.

**Why:** PostgreSQL rejects that metadata read for an otherwise correctly
restricted runtime role.

**How to apply:** Verify an explicitly configured private socket path, its owner
and non-symlink parent, and a Unix-socket connection instead. Keep live connection
environment variables out of child-process environments.

When using synchronous child-process tooling, direct PostgreSQL daemon output to
an explicit private log on restart as well as startup.

**Why:** A restarted daemon can retain inherited pipe handles, hanging the caller
even when the database has restarted successfully.

**How to apply:** Use `pg_ctl -l`, bounded command timeouts, and guaranteed shutdown
and disposal of only the test cluster.
