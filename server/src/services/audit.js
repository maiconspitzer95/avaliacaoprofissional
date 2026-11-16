export async function audit(c, user, action, entity, id, details = {}) {
  await c.query(
    "INSERT INTO ad.audit(user_id,action,entity,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [
      user?.id || null,
      action,
      entity,
      id == null ? null : String(id),
      JSON.stringify(details),
    ],
  );
}
