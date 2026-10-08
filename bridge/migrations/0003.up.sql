-- Version 3 (4.1.17, plan §6): the leaderboards ranked in SQL. A ranked time is kept canonical (decimal digits, no
-- leading zero, at most 30 digits) so its order is its length then its text; the rows written before 4.1.17 are
-- brought to that form: leading zeros dropped ("0" kept), a value that is not a decimal of at most 30 digits set
-- aside (its time removed, its trust untouched, said in its reason). Then the index the ranking reads.
UPDATE runs SET ranked = CASE WHEN LTRIM(ranked, '0') = '' THEN '0' ELSE LTRIM(ranked, '0') END
 WHERE ranked IS NOT NULL AND ranked <> ''
   AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ranked,
       '0', ''), '1', ''), '2', ''), '3', ''), '4', ''), '5', ''), '6', ''), '7', ''), '8', ''), '9', '') = '';
UPDATE runs SET reason = COALESCE(reason, '') || ' [schema 3: the ranked time "' || ranked || '" is not a decimal of at most 30 digits; set aside]',
       ranked = NULL
 WHERE ranked IS NOT NULL
   AND (ranked = '' OR LENGTH(ranked) > 30
     OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ranked,
        '0', ''), '1', ''), '2', ''), '3', ''), '4', ''), '5', ''), '6', ''), '7', ''), '8', ''), '9', '') <> '');
CREATE INDEX runs_rank ON runs (tenant_id, game_id, category_id, status, verdict, player);
