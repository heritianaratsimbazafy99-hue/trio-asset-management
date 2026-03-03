import { supabase } from "./supabaseClient";

const ATTACHMENT_BUCKET = "asset-documents";

function sanitizeFileName(name) {
  return String(name || "document")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
}

export async function uploadAssetAttachment({ assetId, file }) {
  if (!assetId || !file) {
    throw new Error("Fichier ou actif manquant.");
  }

  const cleanName = sanitizeFileName(file.name);
  const filePath = `${assetId}/${Date.now()}-${cleanName}`;

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  return {
    bucket: ATTACHMENT_BUCKET,
    path: filePath,
    fileName: file.name,
    publicUrl: null,
  };
}

export async function saveAttachmentMetadata({
  assetId,
  fileName,
  path,
  publicUrl,
}) {
  const { data, error } = await supabase
    .from("asset_attachments")
    .insert([
      {
        asset_id: assetId,
        file_name: fileName,
        file_path: path,
        file_url: publicUrl,
      },
    ])
    .select("*");

  if (error) {
    // Fallback for projects still using a single attachment on assets.
    const { error: fallbackError } = await supabase
      .from("assets")
      .update({
        attachment_name: fileName,
        attachment_url: publicUrl,
      })
      .eq("id", assetId);

    if (fallbackError) {
      throw error;
    }

    return [];
  }

  return data || [];
}

export async function fetchAssetAttachments(assetId) {
  if (!assetId) return [];

  const { data, error } = await supabase
    .from("asset_attachments")
    .select("*")
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false });

  if (!error) {
    const rows = data || [];
    const signedRows = await Promise.all(
      rows.map(async (item) => {
        if (!item.file_path) return item;
        const { data: signedData } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .createSignedUrl(item.file_path, 60 * 60);
        return {
          ...item,
          file_url: signedData?.signedUrl || item.file_url || null,
        };
      })
    );
    return signedRows;
  }

  const { data: legacyAsset } = await supabase
    .from("assets")
    .select("attachment_name, attachment_url")
    .eq("id", assetId)
    .single();

  if (!legacyAsset?.attachment_url) return [];

  return [
    {
      id: "legacy",
      asset_id: assetId,
      file_name: legacyAsset.attachment_name || "Piece jointe",
      file_url: legacyAsset.attachment_url,
      created_at: null,
    },
  ];
}
