-- Back to an empty database (4.1.10): version 1 is the first, so going down drops everything it made.
DROP TABLE quarantine;
DROP TABLE signing_keys;
DROP TABLE revoked_tokens;
DROP TABLE signals;
DROP INDEX pairings_expiry;
DROP TABLE pairings;
DROP INDEX players_capability;
DROP TABLE players;
