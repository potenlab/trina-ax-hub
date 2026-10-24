-- At most one owner, enforced by the database (setup is also guarded in the web module).
CREATE UNIQUE INDEX users_one_owner ON users(role) WHERE role = 'owner';
