import { supabase } from "./supabaseClient";

function emailLocalPart(email) {
  if (!email || typeof email !== "string") return "";
  const [localPart] = email.split("@");
  return localPart || "";
}

function buildDisplayLabel(entry) {
  if (!entry) return "-";
  return entry.label || entry.full_name || emailLocalPart(entry.email) || entry.id || "-";
}

async function fetchLabelsViaRpc(ids = null) {
  const { data, error } = await supabase.rpc("get_user_labels", {
    p_ids: ids,
  });

  if (error) return null;
  return data || [];
}

export async function fetchUserDirectoryList() {
  const rpcRows = await fetchLabelsViaRpc(null);
  if (rpcRows) {
    return rpcRows.map((row) => ({
      id: row.id,
      label: row.label,
      full_name: row.label,
    }));
  }

  const { data, error } = await supabase
    .from("user_directory")
    .select("id, email, full_name")
    .order("email", { ascending: true });

  if (error) return [];
  return (data || []).map((entry) => {
    const label = buildDisplayLabel(entry);
    return {
      ...entry,
      label,
      full_name: entry.full_name || label,
    };
  });
}

export async function fetchUserDirectoryMapByIds(rawIds = []) {
  const ids = Array.from(new Set((rawIds || []).filter(Boolean)));
  if (!ids.length) return {};

  const rpcRows = await fetchLabelsViaRpc(ids);
  if (rpcRows) {
    const map = {};
    rpcRows.forEach((row) => {
      map[row.id] = {
        id: row.id,
        label: row.label,
      };
    });
    return map;
  }

  const { data, error } = await supabase
    .from("user_directory")
    .select("id, email, full_name")
    .in("id", ids);

  if (error || !data) {
    return {};
  }

  const map = {};
  data.forEach((entry) => {
    map[entry.id] = {
      ...entry,
      label: buildDisplayLabel(entry),
    };
  });
  return map;
}

export function getUserLabelById(userMap, userId) {
  if (!userId) return "-";
  return userMap?.[userId]?.label || userId;
}
