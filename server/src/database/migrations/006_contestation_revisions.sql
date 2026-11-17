CREATE TABLE ad.evaluation_contestation_revisions (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 contestation_id integer NOT NULL REFERENCES ad.evaluation_contestations(id),
 assignment_id integer NOT NULL REFERENCES ad.evaluation_assignments(id),
 authorized_by integer NOT NULL REFERENCES ad.users(id),
 authorized_at timestamptz NOT NULL DEFAULT now(),
 completed_by integer REFERENCES ad.users(id), completed_at timestamptz,
 response_revision integer, justification text NOT NULL,
 UNIQUE(contestation_id)
);
