ALTER TABLE ad.cycle_participants ADD COLUMN feedback_access boolean NOT NULL DEFAULT false;
CREATE TABLE ad.evaluation_contestations (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 participant_id integer NOT NULL REFERENCES ad.cycle_participants(id),
 requested_by integer NOT NULL REFERENCES ad.users(id),
 justification text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','returned','approved','rejected','completed')),
 analyst_id integer REFERENCES ad.users(id),
 decision text CHECK(decision IN ('maintain','authorize_revision')),
 decision_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX evaluation_one_open_contestation ON ad.evaluation_contestations(participant_id) WHERE status <> 'completed';
CREATE TABLE ad.evaluation_contestation_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 contestation_id integer NOT NULL REFERENCES ad.evaluation_contestations(id),
 user_id integer NOT NULL REFERENCES ad.users(id),
 event text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
