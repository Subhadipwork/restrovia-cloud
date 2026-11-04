-- gen_random_uuid() is built into PostgreSQL 13+; citext gives case-insensitive emails.
CREATE EXTENSION IF NOT EXISTS citext;
