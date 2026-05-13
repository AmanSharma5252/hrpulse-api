const supabase     = require("../config/supabase");
const asyncHandler = require("../utils/asyncHandler");

// GET /api/v1/company/settings
exports.getSettings = asyncHandler(async (req, res) => {
  const { company_id } = req.user;

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, logo_url, signature_url, address, phone, email, website, pf_pct, tax_pct, esic_pct")
    .eq("id", company_id)
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, company: data });
});

// PATCH /api/v1/company/settings
// Updates name, address, phone, email, website, logo_url, signature_url
exports.updateSettings = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const { name, address, phone, email, website, logo_url, signature_url } = req.body;

  const updates = {};
  if (name          != null) updates.name           = name;
  if (address       != null) updates.address        = address;
  if (phone         != null) updates.phone          = phone;
  if (email         != null) updates.email          = email;
  if (website       != null) updates.website        = website;
  if (logo_url      != null) updates.logo_url       = logo_url;
  if (signature_url != null) updates.signature_url  = signature_url;

  const { error } = await supabase
    .from("companies")
    .update(updates)
    .eq("id", company_id);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, message: "Company settings updated" });
});

// POST /api/v1/company/upload-asset
// Accepts { type: "logo" | "signature", base64: "data:image/png;base64,..." }
// Uploads to Supabase Storage bucket "company-assets" and saves the URL
exports.uploadAsset = asyncHandler(async (req, res) => {
  const { company_id } = req.user;
  const { type, base64 } = req.body;

  if (!["logo", "signature"].includes(type)) {
    return res.status(400).json({ success: false, error: "type must be logo or signature" });
  }
  if (!base64) {
    return res.status(400).json({ success: false, error: "base64 is required" });
  }

  // Strip the data URI prefix and get the mime type
  const matches = base64.match(/^data:(.+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ success: false, error: "Invalid base64 format" });

  const mimeType  = matches[1]; // e.g. image/png
  const ext       = mimeType.split("/")[1] || "png";
  const buffer    = Buffer.from(matches[2], "base64");
  const filePath  = `${company_id}/${type}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("company-assets")
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: true,  // overwrite if already exists
    });

  if (uploadError) return res.status(500).json({ success: false, error: uploadError.message });

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from("company-assets")
    .getPublicUrl(filePath);

  const publicUrl = urlData.publicUrl;

  // Save the URL to the companies table
  const column = type === "logo" ? "logo_url" : "signature_url";
  await supabase.from("companies").update({ [column]: publicUrl }).eq("id", company_id);

  res.json({ success: true, url: publicUrl, message: `${type} uploaded successfully` });
});