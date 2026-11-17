-- Immutable document snapshots for every signature round, including revised plans.
CREATE TABLE ad.development_document_versions (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id integer NOT NULL REFERENCES ad.development_plans(id),
 signature_round integer NOT NULL,
 signed_text text NOT NULL,
 document_hash text NOT NULL,
 created_by integer NOT NULL REFERENCES ad.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,signature_round)
);
INSERT INTO ad.development_document_versions(plan_id,signature_round,signed_text,document_hash,created_by,created_at)
 SELECT DISTINCT ON (plan_id,signature_round) plan_id,signature_round,signed_text,document_hash,user_id,signed_at
 FROM ad.development_signatures ORDER BY plan_id,signature_round,signed_at
 ON CONFLICT DO NOTHING;
INSERT INTO ad.development_document_versions(plan_id,signature_round,signed_text,document_hash,created_by)
 SELECT id,signature_round,signed_text,document_hash,created_by FROM ad.development_plans WHERE signed_text IS NOT NULL
 ON CONFLICT DO NOTHING;
