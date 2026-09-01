def expand_in(name, values, params):
    """Build a database-agnostic IN clause with individual bind params.

    Works on MySQL, SQLite, and Cloud SQL.
    Returns a string like '(:name_0, :name_1, :name_2)' and populates
    ``params`` with the corresponding key-value entries.
    """
    keys = [f"{name}_{i}" for i in range(len(values))]
    for k, v in zip(keys, values):
        params[k] = v
    return "(" + ", ".join(f":{k}" for k in keys) + ")"
