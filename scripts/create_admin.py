#!/usr/bin/env python3
"""Create an admin dashboard account.

Prints a SQL statement to paste into Supabase (SQL Editor -> New query -> Run).
Nothing is sent anywhere, and no database keys are needed. Uses only Python's
standard library, so it works with the python3 that ships with macOS.

Examples:
  # Your own account, which can see and switch between every business:
  python3 scripts/create_admin.py --email you@example.com --name Saad --role superadmin

  # A business owner, who can only see their own business:
  python3 scripts/create_admin.py --email owner@school.co.uk --name "Jane" --business thames-english

The password is asked for interactively so it never lands in your shell history.
Running it again for an existing email resets that account's password, name,
role and business.
"""

import argparse
import getpass
import hashlib
import os
import sys

# Must match PBKDF2_ITERATIONS / PBKDF2_KEYLEN in api/_lib/admin-auth.js.
ITERATIONS = 600000
KEYLEN = 32
MIN_PASSWORD_LENGTH = 10


def hash_password(password):
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS, KEYLEN)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def sql_literal(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description="Create an admin dashboard account (prints SQL for Supabase).")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default=None)
    parser.add_argument("--role", choices=["owner", "superadmin"], default="owner")
    parser.add_argument("--business", help="Business slug (required for owners), e.g. northstar-plumbing")
    args = parser.parse_args()

    if args.role == "owner" and not args.business:
        parser.error("--business is required for owner accounts")

    password = getpass.getpass("Password: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if getpass.getpass("Confirm password: ") != password:
        sys.exit("Passwords don't match.")

    email = args.email.strip().lower()
    business_sql = (
        f"(select id from businesses where slug = {sql_literal(args.business)})" if args.business else "null"
    )

    print("\n-- Paste this into Supabase -> SQL Editor -> New query, then Run:\n")
    print(
        "insert into admin_users (email, name, role, business_id, password_hash)\n"
        f"values ({sql_literal(email)}, {sql_literal(args.name)}, {sql_literal(args.role)}, "
        f"{business_sql}, {sql_literal(hash_password(password))})\n"
        "on conflict (email) do update set\n"
        "  name = excluded.name, role = excluded.role,\n"
        "  business_id = excluded.business_id, password_hash = excluded.password_hash;"
    )
    if args.business:
        print(
            "\n-- If this fails with 'owner_has_business', no business has the slug "
            f"{sql_literal(args.business)} — check the slug in the businesses table."
        )


if __name__ == "__main__":
    main()
