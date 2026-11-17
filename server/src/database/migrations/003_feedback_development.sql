-- Additive extension: existing tables and evaluation data remain unchanged.
CREATE TABLE ad.development_plans (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 participant_id integer NOT NULL UNIQUE REFERENCES ad.cycle_participants(id),
 document jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_signatures','signed')),
 signature_round integer NOT NULL DEFAULT 0,
 signed_text text,
 document_hash text,
 created_by integer NOT NULL REFERENCES ad.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad.development_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id integer NOT NULL REFERENCES ad.development_plans(id),
 user_id integer NOT NULL REFERENCES ad.users(id),
 event text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_history_plan ON ad.development_history(plan_id,id);
CREATE TABLE ad.development_signatures (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id integer NOT NULL REFERENCES ad.development_plans(id),
 signature_round integer NOT NULL,
 user_id integer NOT NULL REFERENCES ad.users(id),
 functional_identity jsonb NOT NULL,
 kind text NOT NULL CHECK(kind IN ('manager','employee')),
 document_hash text NOT NULL, signed_text text NOT NULL,
 signed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,signature_round,kind), UNIQUE(plan_id,signature_round,user_id)
);
CREATE TABLE ad.development_evidence (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id integer NOT NULL REFERENCES ad.development_plans(id),
 action_id uuid NOT NULL, filename text NOT NULL, mime text NOT NULL,
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 2097152),
 sha256 text NOT NULL, user_id integer NOT NULL REFERENCES ad.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_evidence_plan ON ad.development_evidence(plan_id,action_id);
CREATE TABLE ad.development_checkins (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id integer NOT NULL REFERENCES ad.development_plans(id),
 action_id uuid NOT NULL, due_on date NOT NULL,
 notes text NOT NULL DEFAULT '', completed_at timestamptz,
 created_by integer NOT NULL REFERENCES ad.users(id), completed_by integer REFERENCES ad.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ad.development_notification_reads (
 user_id integer NOT NULL REFERENCES ad.users(id), notification_key text NOT NULL,
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,notification_key)
);
